#!/bin/bash
# Network + database isolation checks (Architecture section 14: N2–N8, A3). Needs `hssh` (SSH via bastion).
#   HSSH=hssh tools/verify.sh | tee evidence/verify_$(date +%F).txt
HSSH=${HSSH:-hssh}
cd "$(dirname "$0")/.."
. infra/topology.env
P=$DB_PRIMARY; S=$DB_STANDBY; A1=${API_HOSTS%% *}
PASS=0; FAIL=0
ok()  { echo "PASS $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL $1"; FAIL=$((FAIL+1)); }
expect() { # expect <name> <open|blocked> <host|local> <ip> <port>
  local name=$1 want=$2 from=$3 ip=$4 port=$5 got
  if [ "$from" = local ]; then timeout 5 bash -c "echo > /dev/tcp/$ip/$port" 2>/dev/null && got=open || got=blocked
  else got=$($HSSH "$from" "if command -v nc >/dev/null; then nc -z -w3 $ip $port; else timeout 4 bash -c 'echo > /dev/tcp/$ip/$port'; fi >/dev/null 2>&1 && echo open || echo blocked" 2>/dev/null | tail -1); fi
  [ "$got" = "$want" ] && ok "$name ($got)" || bad "$name (wanted $want, got $got)"
}
echo "# DormDesk verify — $(date -u +%FT%TZ)"
echo "## From the internet"
expect "N1 HTTPS entry 45.77.40.35:10201"      open    local 45.77.40.35 10201
code=$(curl -s -m8 -o /dev/null -w "%{ssl_verify_result}" https://dormdesk-g02.duckdns.org:10201/); [ "$code" = 0 ] && ok "trusted certificate (Let's Encrypt) for dormdesk-g02.duckdns.org" || bad "certificate verify ($code)"
expect "N2 no other port mapped (10200)"       blocked local 45.77.40.35 10200
expect "N2 no other port mapped (10202)"       blocked local 45.77.40.35 10202
code=$(curl -s -m8 -o /dev/null -w "%{http_code}" http://45.77.40.35:10201/); [ "$code" = 301 ] && ok "plain HTTP is redirected to HTTPS (301)" || bad "plain HTTP ($code)"
echo "## From web-01 (public subnet) — assume it is compromised"
expect "N5 web-01 -> db-01:5432"               blocked 10.0.2.10 10.0.2.150 5432
expect "web-01 -> api-01:8000 directly"        blocked 10.0.2.10 10.0.2.140 8000
expect "web-01 -> internet (1.1.1.1:443)"      blocked 10.0.2.10 1.1.1.1 443
expect "web-01 -> bastion:22 (tunnel)"         open    10.0.2.10 10.0.2.3 22
echo "## From api-01 (private subnet)"
expect "N6 api-01 -> db-01:5432"               open    10.0.2.140 10.0.2.150 5432
expect "api-01 -> mon-01:3000"                 blocked 10.0.2.140 10.0.2.165 3000
expect "api-01 -> internet (1.1.1.1:443)"      blocked 10.0.2.140 1.1.1.1 443
expect "api-01 -> store-01:8333 (S3 over TLS)"  open    10.0.2.140 $STORE 8333
expect "api-01 -> store-01:8334 (plain HTTP)"  blocked 10.0.2.140 $STORE 8334
expect "api-01 -> db-02:5432 (standby)"        open    10.0.2.140 10.0.2.151 5432
echo "## From db-01"
expect "N7 db-01 -> internet (1.1.1.1:443)"    blocked 10.0.2.150 1.1.1.1 443
expect "db-01 -> api-01:8000"                  blocked 10.0.2.150 10.0.2.140 8000
expect "db-01 -> store-01:8333"                blocked 10.0.2.150 $STORE 8333
expect "db-01 <-> db-02:5432 (replication)"    open    10.0.2.150 10.0.2.151 5432
echo "## From db-02 (standby)"
expect "db-02 -> internet (1.1.1.1:443)"       blocked 10.0.2.151 1.1.1.1 443
expect "db-02 -> api-01:8000"                  blocked 10.0.2.151 10.0.2.140 8000
expect "db-02 -> db-01:5432 (replication)"     open    10.0.2.151 10.0.2.150 5432
echo "## From store-01 (object store)"
expect "store-01 -> internet (1.1.1.1:443)"    blocked $STORE 1.1.1.1 443
expect "store-01 -> db-01:5432"                blocked $STORE 10.0.2.150 5432
expect "store-01 -> api-01:8000"               blocked $STORE 10.0.2.140 8000
expect "web-01 -> store-01:8333"               blocked 10.0.2.10 $STORE 8333
expect "mon-01 -> store-01:8333"               blocked 10.0.2.165 $STORE 8333
echo "## From mon-01"
expect "mon-01 -> db-01:5432"                  open    10.0.2.165 10.0.2.150 5432
expect "mon-01 -> db-02:5432"                  open    10.0.2.165 10.0.2.151 5432
expect "mon-01 -> api-01:8000"                 blocked 10.0.2.165 10.0.2.140 8000
echo "## AI tier (ai-01)"
expect "api-01 -> ai-01:8080 (model server)"   open    10.0.2.140 10.0.2.160 8080
expect "web-01 -> ai-01:8080"                  blocked 10.0.2.10 10.0.2.160 8080
expect "db-01 -> ai-01:8080"                   blocked 10.0.2.150 10.0.2.160 8080
expect "ai-01 -> internet (1.1.1.1:443)"       blocked 10.0.2.160 1.1.1.1 443
expect "ai-01 -> db-01:5432"                   blocked 10.0.2.160 10.0.2.150 5432
echo "## Inside the database"
r=$($HSSH $P "su postgres -c \"psql -At -d dormdesk -c 'SET ROLE dormdesk_app; SELECT count(*) FROM requests'\"" 2>/dev/null | tail -1)
[ "$r" = 0 ] && ok "A3 RLS: app account without app.dorm_id sees 0 requests" || bad "A3 RLS ($r)"
r=$($HSSH $P "su postgres -c \"psql -At -d dormdesk -c \\\"SET ROLE dormdesk_app; SELECT set_config('app.dorm_id','2',false); SELECT count(DISTINCT dorm_id) FROM requests\\\"\"" 2>/dev/null | tail -1)
[ "$r" = 1 ] && ok "A3 RLS: with app.dorm_id=2 only one dorm is visible" || bad "A3 RLS dorm filter ($r)"
r=$($HSSH $P "su postgres -c \"psql -At -d dormdesk -c 'SET ROLE dormdesk_app; DELETE FROM requests' 2>&1\"" 2>/dev/null | tail -1)
echo "$r" | grep -q "permission denied" && ok "least privilege: app account cannot DELETE" || bad "app DELETE ($r)"
r=$($HSSH $P "su postgres -c \"psql -At -d dormdesk -c 'SET ROLE dormdesk_ro; SELECT reporter_phone FROM requests LIMIT 1' 2>&1\"" 2>/dev/null | tail -1)
echo "$r" | grep -q "permission denied" && ok "Grafana account cannot read personal data" || bad "ro PII ($r)"
r=$($HSSH $P "su postgres -c \"psql -At -d dormdesk -c 'SELECT count(*) FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid) WHERE a.usename=\\\$\\\$dormdesk_app\\\$\\\$ AND NOT s.ssl'\"" 2>/dev/null | tail -1)
[ "$r" = 0 ] && ok "all API connections to the DB use TLS" || bad "non-TLS API connections ($r)"
r=$($HSSH $P "su postgres -c \"psql -At -d dormdesk -c \\\"SET ROLE dormdesk_app; SELECT set_config('app.dorm_id','1',false), set_config('app.tenancy_id',(SELECT min(tenancy_id)::text FROM requests),false); SELECT count(DISTINCT tenancy_id) FROM requests\\\"\"" 2>/dev/null | tail -1)
[ "$r" = 1 ] && ok "RLS tenancy layer: with app.tenancy_id set only that tenancy is visible" || bad "RLS tenancy ($r)"
r=$($HSSH $P "su postgres -c \"psql -At -d dormdesk -c 'SET ROLE dormdesk_repl; SELECT count(*) FROM public.requests' 2>&1\"" 2>/dev/null | grep ERROR)
echo "$r" | grep -q "permission denied" && ok "replication account cannot read tables" || bad "repl read ($r)"
r=$($HSSH $P "su postgres -c \"psql -At -d dormdesk -c 'SET ROLE dormdesk_ro; SELECT * FROM bill_slips LIMIT 1' 2>&1\"" 2>/dev/null | grep ERROR)
echo "$r" | grep -q "permission denied" && ok "Grafana account cannot read payment slips" || bad "ro slips ($r)"
echo "## Replication + backups"
r=$($HSSH $P "su postgres -c \"psql -At -d postgres -c \\\"SELECT count(*) FROM pg_stat_replication r JOIN pg_stat_ssl s USING (pid) WHERE r.state='streaming' AND s.ssl\\\"\"" 2>/dev/null | tail -1)
[ "${r:-0}" -ge 1 ] && ok "standby streaming from the primary over TLS ($r)" || bad "no TLS streaming standby ($r)"
r=$($HSSH $S "su postgres -c \"psql -At -d postgres -c 'SELECT pg_is_in_recovery()'\"" 2>/dev/null | tail -1)
[ "$r" = t ] && ok "db standby is read-only (in recovery)" || bad "standby recovery ($r)"
r=$($HSSH $S "ls /var/lib/postgresql/wal_archive 2>/dev/null | grep -c gz$" 2>/dev/null | tail -1)
[ "${r:-0}" -ge 1 ] && ok "standby archives WAL for point-in-time recovery ($r segments)" || bad "WAL archive ($r)"
echo "## Object store"
r=$($HSSH $A1 'curl -s -o /dev/null -w "%{http_code} %{ssl_verify_result}" --cacert /srv/dormdesk/dormdesk-ca.crt https://'$STORE':8333/dormdesk' 2>/dev/null | tail -1)
[ "$r" = "403 0" ] && ok "S3 endpoint: TLS verified against DormDesk CA, anonymous access refused (403)" || bad "S3 TLS/anon ($r)"
r=$($HSSH $A1 'cd /srv/dormdesk && set -a && . ./.env && set +a && ./venv/bin/python -c "
from app import storage
k = next((k for k, _ in storage.list_keys(\"\")), None)
print(storage.get(k)[:3].decode() if k else \"none\")"' 2>/dev/null | tail -1)
[ "$r" = DD1 ] && ok "objects are stored encrypted (AES-256-GCM blob header DD1)" || bad "object encryption ($r)"
echo "## Firewall rules + boot hooks loaded (N8)"
for h in 10.0.2.10 $API_HOSTS 10.0.2.150 10.0.2.151 $STORE 10.0.2.165 10.0.2.160; do
  $HSSH $h 'echo "$(hostname): INPUT=$(iptables -S INPUT | head -1 | cut -d" " -f3) OUTPUT=$(iptables -S OUTPUT | head -1 | cut -d" " -f3) rules=$(iptables -S | grep -c "^-A") role=$(cat /etc/dormdesk/role 2>/dev/null) boot_hook=$(grep -q /etc/dormdesk/boot.sh /lab-entrypoint.sh && echo yes || echo NO)"' 2>/dev/null | tail -1
done
echo; echo "$PASS passed, $FAIL failed"
[ $FAIL = 0 ]
