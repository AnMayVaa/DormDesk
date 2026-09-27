#!/bin/bash
# Network + database isolation checks (Architecture section 14: N2–N8, A3). Needs `hssh` (SSH via bastion).
#   HSSH=hssh tools/verify.sh | tee evidence/verify_$(date +%F).txt
HSSH=${HSSH:-hssh}
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
echo "## From db-01"
expect "N7 db-01 -> internet (1.1.1.1:443)"    blocked 10.0.2.150 1.1.1.1 443
expect "db-01 -> api-01:8000"                  blocked 10.0.2.150 10.0.2.140 8000
echo "## From mon-01"
expect "mon-01 -> db-01:5432"                  open    10.0.2.165 10.0.2.150 5432
expect "mon-01 -> api-01:8000"                 blocked 10.0.2.165 10.0.2.140 8000
echo "## AI tier (ai-01)"
expect "api-01 -> ai-01:8080 (model server)"   open    10.0.2.140 10.0.2.160 8080
expect "web-01 -> ai-01:8080"                  blocked 10.0.2.10 10.0.2.160 8080
expect "db-01 -> ai-01:8080"                   blocked 10.0.2.150 10.0.2.160 8080
expect "ai-01 -> internet (1.1.1.1:443)"       blocked 10.0.2.160 1.1.1.1 443
expect "ai-01 -> db-01:5432"                   blocked 10.0.2.160 10.0.2.150 5432
echo "## Inside the database"
r=$($HSSH 10.0.2.150 "su postgres -c \"psql -At -d dormdesk -c 'SET ROLE dormdesk_app; SELECT count(*) FROM requests'\"" 2>/dev/null | tail -1)
[ "$r" = 0 ] && ok "A3 RLS: app account without app.dorm_id sees 0 requests" || bad "A3 RLS ($r)"
r=$($HSSH 10.0.2.150 "su postgres -c \"psql -At -d dormdesk -c \\\"SET ROLE dormdesk_app; SELECT set_config('app.dorm_id','2',false); SELECT count(DISTINCT dorm_id) FROM requests\\\"\"" 2>/dev/null | tail -1)
[ "$r" = 1 ] && ok "A3 RLS: with app.dorm_id=2 only one dorm is visible" || bad "A3 RLS dorm filter ($r)"
r=$($HSSH 10.0.2.150 "su postgres -c \"psql -At -d dormdesk -c 'SET ROLE dormdesk_app; DELETE FROM requests' 2>&1\"" 2>/dev/null | tail -1)
echo "$r" | grep -q "permission denied" && ok "least privilege: app account cannot DELETE" || bad "app DELETE ($r)"
r=$($HSSH 10.0.2.150 "su postgres -c \"psql -At -d dormdesk -c 'SET ROLE dormdesk_ro; SELECT reporter_phone FROM requests LIMIT 1' 2>&1\"" 2>/dev/null | tail -1)
echo "$r" | grep -q "permission denied" && ok "Grafana account cannot read personal data" || bad "ro PII ($r)"
r=$($HSSH 10.0.2.150 "su postgres -c \"psql -At -d dormdesk -c 'SELECT count(*) FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid) WHERE a.usename=\\\$\\\$dormdesk_app\\\$\\\$ AND NOT s.ssl'\"" 2>/dev/null | tail -1)
[ "$r" = 0 ] && ok "all API connections to the DB use TLS" || bad "non-TLS API connections ($r)"
echo "## Firewall rules loaded (N8)"
for h in 10.0.2.10 10.0.2.140 10.0.2.141 10.0.2.150 10.0.2.165 10.0.2.160; do
  $HSSH $h 'echo "$(hostname): INPUT=$(iptables -S INPUT | head -1 | cut -d" " -f3) OUTPUT=$(iptables -S OUTPUT | head -1 | cut -d" " -f3) rules=$(iptables -S | grep -c "^-A")"' 2>/dev/null | tail -1
done
echo; echo "$PASS passed, $FAIL failed"
[ $FAIL = 0 ]
