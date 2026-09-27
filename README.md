# DormDesk — ระบบแจ้งซ่อมหอพัก (group02)

> Mini project วิชา 010123218 Cloud Network and Computing · เพื่อนในทีมอ่าน `CONTRIBUTING.md` ก่อนเริ่มงาน

ระบบต้นแบบออนไลน์ที่ **https://dormdesk-g02.duckdns.org:10201** (Let's Encrypt · เข้าด้วย IP จะถูกพาไปที่โดเมน) · เอกสารอยู่ใน `docs/` (เริ่มที่ `docs/DormDesk_HANDOFF.md`)

| หน้า | URL |
|---|---|
| หน้าแรก | `/` |
| ผู้เช่าแจ้งซ่อม | `/r/<รหัสห้อง>` (ลิงก์อยู่ใน `demo_accounts.txt` หรือแท็บ "ห้อง & ลิงก์") |
| ผู้เช่าติดตาม | `/t/<รหัสติดตาม>` |
| เจ้าของหอ | `/admin` (บัญชีเดโมอยู่ใน `demo_accounts.txt`) |

## โครงสร้าง
```
api/     FastAPI (รันบน api-01/api-02)      db/     schema + roles + Row-Level Security
web/     หน้าเว็บ HTML/JS (web-01)          infra/  nginx, TLS, สคริปต์ deploy, SSH tunnel
tools/   seed_gen.py (ข้อมูลเดโม), smoke_test.py (ทดสอบจากภายนอก)
```

## ไฟล์ลับ (ห้ามเข้า git — อยู่ใน .gitignore · ขอจากเพื่อนในทีมทางช่องทางส่วนตัว)
`cloud_pass.txt` รหัสเข้าเครื่อง · `secrets.env` รหัส DB + SESSION_SECRET · `demo_accounts.txt` บัญชีเดโม ·
`infra/tls/*.key|*.crt` ใบรับรอง (ติดตั้ง `infra/tls/dormdesk-ca.crt` บนเครื่องที่ใช้ demo เพื่อไม่ให้มีคำเตือน)

## Deploy (จากเครื่องของทีม ผ่าน bastion)
ต้องมีคำสั่ง `hssh <ip> [cmd]` = SSH ผ่าน bastion เช่น `ssh -J root@45.77.40.35:22002 root@<ip>`
```bash
infra/tls/make-cert.sh 45.77.40.35                       # ครั้งแรกเท่านั้น
python3 tools/seed_gen.py --base-url https://45.77.40.35:10201   # สร้างข้อมูลเดโม (ล้างข้อมูลเดิม!)
infra/deploy.sh db --seed    # db-01: schema, RLS, TLS, pg_hba, ข้อมูลเดโม
infra/deploy.sh api          # api-01 (api2 = api-02)
infra/deploy.sh ai           # ai-01: llama.cpp + Qwen3-0.6B สำหรับ "ถาม AI"
infra/deploy.sh web          # web-01: หน้าเว็บ, nginx, HTTPS, SSH tunnel
python3 tools/smoke_test.py  # ทดสอบจากภายนอก 15 ข้อ
```

## HTTPS (Let's Encrypt)
`infra/tls/renew-letsencrypt.sh && infra/deploy.sh web` ทุก ~60 วัน (ต้องมี `DUCKDNS_DOMAIN`, `DUCKDNS_TOKEN` ใน secrets.env)

## อีเมลแจ้งเตือน
ใส่ `SMTP_USER` (Gmail) และ `SMTP_PASS` (App Password 16 ตัว) ใน secrets.env แล้ว `infra/deploy.sh api && infra/deploy.sh api2` · `OWNER_ALERT_TO` (ไม่บังคับ) = อีเมลที่รับแจ้งเรื่องใหม่

## Firewall (iptables ในแต่ละเครื่อง)
`infra/firewall/apply.sh all` — default deny ขาเข้า/ขาออก + เปิดตามภาคผนวก B (มี rollback อัตโนมัติ 60 วิ ถ้าต่อกลับไม่ได้)

## ทดสอบและหลักฐาน (`evidence/`)
```bash
python3 tools/smoke_test.py      # 16 ข้อ: แจ้งซ่อม, ติดตาม, login, แยกข้อมูลหอ, Idempotency-Key
tools/verify.sh                  # 20 ข้อ: พอร์ต/เส้นทางที่ต้องเปิด-ปิด, RLS, สิทธิ์ DB, TLS, iptables
tools/backup.sh                  # pg_dump มาไว้ในเครื่องนี้ (backups/) + ทดสอบกู้คืน
```

## Grafana (mon-01 ไม่มีพอร์ตสาธารณะ)
```bash
ssh -p 22002 -N -L 3000:10.0.2.165:3000 root@45.77.40.35     # tunnel ผ่าน bastion (รหัส group02)
```
เปิด http://localhost:3000 → admin / `GRAFANA_PW` ใน `secrets.env` → dashboard "DormDesk — Security & Operations"

## หลังเครื่อง restart (ไม่มี systemd, กฎ iptables ไม่ถาวร)
`infra/after_restart.sh` — รัน API ทั้ง 2 เครื่อง, เปิด tunnel บน web-01, ใส่ firewall, แล้ว smoke test

## ทำไมต้องมี SSH tunnel
แล็บทิ้งทราฟฟิกระหว่าง public ↔ private subnet ทั้งหมด web-01 จึงคุยกับ API ผ่าน tunnel ที่ bastion
(กุญแจจำกัดให้ใช้ได้จาก web-01 และไปได้แค่ API:8000) — รายละเอียด `docs/DormDesk_System_Architecture.md` หัวข้อ 12.12
