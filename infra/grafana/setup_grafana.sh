#!/bin/bash
# Configure Grafana on mon-01 (private subnet, no public port) through the bastion.
# - replace the default admin password  - add read-only PostgreSQL data source (dormdesk_ro, TLS)
# - import the DormDesk security dashboard.   usage: HSSH=hssh infra/grafana/setup_grafana.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
HSSH=${HSSH:-hssh}
set -a; . ./secrets.env; set +a
DS=$(python3 - <<PY
import json,os
print(json.dumps({"uid":"dormdesk-pg","name":"DormDesk (read-only)","type":"grafana-postgresql-datasource",
  "access":"proxy","url":"10.0.2.150:5432","user":"dormdesk_ro","isDefault":True,
  "jsonData":{"database":"dormdesk","sslmode":"require","postgresVersion":1600,"timescaledb":False,"maxOpenConns":5},
  "secureJsonData":{"password":os.environ["RO_PW"]}}))
PY
)
{ echo "$DS"; echo "@@@"; cat infra/grafana/dashboard.json; } | $HSSH 10.0.2.165 "GRAFANA_PW='$GRAFANA_PW' sh -c '
  set -e; cat > /tmp/in; awk \"/^@@@/{f=1;next} !f\" /tmp/in > /tmp/ds.json; awk \"f;/^@@@/{f=1}\" /tmp/in > /tmp/dash.json
  AUTH=admin:admin
  curl -sf -u admin:\$GRAFANA_PW localhost:3000/api/org >/dev/null && AUTH=admin:\$GRAFANA_PW
  if [ \$AUTH = admin:admin ]; then
    curl -sf -u admin:admin -X PUT -H Content-Type:application/json localhost:3000/api/user/password \
      -d \"{\\\"oldPassword\\\":\\\"admin\\\",\\\"newPassword\\\":\\\"\$GRAFANA_PW\\\",\\\"confirmNew\\\":\\\"\$GRAFANA_PW\\\"}\" >/dev/null && echo \"admin password changed\"
    AUTH=admin:\$GRAFANA_PW
  fi
  curl -s -u \$AUTH -X DELETE localhost:3000/api/datasources/uid/dormdesk-pg >/dev/null || true
  curl -sf -u \$AUTH -X POST -H Content-Type:application/json localhost:3000/api/datasources -d @/tmp/ds.json >/dev/null && echo \"datasource ok\"
  curl -s -u \$AUTH -X POST -H Content-Type:application/json localhost:3000/api/ds/query -d \"{\\\"queries\\\":[{\\\"refId\\\":\\\"A\\\",\\\"datasource\\\":{\\\"uid\\\":\\\"dormdesk-pg\\\"},\\\"rawSql\\\":\\\"SELECT count(*) FROM v_request_stats\\\",\\\"format\\\":\\\"table\\\"}]}\" | head -c 300; echo
  curl -sf -u \$AUTH -X POST -H Content-Type:application/json localhost:3000/api/dashboards/db -d @/tmp/dash.json | head -c 200; echo
  rm -f /tmp/in /tmp/ds.json /tmp/dash.json'"
