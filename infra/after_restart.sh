#!/bin/bash
# Normally NOT needed any more: every instance has the boot hook (infra/remote/boot_hook.sh), so after the lab
# restarts a container it re-applies its firewall and starts its own services. This script is the manual
# fallback / check: run every machine's start scripts again, re-apply all firewalls, smoke test.
#   HSSH=hssh infra/after_restart.sh
set -uo pipefail
cd "$(dirname "$0")/.."
HSSH=${HSSH:-hssh}
. infra/topology.env
for ip in $WEB $API_HOSTS $STORE $AI $DB_PRIMARY $DB_STANDBY $MON; do
  timeout 60 $HSSH "$ip" 'echo "$(hostname): $(tail -1 /var/log/dormdesk-boot.log 2>/dev/null)"; for s in /etc/dormdesk/start.d/*; do [ -x "$s" ] && "$s" >/dev/null 2>&1 && echo "  started $s"; done' 2>/dev/null || echo "$ip unreachable"
done
HSSH=$HSSH infra/firewall/apply.sh all                                             # iptables rules (not persistent)
python3 tools/smoke_test.py | tail -1
