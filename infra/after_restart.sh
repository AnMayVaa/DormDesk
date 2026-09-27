#!/bin/bash
# Containers have no systemd: after the lab restarts instances, bring DormDesk back.
#   HSSH=hssh infra/after_restart.sh
set -uo pipefail
cd "$(dirname "$0")/.."
HSSH=${HSSH:-hssh}
for ip in 10.0.2.140 10.0.2.141; do $HSSH $ip '/srv/dormdesk/start.sh'; done        # API processes
$HSSH 10.0.2.160 '/opt/llm/start.sh'                                                # AI model server
$HSSH 10.0.2.10 'sh /usr/local/bin/dd-tunnel.sh start'                              # web-01 -> API tunnel
HSSH=$HSSH infra/firewall/apply.sh all                                             # iptables rules (not persistent)
python3 tools/smoke_test.py | tail -1
