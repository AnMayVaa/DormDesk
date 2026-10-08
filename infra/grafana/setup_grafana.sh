#!/bin/bash
# Configure Grafana on mon-01 (private subnet, no public port) through the bastion.
#   HSSH=hssh infra/grafana/setup_grafana.sh              everything below
#   HSSH=hssh infra/grafana/setup_grafana.sh datasources  only re-point the 2 data sources (failover.sh uses this)
#   HSSH=hssh infra/grafana/setup_grafana.sh smtp         write [smtp] into grafana.ini, then restart mon-01 (console)
# - admin password from secrets.env   - 2 read-only PostgreSQL data sources (dormdesk_ro, TLS):
#     dormdesk-pg = current primary, dormdesk-pg-standby = current standby (from infra/topology.env)
# - dashboards: security (v1) + platform & business (v2)   - alert rules + e-mail contact point
set -euo pipefail
cd "$(dirname "$0")/../.."
HSSH=${HSSH:-hssh}
set -a; . ./secrets.env; . infra/topology.env; set +a
MODE=${1:-all}
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
python3 infra/grafana/build.py >/dev/null
python3 - "$T" "$MODE" <<'PY'
import json, os, sys
t, mode = sys.argv[1], sys.argv[2]
E = os.environ
def ds(uid, name, host, default):
    return {"uid": uid, "name": name, "type": "grafana-postgresql-datasource", "access": "proxy",
            "url": f"{host}:5432", "user": "dormdesk_ro", "isDefault": default,
            "jsonData": {"database": "dormdesk", "sslmode": "require", "postgresVersion": 1600,
                         "timescaledb": False, "maxOpenConns": 5},
            "secureJsonData": {"password": E["RO_PW"]}}
json.dump(ds("dormdesk-pg", "DormDesk primary (read-only)", E["DB_PRIMARY"], True), open(f"{t}/ds1.json", "w"))
json.dump(ds("dormdesk-pg-standby", "DormDesk standby (read-only)", E["DB_STANDBY"], False), open(f"{t}/ds2.json", "w"))
to = E.get("OWNER_ALERT_TO") or E.get("SMTP_USER") or "root@localhost"
json.dump({"uid": "dd-email", "name": "dormdesk-email", "type": "email", "disableResolveMessage": False,
           "settings": {"addresses": to.replace(",", ";"), "singleEmail": True}}, open(f"{t}/contact.json", "w"))
json.dump({"receiver": "dormdesk-email", "group_by": ["alertname"], "group_wait": "30s",
           "group_interval": "5m", "repeat_interval": "4h"}, open(f"{t}/policy.json", "w"))
open(f"{t}/pw", "w").write(E["GRAFANA_PW"])
smtp = f"""[smtp]
enabled = true
host = smtp.gmail.com:587
user = {E.get('SMTP_USER','')}
password = \"\"\"{E.get('SMTP_PASS','').replace(' ','')}\"\"\"
from_address = {E.get('SMTP_USER','')}
from_name = DormDesk alerts
startTLS_policy = MandatoryStartTLS
"""
open(f"{t}/smtp.ini", "w").write(smtp)
for r in json.load(open("infra/grafana/alerts.json")):      # one file per alert rule
    json.dump(r, open(f"{t}/rule_{r['uid']}.json", "w"), ensure_ascii=False)
PY
cp infra/grafana/dashboard.json infra/grafana/dashboard_ops.json "$T/"
tar czf - -C "$T" . | $HSSH "$MON" 'rm -rf /tmp/g && mkdir -p /tmp/g && chmod 700 /tmp/g && tar xzf - -C /tmp/g'
$HSSH "$MON" "MODE=$MODE sh -s" <<'REMOTE'
set -eu
cd /tmp/g; PW=$(cat pw)
G=localhost:3000
api() { curl -s -u "admin:$PW" -H Content-Type:application/json "$@"; }
if [ "$MODE" = smtp ]; then
  # replace the [smtp] section of grafana.ini (takes effect after the console restarts mon-01)
  awk 'FNR==NR { s = s $0 "\n"; next }
       /^\[smtp\]/ { printf "%s", s; skip=1; next }
       /^\[/ { skip=0 }
       !skip { print }' smtp.ini /etc/grafana/grafana.ini > /etc/grafana/grafana.ini.new
  [ -f /etc/grafana/grafana.ini.orig ] || cp /etc/grafana/grafana.ini /etc/grafana/grafana.ini.orig
  chmod 640 /etc/grafana/grafana.ini.new; chown root:root /etc/grafana/grafana.ini.new
  mv /etc/grafana/grafana.ini.new /etc/grafana/grafana.ini; chmod 644 /etc/grafana/grafana.ini
  grep -A3 '^\[smtp\]' /etc/grafana/grafana.ini | sed 's/^password.*/password = ***/'
  echo "SMTP written — now: infra/lab/console.sh restart mon-01"
  rm -rf /tmp/g; exit 0
fi
# admin password: first run changes the default admin/admin
if ! api $G/api/org -o /dev/null -w '%{http_code}' | grep -q 200; then
  curl -s -u admin:admin -X PUT -H Content-Type:application/json $G/api/user/password \
    -d "{\"oldPassword\":\"admin\",\"newPassword\":\"$PW\",\"confirmNew\":\"$PW\"}" >/dev/null && echo "admin password changed"
fi
for f in ds1 ds2; do
  uid=$(sed 's/.*"uid": "\([^"]*\)".*/\1/' $f.json)
  code=$(api -X PUT $G/api/datasources/uid/$uid -d @$f.json -o /dev/null -w '%{http_code}')
  [ "$code" = 200 ] || code=$(api -X POST $G/api/datasources -d @$f.json -o /dev/null -w '%{http_code}')
  echo "datasource $uid -> $(sed 's/.*"url": "\([^"]*\)".*/\1/' $f.json) ($code)"
done
api -X POST $G/api/ds/query -d '{"queries":[{"refId":"A","datasource":{"uid":"dormdesk-pg"},"rawSql":"SELECT role, standby_count FROM ops_replication()","format":"table"}]}' | head -c 220; echo
[ "$MODE" = datasources ] && { rm -rf /tmp/g; exit 0; }
for d in dashboard dashboard_ops; do api -X POST $G/api/dashboards/db -d @$d.json | head -c 120; echo; done
api -X POST $G/api/folders -d '{"uid":"dormdesk","title":"DormDesk"}' -o /dev/null || true
# contact point + default policy
api -X PUT $G/api/v1/provisioning/contact-points/dd-email -d @contact.json -o /dev/null -w 'contact point %{http_code}\n' | grep -q ' 202' \
  || api -X POST $G/api/v1/provisioning/contact-points -d @contact.json -o /dev/null -w 'contact point %{http_code}\n'
api -X PUT $G/api/v1/provisioning/policies -d @policy.json -o /dev/null -w 'policy %{http_code}\n'
# alert rules (idempotent by uid: update, or create if new)
for f in rule_*.json; do
  uid=${f#rule_}; uid=${uid%.json}
  c=$(api -X PUT $G/api/v1/provisioning/alert-rules/$uid -d @$f -o /tmp/g/out -w '%{http_code}')
  [ "$c" = 200 ] || c=$(api -X POST $G/api/v1/provisioning/alert-rules -d @$f -o /tmp/g/out -w '%{http_code}')
  echo "alert $uid -> $c $( [ "$c" = 200 ] || [ "$c" = 201 ] || head -c 200 /tmp/g/out)"
done
sleep 2
api $G/api/prometheus/grafana/api/v1/rules | grep -o '"state":"[a-z]*"' | sort | uniq -c
rm -rf /tmp/g
REMOTE
