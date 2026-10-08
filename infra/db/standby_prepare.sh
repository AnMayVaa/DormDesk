#!/bin/sh
# Runs ON the node that will become the standby, while its current postgres keeps running.
# Copies the primary with pg_basebackup into a STAGING directory; the boot hook swaps it in on the next
# container restart (postgres is PID 1 here, so it cannot be stopped without restarting the container).
# env: P (primary ip) SLOT (replication slot) REPL_PW  APP_NAME
set -eu
NEW=/var/lib/postgresql/standby.new
ARCH=/var/lib/postgresql/wal_archive
mkdir -p /etc/dormdesk
echo "$P" > /etc/dormdesk/peer
printf '*:5432:*:dormdesk_repl:%s\n' "$REPL_PW" > /etc/dormdesk/repl.pgpass; chmod 600 /etc/dormdesk/repl.pgpass
install -o postgres -g postgres -m 600 /etc/dormdesk/repl.pgpass /var/lib/postgresql/.pgpass
rm -rf "$NEW"; install -d -o postgres -g postgres -m 700 "$NEW"
install -d -o postgres -g postgres -m 700 "$ARCH"
echo "pg_basebackup from $P ..."
su postgres -c "pg_basebackup -d 'host=$P user=dormdesk_repl sslmode=require application_name=$APP_NAME' \
  -D $NEW -X stream -c fast --no-password" 
# standby settings (replace any copied from the primary's postgresql.auto.conf)
A=$NEW/postgresql.auto.conf
grep -v -E '^(primary_conninfo|primary_slot_name|archive_mode|archive_command|shared_buffers|default_transaction_read_only) ' $A > $A.n || true
MEM=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo max)
cat >> $A.n <<CONF
primary_conninfo = 'host=$P port=5432 user=dormdesk_repl passfile=/var/lib/postgresql/.pgpass sslmode=require application_name=$APP_NAME'
primary_slot_name = '$SLOT'
archive_mode = 'always'
archive_command = 'f=$ARCH/%f.gz; [ -f \$f ] || { gzip -c %p > \$f.part && mv \$f.part \$f; }'
CONF
[ "$MEM" != max ] && [ "$MEM" -lt 400000000 ] && echo "shared_buffers = '64MB'" >> $A.n
mv $A.n $A; chown postgres:postgres $A; chmod 600 $A
touch $NEW/standby.signal; chown postgres:postgres $NEW/standby.signal
touch $NEW/.dd-ready                       # the boot hook swaps it in and sets role=db
du -sh $NEW | sed 's/^/staged: /'
