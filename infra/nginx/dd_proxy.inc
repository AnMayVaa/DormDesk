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
# every write from our pages carries an Idempotency-Key and api/app/idempotency.py runs one key once (the record is in the
# shared database, so it holds across api-01 / api-02). Before v2.1 this comment said "state changes set an absolute value" -
# not true for the repair-status history, and this retry was one of the ways one click became 2-3 history rows.
proxy_next_upstream error timeout http_502 http_503 non_idempotent;
proxy_next_upstream_tries 2;
proxy_hide_header X-Powered-By;
