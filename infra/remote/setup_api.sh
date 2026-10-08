#!/bin/bash
# Runs ON an API server (Ubuntu 24.04). Expects /tmp/dd/api/*, /tmp/dd/env, /tmp/dd/dormdesk-ca.crt
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v python3 >/dev/null || ! python3 -c 'import venv' 2>/dev/null || ! command -v curl >/dev/null; then
  apt-get update -qq && apt-get install -y -qq python3 python3-venv curl ca-certificates >/dev/null
fi
mkdir -p /srv/dormdesk /etc/dormdesk/start.d
rm -rf /srv/dormdesk/app
cp -r /tmp/dd/api/app /tmp/dd/api/requirements.txt /tmp/dd/api/start.sh /srv/dormdesk/
install -m 600 /tmp/dd/env /srv/dormdesk/.env
install -m 644 /tmp/dd/dormdesk-ca.crt /srv/dormdesk/dormdesk-ca.crt    # verifies store-01's HTTPS certificate
cd /srv/dormdesk
[ -d venv ] || python3 -m venv venv
./venv/bin/pip install -q --disable-pip-version-check -r requirements.txt
chmod 700 start.sh
printf '#!/bin/sh\nexec /srv/dormdesk/start.sh\n' > /etc/dormdesk/start.d/50-api; chmod 700 /etc/dormdesk/start.d/50-api
rm -rf /tmp/dd
./start.sh
