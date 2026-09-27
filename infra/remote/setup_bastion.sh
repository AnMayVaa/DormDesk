#!/bin/bash
# Runs ON the lab bastion. Creates a dedicated, locked-down account for the web-01 -> API tunnel
# (instead of using root): no password, no shell, no PTY, key usable only from web-01 and only to open
# connections to the API ports. Usage: PUBKEY="ssh-ed25519 AAAA... dormdesk-tunnel@web-01" bash setup_bastion.sh
set -euo pipefail
id ddtunnel >/dev/null 2>&1 || useradd --create-home --shell /usr/sbin/nologin ddtunnel
passwd -l ddtunnel >/dev/null                       # no password login at all
install -d -m 700 -o ddtunnel -g ddtunnel /home/ddtunnel/.ssh
printf 'from="10.0.2.10",restrict,port-forwarding,permitopen="10.0.2.140:8000",permitopen="10.0.2.141:8000",command="/usr/sbin/nologin" %s\n' "$PUBKEY" \
  > /home/ddtunnel/.ssh/authorized_keys
chown ddtunnel:ddtunnel /home/ddtunnel/.ssh/authorized_keys; chmod 600 /home/ddtunnel/.ssh/authorized_keys
# remove the old root-level tunnel key if present
[ -f /root/.ssh/authorized_keys ] && sed -i '/dormdesk-tunnel@web-01/d' /root/.ssh/authorized_keys
echo "ddtunnel ready"
