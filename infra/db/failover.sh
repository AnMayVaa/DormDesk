#!/bin/bash
# Promote the standby to primary. Manual on purpose (async replication + 2 nodes: a human decides that the
# primary is really dead — automatic failover needs a 3rd voter, e.g. Patroni + etcd, see roadmap).
#   HSSH=hssh infra/db/failover.sh             primary is dead/unreachable: fence it (if reachable) and promote
#   HSSH=hssh infra/db/failover.sh --planned   switchover: stop writes, wait until the standby has EVERYTHING, promote
set -uo pipefail
cd "$(dirname "$0")/../.."
HSSH=${HSSH:-hssh}
set -a; . ./secrets.env; set +a
. infra/topology.sh
P=$DB_PRIMARY S=$DB_STANDBY PLANNED=0; [ "${1:-}" = --planned ] && PLANNED=1
sq() { timeout "${3:-20}" $HSSH "$1" "su postgres -c \"psql -At -d postgres -c \\\"$2\\\"\""; }
T0=$(date +%s)
echo "== 1/5 standby $(dd_name $S) ($S)"
r=$(sq $S "select pg_is_in_recovery()") || { echo "standby unreachable — cannot fail over"; exit 1; }
[ "$r" = t ] || { echo "$S is not a standby (in_recovery=$r) — already promoted?"; exit 1; }
sq $S "select 'replay age ' || coalesce(round(extract(epoch from now()-pg_last_xact_replay_timestamp()))::text,'?') || ' s, received ' || pg_last_wal_receive_lsn() || ', replayed ' || pg_last_wal_replay_lsn()"

echo "== 2/5 fence old primary $(dd_name $P) ($P)"
FENCED=0
if timeout 25 $HSSH "$P" 'sh -s' <<'FENCE' >/dev/null; then
echo db-fenced > /etc/dormdesk/role
sh /usr/local/sbin/dd-firewall.sh db-fenced
su postgres -c "psql -q -d postgres" <<'SQL'
ALTER SYSTEM SET default_transaction_read_only = on;
SELECT pg_reload_conf();
SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename IN ('dormdesk_app', 'dormdesk_ro');
SQL
FENCE
  FENCED=1; echo "   firewall db-fenced + read-only + app sessions closed"
else
  echo "   unreachable — treated as dead. If it comes back, its boot hook sees the new primary and fences itself."
fi
if [ $PLANNED = 1 ]; then
  [ $FENCED = 1 ] || { echo "planned switchover needs a reachable primary"; exit 1; }
  L=$(sq $P "select pg_current_wal_lsn()"); echo "   waiting for standby to replay up to $L"
  for i in $(seq 1 30); do d=$(sq $S "select pg_wal_lsn_diff('$L', pg_last_wal_replay_lsn()) <= 0"); [ "$d" = t ] && break; sleep 1; done
  [ "$d" = t ] && echo "   standby has every committed transaction (zero data loss)" || { echo "   standby did not catch up"; exit 1; }
fi

echo "== 3/5 promote $(dd_name $S)"
sq $S "select pg_promote(true, 60)" 70 | sed 's/^/   promoted: /'
r=$(sq $S "select pg_is_in_recovery()"); [ "$r" = f ] || { echo "promotion failed"; exit 1; }

echo "== 4/5 topology: primary is now $S"
dd_swap_db
for ip in $API_HOSTS; do   # new DSN order (takes effect on next API restart; libpq already finds the new primary)
  echo "DATABASE_URL='$(dd_dsn dormdesk_app "$APP_PW")'" | timeout 20 $HSSH "$ip" \
    'f=/srv/dormdesk/.env; read -r L; grep -v ^DATABASE_URL= $f > $f.n; echo "$L" >> $f.n; chmod 600 $f.n; mv $f.n $f' || echo "   $ip: .env not updated"
done
[ -x infra/grafana/setup_grafana.sh ] && HSSH=$HSSH infra/grafana/setup_grafana.sh datasources 2>/dev/null | sed 's/^/   grafana: /'

echo "== 5/5 smoke test through the public URL"
sleep 3
python3 tools/smoke_test.py | tail -2
echo "failover took $(( $(date +%s) - T0 )) s. Next: infra/db/rejoin.sh  (rebuild $(dd_name $P) as the new standby)"
