#!/bin/bash
# Deploy DormDesk from the team laptop through the lab bastion.
# Needs a helper `hssh <internal-ip> [cmd]` that SSHes to an instance via bastion 45.77.40.35:22002
# (e.g. ssh -J root@45.77.40.35:22002 root@<ip>). Secrets come from ./secrets.env (gitignored).
#   usage: infra/deploy.sh db|api|web|all [--seed]
set -euo pipefail
cd "$(dirname "$0")/.."
HSSH=${HSSH:-hssh}
. ./secrets.env      # APP_PW RO_PW PG_PW SESSION_SECRET
SEED=0; [ "${2:-}" = "--seed" ] && SEED=1

deploy_db() {
  tar czf - db/01_schema.sql db/02_security.sql $( [ $SEED = 1 ] && echo db/seed.generated.sql ) \
      -C infra/tls db.crt db.key | $HSSH 10.0.2.150 'rm -rf /tmp/dd && mkdir -p /tmp/dd && tar xzf - -C /tmp/dd'
  $HSSH 10.0.2.150 "APP_PW='$APP_PW' RO_PW='$RO_PW' PG_PW='$PG_PW' SEED=$SEED sh -s" < infra/remote/setup_db.sh
}
deploy_api() {  # $1 = ip
  local ip=$1 tmp; tmp=$(mktemp)
  printf 'DATABASE_URL=postgresql://dormdesk_app:%s@10.0.2.150:5432/dormdesk?sslmode=require\nSESSION_SECRET=%s\nCOOKIE_SECURE=1\nROOM_LIMIT_PER_10MIN=5\nBIND_IP=%s\n' \
    "$APP_PW" "$SESSION_SECRET" "$ip" > "$tmp"
  tar czf - --exclude=__pycache__ api/app api/requirements.txt api/start.sh -C "$(dirname "$tmp")" --transform "s|$(basename "$tmp")|env|" "$(basename "$tmp")" \
    | $HSSH "$ip" 'rm -rf /tmp/dd && mkdir -p /tmp/dd && tar xzf - -C /tmp/dd'
  rm -f "$tmp"
  # egress is default-deny: open it while apt/pip install, then restore the api firewall
  $HSSH "$ip" '[ -x /usr/local/sbin/dd-firewall.sh ] && sh /usr/local/sbin/dd-firewall.sh open || true'
  $HSSH "$ip" 'bash -s' < infra/remote/setup_api.sh
  $HSSH "$ip" '[ -x /usr/local/sbin/dd-firewall.sh ] && sh /usr/local/sbin/dd-firewall.sh api || true'
}
deploy_web() {
  tar czf - web -C infra nginx -C remote tunnel.sh --transform 's|^tunnel.sh|nginx/tunnel.sh|' -C ../tls server.crt server.key | $HSSH 10.0.2.10 'rm -rf /tmp/dd && mkdir -p /tmp/dd && tar xzf - -C /tmp/dd'
  $HSSH 10.0.2.10 'sh -s' < infra/remote/setup_web.sh
}
case "${1:-}" in
  db)  deploy_db ;;
  api) deploy_api 10.0.2.140 ;;
  api2) deploy_api 10.0.2.141 ;;
  web) deploy_web ;;
  all) deploy_db; deploy_api 10.0.2.140; deploy_web ;;
  *) echo "usage: $0 db|api|api2|web|all [--seed]"; exit 1 ;;
esac
