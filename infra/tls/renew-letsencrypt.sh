#!/bin/bash
# Trusted HTTPS: Let's Encrypt certificate for <DUCKDNS_DOMAIN>.duckdns.org via DNS-01 (no port 80/443 needed).
# Needs DUCKDNS_DOMAIN / DUCKDNS_TOKEN in secrets.env. Run every ~60 days (cert lasts 90), then: infra/deploy.sh web
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./secrets.env; set +a
export DuckDNS_Token="$DUCKDNS_TOKEN"
D="$DUCKDNS_DOMAIN.duckdns.org"; H="$PWD/infra/tls/acme"
[ -d "$HOME/acme.sh-src" ] || git clone -q --depth 1 https://github.com/acmesh-official/acme.sh.git "$HOME/acme.sh-src"
"$HOME/acme.sh-src/acme.sh" --home "$H" --config-home "$H" --cert-home "$H/certs" --issue --server letsencrypt \
  --dns dns_duckdns -d "$D" --keylength ec-256 --dnssleep 60 ${FORCE:+--force} || [ $? -eq 2 ]   # 2 = not due yet
cp "$H/certs/${D}_ecc/fullchain.cer" infra/tls/server.crt
cp "$H/certs/${D}_ecc/$D.key" infra/tls/server.key
openssl x509 -in infra/tls/server.crt -noout -subject -enddate
