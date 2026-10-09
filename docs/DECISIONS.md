# DormDesk — Decisions & problems (v2, 8 Oct 2026)

Why the system looks the way it does. Each entry: **problem → how we thought about it → options → choice → what we got** (with the evidence file).
Read this together with `DormDesk_System_Architecture.md` (what the system is) and `PROJECT_TRACKER.md` (when it was done).

---

## Part A — Product features (Feature Spec v2)

### D1. Bills, fines and repairs must belong to a *person*, not a room
- **Problem.** Rooms change tenants. If bills and repair history hang off the room, the next tenant sees the old tenant's bills, slips and messages, and the old tenant's tracking links keep working.
- **Thinking.** The link a tenant holds is the room code; there are no tenant accounts (that is a product decision — no sign-up). So "who" must be modelled without logins.
- **Options.** (a) tenant accounts with login · (b) a `tenancies` row per stay + room-code rotation on change of tenant.
- **Choice.** (b). Every tenant table carries `tenancy_id`. Row-Level Security has two layers: `p_tenant` (dorm) and a RESTRICTIVE `p_tenancy` policy. "Change tenant" closes the tenancy and issues a new room code in one transaction. `resolve_tracking()` only resolves tokens of the *current* tenancy.
- **Result.** The old tenant's room link and tracking links stop working; the owner still sees history (badge "previous tenant"). Covered by `tools/flow_test.py` section "change of tenant".

### D2. Dorms want different features
- **Choice.** `dorm_settings` holds a switch per feature (fitness, pool, spaces, parking, bills, fines) plus every rule (quotas, fees, days). The API refuses a disabled feature with **403 `feature_disabled`** — hiding a tab is not security. The UI hides tabs only as convenience.
- **Result.** flow_test "feature switches are enforced by the API".

### D3. Time-based rules without a cron machine
- **Problem.** No-shows, the 15-day parking cancel notice, monthly bills, overdue e-mails and the 180-day PDPA clean-up all depend on time. Containers have no systemd/cron, and a cron on one API would die with that API.
- **Options.** (a) a separate "worker" instance · (b) cron on api-01 · (c) the job inside every API process, coordinated by the database.
- **Choice.** (c). Each API process runs a 1-minute loop; `pg_try_advisory_lock(727001)` makes sure only **one** runs the work. State that must be correct on every read (booking no-show, parking end, check-in expiry) is "settled" at read time too, so correctness never depends on the job running. E-mails are exactly-once via the `notifications` table (`ON CONFLICT DO NOTHING`).
- **Result.** No extra machine; if api-01 dies the job continues on api-02. Grafana alert "Background job stalled".

### D4. Two API servers write at the same time
- **Problem.** Double-booking a room slot, exceeding a weekly quota, or two receipts with the same number.
- **Choice.** Booking overlap is impossible at the database level: `EXCLUDE USING gist (facility_id WITH =, tstzrange WITH &&)` (btree_gist). Quotas and check-in limits use row locks. Receipt numbers come from `dorm_counters` (gapless per dorm, `DDxx-yymm-0001`).
- **Result.** flow_test booking/receipt sections; concurrent requests through Nginx retry are safe (D7).

### D5. Money and PromptPay
- **Choice.** Money is stored as **integer satang** (no float rounding). PromptPay QR = EMVCo payload built by our code (fields 00,01,29,58,53,54,63 + CRC-16/CCITT-FALSE), rendered as SVG with `segno`.
- **Check.** Our payload is byte-identical to the reference npm library `promptpay-qr`.
- **Safety.** The demo PromptPay id is an **invalid placeholder** on purpose — nobody can pay real money into a demo QR.

### D6. QR check-in for gym / pool
- **Problem.** Not every phone browser can scan QR codes in a web page.
- **Choice.** The QR encodes a URL `/q/<token>` — the phone's normal camera app opens it (landing page `q.html`). Inside the app we try the browser's `BarcodeDetector`, then a self-hosted `jsQR` (no CDN, Apache-2.0), then "take a photo of the QR". The owner can rotate a facility's QR (old prints stop working). `Permissions-Policy: camera=(self)`.

### D7. Retrying writes must be safe
- **Problem.** Nginx retries a failed request on the other API (`proxy_next_upstream … non_idempotent`). Through the SSH tunnel a dead API looks like "sent, then cut", so without retries POSTs returned 502 during failover (v1 finding).
- **Choice.** Every create carries an `Idempotency-Key`; the key is stored in `idem_keys` **in the same transaction** as the write, so a retry returns the first result instead of creating a duplicate. State changes set absolute values.
- **Correction (v2.1, D19).** "State changes set absolute values" was not true for the repair status: each change also adds a history row. A retried status change therefore added the row twice. D19 extends the key to every write.

---

## Part B — Platform

### D8. Where do photos, payment slips and fine evidence live?
- **Problem.** v1 kept photos as `bytea` in PostgreSQL. With slips and fine evidence that would grow the database, every backup and every replica — and slips are sensitive financial documents.
- **Options.**
  | Option | Verdict |
  |---|---|
  | keep `bytea` in PostgreSQL | simple, but bloats DB/backups/replication |
  | **MinIO** (originally planned) | the community edition was **archived in 2026** — no more security fixes; release downloads return 410 |
  | Ceph RGW | far too heavy for 256 MB |
  | Garage | good, but smaller ecosystem |
  | **SeaweedFS** | Apache-2.0, one static binary, S3 API, ~110 MB RAM idle |
- **Choice.** **SeaweedFS on store-01** (chosen by Ohm after MinIO turned out archived). On top of it:
  - the API encrypts every object with **AES-256-GCM** before upload (AAD = object key, key id stored with the metadata) — the store and its backups only ever hold ciphertext;
  - the metadata row lives in PostgreSQL table `objects` under RLS: if the row is not visible to the dorm, the API never fetches the blob;
  - two S3 identities, least privilege: `dormdesk-api` (read/write/list one bucket) and `dormdesk-backup` (read/list only);
  - S3 over **HTTPS** with a certificate from our own CA, verified by the API (`S3_CA_FILE`); the plain-HTTP port is moved and blocked by the firewall; only the app zone may reach port 8333;
  - a tiny dependency-free S3 SigV4 client in `api/app/storage.py` (no boto3 in 512 MB).
- **Result.** `tools/verify.sh`: TLS verified + anonymous 403, objects start with the `DD1` header, store-01 cannot reach the internet or the DB. Backup identity gets 403 on PUT.

### D9. Owner sessions must be revocable
- **Problem.** v1 used a signed cookie: a stolen cookie stayed valid until expiry, and "log out everywhere" meant rotating the secret for everybody.
- **Choice.** Random session token in the cookie, only its **sha256** stored in `admin_sessions`; 8 h absolute lifetime, 2 h idle timeout; "sign out other devices" and per-session revoke in Settings; logout kills the row.
- **Skipped on purpose:** owner 2FA (adds a TOTP enrolment flow and recovery codes — not worth it before Demo Day), docker-compose dev environment (CI already gives every change a full Postgres + SeaweedFS + API run).

### D10. A second database (db-02)
- **Problem.** db-01 was the single point of failure: a dead db-01 meant restore-from-dump and lost writes since the last dump.
- **Options.**
  | Option | Data loss if primary dies | Downside |
  |---|---|---|
  | backups only (v1) | since last dump (hours) | long outage |
  | synchronous replication, 2 nodes | none | if the standby dies the primary **stops accepting writes** |
  | **asynchronous streaming replication** | ~1 s | small loss window, needs a lag alert |
  | Patroni + etcd (automatic) | ~1 s | needs a 3rd voter + more RAM than the lab gives us |
- **Choice.** Async physical streaming replication db-01 → db-02 (replication slot, TLS, `dormdesk_repl` role that can replicate but cannot read a single table), **manual failover** with one command (`infra/db/failover.sh`). Automatic failover with only 2 nodes cannot tell "primary dead" from "network split" — that is how split-brain happens.
- **How the API finds the new primary.** libpq multi-host DSN `host=db-01,db-02 … target_session_attrs=read-write` with short timeouts — no API restart, no DNS.
- **Fencing (split-brain guard), three layers:** the old primary gets firewall role `db-fenced` (5432 rejected), `default_transaction_read_only=on`, and on its next boot the hook asks its peer "are you primary?" — if yes, it fences itself before PostgreSQL starts.
- **Result (measured, `evidence/A11_db_failover_2026-10-08.txt`):** db-01 stopped → service back on db-02 in ~35 s, smoke test 16/16; db-01 came back and **fenced itself**; rebuilt as standby; planned switchover back with **zero data loss** (waited until replay LSN = primary LSN).

### D11. PostgreSQL is PID 1 in the lab container
- **Problem.** To turn a node into a standby you must replace its data directory while PostgreSQL is stopped — but stopping PID 1 stops the container, and only the lab console can start it again.
- **Choice.** `pg_basebackup` into a **staging directory** while the old server keeps running; the boot hook swaps it in on the next console restart, before PostgreSQL starts (`infra/db/make_standby.sh`, `standby_prepare.sh`). The old directory is kept once (`data.old.*`) for forensics.

### D12. Machines must come back by themselves after a lab restart
- **Problem.** No systemd: after the lab restarts a container, our processes are gone and iptables rules (network namespace) are gone. v1 needed `infra/after_restart.sh` from the laptop.
- **Choice.** A **boot hook**: one line in the lab's `/lab-entrypoint.sh` runs `/etc/dormdesk/boot.sh` before the main process. It swaps a staged standby (db), runs the split-brain guard (db), re-applies the firewall for `/etc/dormdesk/role`, and starts `/etc/dormdesk/start.d/*` (API, tunnel, SeaweedFS, model server).
- **Result.** Seen working on db-01, db-02, api-01, mon-01 restarts (`evidence/A9_api_failover_selfheal_2026-10-08.txt`, A11).

### D13. Backups you can trust
- **Thinking.** A backup that was never restored is a hope, not a backup. And backups inside the lab die with the lab.
- **Choice.**
  - daily logical dump **from the standby** (no load on the primary) + objects (via the read-only identity) + WAL segments, pulled to the **laptop**, encrypted there (AES-256, PBKDF2, `BACKUP_PASSPHRASE`);
  - weekly physical base backup; the standby archives WAL itself (`archive_mode=always`), the primary forces a segment switch every 60 s (`archive_timeout`) → point-in-time recovery to within ~1 minute;
  - **every run restores** the laptop copy into a throw-away database and compares row counts of 10 tables; the result is written to `ops_meta` → Grafana alert if no good backup for 26 h;
  - **PITR drill** (`tools/backup.sh pitr`): write a value, make a "mistake", rewind a copy to 1 s before the mistake using only laptop files.
- **Result.** `evidence/A12_backup_pitr_2026-10-08.txt`: restore counts identical, `PITR_OK` (restored value = good value, live value = MISTAKE).

### D14. Adding an API server should be one command (api-N auto-wiring)
- **Problem.** The API list was written in 3 places by hand: Nginx upstream, the SSH tunnel forwards, the bastion `permitopen` list.
- **Choice.** `infra/topology.env` is the only place with IPs. Everything else is **generated** (`infra/topology.sh`). The firewall and `pg_hba` already trust the whole app zone `10.0.2.136/29`, and the job uses an advisory lock, so a new server needs nothing else. `infra/scale_api.sh add|remove <ip>`.
- **Result.** `evidence/api_scale_out_2026-10-08.txt`: api-03 created in the console, deployed, wired, serving traffic (requests spread over 3 servers), then removed — one command each.

### D15. A dead API made users wait (found during testing)
- **Problem.** Stopping api-01 in the console made some requests hang for 15–30 s and one smoke test timed out. Reason: Nginx connects to the *local tunnel port*, which always accepts; the bastion then tries to reach a container that no longer exists and waits for TCP retries. Open-source Nginx has no active health checks, so it cannot know.
- **Choice.** The web-01 watchdog (`dd-tunnel.sh watch`) is now an **active health check**: every 5 s it calls `/api/health` of every API through the tunnel; 2 failures → that server is marked `down` in the upstream (never all of them); healthy again → back in. It still restarts a stuck SSH tunnel if no API answers for ~60 s. `proxy_read_timeout` lowered to 15 s.
- **Result.** Same test afterwards: smoke test passes while api-01 is down; only the 2 requests in the first ~10 s were slow. api-01 started again → boot hook started the API → watchdog put it back.

### D16. Monitoring and alerts
- **Choice.** Grafana reads **aggregate views only** (no names, phones, plates, slips) through two read-only data sources (primary + standby). New dashboard "Platform & Business" and **7 alert rules**: API server silent, no standby streaming, standby lagging, failed-login spike, background job stalled, backup older than 26 h, TLS certificate < 14 days. E-mail via Gmail (test e-mail delivered).
- **Problem found.** Grafana 13 at 256 MB sat at its memory limit and took 4 s per request; creating alert rules hung. → mon-01 resized to 512 MB / 0.5 vCPU. Safe because everything in Grafana is provisioned by `infra/grafana/setup_grafana.sh` (dashboards and alerts are generated from `build.py`).

### D17. Load test — where is the bottleneck?
- **Choice.** k6 from the laptop through the public URL, 80 virtual users. A random header token (only during the test) skips the per-IP limit, because all virtual users share one IP.
- **Result** (`evidence/loadtest_summary_2026-10-08.txt`): 1 API 50.6 req/s, median 1.32 s → 2 APIs 66.9 req/s, median 0.73 s (+32 % throughput, median halved). A 3rd API did **not** help (59.6 req/s, worse p95): CPU stats show the 0.5-vCPU database throttling. Next step is the data tier (more DB CPU, or read-only pages served by db-02), not more APIs.

### D18. CI (GitHub Actions)
- **Choice.** Every push: Python compile, `node --check`, `bash -n` + shellcheck (errors), Grafana files up to date, `nginx -t` on the generated config, then an end-to-end job with **PostgreSQL 16 + SeaweedFS + the API**: smoke test (16), flow test (81 since v2.1), object backup round trip.
- **Result.** shellcheck found a real bug before CI even ran on GitHub: `infra/lab/console.sh` fed the page HTML and the Python script through the same stdin (`list` never worked).

### D19. One click = one change, even when the reply is lost (v2.1, found by the team)
- **Problem.** A teammate changed a repair status on the lab, got **502**, but the change was saved. Pressing again saved it again; the history showed the same step **3 times**, and the tenant saw the duplicates too.
- **How we looked for the cause.** The access log showed 502/504 bursts only on the API, never on static files. The API logs had **1,128 "Child process died"** lines on api-02. uvicorn with `--workers 2` runs a supervisor that pings each worker and kills it after 5 s without an answer. On a 0.5-vCPU container that is throttled under load, a busy worker misses the ping → killed in the middle of a request → Nginx gets a cut connection (502) or waits (504) → Nginx retries the PATCH on the other API (`non_idempotent`, D7) → the user presses again. Every path writes one more history row.
- **Options.** (a) only stop the restarts — fixes this cause, but any lost reply (Wi-Fi, tunnel, timeout) would still duplicate; (b) stop Nginx retrying writes — then a dead API means a 502 for the user again (the v1 problem from D7); (c) make every write *exactly-once* by key, then retries are harmless and can stay. **Chosen: (a) + (c)**, plus a small guard in the data.
- **What we built.**
  1. `api/start.sh`: `--workers 1` (we scale with more servers, D14 — not more processes on half a CPU) and `--timeout-keep-alive 75`. The Nginx upstream got `keepalive_timeout 30s`, shorter than the API's, so Nginx never reuses a connection the API already closed (another classic source of random 502s).
  2. `api/app/idempotency.py`: middleware for every POST/PATCH/PUT with an `Idempotency-Key`. It **records the key before** the handler runs and **stores the reply after**, in the shared database (`http_idem`), so it works across api-01 and api-02. Same key again → the stored reply (`Idempotent-Replay: true`); still running → wait up to 12 s (below Nginx's 15 s), then `409` + `Retry-After`; failed with 5xx → may run again; abandoned > 60 s → taken over. Scope = method + path + session cookie (nobody can replay someone else's reply). Rows are purged after 24 h by a `SECURITY DEFINER` function, so the app role still has no `DELETE`.
  3. `web/assets/common.js`: every write gets a key; on 502/503/504, no answer, or `409 + Retry-After` the **same key** is sent again (up to 3 tries). If it still fails the owner sees "the connection dropped, it may already be saved" and the drawer reloads the real status instead of inviting a second click.
  4. `admin_update_request`: the same status + same note from the same owner within 10 minutes is recorded once (covers a double press with two different keys).
- **Result.** Reproduced in a browser test: the first two replies are thrown away as 502 → the page retries with the same key → **1** history row, success message. Flow test +4 checks (same key → same reply; pressed again → still one row; two parallel copies → one row; another owner reusing the key → still 403). On the lab after deploy (`evidence/v2.1_lab_2026-10-09.txt`): one process per API, the "Child process died" counters stopped (api-01 87, api-02 1,128 — no new lines), **0** responses 5xx (the 9 hours before: 85 × 502, 8 × 504), and the same 4 checks pass through Nginx across both API servers.

### D20. Works on any screen: phone, iPad, desktop (v2.1)
- **Problem (owner feedback).** "Settings: where does it redirect?", "the e-mail text box is squeezed on the phone", "a button runs off the screen".
- **How we looked.** A Playwright audit (`tools/ui_audit.js`) opens every tenant and owner page at 360, 390, 768, 1180 and 1440 px and reports: the whole page scrolling sideways, elements outside the screen, inputs narrower than 150 px, buttons under 32 px. Before: the landing page, billing and settings scrolled sideways on phones; the e-mail form sat in a ~40 px column.
- **What we changed.**
  - The "redirect": *Print QR* (and slips, photos) opened the raw API file in a new tab — a bare SVG with no way back on a phone. Now an **in-page viewer** shows it with Print / Download / Close (print CSS prints only the QR). The admin tab is kept in the address (`/admin#settings`), so a reload or the TH/EN switch no longer throws you back to the overview.
  - Long buttons wrap their text on phones; the "For dorm owners" button becomes a lock icon (name kept for screen readers).
  - Grid/flex children may shrink (`min-width: 0`), so one wide table no longer widens the whole page.
  - Tables turn into **one card per row** on phones (each value shows its column name); the meter table is half as long as a first card version.
  - Settings rows wrap their controls under the label; rate fields stay in label + input pairs; the rules use 2 columns on iPad.
  - The e-mail form spans the whole card, with `inputmode="email"` and no auto-capitalisation.
  - The admin tabs scroll sideways with a fade on the side where more tabs are hidden; the chosen tab is scrolled into view.
  - Signed-in devices show "Safari on iPhone" instead of a cut user-agent string.
- **Result.** Audit at 5 widths: 0 pages scroll sideways, 0 elements off screen; the only "narrow" inputs left are fixed-size number fields (rates, units). UI flow test still passes (scan QR, book, send slip, owner sees slip, receipt, fine reply, parking approve).

---

## Part C — Problems we hit (and how they were fixed)

| # | Problem | Cause | Fix |
|---|---|---|---|
| 1 | MinIO download returned 410 | community edition archived | SeaweedFS (D8) |
| 2 | SeaweedFS served plain HTTP on 8333 although a certificate was given | `-s3.port` is always HTTP; HTTPS needs `-s3.port.https` | HTTPS on 8333, HTTP moved to 8334 and firewalled |
| 3 | RLS policy error "invalid input syntax for integer" | SQL does not short-circuit `''::int` | `COALESCE(NULLIF(setting,'')::int, tenancy_id)` |
| 4 | `IndeterminateDatatype` in a contact update | untyped NULL parameter | `CASE WHEN %s THEN now() END` with a bool |
| 5 | UI: "null" text, duplicate fine banner, wrong route for `#fine/<id>`, inline meter text | found in screenshots | fixed in tenant-hub.js / CSS |
| 6 | `pkill -f` killed the test shell itself | pattern matched our own command line | pid-file restart script |
| 7 | New lab instances: our root password ignored | the console generates its own | `console.sh pass <name>` reads it from the page |
| 8 | Console "Edit" renamed mon-01 to `group02-group02-mon-01` | Edit recreates the container and adds the group prefix again | `console.sh resize` strips the prefix |
| 9 | `pg_basebackup` failed: permission denied `pg_hba.conf.orig` | file created by root in PGDATA | chown postgres in `setup_db.sh` |
| 10 | basebackup timed out to db-01 | db-01 still had the v1 firewall | apply v2 rules (`apply.sh`) before building the standby |
| 11 | new instances had no `iptables` | lab-alpine / lab-postgres images | `rules.sh` installs it once |
| 12 | backup restore test restored nothing | bash dynamic scope: a loop variable `f` overwrote the dump path | `local f` |
| 13 | restore check said OK although tables were missing | empty value compared as 0 | check counts every table and empty values |
| 14 | archive settings flipped after a node was rebuilt | `setup_db.sh` forced `archive_mode=on` over `always` | only set it on a first-time primary |
| 15 | dead API made requests hang | tunnel accepts, bastion waits (D15) | watchdog active health check |
| 16 | Grafana unusable | 256 MB memory limit (D16) | 512 MB, everything provisioned by script |
| 17 | `.env` DSN broke on `&` | shell `source` treats `&` as background | quote the value |
| 18 | 502 on a saved status change, history ×3 | uvicorn worker health-ping kills on a throttled CPU + Nginx write retry + second press (D19) | 1 worker, exactly-once key middleware, client retry with the same key, de-dup |
| 19 | "Settings redirects somewhere" | Print QR opened the raw SVG in a new tab | in-page viewer with Print / Download (D20) |
| 20 | page scrolls sideways on phones | grid children keep their content width (`min-width: auto`) | `min-width: 0`, table → cards on phones (D20) |
| 21 | the viewer hook would have hijacked the tenant's menu | tenant menu links already used `data-view` | renamed the viewer attribute to `data-viewer` (caught in review before release) |

## Part D — Not done (and why)
- **Owner 2FA, docker-compose dev** — skipped by decision (D9).
- **Automatic DB failover** — needs a third voter (Patroni + etcd); with 2 nodes manual is safer (D10).
- **Read traffic on db-02** — the load test says this is the next real gain (D17).
