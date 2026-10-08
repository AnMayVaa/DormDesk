#!/bin/bash
# Build (or rebuild) a hot standby: copy the primary, then restart the standby's container so the boot hook
# swaps the copy in. Used for the first db-02 build and for rejoining an old primary after a failover.
#   HSSH=hssh infra/db/make_standby.sh [standby-ip] [primary-ip]      (defaults from infra/topology.env)
set -euo pipefail
cd "$(dirname "$0")/../.."
HSSH=${HSSH:-hssh}
set -a; . ./secrets.env; set +a
. infra/topology.sh
S=${1:-$DB_STANDBY} P=${2:-$DB_PRIMARY}
SLOT=standby_${S##*.}; NAME=$(dd_name "$S"); APP=${NAME/-/}
psqlp() { $HSSH "$P" "su postgres -c 'psql -At -d postgres'"; }
echo "== 1/5 primary $P: replication slot $SLOT (reserves WAL from now on)"
echo "SELECT 'slot ' || coalesce((SELECT 'exists' FROM pg_replication_slots WHERE slot_name='$SLOT'),
       (SELECT 'created ' || slot_name FROM pg_create_physical_replication_slot('$SLOT', true)));" | psqlp
echo "== 2/5 $NAME ($S): boot hook + firewall (db role)"
if [ "$($HSSH "$S" 'cat /etc/dormdesk/role 2>/dev/null' || true)" = db-fenced ]; then
  dd_install_hook "$S" db-fenced      # old primary: stays fenced until the boot hook swaps in the fresh copy
else
  dd_install_hook "$S" db
  HSSH=$HSSH FORCE_ROLE=db infra/firewall/apply.sh "$( [ "$S" = 10.0.2.150 ] && echo db1 || echo db2 )"
fi
echo "== 3/5 $NAME: pg_basebackup into staging"
$HSSH "$S" "P=$P SLOT=$SLOT REPL_PW='$REPL_PW' APP_NAME=$APP sh -s" < infra/db/standby_prepare.sh
echo "== 4/5 restart $NAME via the lab console (boot hook swaps the data directory)"
infra/lab/console.sh restart "$NAME"
sleep 15; dd_wait_ssh "$S" 180 || { echo "$NAME did not come back"; exit 1; }
for i in $(seq 1 24); do
  r=$($HSSH "$S" "su postgres -c \"psql -At -d postgres -c 'select pg_is_in_recovery()'\"" 2>/dev/null || true)
  [ "$r" = t ] && break; sleep 5; done
echo "== 5/5 check: $NAME in_recovery=$r"
$HSSH "$P" "su postgres -c \"psql -d postgres -c 'select application_name, client_addr, state, sync_state, replay_lag from pg_stat_replication'\""
$HSSH "$S" 'tail -5 /var/log/dormdesk-boot.log'
[ "$r" = t ] && echo "STANDBY_OK $NAME follows $P" || { echo "STANDBY_FAILED"; exit 1; }
