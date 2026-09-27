#!/bin/sh
# Runs ON db-01 (Alpine, official postgres image). Expects in /tmp/dd: db/*.sql, db.crt, db.key
# env: APP_PW RO_PW PG_PW  [SEED=1]
set -eu
PGDATA=${PGDATA:-/var/lib/postgresql/data}
cd /tmp/dd
chmod -R a+rX /tmp/dd   # files come from a Windows checkout with 700 perms
PSQL="su postgres -c"   # local socket, run as postgres

# --- TLS for API <-> DB
install -o postgres -g postgres -m 600 db.key "$PGDATA/server.key"
install -o postgres -g postgres -m 644 db.crt "$PGDATA/server.crt"

# --- schema, roles, RLS
su postgres -c "psql -q -v ON_ERROR_STOP=1 -d postgres -tc \"SELECT 1 FROM pg_database WHERE datname='dormdesk'\"" | grep -q 1 \
  || su postgres -c "createdb dormdesk"
su postgres -c "psql -q -v ON_ERROR_STOP=1 -d dormdesk -f /tmp/dd/db/01_schema.sql"
su postgres -c "psql -q -v ON_ERROR_STOP=1 -v app_pw='$APP_PW' -v ro_pw='$RO_PW' -d dormdesk -f /tmp/dd/db/02_security.sql"
if [ "${SEED:-0}" = "1" ]; then
  su postgres -c "psql -q -v ON_ERROR_STOP=1 -d dormdesk -f /tmp/dd/db/seed.generated.sql" >/dev/null
fi
su postgres -c "psql -q -v ON_ERROR_STOP=1 -v pw='$PG_PW' -d postgres" <<'SQL'
ALTER ROLE postgres PASSWORD :'pw';
ALTER SYSTEM SET ssl = on;
ALTER SYSTEM SET ssl_min_protocol_version = 'TLSv1.2';
ALTER SYSTEM SET password_encryption = 'scram-sha-256';
ALTER SYSTEM SET log_connections = on;
SQL

# --- who may connect: only the app zone (api-01/02) and mon-01, only over TLS, only to dormdesk
[ -f "$PGDATA/pg_hba.conf.orig" ] || cp "$PGDATA/pg_hba.conf" "$PGDATA/pg_hba.conf.orig"
cat > "$PGDATA/pg_hba.conf" <<'HBA'
# DormDesk db-01 — everything not listed is rejected
# TYPE    DATABASE  USER           ADDRESS          METHOD
local     all       all                             trust
host      all       all            127.0.0.1/32     scram-sha-256
hostssl   dormdesk  dormdesk_app   10.0.2.136/29    scram-sha-256
hostssl   dormdesk  dormdesk_ro    10.0.2.165/32    scram-sha-256
HBA
chown postgres:postgres "$PGDATA/pg_hba.conf"
su postgres -c "psql -q -d postgres -c 'SELECT pg_reload_conf()'" >/dev/null
sleep 1
su postgres -c "psql -At -d postgres -c 'SHOW ssl'" | sed 's/^/ssl=/'
su postgres -c "psql -At -d dormdesk -c 'SELECT count(*) FROM requests'" | sed 's/^/requests=/'
rm -rf /tmp/dd
echo DB_OK
