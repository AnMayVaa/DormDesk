#!/bin/bash
# Start / restart the DormDesk API (containers have no systemd).
set -e
cd /srv/dormdesk
set -a; . ./.env; set +a
pkill -f "uvicorn app.main:app" 2>/dev/null || true
sleep 1
# ONE process per server (we scale with more servers, not more workers): with --workers N uvicorn's supervisor
# kills a worker that does not answer its 5 s health ping - on a CPU-throttled 0.5 vCPU container that turned into
# a restart storm (lab, 8 Oct 2026: 1 128 restarts, 502s, duplicate writes). keep-alive 75 s > Nginx's 30 s,
# so Nginx never reuses a connection the API has just closed.
nohup ./venv/bin/uvicorn app.main:app --host "${BIND_IP}" --port 8000 --workers 1 --timeout-keep-alive 75 \
  --proxy-headers --forwarded-allow-ips 10.0.2.131 --no-server-header \
  >> /var/log/dormdesk-api.log 2>&1 &
for i in $(seq 1 15); do sleep 1; curl -sf "http://${BIND_IP}:8000/api/health" && echo && exit 0; done
echo "API did not start — see /var/log/dormdesk-api.log"; exit 1
