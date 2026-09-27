#!/bin/sh
# Runs ON web-01 (Alpine, official nginx image). Expects /tmp/dd/web/*, /tmp/dd/nginx/*, /tmp/dd/server.{crt,key}
set -eu
mkdir -p /etc/nginx/tls
install -m 600 /tmp/dd/server.key /etc/nginx/tls/server.key
install -m 644 /tmp/dd/server.crt /etc/nginx/tls/server.crt
[ -f /etc/nginx/conf.d/default.conf.orig ] || cp /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.orig 2>/dev/null || true
cp /tmp/dd/nginx/default.conf /tmp/dd/nginx/dd_proxy.inc /etc/nginx/conf.d/
rm -rf /usr/share/nginx/html/*
cp -r /tmp/dd/web/* /usr/share/nginx/html/
# nginx image symlinks access.log to stdout; write a real file so we can inspect $remote_addr
[ -L /var/log/nginx/access.log ] && rm /var/log/nginx/access.log && touch /var/log/nginx/access.log
chmod 644 /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/dd_proxy.inc
find /usr/share/nginx/html -type d -exec chmod 755 {} + ; find /usr/share/nginx/html -type f -exec chmod 644 {} +
install -m 755 /tmp/dd/nginx/tunnel.sh /usr/local/bin/dd-tunnel.sh
pgrep -f 'dd-tunnel.sh loop' >/dev/null || sh /usr/local/bin/dd-tunnel.sh start
nginx -t
nginx -s reload
rm -rf /tmp/dd
sleep 1
echo WEB_OK
