#!/bin/bash
# After a failover: turn the old (fenced) primary into a standby of the new primary.
# The old data directory is NOT reused (it may contain transactions the new primary never saw);
# it is copied fresh from the new primary, and the old copy is kept once as data.old.* for forensics.
#   HSSH=hssh infra/db/rejoin.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
. infra/topology.env
exec infra/db/make_standby.sh "$DB_STANDBY" "$DB_PRIMARY"
