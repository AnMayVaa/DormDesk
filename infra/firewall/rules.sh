#!/bin/sh
# DormDesk in-container firewall (Architecture Appendix B). Runs ON each instance: sh rules.sh <role>
# Default deny in AND out; allow only the flows the system needs. Stateful: replies are always allowed.
# The lab Console's firewall page cannot find our instances (it looks for "group02-group02-*"), so we
# apply the same iptables rules ourselves — this is exactly what the Console would do.
set -eu
ROLE=$1
BASTION_PUB=10.0.2.3      # bastion NIC in the public subnet
BASTION_PRIV=10.0.2.131   # bastion NIC in the private subnet
APP_ZONE=10.0.2.136/29    # api-01, api-02
DB=10.0.2.150
MON=10.0.2.165

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
    iptables -A OUTPUT -p tcp -d $DB --dport 5432 -j ACCEPT                      # database only
    ;;
  db)
    iptables -A INPUT  -p tcp -s $APP_ZONE --dport 5432 -j ACCEPT
    iptables -A INPUT  -p tcp -s $MON      --dport 5432 -j ACCEPT
    iptables -A INPUT  -p tcp -s $BASTION_PRIV --dport 22 -j ACCEPT
    iptables -A INPUT  -p icmp -s $BASTION_PRIV -j ACCEPT
    ;;                                                                            # no new outbound at all
  mon)
    iptables -A INPUT  -p tcp -s $BASTION_PRIV --dport 3000 -j ACCEPT            # Grafana via SSH tunnel
    iptables -A INPUT  -p tcp -s $BASTION_PRIV --dport 22 -j ACCEPT
    iptables -A INPUT  -p icmp -s $BASTION_PRIV -j ACCEPT
    iptables -A OUTPUT -p tcp -d $DB --dport 5432 -j ACCEPT
    ;;
  open)  # emergency / package install: allow all
    exit 0 ;;
  *) echo "role must be web|api|db|mon|open"; exit 1 ;;
esac
# log + drop everything else (rate-limited log so the console does not flood)
iptables -A INPUT  -m limit --limit 6/min -j LOG --log-prefix "dd-fw-in-drop: "  2>/dev/null || true
iptables -A OUTPUT -m limit --limit 6/min -j LOG --log-prefix "dd-fw-out-drop: " 2>/dev/null || true
iptables -P INPUT DROP
iptables -P OUTPUT DROP
iptables -P FORWARD DROP
echo "firewall applied: $ROLE"
