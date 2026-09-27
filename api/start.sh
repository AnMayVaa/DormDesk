#!/bin/bash
# Start / restart the DormDesk API (containers have no systemd).
set -e
cd /srv/dormdesk
set -a; . ./.env; set +a
pkill -f "uvicorn app.main:app" 2>/dev/null || true
sleep 1
nohup ./venv/bin/uvicorn app.main:app --host "${BIND_IP}" --port 8000 --workers 2 \
  --proxy-headers --forwarded-allow-ips 10.0.2.131 --no-server-header \
  >> /var/log/dormdesk-api.log 2>&1 &
for i in $(seq 1 15); do sleep 1; curl -sf "http://${BIND_IP}:8000/api/health" && echo && exit 0; done
echo "API did not start — see /var/log/dormdesk-api.log"; exit 1
