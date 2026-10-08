#!/bin/bash
# Runs ON the lab bastion. Creates a dedicated, locked-down account for the web-01 -> API tunnel
# (instead of using root): no password, no shell, no PTY, key usable only from web-01 and only to open
# connections to the API ports. PERMITOPEN is GENERATED from infra/topology.env (deploy.sh bastion), so a
# new API server (infra/scale_api.sh) is allowed here automatically and nothing else is.
#   PUBKEY="ssh-ed25519 AAAA... dormdesk-tunnel@web-01" PERMITOPEN='permitopen="10.0.2.140:8000",...' bash setup_bastion.sh
set -euo pipefail
case "$PERMITOPEN" in *[!a-z0-9.:\",=]*) echo "bad PERMITOPEN"; exit 1 ;; esac
id ddtunnel >/dev/null 2>&1 || useradd --create-home --shell /usr/sbin/nologin ddtunnel
passwd -l ddtunnel >/dev/null                       # no password login at all
install -d -m 700 -o ddtunnel -g ddtunnel /home/ddtunnel/.ssh
printf 'from="10.0.2.10",restrict,port-forwarding,%s,command="/usr/sbin/nologin" %s\n' "$PERMITOPEN" "$PUBKEY" \
  > /home/ddtunnel/.ssh/authorized_keys
chown ddtunnel:ddtunnel /home/ddtunnel/.ssh/authorized_keys; chmod 600 /home/ddtunnel/.ssh/authorized_keys
# remove the old root-level tunnel key if present
[ -f /root/.ssh/authorized_keys ] && sed -i '/dormdesk-tunnel@web-01/d' /root/.ssh/authorized_keys
echo "ddtunnel ready: $PERMITOPEN"
