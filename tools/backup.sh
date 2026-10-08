#!/bin/bash
# Backups to this laptop — OUTSIDE the lab, so they survive losing the whole lab host. Everything written
# under backups/ is encrypted (AES-256, key = BACKUP_PASSPHRASE in secrets.env) and every run proves it restores.
#   HSSH=hssh tools/backup.sh          daily : logical dump (from the standby) + WAL archive + objects, restore test
#   HSSH=hssh tools/backup.sh base     weekly: physical base backup (start point for point-in-time recovery)
#   HSSH=hssh tools/backup.sh pitr     drill : make a "mistake", then rewind a copy to 1 s before it (test A12)
# Layout: backups/daily/*.dump.enc (7 kept) backups/base/*.tar.gz.enc (4) backups/wal/*.gz.enc backups/objects/*.tar.enc (7)
set -euo pipefail
cd "$(dirname "$0")/.."
HSSH=${HSSH:-hssh}
set -a; . ./secrets.env; set +a
. infra/topology.env
: "${BACKUP_PASSPHRASE:?add BACKUP_PASSPHRASE to secrets.env}"
B=backups; mkdir -p $B/daily $B/base $B/wal $B/objects; chmod 700 $B
TS=$(date +%Y%m%d_%H%M%S)
enc() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE; }
dec() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE; }
pg() { $HSSH "$1" "su postgres -c 'psql -At -v ON_ERROR_STOP=1 -d ${3:-postgres}'" <<<"$2"; }
ARCH=/var/lib/postgresql/wal_archive

# read from the standby when it is healthy (no load on the primary), else from the primary
SRC=$DB_STANDBY
[ "$(pg "$DB_STANDBY" 'select pg_is_in_recovery()' 2>/dev/null)" = t ] || { echo "! standby not available — using the primary"; SRC=$DB_PRIMARY; }

pull_wal() {   # copy archived WAL segments we do not have yet, from both nodes (either may be primary)
  local node have need n=0 t f
  for node in $DB_PRIMARY $DB_STANDBY; do
    have=$(cd $B/wal && ls 2>/dev/null | sed 's/\.enc$//' | sort)
    need=$(comm -13 <(echo "$have") <($HSSH "$node" "ls $ARCH 2>/dev/null" 2>/dev/null | grep -E '\.gz$' | sort) || true)
    [ -z "$need" ] && continue
    t=$(mktemp -d)
    # shellcheck disable=SC2086
    $HSSH "$node" "cd $ARCH && tar cf - $(echo $need)" | tar xf - -C "$t"
    for f in "$t"/*; do enc < "$f" > "$B/wal/$(basename "$f").enc"; n=$((n+1)); done
    rm -rf "$t"
    $HSSH "$node" "find $ARCH -name '*.gz' -mtime +10 -delete" || true   # on-node copy only needs ~10 days
  done
  echo "wal: +$n segments ($(ls $B/wal | wc -l) total)"
}

base() {
  local f=$B/base/base_$TS.tar.gz.enc
  echo "base backup from $SRC ..."
  $HSSH "$SRC" "su postgres -c 'pg_basebackup -D - -Ft -X fetch -z -c fast'" | enc > "$f"
  echo "base: $f ($(du -h "$f" | cut -f1))"
  ls -1t $B/base/*.enc | tail -n +5 | xargs -r rm -f                    # keep 4
  local oldest; oldest=$(ls -1t $B/base/*.enc | tail -1)
  find $B/wal -name '*.enc' ! -newer "$oldest" -mmin +1440 -delete        # WAL older than the oldest base is useless
}

daily() {
  local f=$B/daily/dormdesk_$TS.dump.enc o=$B/objects/objects_$TS.tar.enc api
  $HSSH "$SRC" "su postgres -c 'pg_dump -Fc dormdesk'" | enc > "$f"
  echo "dump: $f ($(du -h "$f" | cut -f1)) from $SRC"
  pull_wal
  # objects: only the API tier can reach store-01; the dump runs with the READ-ONLY backup identity
  api=${API_HOSTS%% *}
  printf '%s\n%s\n' "$S3_BACKUP_KEY" "$S3_BACKUP_SECRET" | $HSSH "$api" \
    'cd /srv/dormdesk && set -a && . ./.env && set +a && read -r K && read -r S && S3_ACCESS_KEY=$K S3_SECRET_KEY=$S ./venv/bin/python -m app.objbackup dump' \
    | enc > "$o"
  echo "objects: $o ($(du -h "$o" | cut -f1))"; dec < "$o" | (cd api && python3 -m app.objbackup verify)
  # restore test: decrypt the LAPTOP copy, restore it into a throw-away database, compare row counts
  dec < "$f" | $HSSH "$DB_PRIMARY" 'cat > /tmp/r.dump && chmod 644 /tmp/r.dump && su postgres -c "
    dropdb --if-exists dormdesk_restore_test && createdb dormdesk_restore_test &&
    pg_restore -d dormdesk_restore_test --no-owner /tmp/r.dump || echo pg_restore_failed;
    for t in dorms rooms tenancies requests bills fines bookings checkins parking_permits objects; do
      a=\$(psql -At -d dormdesk -c \"select count(*) from \$t\"); b=\$(psql -At -d dormdesk_restore_test -c \"select count(*) from \$t\");
      echo \"  \$t: live=\$a restored=\$b\"; done;
    dropdb dormdesk_restore_test"; rm -f /tmp/r.dump' | tee /tmp/dd-restore.txt
  awk '/live=/ {n++; split($2,a,"="); split($3,b,"="); if (b[2] == "" || b[2] + 0 < a[2] - 5) bad=1} END {exit (bad || n < 10)}' /tmp/dd-restore.txt \
    || { echo "RESTORE TEST FAILED"; exit 1; }
  pg "$DB_PRIMARY" "INSERT INTO ops_meta (key, value, updated_at) VALUES ('backup_last_ok', 'dump $(du -h "$f" | cut -f1), objects $(du -h "$o" | cut -f1), wal $(ls $B/wal | wc -l)', now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();" dormdesk >/dev/null
  ls -1t $B/daily/*.enc | tail -n +8 | xargs -r rm -f; ls -1t $B/objects/*.enc | tail -n +8 | xargs -r rm -f
  echo "BACKUP_OK"
}

pitr() {   # proves RPO "1 minute before the mistake" with the LAPTOP copies only
  [ -n "$(ls $B/base/*.enc 2>/dev/null)" ] || base
  local bb probe good t0 wf f
  bb=$(ls -1t $B/base/*.enc | head -1); probe="good-$TS"
  echo "1) primary: write '$probe', then a 'mistake' 3 s later"
  pg "$DB_PRIMARY" "INSERT INTO ops_meta (key, value) VALUES ('pitr_probe', '$probe') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();" dormdesk >/dev/null
  sleep 2; good=$(pg "$DB_PRIMARY" "select now()"); sleep 2
  pg "$DB_PRIMARY" "UPDATE ops_meta SET value = 'MISTAKE', updated_at = now() WHERE key = 'pitr_probe';" dormdesk >/dev/null
  wf=$(pg "$DB_PRIMARY" "select pg_walfile_name(pg_current_wal_lsn())"); pg "$DB_PRIMARY" "select pg_switch_wal()" >/dev/null
  echo "   target time = $good (between the good write and the mistake); waiting for $wf in the archive"
  for i in $(seq 1 30); do $HSSH "$SRC" "test -f $ARCH/$wf.gz" && break; sleep 2; done
  pull_wal
  echo "2) restore $(basename "$bb") + WAL on $(echo "$SRC") into a temporary server (port 5499, no network)"
  local R=/var/lib/postgresql/pitr W=/var/lib/postgresql/pitr_wal
  $HSSH "$SRC" "rm -rf $R $W && install -d -o postgres -g postgres -m 700 $R $W"
  dec < "$bb" | $HSSH "$SRC" "su postgres -c 'tar xzf - -C $R && touch $R/recovery.signal && rm -f $R/standby.signal'"
  t0=$(mktemp -d); for f in $B/wal/*.enc; do dec < "$f" > "$t0/$(basename "$f" .enc)"; done
  tar cf - -C "$t0" . | $HSSH "$SRC" "su postgres -c 'tar xf - -C $W'"; rm -rf "$t0"
  # recovery settings appended to the copy's postgresql.auto.conf (the last value of a setting wins)
  $HSSH "$SRC" "su postgres -c 'cat >> $R/postgresql.auto.conf'" <<CONF
# --- PITR drill (temporary server, no network, no archiving)
listen_addresses = ''
unix_socket_directories = '/tmp'
port = 5499
shared_buffers = '16MB'
hot_standby = off
archive_mode = off
primary_conninfo = ''
primary_slot_name = ''
restore_command = 'gunzip -c $W/%f.gz > %p'
recovery_target_time = '$good'
recovery_target_action = 'promote'
CONF
  $HSSH "$SRC" "su postgres -c 'pg_ctl -D $R -l /var/lib/postgresql/pitr.log -w -t 180 start'" >/dev/null
  local got; got=$($HSSH "$SRC" "su postgres -c \"psql -h /tmp -p 5499 -At -d dormdesk -c \\\"select value from ops_meta where key='pitr_probe'\\\"\"")
  $HSSH "$SRC" "su postgres -c 'pg_ctl -D $R -m immediate stop' >/dev/null; tail -3 /var/lib/postgresql/pitr.log; rm -rf $R $W /var/lib/postgresql/pitr.log"
  echo "3) restored value = '$got' (live value is 'MISTAKE')"
  pg "$DB_PRIMARY" "UPDATE ops_meta SET value = 'pitr drill ok $TS', updated_at = now() WHERE key = 'pitr_probe';
     INSERT INTO ops_meta (key, value) VALUES ('pitr_last_ok', '$TS') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();" dormdesk >/dev/null
  [ "$got" = "$probe" ] && echo "PITR_OK" || { echo "PITR_FAILED"; exit 1; }
}

case "${1:-daily}" in
  daily) daily ;;
  base)  base ;;
  pitr)  pitr ;;
  *) echo "usage: $0 [daily|base|pitr]"; exit 1 ;;
esac
