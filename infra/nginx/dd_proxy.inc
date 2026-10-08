proxy_pass http://dd_api;
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto https;
proxy_connect_timeout 3s;
proxy_read_timeout 15s;   # an API that accepted but never answers is retried on the other one
# retry the other API instance on failure. POST/PATCH/PUT are retried too (non_idempotent) because they are safe to repeat:
# every create carries an Idempotency-Key (stored in the same DB transaction), state changes set an absolute value.
proxy_next_upstream error timeout http_502 http_503 non_idempotent;
proxy_next_upstream_tries 2;
proxy_hide_header X-Powered-By;
