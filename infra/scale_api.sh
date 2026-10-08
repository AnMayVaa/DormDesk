#!/bin/bash
# api-N auto-wiring: add or remove an API server. infra/topology.env is the only thing that changes;
# everything that must know the API list is regenerated from it and redeployed:
#   bastion permitopen (tunnel may reach it) -> web-01 tunnel forwards + Nginx upstream (traffic reaches it).
# Firewall and pg_hba already trust the whole app zone 10.0.2.136/29, and the background job is
# coordinated by a PostgreSQL advisory lock, so a new server needs no other change.
#   HSSH=hssh infra/scale_api.sh add 10.0.2.142      create api-03 in the lab console, deploy, wire in
#   HSSH=hssh infra/scale_api.sh remove 10.0.2.142   unwire, then delete the instance
set -euo pipefail
cd "$(dirname "$0")/.."
HSSH=${HSSH:-hssh}; export HSSH
. infra/topology.sh
CMD=${1:?add|remove} IP=${2:?ip}
case $IP in 10.0.2.137|10.0.2.138|10.0.2.139|10.0.2.140|10.0.2.141|10.0.2.142) ;;
  *) echo "API servers must be inside the app zone 10.0.2.136/29 (.137-.142) — firewall and pg_hba trust only that range"; exit 1 ;; esac
NAME=$(dd_name "$IP")
set_hosts() { sed -i "s/^API_HOSTS=\"[^\"]*\"/API_HOSTS=\"$1\"/" infra/topology.env; . infra/topology.sh; echo "API_HOSTS=$API_HOSTS"; }
case $CMD in
  add)
    grep -qw "$IP" <<<"$API_HOSTS" && { echo "$IP is already in API_HOSTS"; exit 0; }
    if infra/lab/console.sh list | grep -q "^$NAME "; then
      echo "== $NAME already exists in the lab console (resuming)"
    else
      echo "== create $NAME ($IP) in the lab console"
      infra/lab/console.sh create "$NAME" "${API_IMAGE:-lab-ubuntu:latest}" "$IP" "${API_CPUS:-0.5}" "${API_MEM:-512m}"
      sleep 15
    fi
    PWF=$HOME/.dd/$IP.pw   # the console generates the root password; keep it where hssh's askpass finds it
    infra/lab/console.sh pass "$NAME" > "$PWF"; chmod 600 "$PWF"
    grep -q "^$NAME=" cloud_pass.txt || echo "$NAME=$(cat "$PWF")" >> cloud_pass.txt
    dd_wait_ssh "$IP" 300 || { echo "$NAME not reachable over SSH"; exit 1; }
    echo "== deploy the API on $NAME"
    infra/deploy.sh api "$IP"
    set_hosts "$API_HOSTS $IP"
    echo "== re-wire: bastion permitopen, web-01 tunnel + Nginx upstream"
    infra/deploy.sh bastion; infra/deploy.sh web
    port=$(dd_api_list | awk -v ip="$IP" '$2==ip {print $3}')
    sleep 3; $HSSH "$WEB" "wget -qO- -T 5 http://127.0.0.1:$port/api/health" && echo && echo "SCALE_OK $NAME serves through 127.0.0.1:$port" ;;
  remove)
    grep -qw "$IP" <<<"$API_HOSTS" || { echo "$IP is not in API_HOSTS"; exit 1; }
    set_hosts "$(tr ' ' '\n' <<<"$API_HOSTS" | grep -vx "$IP" | xargs)"
    infra/deploy.sh web; infra/deploy.sh bastion           # stop sending traffic first, then revoke the tunnel
    $HSSH "$DB_PRIMARY" "su postgres -c \"psql -q -d dormdesk -c \\\"DELETE FROM api_heartbeats WHERE host = '$NAME'\\\"\"" || true
    [ "${KEEP:-0}" = 1 ] || infra/lab/console.sh delete "$NAME"
    echo "REMOVED $NAME" ;;
  *) echo "usage: $0 add|remove <ip>"; exit 1 ;;
esac
