# DormDesk routes (shared by the lab config and the local test config)
root /usr/share/nginx/html;

location = /       { try_files /index.html =404; }
location = /admin  { try_files /admin.html =404; }
location /r/       { try_files /r.html =404; }
location /t/       { try_files /t.html =404; }
location /q/       { try_files /q.html =404; }          # facility QR scanned with the phone camera app
location /assets/  { expires 1h; include /etc/nginx/conf.d/dd_headers.inc; add_header Cache-Control "public"; }
location = /favicon.ico { return 301 /assets/favicon.svg; }
location ~ \.html$ { internal; }   # pages only via the clean URLs above

location = /api/auth/login {
    limit_req zone=dd_login burst=3 nodelay;
    include /etc/nginx/conf.d/dd_proxy.inc;
}
location ~ ^/api/rooms/[^/]+/requests$ {
    limit_req zone=dd_report burst=5 nodelay;
    include /etc/nginx/conf.d/dd_proxy.inc;
}
# v2 tenant writes: check-in, booking, parking, guest pass, waitlist, slip, messages, contact e-mail
location ~ ^/api/rooms/[^/]+/(checkins|bookings|parking|bills|fines|contact) {
    limit_req zone=dd_write burst=10 nodelay;
    limit_req zone=dd_api_lt burst=20 nodelay;
    include /etc/nginx/conf.d/dd_proxy.inc;
}
location ~ ^/api/admin/dorms/[0-9]+/fines$ {             # owner uploads up to 3 evidence photos
    client_max_body_size 9m;
    limit_req zone=dd_api_lt burst=20 nodelay;
    include /etc/nginx/conf.d/dd_proxy.inc;
}
location ~ ^/api/admin/dorms/[0-9]+/ask$ {               # AI Insight: slow local model — no retry, longer timeout
    limit_req zone=dd_api burst=5 nodelay;
    proxy_pass http://dd_api;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_connect_timeout 3s;
    proxy_read_timeout 60s;
    proxy_next_upstream off;
}
location /api/ {
    limit_req zone=dd_api_lt burst=20 nodelay;
    include /etc/nginx/conf.d/dd_proxy.inc;
}
