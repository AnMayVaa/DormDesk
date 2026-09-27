proxy_pass http://dd_api;
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto https;
proxy_connect_timeout 3s;
proxy_read_timeout 30s;
# retry the other API instance on failure. POST/PATCH are retried too (non_idempotent) because they are safe to repeat:
# new requests carry an Idempotency-Key, status changes set an absolute value.
proxy_next_upstream error timeout http_502 http_503 non_idempotent;
proxy_next_upstream_tries 2;
proxy_hide_header X-Powered-By;
