#!/bin/bash
# Runs ON api-01 / api-02 (Ubuntu 24.04). Expects /tmp/dd/api/* and /tmp/dd/env
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v python3 >/dev/null || ! python3 -c 'import venv' 2>/dev/null || ! command -v curl >/dev/null; then
  apt-get update -qq && apt-get install -y -qq python3 python3-venv curl ca-certificates >/dev/null
fi
mkdir -p /srv/dormdesk
rm -rf /srv/dormdesk/app
cp -r /tmp/dd/api/app /tmp/dd/api/requirements.txt /tmp/dd/api/start.sh /srv/dormdesk/
install -m 600 /tmp/dd/env /srv/dormdesk/.env
cd /srv/dormdesk
[ -d venv ] || python3 -m venv venv
./venv/bin/pip install -q --disable-pip-version-check -r requirements.txt
chmod 700 start.sh
rm -rf /tmp/dd
./start.sh
