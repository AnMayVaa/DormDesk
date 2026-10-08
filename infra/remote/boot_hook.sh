#!/bin/sh
# DormDesk boot hook — installed as /etc/dormdesk/boot.sh on EVERY instance and called by the lab's
# /lab-entrypoint.sh just before it starts the container's main process. Containers have no systemd, so
# this is how a machine brings itself back after the lab restarts it (no laptop needed):
#   1. db only: swap in a prepared standby data directory (made by infra/db/make_standby.sh)
#   2. db only: split-brain guard — if I would start as a primary but my peer already IS the primary, fence myself
#   3. re-apply the firewall for this machine's role (/etc/dormdesk/role)
#   4. start our background services (/etc/dormdesk/start.d/*) once the main process is up
# Install: infra/remote/install_boot_hook.sh (idempotent). Log: /var/log/dormdesk-boot.log
exec >>/var/log/dormdesk-boot.log 2>&1
echo "=== boot $(date -u +%FT%TZ) role=$(cat /etc/dormdesk/role 2>/dev/null)"
ROLE=$(cat /etc/dormdesk/role 2>/dev/null || echo open)

if [ "$ROLE" = db ] || [ "$ROLE" = db-fenced ]; then
  PGDATA=/var/lib/postgresql/data
  NEW=/var/lib/postgresql/standby.new
  # 1. a standby data directory prepared while the old server was still running
  if [ -f "$NEW/.dd-ready" ]; then
    OLD=/var/lib/postgresql/data.old.$(date +%Y%m%d%H%M%S)
    mkdir -p "$OLD" && find "$PGDATA" -mindepth 1 -maxdepth 1 -exec mv {} "$OLD"/ \;
    rm -f "$NEW/.dd-ready" && find "$NEW" -mindepth 1 -maxdepth 1 -exec mv {} "$PGDATA"/ \;
    rmdir "$NEW"; chown -R postgres:postgres "$PGDATA"; chmod 700 "$PGDATA"
    for d in /var/lib/postgresql/data.old.*; do [ "$d" = "$OLD" ] || rm -rf "$d"; done   # keep only the newest old copy
    echo "standby data directory swapped in (old copy: $OLD)"
    ROLE=db; echo db > /etc/dormdesk/role
  fi
  # 2. split-brain guard: only matters if this node would come up as a primary
  if [ ! -f "$PGDATA/standby.signal" ] && [ -f /etc/dormdesk/peer ]; then
    PEER=$(cat /etc/dormdesk/peer)
    R=$(PGPASSFILE=/etc/dormdesk/repl.pgpass PGCONNECT_TIMEOUT=4 psql -At \
        "host=$PEER user=dormdesk_repl dbname=postgres sslmode=require" -c 'select pg_is_in_recovery()' 2>/dev/null)
    if [ "$R" = f ]; then
      echo "peer $PEER is already PRIMARY and I am not a standby -> FENCING myself (db-fenced, read-only)"
      ROLE=db-fenced; echo db-fenced > /etc/dormdesk/role
      # second fence: even if a client reached me, libpq's target_session_attrs=read-write skips a read-only server
      grep -q '^default_transaction_read_only' "$PGDATA/postgresql.auto.conf" ||
        echo "default_transaction_read_only = 'on'" >> "$PGDATA/postgresql.auto.conf"
    else
      echo "peer $PEER says in_recovery='$R' -> starting normally"
    fi
  fi
fi

# 3. firewall (iptables rules live in the container's network namespace and vanish on restart)
[ -x /usr/local/sbin/dd-firewall.sh ] && sh /usr/local/sbin/dd-firewall.sh "$ROLE"

# 4. our services, started after the main process (postgres / nginx / grafana) had time to come up
if [ -d /etc/dormdesk/start.d ]; then
  ( sleep 8; for s in /etc/dormdesk/start.d/*; do [ -x "$s" ] && { echo "start $s"; "$s"; }; done ) >>/var/log/dormdesk-boot.log 2>&1 &
fi
exit 0
