#!/bin/sh
# DormDesk in-container firewall (Architecture Appendix B). Runs ON each instance: sh rules.sh <role>
# Default deny in AND out; allow only the flows the system needs. Stateful: replies are always allowed.
# The lab Console's firewall page cannot find our instances (it looks for "group02-group02-*"), so we
# apply the same iptables rules ourselves — this is exactly what the Console would do.
# v2: db (primary <-> standby replication), store (object store), mon -> both DBs + SMTP for alerts.
set -eu
ROLE=$1
BASTION_PUB=10.0.2.3      # bastion NIC in the public subnet
BASTION_PRIV=10.0.2.131   # bastion NIC in the private subnet
APP_ZONE=10.0.2.136/29    # api-01, api-02 (+ api-03 = .142 when scaled out)
DB_ZONE=10.0.2.150/31     # db-01 (.150) + db-02 (.151): either can be primary after a failover
STORE=10.0.2.155          # store-01: SeaweedFS S3 (HTTPS 8333)
MON=10.0.2.165
AI=10.0.2.160             # ai-01: local LLM for AI Insight

# new instances (lab-alpine / lab-postgres images) ship without iptables: install it once (egress is still open here)
command -v iptables >/dev/null || apk add -q iptables 2>/dev/null || { apt-get update -qq && apt-get install -y -qq iptables; } >/dev/null
iptables -P INPUT ACCEPT; iptables -P OUTPUT ACCEPT; iptables -F; iptables -X 2>/dev/null || true
for CH in INPUT OUTPUT; do
  iptables -A $CH -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -A $CH -m conntrack --ctstate INVALID -j DROP
done
iptables -A INPUT -i lo -j ACCEPT;  iptables -A OUTPUT -o lo -j ACCEPT

case "$ROLE" in
  web)   # public entry point
    iptables -A INPUT  -p tcp --dport 443 -j ACCEPT                              # users (via lab port 10201)
    iptables -A INPUT  -p tcp -s $BASTION_PUB --dport 22 -j ACCEPT               # admin SSH only via bastion
    iptables -A INPUT  -p icmp -s $BASTION_PUB -j ACCEPT
    iptables -A OUTPUT -p tcp -d $BASTION_PUB --dport 22 -j ACCEPT               # SSH tunnel to the API
    ;;
  api)
    iptables -A INPUT  -p tcp -s $BASTION_PRIV --dport 8000 -j ACCEPT            # Nginx traffic (arrives via tunnel exit)
    iptables -A INPUT  -p tcp -s $BASTION_PRIV --dport 22 -j ACCEPT
    iptables -A INPUT  -p icmp -s $BASTION_PRIV -j ACCEPT
    iptables -A OUTPUT -p tcp -d $DB_ZONE --dport 5432 -j ACCEPT                 # database (primary found by libpq)
    iptables -A OUTPUT -p tcp -d $STORE --dport 8333 -j ACCEPT                   # object store (S3 over TLS)
    iptables -A OUTPUT -p tcp -d $AI --dport 8080 -j ACCEPT                      # AI Insight model server
    iptables -A OUTPUT -p tcp --dport 587 -j ACCEPT                              # Gmail SMTP (STARTTLS) for notifications
    ;;
  ai)    # model server: only the API tier may call it; no outbound at all
    iptables -A INPUT  -p tcp -s $APP_ZONE --dport 8080 -j ACCEPT
    iptables -A INPUT  -p tcp -s $BASTION_PRIV --dport 22 -j ACCEPT
    iptables -A INPUT  -p icmp -s $BASTION_PRIV -j ACCEPT
    ;;
  db)    # db-01 and db-02 share this role; the peer streams WAL over 5432 (TLS, replication-only account)
    iptables -A INPUT  -p tcp -s $APP_ZONE --dport 5432 -j ACCEPT
    iptables -A INPUT  -p tcp -s $MON      --dport 5432 -j ACCEPT
    iptables -A INPUT  -p tcp -s $DB_ZONE  --dport 5432 -j ACCEPT                # replication from the peer
    iptables -A OUTPUT -p tcp -d $DB_ZONE  --dport 5432 -j ACCEPT                # standby -> primary (WAL stream)
    iptables -A INPUT  -p tcp -s $BASTION_PRIV --dport 22 -j ACCEPT
    iptables -A INPUT  -p icmp -s $BASTION_PRIV -j ACCEPT
    ;;                                                                            # no internet in or out
  store) # object store: only the API tier, no outbound at all
    iptables -A INPUT  -p tcp -s $APP_ZONE --dport 8333 -j ACCEPT
    iptables -A INPUT  -p tcp -s $BASTION_PRIV --dport 22 -j ACCEPT
    iptables -A INPUT  -p icmp -s $BASTION_PRIV -j ACCEPT
    ;;
  mon)
    iptables -A INPUT  -p tcp -s $BASTION_PRIV --dport 3000 -j ACCEPT            # Grafana via SSH tunnel
    iptables -A INPUT  -p tcp -s $BASTION_PRIV --dport 22 -j ACCEPT
    iptables -A INPUT  -p icmp -s $BASTION_PRIV -j ACCEPT
    iptables -A OUTPUT -p tcp -d $DB_ZONE --dport 5432 -j ACCEPT                 # read-only views on primary + standby
    iptables -A OUTPUT -p tcp --dport 587 -j ACCEPT                              # alert e-mails (Gmail SMTP)
    ;;
  db-fenced)  # failover: old primary may only talk to the bastion (admin) — no app, no replication, no writes reach it
    iptables -A INPUT  -p tcp -s $BASTION_PRIV --dport 22 -j ACCEPT
    iptables -A INPUT  -p icmp -s $BASTION_PRIV -j ACCEPT
    iptables -A INPUT  -p tcp --dport 5432 -j REJECT --reject-with tcp-reset    # clients fail at once, try the next host
    iptables -A OUTPUT -p tcp -d $DB_ZONE --dport 5432 -j ACCEPT                 # rejoin: copy FROM the new primary
    ;;
  open)  # emergency / package install: allow all
    exit 0 ;;
  *) echo "role must be web|api|db|store|mon|ai|db-fenced|open"; exit 1 ;;
esac
# log + drop everything else (rate-limited log so the console does not flood)
iptables -A INPUT  -m limit --limit 6/min -j LOG --log-prefix "dd-fw-in-drop: "  2>/dev/null || true
iptables -A OUTPUT -m limit --limit 6/min -j LOG --log-prefix "dd-fw-out-drop: " 2>/dev/null || true
iptables -P INPUT DROP
iptables -P OUTPUT DROP
iptables -P FORWARD DROP
echo "firewall applied: $ROLE"
