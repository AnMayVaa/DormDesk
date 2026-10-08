#!/bin/sh
# Runs ON an instance after /etc/dormdesk/boot.sh was copied there: makes the lab entrypoint call it.
#   laptop side: dd_install_hook <ip> <role>   (infra/topology.sh — deploy.sh, make_standby.sh, scale_api.sh)
set -eu
mkdir -p /etc/dormdesk/start.d
chmod 700 /etc/dormdesk/boot.sh
[ -n "${ROLE:-}" ] && echo "$ROLE" > /etc/dormdesk/role
E=/lab-entrypoint.sh
if [ -f $E ] && ! grep -q /etc/dormdesk/boot.sh $E; then
  cp $E /etc/dormdesk/lab-entrypoint.orig
  # insert our hook right before the lab starts the main process
  awk '/^# Run the original entrypoint/ && !done { print "[ -x /etc/dormdesk/boot.sh ] && /etc/dormdesk/boot.sh || true  # DormDesk boot hook"; done=1 } { print }' \
    /etc/dormdesk/lab-entrypoint.orig > $E.new && chmod 755 $E.new && mv $E.new $E
fi
grep -q /etc/dormdesk/boot.sh $E && echo "boot hook installed ($(hostname), role=$(cat /etc/dormdesk/role 2>/dev/null))"
