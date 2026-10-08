# DormDesk — ระบบจัดการหอพัก (group02)

> Mini project วิชา 010123218 Cloud Network and Computing · เพื่อนในทีมอ่าน `CONTRIBUTING.md` ก่อนเริ่มงาน

ระบบออนไลน์ที่ **https://dormdesk-g02.duckdns.org:10201** (Let's Encrypt · เข้าด้วย IP จะถูกพาไปที่โดเมน) · เอกสารอยู่ใน `docs/`:
`DormDesk_System_Architecture.md` (ระบบคืออะไร) · `DECISIONS.md` (ทำไม + ปัญหาที่เจอ) · `DormDesk_HANDOFF.md` (กฎการเขียนโค้ด, API) · `PROJECT_TRACKER.md` (สถานะ)

| หน้า | URL |
|---|---|
| หน้าแรก | `/` |
| ผู้เช่า: แจ้งซ่อม · บิล · ค่าปรับ · ฟิตเนส/สระ · จอง · ที่จอดรถ | `/r/<รหัสห้อง>` (ลิงก์อยู่ใน `demo_accounts.txt` หรือแท็บ "ห้อง & ลิงก์") |
| ผู้เช่าติดตามเรื่องซ่อม | `/t/<รหัสติดตาม>` |
| QR ของฟิตเนส/สระ (สแกนด้วยกล้องมือถือ) | `/q/<token>` |
| เจ้าของหอ | `/admin` (บัญชีเดโมอยู่ใน `demo_accounts.txt`) |

## โครงสร้าง
```
api/     FastAPI 2.0 (api-01/02/…): main, tenant, admin_features, auth, jobs, storage, promptpay, objbackup
db/      01_schema → 02_features (v2 + migration) → 03_security (roles, RLS, Grafana views)
web/     HTML/JS (web-01) · assets/tenant-hub.js, admin-features.js, scanner.js, vendor/jsQR.js
infra/   topology.env (รายชื่อเครื่อง — ที่เดียว) · deploy.sh · db/ (standby, failover, rejoin) · remote/ (setup ทุกเครื่อง,
         boot hook, tunnel+watchdog) · firewall/ · nginx/ · grafana/ · lab/console.sh · scale_api.sh · tls/
tools/   seed_gen.py · smoke_test.py (16) · flow_test.py (77) · verify.sh (48) · backup.sh · loadtest/ (k6) · ci/
.github/ CI (GitHub Actions)
```

## ไฟล์ลับ (ห้ามเข้า git — อยู่ใน .gitignore · ขอจากเพื่อนในทีมทางช่องทางส่วนตัว)
`cloud_pass.txt` รหัสเข้าเครื่อง · `secrets.env` รหัส DB / S3 / กุญแจเข้ารหัสไฟล์ / backup passphrase (แบบฟอร์ม `secrets.env.example`) ·
`demo_accounts.txt` บัญชีเดโม · `infra/tls/*.key|*.crt` ใบรับรอง + CA ของทีม · `backups/` (เข้ารหัส)
> `OBJ_KEYS` และ `BACKUP_PASSPHRASE` หาย = ไฟล์ใน object store และ backup อ่านไม่ได้อีกเลย เก็บไว้ 2 ที่เสมอ

## Deploy (จากเครื่องของทีม ผ่าน bastion)
ต้องมี `hssh <ip> [cmd]` = SSH ผ่าน bastion (เช่น `ssh -J root@45.77.40.35:22002 root@<ip>`) และ `bssh [cmd]` = SSH เข้า bastion
```bash
infra/lab/console.sh list                                 # เครื่องในแล็บ (create / restart / pass / resize ก็ได้)
infra/tls/make-cert.sh store                              # ใบรับรองของ store-01 (ครั้งแรก)
python3 tools/seed_gen.py --base-url https://dormdesk-g02.duckdns.org:10201   # ข้อมูลเดโม (ล้างข้อมูลเดิม!)
infra/deploy.sh store        # store-01: SeaweedFS (S3 HTTPS) + 2 บัญชี S3
infra/deploy.sh db --seed    # เครื่องหลัก: schema 01→02→03, RLS, TLS, pg_hba, replication, ข้อมูลเดโม
infra/db/make_standby.sh     # db-02: สร้าง/สร้างใหม่ hot standby (console restart ให้เอง)
infra/deploy.sh apis         # ทุกเครื่องใน API_HOSTS   (api <ip> = เครื่องเดียว)
infra/deploy.sh bastion      # permitopen ของ tunnel (สร้างจาก topology.env)
infra/deploy.sh web          # web-01: หน้าเว็บ, nginx, HTTPS, tunnel + watchdog
infra/deploy.sh hooks        # boot hook ทุกเครื่อง
infra/deploy.sh ai           # ai-01: llama.cpp + Qwen3-0.6B สำหรับ "ถาม AI"
infra/grafana/setup_grafana.sh && infra/grafana/setup_grafana.sh smtp   # แล้ว console.sh restart mon-01
```

## ฐานข้อมูลสำรอง (db-02)
```bash
infra/db/failover.sh             # db หลักล่ม: fence เครื่องเก่า (ถ้าติดต่อได้) → promote db-02 → สลับ topology → smoke test
infra/db/failover.sh --planned   # สลับแบบตั้งใจ: รอจน standby ได้ทุก transaction (ไม่เสียข้อมูล)
infra/db/rejoin.sh               # สร้างเครื่องเก่าเป็น standby ของเครื่องหลักใหม่
```

## เพิ่ม/ลด API (api-N auto-wiring)
`infra/scale_api.sh add 10.0.2.142` (สร้าง api-03 ใน Console + deploy + ต่อ bastion/tunnel/Nginx ให้เอง) · `infra/scale_api.sh remove 10.0.2.142`

## Backup (เก็บบน laptop แบบเข้ารหัส)
```bash
tools/backup.sh          # ทุกวัน: dump (จาก standby) + WAL + objects → ทดสอบกู้คืน → บันทึกให้ Grafana
tools/backup.sh base     # ทุกสัปดาห์: base backup สำหรับ PITR
tools/backup.sh pitr     # ซ้อมกู้ย้อนเวลา (A12)
```

## HTTPS (Let's Encrypt)
`infra/tls/renew-letsencrypt.sh && infra/deploy.sh web` ทุก ~60 วัน (Grafana เตือนเมื่อเหลือ < 14 วัน)

## อีเมลแจ้งเตือน
ใส่ `SMTP_USER` (Gmail) และ `SMTP_PASS` (App Password 16 ตัว) ใน secrets.env แล้ว `infra/deploy.sh apis` · `OWNER_ALERT_TO` (ไม่บังคับ) = อีเมลที่รับแจ้งเรื่องใหม่และ alert ของ Grafana

## Firewall (iptables ในแต่ละเครื่อง)
`infra/firewall/apply.sh all` — default deny ขาเข้า/ขาออก + เปิดตามภาคผนวก B (มี rollback อัตโนมัติ 60 วิ ถ้าต่อกลับไม่ได้) · boot hook ตั้งใหม่ให้เองหลัง restart

## ทดสอบและหลักฐาน (`evidence/`)
```bash
python3 tools/smoke_test.py                                       # 16 ข้อ (v1)
python3 tools/flow_test.py https://dormdesk-g02.duckdns.org:10201 --lab   # 77 ข้อ (v2 ทั้งหมด)
tools/verify.sh                                                   # 48 ข้อ: network, firewall, RLS, replication, object store
tools/loadtest/run.sh 80 30s 0.3                                  # k6: 1 API vs ทุก API (ต้องมี k6)
```
CI (`.github/workflows/ci.yml`) รัน lint + `nginx -t` + PostgreSQL 16 + SeaweedFS + API + smoke + flow ทุก push

## Grafana (mon-01 ไม่มีพอร์ตสาธารณะ)
```bash
ssh -p 22002 -N -L 3000:10.0.2.165:3000 root@45.77.40.35     # tunnel ผ่าน bastion (รหัส group02)
```
เปิด http://localhost:3000 → admin / `GRAFANA_PW` ใน `secrets.env` → "DormDesk — Security & Operations" และ "DormDesk — Platform & Business" · alert rules อยู่ในโฟลเดอร์ DormDesk

## หลังเครื่อง restart
ไม่ต้องทำอะไร: boot hook ในแต่ละเครื่องตั้ง firewall และสตาร์ตบริการเอง · ถ้าสงสัย รัน `infra/after_restart.sh` (รันซ้ำ + smoke test)

## ทำไมต้องมี SSH tunnel
แล็บทิ้งทราฟฟิกระหว่าง public ↔ private subnet ทั้งหมด web-01 จึงคุยกับ API ผ่าน tunnel ที่ bastion
(กุญแจจำกัดให้ใช้ได้จาก web-01 และไปได้แค่ API:8000) — รายละเอียด `docs/DormDesk_System_Architecture.md` หัวข้อ 12.12
