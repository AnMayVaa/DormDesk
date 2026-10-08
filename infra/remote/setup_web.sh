#!/bin/sh
# Runs ON web-01 (Alpine, official nginx image). Expects /tmp/dd/web/*, /tmp/dd/nginx/* (incl. GENERATED
# dd_upstream.inc + tunnel.conf), /tmp/dd/server.{crt,key}
set -eu
mkdir -p /etc/nginx/tls /etc/dormdesk/start.d
install -m 600 /tmp/dd/server.key /etc/nginx/tls/server.key
install -m 644 /tmp/dd/server.crt /etc/nginx/tls/server.crt
[ -f /etc/nginx/conf.d/default.conf.orig ] || cp /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.orig 2>/dev/null || true
cp /tmp/dd/nginx/default.conf /tmp/dd/nginx/*.inc /etc/nginx/conf.d/
chmod 644 /etc/nginx/conf.d/*.conf /etc/nginx/conf.d/*.inc
rm -rf /usr/share/nginx/html/*
cp -r /tmp/dd/web/* /usr/share/nginx/html/
# nginx image symlinks access.log to stdout; write a real file so we can inspect $remote_addr
[ -L /var/log/nginx/access.log ] && rm /var/log/nginx/access.log && touch /var/log/nginx/access.log
find /usr/share/nginx/html -type d -exec chmod 755 {} + ; find /usr/share/nginx/html -type f -exec chmod 644 {} +
RESTART=0; cmp -s /tmp/dd/nginx/tunnel.sh /usr/local/bin/dd-tunnel.sh || RESTART=1
install -m 755 /tmp/dd/nginx/tunnel.sh /usr/local/bin/dd-tunnel.sh
printf '#!/bin/sh\nexec sh /usr/local/bin/dd-tunnel.sh start\n' > /etc/dormdesk/start.d/50-tunnel; chmod 700 /etc/dormdesk/start.d/50-tunnel
# restart the tunnel only if its script or the API list changed (api-N auto-wiring) or it is not running
if [ $RESTART = 1 ] || ! cmp -s /tmp/dd/nginx/tunnel.conf /etc/dormdesk/tunnel.conf || ! pgrep -f 'dd-tunnel.sh loop' >/dev/null || ! pgrep -f 'dd-tunnel.sh watch' >/dev/null; then
  install -m 644 /tmp/dd/nginx/tunnel.conf /etc/dormdesk/tunnel.conf
  sh /usr/local/bin/dd-tunnel.sh start
fi
nginx -t
nginx -s reload
rm -rf /tmp/dd
sleep 1
echo WEB_OK
