#!/bin/sh
# Runs ON the PRIMARY database (Alpine, official postgres image). Expects in /tmp/dd: db/*.sql, db.crt, db.key
# env: APP_PW RO_PW REPL_PW PG_PW PEER (the other db node)  [SEED=1]
# Safe to run again: every SQL file is idempotent. On a standby this script refuses to run (it is read-only).
set -eu
PGDATA=${PGDATA:-/var/lib/postgresql/data}
cd /tmp/dd
chmod -R a+rX /tmp/dd   # files come from a Windows checkout with 700 perms
q() { su postgres -c "psql -q -v ON_ERROR_STOP=1 $*"; }
[ "$(su postgres -c "psql -At -d postgres -c 'select pg_is_in_recovery()'")" = f ] || { echo "this node is a STANDBY — run setup_db on the primary"; exit 1; }

# --- TLS for API <-> DB and DB <-> DB
install -o postgres -g postgres -m 600 db.key "$PGDATA/server.key"
install -o postgres -g postgres -m 644 db.crt "$PGDATA/server.crt"

# --- schema v1, v2 features + migration, roles + RLS (order matters: 01 -> 02 -> 03)
su postgres -c "psql -q -v ON_ERROR_STOP=1 -d postgres -tc \"SELECT 1 FROM pg_database WHERE datname='dormdesk'\"" | grep -q 1 \
  || su postgres -c "createdb dormdesk"
q -d dormdesk -f /tmp/dd/db/01_schema.sql
q -d dormdesk -f /tmp/dd/db/02_features.sql
q -v app_pw="'$APP_PW'" -v ro_pw="'$RO_PW'" -v repl_pw="'$REPL_PW'" -d dormdesk -f /tmp/dd/db/03_security.sql
if [ "${SEED:-0}" = "1" ]; then
  q -d dormdesk -f /tmp/dd/db/seed.generated.sql >/dev/null
fi
su postgres -c "psql -q -v ON_ERROR_STOP=1 -v pw='$PG_PW' -d postgres" <<'SQL'
ALTER ROLE postgres PASSWORD :'pw';
ALTER SYSTEM SET ssl = on;
ALTER SYSTEM SET ssl_min_protocol_version = 'TLSv1.2';
ALTER SYSTEM SET password_encryption = 'scram-sha-256';
ALTER SYSTEM SET log_connections = on;
-- streaming replication to the standby (async: a commit does not wait for db-02)
ALTER SYSTEM SET wal_level = 'replica';
ALTER SYSTEM SET max_wal_senders = 10;
ALTER SYSTEM SET max_replication_slots = 10;
ALTER SYSTEM SET hot_standby = on;
ALTER SYSTEM SET hot_standby_feedback = on;
ALTER SYSTEM SET wal_keep_size = '128MB';
ALTER SYSTEM SET max_slot_wal_keep_size = '2GB';      -- a dead standby can never fill the primary's disk
-- archive_timeout closes a WAL segment at least every 60 s even when idle; the STANDBY archives it
-- (archive_mode=always there). archive_timeout only works with archive_mode on -> ONE restart, first time only.
ALTER SYSTEM SET archive_timeout = '60s';
SQL
# a node that was built as a standby already has archive_mode=always + the gzip archive_command: keep that
# (after a failover the new primary keeps archiving). A first-time primary gets a no-op archiver.
if [ "$(su postgres -c "psql -At -d postgres -c 'SHOW archive_mode'")" = off ]; then
  su postgres -c "psql -q -d postgres -c \"ALTER SYSTEM SET archive_mode = 'on'\" -c \"ALTER SYSTEM SET archive_command = '/bin/true'\""
fi

# --- who may connect: app zone, mon-01, and the peer db (replication only). TLS + SCRAM for everything remote.
[ -f "$PGDATA/pg_hba.conf.orig" ] || cp "$PGDATA/pg_hba.conf" "$PGDATA/pg_hba.conf.orig"
chown postgres:postgres "$PGDATA/pg_hba.conf.orig"   # pg_basebackup copies every file in PGDATA as postgres
cat > "$PGDATA/pg_hba.conf" <<'HBA'
# DormDesk db-01 / db-02 (same file on both) — everything not listed is rejected
# TYPE    DATABASE     USER           ADDRESS          METHOD
local     all          all                             trust
local     replication  all                             trust
host      all          all            127.0.0.1/32     scram-sha-256
hostssl   dormdesk     dormdesk_app   10.0.2.136/29    scram-sha-256
hostssl   dormdesk     dormdesk_ro    10.0.2.165/32    scram-sha-256
hostssl   replication  dormdesk_repl  10.0.2.150/31    scram-sha-256
hostssl   postgres     dormdesk_repl  10.0.2.150/31    scram-sha-256
HBA
chown postgres:postgres "$PGDATA/pg_hba.conf"

# --- the peer + replication password for the boot-time split-brain check (root only)
mkdir -p /etc/dormdesk
[ -n "${PEER:-}" ] && echo "$PEER" > /etc/dormdesk/peer
printf '*:5432:*:dormdesk_repl:%s\n' "$REPL_PW" > /etc/dormdesk/repl.pgpass; chmod 600 /etc/dormdesk/repl.pgpass

su postgres -c "psql -q -d postgres -c 'SELECT pg_reload_conf()'" >/dev/null
sleep 1
su postgres -c "psql -At -d postgres -c 'SHOW ssl'" | sed 's/^/ssl=/'
su postgres -c "psql -At -d dormdesk -c 'SELECT count(*) FROM requests'" | sed 's/^/requests=/'
P=$(su postgres -c "psql -At -d postgres -c \"SELECT string_agg(name, ',') FROM pg_settings WHERE pending_restart\"")
[ -n "$P" ] && echo "RESTART_NEEDED=$P"
rm -rf /tmp/dd
echo DB_OK
