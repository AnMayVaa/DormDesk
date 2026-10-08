#!/bin/bash
# Apply rules.sh to every instance with an automatic 60 s rollback: if we lock ourselves out, the rules
# reset themselves. After applying, a NEW ssh session confirms access and cancels the rollback.
# The rules are also installed as /usr/local/sbin/dd-firewall.sh + /etc/dormdesk/role so the boot hook
# (infra/remote/boot_hook.sh) re-applies them when the lab restarts a container.
#   usage: HSSH=hssh infra/firewall/apply.sh [web|api1|api2|api3|db1|db2|store|mon|ai|all]
set -uo pipefail
cd "$(dirname "$0")/../.."
HSSH=${HSSH:-hssh}
. infra/topology.env
declare -A IP=([web]=$WEB [db1]=10.0.2.150 [db2]=10.0.2.151 [store]=$STORE [mon]=$MON [ai]=$AI)
declare -A ROLE=([web]=web [db1]=db [db2]=db [store]=store [mon]=mon [ai]=ai)
n=0; for ip in $API_HOSTS; do n=$((n+1)); IP[api$n]=$ip; ROLE[api$n]=api; done
apply_one() {
  local n=$1 ip=${IP[$1]} role=${FORCE_ROLE:-${ROLE[$1]}}
  cat infra/firewall/rules.sh | $HSSH "$ip" "mkdir -p /usr/local/sbin /etc/dormdesk; cat > /usr/local/sbin/dd-firewall.sh; chmod 700 /usr/local/sbin/dd-firewall.sh
    echo $role > /etc/dormdesk/role
    setsid nohup sh -c 'sleep 60; iptables -P INPUT ACCEPT; iptables -P OUTPUT ACCEPT; iptables -F' >/dev/null 2>&1 &
    echo \$! > /tmp/dd-fw-rollback.pid
    sh /usr/local/sbin/dd-firewall.sh $role" || return 1
  sleep 2
  if $HSSH "$ip" 'kill $(cat /tmp/dd-fw-rollback.pid) 2>/dev/null && echo "$(hostname): access OK, rollback cancelled"'; then :; else
    echo "!! $n: could not reconnect — rules will roll back in <60 s"; fi
}
if [ "${1:-all}" = all ]; then
  for n in db1 db2 store $(for i in $(seq 1 $(wc -w <<<"$API_HOSTS")); do echo api$i; done) mon ai web; do apply_one $n; done
else apply_one "$1"; fi
