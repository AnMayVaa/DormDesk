#!/bin/bash
# Local CA + server certificate for the lab IP (no domain => no public CA). Same idea as mkcert.
# Output stays on the infra person's machine (gitignored). Install dormdesk-ca.crt on the demo laptop.
set -e
cd "$(dirname "$0")"
IP=${1:-45.77.40.35}
[ -f dormdesk-ca.key ] || openssl req -x509 -newkey rsa:3072 -nodes -days 825 -keyout dormdesk-ca.key \
  -out dormdesk-ca.crt -subj "/CN=DormDesk Local CA (group02)"
T=$(mktemp -d)
openssl req -newkey rsa:2048 -nodes -keyout server.key -out "$T/server.csr" -subj "/CN=$IP"
printf "subjectAltName=IP:%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n" "$IP" > "$T/server.ext"
openssl x509 -req -in "$T/server.csr" -CA dormdesk-ca.crt -CAkey dormdesk-ca.key -CAcreateserial -days 397 \
  -out server.crt -extfile "$T/server.ext"
# db-01 TLS certificate (API verifies encryption with sslmode=require)
openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout db.key -out db.crt -subj "/CN=db-01.group02"
rm -rf "$T"
echo "done: server.crt/server.key (web-01), db.crt/db.key (db-01), dormdesk-ca.crt (install on demo laptop)"
