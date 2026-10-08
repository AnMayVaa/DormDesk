#!/bin/bash
# Deploy DormDesk from the team laptop through the lab bastion.
# Needs a helper `hssh <internal-ip> [cmd]` that SSHes to an instance via bastion 45.77.40.35:22002
# (e.g. ssh -J root@45.77.40.35:22002 root@<ip>) and `bssh [cmd]` for the bastion itself.
# Machine list: infra/topology.env (the ONLY place with IPs). Secrets: ./secrets.env (gitignored).
#   usage: infra/deploy.sh db|api <ip>|apis|web|store|bastion|ai|hooks|cert|all [--seed]
set -euo pipefail
cd "$(dirname "$0")/.."
HSSH=${HSSH:-hssh}; BSSH=${BSSH:-bssh}; export HSSH
set -a; . ./secrets.env; set +a   # APP_PW RO_PW REPL_PW PG_PW SESSION_SECRET S3_* OBJ_KEYS LLM_API_KEY SMTP_* DUCKDNS_*
. infra/topology.sh
SEED=0; for a in "$@"; do [ "$a" = --seed ] && SEED=1; done
fw() { $HSSH "$1" 'mkdir -p /usr/local/sbin; cat > /usr/local/sbin/dd-firewall.sh; chmod 700 /usr/local/sbin/dd-firewall.sh; sh /usr/local/sbin/dd-firewall.sh '"$2" < infra/firewall/rules.sh; }
fw_open() { $HSSH "$1" '[ -x /usr/local/sbin/dd-firewall.sh ] && sh /usr/local/sbin/dd-firewall.sh open || true'; }

deploy_db() {   # always the CURRENT primary; the standby receives every change through replication
  tar czf - db/01_schema.sql db/02_features.sql db/03_security.sql $( [ $SEED = 1 ] && echo db/seed.generated.sql ) \
      -C infra/tls db.crt db.key | $HSSH "$DB_PRIMARY" 'rm -rf /tmp/dd && mkdir -p /tmp/dd && tar xzf - -C /tmp/dd'
  $HSSH "$DB_PRIMARY" "APP_PW='$APP_PW' RO_PW='$RO_PW' REPL_PW='$REPL_PW' PG_PW='$PG_PW' PEER=$DB_STANDBY SEED=$SEED sh -s" < infra/remote/setup_db.sh
  dd_install_hook "$DB_PRIMARY" db
}

api_env() {  # $1 = ip
  cat <<ENV
DATABASE_URL='$(dd_dsn dormdesk_app "$APP_PW")'
SESSION_SECRET=$SESSION_SECRET
COOKIE_SECURE=1
ROOM_LIMIT_PER_10MIN=5
BIND_IP=$1
RUN_JOBS=1
PUBLIC_BASE_URL=https://${DUCKDNS_DOMAIN:-dormdesk-g02}.duckdns.org:10201
LLM_URL=http://$AI:8080/v1/chat/completions
LLM_API_KEY=${LLM_API_KEY:-}
SMTP_USER=${SMTP_USER:-}
SMTP_PASS=${SMTP_PASS:-}
OWNER_ALERT_TO=${OWNER_ALERT_TO:-${SMTP_USER:-}}
S3_URL=https://$STORE:8333
S3_BUCKET=dormdesk
S3_ACCESS_KEY=$S3_KEY
S3_SECRET_KEY=$S3_SECRET
S3_CA_FILE=/srv/dormdesk/dormdesk-ca.crt
OBJ_KEYS=$OBJ_KEYS
OBJ_KEY_ID=${OBJ_KEY_ID:-k1}
ENV
}
deploy_api() {  # $1 = ip
  local ip=$1 t; t=$(mktemp -d)
  api_env "$ip" > "$t/env"; cp infra/tls/dormdesk-ca.crt "$t/"
  tar czf - --exclude=__pycache__ api/app api/requirements.txt api/start.sh -C "$t" env dormdesk-ca.crt \
    | $HSSH "$ip" 'rm -rf /tmp/dd && mkdir -p /tmp/dd && tar xzf - -C /tmp/dd'
  rm -rf "$t"
  fw_open "$ip"                                   # egress is default-deny: open it while apt/pip install
  $HSSH "$ip" 'bash -s' < infra/remote/setup_api.sh
  dd_install_hook "$ip" api
  fw "$ip" api                                    # re-apply the CURRENT rules from the repo
}

deploy_web() {
  local t; t=$(mktemp -d); mkdir -p "$t/nginx"
  cp infra/nginx/default.conf infra/nginx/*.inc infra/remote/tunnel.sh "$t/nginx/"
  dd_upstream > "$t/nginx/dd_upstream.inc"; dd_tunnel_conf > "$t/nginx/tunnel.conf"   # GENERATED (api-N)
  cp infra/tls/server.crt infra/tls/server.key "$t/"
  tar czf - web -C "$t" nginx server.crt server.key | $HSSH "$WEB" 'rm -rf /tmp/dd && mkdir -p /tmp/dd && tar xzf - -C /tmp/dd'
  rm -rf "$t"
  $HSSH "$WEB" 'sh -s' < infra/remote/setup_web.sh
  dd_install_hook "$WEB" web
  record_cert
}
record_cert() {   # certificate expiry -> ops_meta, so Grafana can alert 14 days before it runs out
  local na; na=$(date -u -d "$(openssl x509 -enddate -noout -in infra/tls/server.crt | cut -d= -f2)" +%F)
  echo "INSERT INTO ops_meta (key, value, updated_at) VALUES ('tls_cert_not_after', '$na', now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();" \
    | $HSSH "$DB_PRIMARY" "su postgres -c 'psql -q -d dormdesk'" && echo "TLS certificate valid until $na (recorded)"
}

deploy_store() {
  [ -f infra/tls/store.crt ] || infra/tls/make-cert.sh store
  tar czf - -C infra/tls store.crt store.key | $HSSH "$STORE" 'rm -rf /tmp/dd && mkdir -p /tmp/dd && tar xzf - -C /tmp/dd'
  fw_open "$STORE"                                # download the SeaweedFS release (checksum pinned)
  $HSSH "$STORE" "S3_KEY='$S3_KEY' S3_SECRET='$S3_SECRET' S3_BACKUP_KEY='$S3_BACKUP_KEY' S3_BACKUP_SECRET='$S3_BACKUP_SECRET' sh -s" < infra/remote/setup_store.sh
  dd_install_hook "$STORE" store
  fw "$STORE" store
}

deploy_bastion() {
  PUBKEY=$(cat "${TUNNEL_PUB:-$HOME/.dd/tunnel.pub}")
  $BSSH "PUBKEY='$PUBKEY' PERMITOPEN='$(dd_permitopen)' bash -s" < infra/remote/setup_bastion.sh
}

deploy_hooks() {   # boot hook everywhere (after a lab restart every machine brings itself back)
  dd_install_hook "$WEB" web; dd_install_hook "$MON" mon; dd_install_hook "$STORE" store
  dd_install_hook "$DB_PRIMARY" db; timeout 30 $HSSH "$DB_STANDBY" true 2>/dev/null && dd_install_hook "$DB_STANDBY" db
  for ip in $API_HOSTS; do dd_install_hook "$ip" api; done
  dd_install_hook "$AI" ai && $HSSH "$AI" 'printf "#!/bin/sh\nexec /opt/llm/start.sh\n" > /etc/dormdesk/start.d/50-llm; chmod 700 /etc/dormdesk/start.d/50-llm'
}

case "${1:-}" in
  db)      deploy_db ;;
  api)     deploy_api "${2:?ip}" ;;
  apis)    for ip in $API_HOSTS; do deploy_api "$ip"; done ;;
  web)     deploy_web ;;
  store)   deploy_store ;;
  bastion) deploy_bastion ;;
  hooks)   deploy_hooks ;;
  cert)    record_cert ;;
  ai)  fw_open "$AI"
       $HSSH "$AI" "LLM_API_KEY='$LLM_API_KEY' bash -s" < infra/remote/setup_ai.sh
       fw "$AI" ai ;;
  all) deploy_db; deploy_store; for ip in $API_HOSTS; do deploy_api "$ip"; done; deploy_bastion; deploy_web; deploy_hooks ;;
  *) echo "usage: $0 db|api <ip>|apis|web|store|bastion|ai|hooks|cert|all [--seed]"; exit 1 ;;
esac
