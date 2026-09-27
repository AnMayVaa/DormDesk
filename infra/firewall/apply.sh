#!/bin/bash
# Apply rules.sh to every instance with an automatic 60 s rollback: if we lock ourselves out, the rules
# reset themselves. After applying, a NEW ssh session confirms access and cancels the rollback.
#   usage: HSSH=hssh infra/firewall/apply.sh [web|api|api2|db|mon|all]   ("open" to remove: ROLE=open)
set -uo pipefail
cd "$(dirname "$0")/../.."
HSSH=${HSSH:-hssh}
declare -A IP=([web]=10.0.2.10 [api]=10.0.2.140 [api2]=10.0.2.141 [db]=10.0.2.150 [mon]=10.0.2.165)
declare -A ROLE=([web]=web [api]=api [api2]=api [db]=db [mon]=mon)
apply_one() {
  local n=$1 ip=${IP[$1]} role=${FORCE_ROLE:-${ROLE[$1]}}
  cat infra/firewall/rules.sh | $HSSH "$ip" "mkdir -p /usr/local/sbin; cat > /usr/local/sbin/dd-firewall.sh; chmod 700 /usr/local/sbin/dd-firewall.sh
    setsid nohup sh -c 'sleep 60; iptables -P INPUT ACCEPT; iptables -P OUTPUT ACCEPT; iptables -F' >/dev/null 2>&1 &
    echo \$! > /tmp/dd-fw-rollback.pid
    sh /usr/local/sbin/dd-firewall.sh $role" || return 1
  sleep 2
  if $HSSH "$ip" 'kill $(cat /tmp/dd-fw-rollback.pid) 2>/dev/null && echo "$(hostname): access OK, rollback cancelled"'; then :; else
    echo "!! $n: could not reconnect — rules will roll back in <60 s"; fi
}
if [ "${1:-all}" = all ]; then for n in db api api2 mon web; do apply_one $n; done; else apply_one "$1"; fi
