#!/bin/bash
# Cloud Lab Console (http://45.77.40.35:9000) from the command line — the same forms the web page posts.
#   infra/lab/console.sh list
#   infra/lab/console.sh create <name> <image> <ip> <cpus> <memory> [KEY=VAL ...]   e.g. create db-02 lab-postgres:latest 10.0.2.151 0.5 256m POSTGRES_PASSWORD=x
#   infra/lab/console.sh restart|stop|delete <name>
#   infra/lab/console.sh resize <name> <cpus> <memory>   RECREATES the container (writable layer + boot hook lost,
#                                                         new root password) — re-run the setup for that machine after
#   infra/lab/console.sh pass <name> > file     root password the console generated (never print it to a terminal you share)
# Login: group02 + the password in cloud_pass.txt (pass=...). Cookie kept in ~/.dd/cj.
set -euo pipefail
cd "$(dirname "$0")/../.."
C=http://45.77.40.35:9000; G=group02; J=${CJ:-$HOME/.dd/cj}
login() {
  local pw; pw=$(grep -o 'pass=[^ ]*' cloud_pass.txt | head -1 | cut -d= -f2)
  curl -s -m 15 -c "$J" -b "$J" -o /dev/null -d "group=$G" --data-urlencode "password=$pw" "$C/login"
}
page() { curl -s -m 20 -b "$J" -c "$J" "$C/$G/instances"; }
html=$(page); grep -q 'create-form' <<<"$html" || { login; html=$(page); }
H=$(mktemp); trap 'rm -f "$H"' EXIT; printf '%s' "$html" > "$H"   # page HTML for the parsers below
id_of() { python3 - "$1" "$H" <<'PY'
import re, sys
h = open(sys.argv[2], encoding="utf-8", errors="replace").read(); name = sys.argv[1]
for n, i in re.findall(r'group02-([a-z0-9._-]+)</[^>]*>.*?instances/([0-9a-f]{12})/', h, re.S):
    if n == name: print(i); break
PY
}
case "${1:-list}" in
  list) python3 - "$H" <<'PY'
import re, sys
h = re.sub(r'<script.*?</script>', '', open(sys.argv[1], encoding="utf-8", errors="replace").read(), flags=re.S)
t = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', h))
for m in re.finditer(r'group02-([a-z0-9._-]+) (lab-[a-z]+:latest) (\w+) (10\.0\.2\.\d+)', t): print(*m.groups())
PY
  ;;
  create)
    shift; name=$1 image=$2 ip=$3 cpus=$4 mem=$5; shift 5
    env=$(printf '%s\n' "$@")
    case $ip in 10.0.2.1[3-9][0-9]|10.0.2.2*) net=group02-private ;; *) net=group02-public ;; esac
    curl -s -m 60 -b "$J" -c "$J" -o /dev/null -w "create $name -> HTTP %{http_code}\n" \
      --data-urlencode "image=$image" --data-urlencode "name=$name" --data-urlencode "network=$net" --data-urlencode "ip=$ip" \
      --data-urlencode "cpus=$cpus" --data-urlencode "memory=$mem" --data-urlencode "port_mappings=" --data-urlencode "env=$env" \
      "$C/$G/instances/create" ;;
  pass)
    python3 - "$2" "$H" <<'PY'
import re, sys
h = open(sys.argv[2], encoding="utf-8", errors="replace").read()
i = h.find("group02-" + sys.argv[1] + "<")
m = re.search(r"copyCred\(this, '([^']+)'\)", h[i:i + 4000]) if i >= 0 else None
sys.exit("no instance / password for " + sys.argv[1]) if not m else print(m.group(1))
PY
  ;;
  resize)   # the console's Edit form: same name/image/network/ip/ports/env, new CPU + RAM
    id=$(id_of "$2"); [ -n "$id" ] || { echo "no instance $2"; exit 1; }
    E=$(mktemp); curl -s -m 20 -b "$J" -c "$J" "$C/$G/instances/$id/edit" > "$E"
    args=$(python3 - "$E" "$3" "$4" <<'PY'
import html, re, shlex, sys
h = open(sys.argv[1], encoding="utf-8", errors="replace").read()
v = lambda n: html.unescape((re.search(r'name="%s"[^>]*value="([^"]*)"' % n, h) or [None, ""])[1])
sel = lambda n: (re.search(r'name="%s".*?<option[^>]*value="([^"]*)"[^>]*selected' % n, h, re.S) or [None, ""])[1]
env = html.unescape((re.search(r'name="env"[^>]*>(.*?)</textarea>', h, re.S) or [None, ""])[1])
f = {"name": re.sub(r"^(group02-)+", "", v("name")),   # the console adds the group prefix itself
     "image": sel("image"), "network": sel("network"), "ip": v("ip"),
     "cpus": sys.argv[2], "memory": sys.argv[3], "port_mappings": v("port_mappings"), "env": env}
print(" ".join("--data-urlencode " + shlex.quote(k + "=" + x) for k, x in f.items()))
PY
)
    rm -f "$E"
    eval curl -s -m 120 -b "$J" -c "$J" -o /dev/null -w "'resize $2 ($id) -> HTTP %{http_code}\n'" "$args" "$C/$G/instances/$id/update" ;;
  restart|stop|delete|start)
    id=$(id_of "$2"); [ -n "$id" ] || { echo "no instance $2"; exit 1; }
    curl -s -m 60 -b "$J" -c "$J" -o /dev/null -w "$1 $2 ($id) -> HTTP %{http_code}\n" -X POST "$C/$G/instances/$id/$1" ;;
  *) echo "usage: $0 list|create|restart|stop|start|delete"; exit 1 ;;
esac
