#!/bin/bash
# Scaling evidence: the same k6 load against 1 API server, then against every server in infra/topology.env.
#   HSSH=hssh tools/loadtest/run.sh [VUS] [HOLD] [THINK]      e.g. tools/loadtest/run.sh 80 30s 0.3
# For the test only, a random token is written to web-01 (/etc/nginx/conf.d/dd_loadtest.map) so Nginx does
# not rate-limit the single test IP; it is removed again at the end (trap), even if k6 fails.
set -euo pipefail
cd "$(dirname "$0")/../.."
HSSH=${HSSH:-hssh}
. infra/topology.sh
VUS=${1:-30}; HOLD=${2:-60s}; THINK=${3:-1}
BASE=${BASE:-https://dormdesk-g02.duckdns.org:10201}
K6=${K6:-$(command -v k6 || echo "$HOME/.dd/k6")}
[ -x "$K6" ] || { echo "k6 not found (set K6=/path/to/k6)"; exit 1; }
# dorm 1 rooms only (dorm 2 has facilities/parking switched off -> those pages answer 403 by design)
ROOMS=$(sed '/(dorm_id 2)/,$d' demo_accounts.txt | grep -oE '/r/[A-Za-z0-9_-]+' | cut -d/ -f3 | head -40 | paste -sd, -)
TOKEN=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
OUT=evidence/loadtest_$(date +%F_%H%M); mkdir -p "$OUT"
nginx_upstream() { $HSSH "$WEB" 'cat > /etc/nginx/conf.d/dd_upstream.inc && nginx -t -q && nginx -s reload'; }
cleanup() {
  $HSSH "$WEB" 'rm -f /etc/nginx/conf.d/dd_loadtest.map /etc/dormdesk/watchdog.pause; nginx -s reload' || true
  dd_upstream | nginx_upstream || true
  echo "cleanup: token removed, full upstream restored"
}
trap cleanup EXIT
$HSSH "$WEB" 'touch /etc/dormdesk/watchdog.pause'      # the watchdog must not "repair" our 1-API upstream
echo "\"$TOKEN\" \"\";" | $HSSH "$WEB" 'cat > /etc/nginx/conf.d/dd_loadtest.map && chmod 600 /etc/nginx/conf.d/dd_loadtest.map && nginx -t -q && nginx -s reload'
run() {  # $1 = label
  echo "== $1: $VUS virtual users, hold $HOLD, think ${THINK}s"
  "$K6" run --quiet -e BASE="$BASE" -e ROOMS="$ROOMS" -e LT_TOKEN="$TOKEN" -e VUS="$VUS" -e HOLD="$HOLD" -e THINK="$THINK" \
     --summary-export "$OUT/$1.json" tools/loadtest/dormdesk.js 2>&1 | grep -E "http_req_duration|http_reqs|http_req_failed|checks|iterations" | tee "$OUT/$1.txt" || true
}
# 1 API server: upstream with only the first entry
( API_HOSTS=${API_HOSTS%% *}; dd_upstream ) | nginx_upstream
sleep 2; run "1_api"
dd_upstream | nginx_upstream
sleep 2; run "$(wc -w <<<"$API_HOSTS")_apis"
python3 - "$OUT" <<'PY'
import json, sys, glob, os
rows = []
for f in sorted(glob.glob(os.path.join(sys.argv[1], "*.json"))):
    m = json.load(open(f))["metrics"]
    d, r, e = m["http_req_duration"], m["http_reqs"], m["http_req_failed"]
    rows.append((os.path.basename(f)[:-5], r["rate"], d["med"], d["p(95)"], e.get("value", e.get("rate", 0)) * 100))
print(f"{'setup':<8} {'req/s':>8} {'median ms':>10} {'p95 ms':>8} {'errors %':>9}")
for n, rate, med, p95, err in rows:
    print(f"{n:<8} {rate:>8.1f} {med:>10.0f} {p95:>8.0f} {err:>9.2f}")
PY
echo "results: $OUT"
