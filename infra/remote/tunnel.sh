#!/bin/sh
# Runs ON web-01. The lab host drops traffic between group02-public and group02-private, so web-01 reaches
# the private API through an SSH tunnel via the lab bastion (dual-homed: 10.0.2.3 public / 10.0.2.131 private).
# The bastion key is locked down: from="10.0.2.10", no shell, only permitopen to the API ports.
#   127.0.0.1:8001 -> api-01 10.0.2.140:8000
#   127.0.0.1:8002 -> api-02 10.0.2.141:8000
# Start (idempotent):  sh /usr/local/bin/dd-tunnel.sh start
set -eu
KEY=/root/.ssh/dd_tunnel
case "${1:-start}" in
  loop)
    while true; do
      ssh -N -i "$KEY" -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=3 \
          -o StrictHostKeyChecking=accept-new \
          -L 127.0.0.1:8001:10.0.2.140:8000 -L 127.0.0.1:8002:10.0.2.141:8000 ddtunnel@10.0.2.3 || true
      sleep 2
    done ;;
  start)
    pkill -f "dd-tunnel.sh loop" 2>/dev/null || true
    pkill -f "ssh -N -i $KEY" 2>/dev/null || true
    nohup sh /usr/local/bin/dd-tunnel.sh loop >/var/log/dd-tunnel.log 2>&1 &
    sleep 3
    echo TUNNEL_STARTED ;;
esac
