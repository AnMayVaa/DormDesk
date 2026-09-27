#!/bin/bash
# Back up db-01 to this laptop (outside the lab) and prove it restores (test A10).
#   HSSH=hssh tools/backup.sh            -> backups/dormdesk_YYYYmmdd_HHMM.dump + restore test
set -euo pipefail
cd "$(dirname "$0")/.."
HSSH=${HSSH:-hssh}
mkdir -p backups
F=backups/dormdesk_$(date +%Y%m%d_%H%M).dump
$HSSH 10.0.2.150 'su postgres -c "pg_dump -Fc dormdesk"' > "$F"
echo "backup: $F ($(du -h "$F" | cut -f1))"
# restore into a throw-away database on db-01 and compare row counts
cat "$F" | $HSSH 10.0.2.150 'cat > /tmp/r.dump && chmod 644 /tmp/r.dump && su postgres -c "
  dropdb --if-exists dormdesk_restore_test && createdb dormdesk_restore_test &&
  pg_restore -d dormdesk_restore_test --no-owner /tmp/r.dump 2>/dev/null;
  for t in dorms rooms requests request_events request_photos; do
    a=\$(psql -At -d dormdesk -c \"select count(*) from \$t\"); b=\$(psql -At -d dormdesk_restore_test -c \"select count(*) from \$t\");
    echo \"  \$t: live=\$a restored=\$b\"; done;
  dropdb dormdesk_restore_test"; rm -f /tmp/r.dump'
