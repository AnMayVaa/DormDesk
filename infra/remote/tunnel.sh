#!/bin/sh
# Runs ON web-01. The lab host drops traffic between group02-public and group02-private, so web-01 reaches
# the private API servers through ONE SSH connection via the lab bastion (10.0.2.3 public / 10.0.2.131 private).
# The bastion key is locked down: from="10.0.2.10", no shell, permitopen only to the API ports.
# Forwards come from /etc/dormdesk/tunnel.conf ("<local port> <api ip>"), GENERATED from infra/topology.env:
#   127.0.0.1:8001 -> api-01:8000, 127.0.0.1:8002 -> api-02:8000, ... (api-N auto-wiring)
#   sh /usr/local/bin/dd-tunnel.sh start     (idempotent; the boot hook runs it after a restart)
set -eu
KEY=/root/.ssh/dd_tunnel
CONF=/etc/dormdesk/tunnel.conf
LOG=/var/log/dd-tunnel.log
fwd() { while read -r port ip; do [ -n "${port:-}" ] && printf -- '-L 127.0.0.1:%s:%s:8000 ' "$port" "$ip"; done < "$CONF"; }
case "${1:-start}" in
  loop)   # reconnect forever: if the bastion or network drops, ssh exits and we dial again 2 s later
    while true; do
      # shellcheck disable=SC2046
      ssh -N -i "$KEY" -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=3 \
          -o StrictHostKeyChecking=accept-new $(fwd) ddtunnel@10.0.2.3 || true
      sleep 2
    done ;;
  watch)  # watchdog = the active health check that open-source Nginx does not have. Every 5 s it asks each API
          # (through the tunnel) for /api/health:
          #  * an API that fails 2 checks in a row is marked `down` in Nginx's upstream (no request waits on it);
          #    it is put back as soon as it answers again. Never all at once: if every API fails, all stay in.
          #  * if NO API answers for ~60 s, ssh itself is probably stuck (half-open TCP): kill it, `loop` redials.
    UP=/etc/nginx/conf.d/dd_upstream.inc
    all_bad=0
    while true; do
      sleep 5; down=""; n=0; bad=0
      while read -r port ip; do
        [ -n "${port:-}" ] || continue; n=$((n+1)); f=/tmp/dd-wd-$port
        if wget -q -T 3 -O /dev/null "http://127.0.0.1:$port/api/health" 2>/dev/null; then echo 0 > $f
        else c=$(( $(cat $f 2>/dev/null || echo 0) + 1 )); echo $c > $f; [ $c -ge 2 ] && { down="$down $port"; bad=$((bad+1)); }; fi
      done < "$CONF"
      [ "$bad" -ge "$n" ] && down=""                       # all failing: do not empty the upstream
      if [ ! -f /etc/dormdesk/watchdog.pause ]; then        # tools/loadtest/run.sh pauses it while it edits the upstream
        { echo "# GENERATED from infra/topology.env (tunnel.conf); health flags by the web-01 watchdog (dd-tunnel.sh watch)"
          echo "upstream dd_api {"
          while read -r port ip; do
            [ -n "${port:-}" ] || continue
            case " $down " in *" $port "*) st=" down" ;; *) st="" ;; esac
            echo "    server 127.0.0.1:$port max_fails=2 fail_timeout=10s$st;   # $ip"
          done < "$CONF"
          echo "    keepalive 16;"; echo "    keepalive_timeout 30s;   # < uvicorn keep-alive (75 s)"; echo "}"; } > $UP.new
        if ! cmp -s $UP.new $UP; then
          mv $UP.new $UP && nginx -s reload 2>/dev/null
          echo "$(date -u +%FT%TZ) watchdog: upstream rewritten, down=[${down# }]"
        fi
      fi
      if [ "$bad" -ge "$n" ]; then all_bad=$((all_bad+1)); else all_bad=0; fi
      if [ "$all_bad" -ge 12 ]; then
        echo "$(date -u +%FT%TZ) watchdog: no API answered through the tunnel for ~60 s -> restarting ssh"
        pkill -f "ssh -N -i $KEY" || true; all_bad=0
      fi
    done ;;
  start)
    pkill -f "dd-tunnel.sh loop" 2>/dev/null || true
    pkill -f "dd-tunnel.sh watch" 2>/dev/null || true
    pkill -f "ssh -N -i $KEY" 2>/dev/null || true
    nohup sh /usr/local/bin/dd-tunnel.sh loop  >>"$LOG" 2>&1 &
    nohup sh /usr/local/bin/dd-tunnel.sh watch >>"$LOG" 2>&1 &
    sleep 3
    echo "TUNNEL_STARTED ($(wc -l < "$CONF") API forwards)" ;;
esac
