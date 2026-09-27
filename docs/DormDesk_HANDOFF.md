# DormDesk — Handoff & Context

> **อ่านไฟล์นี้ก่อนเริ่มทำงานต่อ** ไม่ว่าจะเป็นคนในทีมหรือ AI assistant
> ไฟล์นี้เก็บบริบท สเปคของโค้ด และเหตุผลของการตัดสินใจ
> **ตัวเลข IP พอร์ต เครื่อง และกฎ firewall ให้ยึด `DormDesk_System_Architecture.md` เป็นหลัก** — ไฟล์นี้สรุปไว้เท่านั้น
> สถานะงานรายสัปดาห์ + checklist อยู่ใน `PROJECT_TRACKER.md`

---

## 0. TL;DR สำหรับคนที่เพิ่งเข้ามา

เราคือกลุ่ม group02 วิชา 010123218 Cloud Network and Computing กำลังทำ mini project
สวมบทเป็นสตาร์ทอัพ สร้าง MVP ที่ใช้งานได้จริงบน Cloud Lab ของอาจารย์ แล้ว pitch ให้อาจารย์ฟัง

**ผลิตภัณฑ์:** DormDesk — เว็บแอปรับแจ้งซ่อมหอพัก/คอนโด แทนการแจ้งผ่าน LINE
**สถานะ:** Sprint 1 — **ระบบต้นแบบออนไลน์ที่ https://45.77.40.35:10201** (ผู้เช่าแจ้ง/ติดตาม, เจ้าของ login/เปลี่ยนสถานะ/dashboard/ห้อง/หมวด) · Console firewall ยังใช้ไม่ได้ (บั๊กของแล็บ) · web-01 คุยกับ API ผ่าน SSH tunnel ผ่าน bastion (Architecture 12.12)
**เส้นตาย:** Sprint 1 = สัปดาห์ที่ 2, Sprint 2 = Demo Day สัปดาห์ที่ 3, รายงานเต็มสิ้นเทอม

**สิ่งที่ห้ามพลาดในการประเมิน:** อาจารย์ให้คะแนน 2 เรื่อง คือ (1) สถาปัตยกรรม — network, security,
การแบ่ง tier และ (2) แก้ปัญหาธุรกิจจริงไหม ทุกการตัดสินใจต้องอธิบายเหตุผลได้ และ **ทุกข้ออ้างด้านความปลอดภัยต้องมีผลทดสอบรองรับ** (Architecture หัวข้อ 14)

**3 เรื่องที่ต้องทำก่อนเรื่องอื่น**
1. แก้ firewall กับอาจารย์ + ตั้งชั้นป้องกันในตัวโปรแกรมระหว่างรอ (Architecture หัวข้อ 10)
2. ทำเส้นทางหลักให้ทำงานครบ: ผู้เช่าแจ้ง → เจ้าของเห็นและเปลี่ยนสถานะ → ผู้เช่าเห็นสถานะใหม่
3. พิสูจน์ว่าข้อมูลหอ A กับหอ B ไม่ปนกัน (ทดสอบ A1–A3)

---

## 1. ไฟล์ในโปรเจค

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `DormDesk_System_Architecture.md` | **แหล่งข้อมูลหลักด้านสถาปัตยกรรม** — เครื่อง, IP, firewall, ความปลอดภัย, วิธีสร้างใหม่, แผนทดสอบ |
| `DormDesk_HANDOFF.md` (ไฟล์นี้) | บริบท ผลิตภัณฑ์ สเปคของโค้ด เหตุผลของการตัดสินใจ |
| `PROJECT_TRACKER.md` | สถานะรายสัปดาห์, checklist, decision log, work log, ซ้อม Q&A |
| `DormDesk_OnePager.html` / `.pdf` | ส่งมอบ Sprint 0 (หน้าเดียว A4) |
| `cloud_pass.txt` · `secrets.env` · `demo_accounts.txt` | รหัสเข้าเครื่อง · รหัส DB/SESSION_SECRET · บัญชีเดโม + ลิงก์ห้อง — **เก็บเฉพาะในทีม ห้ามเข้า git** |
| `api/` `web/` `db/` `infra/` `tools/` | โค้ดและสคริปต์ deploy — วิธีใช้ใน `README.md` |

---

## 2. ข้อกำหนดของวิชา (ห้ามแก้ — มาจากโจทย์)

1. **Two-Tier Network:** ต้องมีทั้ง public subnet และ private subnet
2. **Frontend:** web app อยู่ใน public subnet
3. **Backend:** REST API อย่างน้อย 1 endpoint อยู่ใน private subnet
4. **Security:** เปิดพอร์ตสู่ internet เท่าที่จำเป็น

Demo Day = pitch 5 นาที + live demo 5 นาที + technical Q&A 5 นาที

---

## 3. ผลิตภัณฑ์ — ต้องเข้าใจก่อนเขียนโค้ด

### ปัญหาและลูกค้า
หอพัก/คอนโดกลางรับแจ้งปัญหาทาง LINE พอหลายห้องแจ้งพร้อมกัน เรื่องจมหาย ติดตามสถานะไม่ได้
ผู้เช่าต้องทักซ้ำ และเจ้าของไม่มีภาพรวมว่าปัญหาไหนเกิดบ่อยหรือแก้ช้า
**คนจ่ายเงิน:** เจ้าของ/ผู้จัดการหอระดับกลาง (ดูแลได้หลายอาคาร) — **ผู้เช่า:** ใช้ฟรี ไม่ต้องสมัคร

### ทำไมไม่ใช้ LINE OA + Google Form (คำถามที่อาจารย์น่าจะถาม)
- Google Form ไม่มีสถานะงาน ผู้เช่าไม่รู้ว่าเรื่องไปถึงไหน → ยังต้องทัก LINE ซ้ำ
- ไม่รู้ว่าแจ้งจากห้องไหนจริง (ใครก็กรอกได้) — DormDesk รู้ห้องจากลิงก์ประจำห้อง
- ไม่มีตัวเลขสำหรับบริหาร: เวลาเฉลี่ยที่ใช้ซ่อม, เรื่องค้างเกินกำหนด, ห้อง/หมวดที่เสียซ้ำ
- ดูแลหลายหอในบัญชีเดียวไม่ได้
- **จุดขายหลักของ pitch คือ dashboard ที่ตอบว่า "หอเราซ่อมเร็วแค่ไหน และอะไรเสียบ่อย"**

### Flow ฝั่งผู้เช่า (ไม่มี login)
1. เจ้าของสร้างห้องในระบบ → ระบบออก **รหัส/ลิงก์ประจำห้อง** เป็นค่าสุ่มเดาไม่ได้
2. เจ้าของส่งลิงก์ให้ผู้เช่าทาง LINE ตอนย้ายเข้า
3. ผู้เช่าเปิดลิงก์ → ระบบรู้หอและเลขห้องจากรหัส → กรอกหมวด ชื่อ เบอร์ รายละเอียด รูป · อีเมล (ไม่บังคับ — ใช้รับแจ้งเตือน) · ติ๊กยินยอมการเก็บข้อมูล (PDPA)
4. ส่งแล้วได้ **tracking link** (token สุ่ม) ไว้ดูสถานะ
5. เมื่อสถานะเปลี่ยน → ถ้าให้อีเมลไว้ ระบบส่งอีเมลแจ้ง (Should) — ผู้เช่าไม่ต้องคอยเปิดดูเอง
6. ผู้เช่าย้ายออกหรือรหัสหลุด → เจ้าของกดเปลี่ยนรหัสห้อง ลิงก์เก่าใช้ไม่ได้ทันที

> หมายเหตุ: LINE Notify ปิดบริการแล้ว (มี.ค. 2025) ถ้าจะแจ้งเตือนทาง LINE ต้องใช้ LINE Messaging API — จัดเป็นไอเดียอนาคต ไม่ใช่ MVP

### Flow ฝั่งเจ้าของ (admin, มี login)
login → เลือกหอ → เห็นคำขอแยกหมวด/ความเร่งด่วน → เปลี่ยนสถานะ → ดู dashboard สรุป
→ จัดการห้องและรหัสห้อง → เปิด-ปิดหมวดปัญหาของหอนั้น

### หมวดปัญหา (เจ้าของเปิด-ปิดได้ต่อหอ)
`ไฟฟ้า` `น้ำ` `แอร์` `ลิฟต์` `ของชำรุดในห้อง` `laundry` `พัสดุ` `parking` `อื่น ๆ`

### สถานะคำขอ
`received` รับเรื่องแล้ว → `in_progress` กำลังดำเนินการ → `done` เสร็จสิ้น
(+ `rejected` ปฏิเสธ/แจ้งซ้ำ) — ความเร่งด่วน: `normal` / `urgent`

### ตัวเลขบน Dashboard (ต้องมี — เป็นจุดขาย)
| ตัวเลข | ตอบคำถามเจ้าของว่า |
|---|---|
| จำนวนเรื่องตามสถานะ | ตอนนี้ค้างกี่เรื่อง |
| เวลาเฉลี่ยตั้งแต่แจ้งจนเสร็จ (ต่อหมวด) | ทีมช่างเร็วแค่ไหน |
| เรื่องที่ค้างเกิน 48 ชม. | อะไรต้องเร่ง |
| หมวดที่แจ้งบ่อยที่สุด (30 วัน) | ควรลงทุนแก้อะไรถาวร |
| ห้องที่แจ้งซ้ำหมวดเดิม | อุปกรณ์ห้องไหนควรเปลี่ยน |

### ขอบเขต MVP
| ระดับ | ฟีเจอร์ |
|---|---|
| **Must** | admin login (1 บัญชีหลายหอ), จัดการหอ/ห้อง + รหัสประจำห้อง, แจ้งปัญหาพร้อมรูป + ยินยอม PDPA, tracking link, รายการคำขอ + เปลี่ยนสถานะ, แยกข้อมูลแต่ละหอ (API + RLS), rate limit ต่อห้อง |
| **Should** | dashboard ตามตารางด้านบน, เปิด-ปิดหมวดต่อหอ, ความเร่งด่วน, อีเมลแจ้งเตือนเมื่อสถานะเปลี่ยน, api-02 (HA), Grafana บน mon-01 |
| **Could** | AI Insight Assistant, แจ้งเตือนผ่าน LINE Messaging API |

> ทำ Must ให้เสร็จและเสถียรก่อนเสมอ ห้ามเริ่ม Could ถ้า Must ยังไม่ครบ

### โมเดลธุรกิจ (สมมติฐาน — ต้องบอกว่าเป็นสมมติฐานเสมอ)
- SaaS รายเดือนต่อหอ, AI Insight เป็นแพ็กเกจเสริม · ราคายังไม่ยืนยัน
- **งานยืนยัน:** คุยกับเจ้าของ/ผู้จัดการหอจริง 2–3 ราย (ถามว่าตอนนี้รับแจ้งซ่อมอย่างไร เสียเวลาเท่าไร ยอมจ่ายไหม) แล้วใส่คำพูดจริง 1 ประโยคในสไลด์

---

## 4. สภาพแวดล้อม Cloud Lab (ข้อมูลจริง ห้ามเดา)

| รายการ | ค่า |
|---|---|
| Server ของแล็บ | 45.77.40.35 |
| VPC ของกลุ่ม | 10.0.2.0/24 |
| Public subnet | `group02-public` 10.0.2.0/25 — gateway 10.0.2.1 |
| Private subnet | `group02-private` 10.0.2.128/25 — gateway 10.0.2.129 |
| Bastion / Jump host | 10.0.2.131 — SSH จากภายนอกผ่าน `45.77.40.35:22002` (แล็บเตรียมให้) |
| Instance | Docker container กำหนด static IP ได้ ค่าเริ่มต้น 0.5 vCPU / 256 MB · ไม่มี systemd |
| เปิดสู่ภายนอก | port mapping host port 10200–10299 → port ใน container |
| Firewall | ตั้งใน Console ทั้งขาเข้า/ขาออก รองรับ CIDR · ใช้ iptables ในเครื่อง |
| ขาออก internet | ทั้งสอง subnet ออกได้ผ่าน server แล็บ (ต้องจำกัดเองด้วย firewall ขาออก) |

**ผลตรวจที่ยืนยันแล้ว (27 ก.ย. 2026)**
- ✅ port mapping 10201 → web-01:443 ตั้งได้
- ✅ เครื่องใน private subnet ไม่มีทางเข้าจากภายนอก (ยกเว้น bastion ของแล็บ)
- ❌ กฎ firewall ยังไม่มีผลกับเครื่องจริง — ระบบแล็บหาเครื่องไม่เจอ และ image ไม่มี iptables → ต้องแจ้งอาจารย์
- ⚠️ รหัสผ่านเริ่มต้นของ PostgreSQL และ Grafana ยังไม่ได้เปลี่ยน
- ❓ ยังไม่รู้: Nginx เห็น IP จริงของผู้ใช้หรือเห็นเป็น IP ของ server แล็บ (กระทบ rate limit ต่อ IP)
- ไม่มี object storage → เก็บรูปในฐานข้อมูล

---

## 5. สถาปัตยกรรม (สรุป — รายละเอียดเต็มใน Architecture)

```
ผู้ใช้ ──HTTPS 45.77.40.35:10201──► [public 10.0.2.0/25]  web-01 · Nginx · 10.0.2.10:443
                                            │  (TLS, rate limit, reverse proxy, load balance)
                                            └── /api/* → :8000 ──► [private 10.0.2.128/25]
                                                                   api-01 · FastAPI · 10.0.2.140
                                                                   api-02 · FastAPI · 10.0.2.141
                                                                         │
                                                                         └── :5432 (TLS) ──► db-01 · PostgreSQL · 10.0.2.150
                                                                   mon-01 · Grafana · 10.0.2.165 ──(อ่านอย่างเดียว)──► db-01
ทีมดูแล ──SSH 45.77.40.35:22002──► bastion 10.0.2.131 ──SSH──► ทุกเครื่อง
```

| Instance | Subnet | Image | Static IP | Port mapping | ระดับ |
|---|---|---|---|---|---|
| web-01 | public | Nginx | 10.0.2.10 | ✅ 10201 → 443 (ตัวเดียวในระบบ) | Must |
| api-01 | private | Ubuntu 24.04 + Python/FastAPI | 10.0.2.140 | ❌ | Must |
| db-01 | private | PostgreSQL 16 | 10.0.2.150 | ❌ | Must |
| api-02 | private | Ubuntu 24.04 + Python/FastAPI | 10.0.2.141 | ❌ | Should |
| mon-01 | private | Grafana | 10.0.2.165 | ❌ | Should |
| bastion | private | (แล็บให้) | 10.0.2.131 | 22002 → 22 (แล็บเปิด) | – |

- **ไม่เปิด HTTP (80)** — ใช้ HTTPS อย่างเดียว ใบรับรองจาก mkcert (ไม่มีโดเมน)
- **กฎ firewall ขาเข้า/ขาออก:** Architecture ภาคผนวก B · **โซน IP:** ภาคผนวก A
- **วิธีสร้างใหม่ถ้าแล็บ reset:** Architecture หัวข้อ 13

---

## 6. สเปคที่ต้องทำตาม (กติกาของโค้ด)

### 6.1 Multi-tenant — กฎเหล็ก
- ทุกตารางที่เก็บข้อมูลลูกค้าต้องมี `dorm_id`
- ฝั่ง admin: `dorm_id` มาจาก **session ของผู้ login** และต้องตรวจกับ `admin_dorms` ทุกครั้ง
- **ห้าม**รับ `dorm_id` จาก request body หรือ query string มาใช้ตรง ๆ (path `/dorms/{id}` ใช้ได้เฉพาะหลังตรวจสิทธิ์กับ `admin_dorms`)
- ฝั่งผู้เช่า: `dorm_id` และ `room_id` มาจาก `resolve_room(code)` / `resolve_tracking(token)` เท่านั้น

### 6.2 Row-Level Security (ชั้นป้องกันสุดท้าย)
- ทุกตารางที่มี `dorm_id`: `ENABLE` + `FORCE ROW LEVEL SECURITY` + policy ตาม Architecture ภาคผนวก C
- ตารางเป็นของ `postgres` · API ใช้ `dormdesk_app` ที่ไม่ใช่เจ้าของและไม่มี `BYPASSRLS`
- ทุกคำขอเปิด transaction แล้ว `SET LOCAL app.dorm_id` — **ห้ามใช้ `SET` เฉย ๆ** (ค่าจะค้างใน connection pool)
- ฟังก์ชันที่ต้องใช้ก่อนรู้หอ (`resolve_room`, `resolve_tracking`) เป็น `SECURITY DEFINER` คืนแค่ id

### 6.3 Token และรหัส
- `room_code` และ `tracking_token` = ค่าสุ่ม 128 bit ขึ้นไป (`secrets.token_urlsafe(16)` หรือ UUIDv4) **ห้ามใช้เลขรัน**
- เปลี่ยน `room_code` ได้โดยไม่กระทบคำขอเก่า (เก็บ `room_id` ใน request ไม่ใช่ code)
- รหัสผ่าน admin เก็บแบบ bcrypt · session เป็น token ลงลายเซ็นใน cookie `HttpOnly; Secure; SameSite=Strict` อายุ 8 ชั่วโมง

### 6.4 Rate limit
- **หลัก:** สร้างคำขอได้ 5 เรื่อง / 10 นาที **ต่อห้อง** (นับจากฐานข้อมูล — ทำงานได้แม้มี API 2 เครื่อง)
- **ชั้นนอก (Nginx):** 30 เรื่อง / 10 นาที ต่อ IP (หลวมเพราะทั้งหอใช้ Wi-Fi เดียวกัน) · login 5 ครั้ง/นาที/IP · API ทั่วไป 10 req/s/IP
- ถ้าพบว่า Nginx ไม่เห็น IP จริง → ปิด limit ต่อ IP แล้วบันทึกเป็นข้อจำกัด

### 6.5 ไฟล์อัปโหลด
- รับเฉพาะ jpg / png / webp ตรวจจากเนื้อไฟล์ (ไม่ใช่นามสกุล) · ไม่เกิน 5 MB
- แปลงรูปใหม่ (Pillow) เพื่อลบ EXIF เช่นพิกัด GPS
- **เก็บในฐานข้อมูล** (`request_photos.data` แบบ `bytea`) เพื่อให้ API ไม่มีสถานะในเครื่อง → ทำ HA ได้ · เข้าถึงผ่าน API ที่ตรวจสิทธิ์เท่านั้น

### 6.6 Secret
- รหัส database และ `SESSION_SECRET` อยู่ใน `/srv/dormdesk/.env` (สิทธิ์ 600) เท่านั้น ห้าม commit ลง git
- รหัสทั้งหมดของทีมอยู่ใน `cloud_pass.txt` เท่านั้น

### 6.7 ข้อมูลส่วนบุคคล (PDPA)
- เก็บเท่าที่จำเป็น: ชื่อ เบอร์ (อีเมลไม่บังคับ) · มีข้อความแจ้งวัตถุประสงค์ + ช่องยินยอมในฟอร์ม
- ลบ/ปิดบังชื่อ เบอร์ อีเมล ของคำขอที่ `done` เกิน 180 วัน (เก็บตัวเลขสถิติไว้ได้)
- Grafana และ AI เห็นเฉพาะตัวเลขรวม ไม่เห็นข้อมูลระบุตัวบุคคล

### 6.8 Log และ error
- บันทึกเหตุผิดปกติลง `security_events`: login ผิด, โดน rate limit, พยายามเข้าหออื่น, รหัสห้อง/รหัสติดตามผิด
- ห้ามบันทึกรหัสห้อง/รหัสติดตามเต็มใน log
- Error format เดียวทั้งระบบ: `{ "error": { "code": "...", "message": "..." } }` · ไม่ส่ง stack trace ให้ผู้ใช้

---

## 7. Data Model

```
dorms(id, name, created_at)
admins(id, email, password_hash, created_at)
admin_dorms(admin_id, dorm_id)              -- 1 บัญชีดูแลได้หลายหอ
rooms(id, dorm_id, room_no, room_code, code_rotated_at)
categories(id, code, name_th)               -- master list
dorm_categories(dorm_id, category_id, enabled)
requests(id, dorm_id, room_id, category_id, title, detail,
         reporter_name, reporter_phone, reporter_email, consent_at,
         status, priority, tracking_token, created_at, updated_at, done_at)
request_photos(id, dorm_id, request_id, mime, size, data bytea)
request_events(id, dorm_id, request_id, from_status, to_status, note, actor, created_at)
security_events(id, occurred_at, type, ip, dorm_id, detail)
```

**Index ที่ควรมี:** `requests(dorm_id, status)`, `requests(tracking_token)` unique, `rooms(room_code)` unique, `security_events(occurred_at)`
**Seed:** หอตัวอย่าง 2 หอ + admin คนละบัญชี (ไว้โชว์ว่าข้อมูลไม่ข้ามกัน) + ข้อมูลย้อนหลังพอให้ dashboard มีกราฟ

---

## 8. API Spec

| Method | Path | ผู้ใช้ | หมายเหตุ |
|---|---|---|---|
| GET | `/api/health` | – | ตรวจว่า web → api ทะลุถึงกัน (ไม่เปิดเผยข้อมูลภายใน) |
| GET | `/api/rooms/{roomCode}` | ผู้เช่า | ชื่อหอ เลขห้อง และหมวดที่เปิดอยู่ |
| POST | `/api/rooms/{roomCode}/requests` | ผู้เช่า | สร้างคำขอ (multipart + รูป) คืน `tracking_token` |
| GET | `/api/track/{token}` | ผู้เช่า | สถานะ + ประวัติการเปลี่ยนสถานะ |
| GET | `/api/track/{token}/photos/{id}` | ผู้เช่า | รูปของคำขอตัวเอง |
| POST | `/api/auth/login` · `/api/auth/logout` | admin | session cookie |
| GET | `/api/admin/dorms` | admin | หอที่บัญชีนี้ดูแล |
| GET | `/api/admin/dorms/{id}/requests` | admin | filter: status, category, priority |
| GET | `/api/admin/requests/{id}` · `/photos/{pid}` | admin | รายละเอียด + รูป |
| PATCH | `/api/admin/requests/{id}` | admin | เปลี่ยน status / priority (+ ส่งอีเมลถ้ามี) |
| GET | `/api/admin/dorms/{id}/dashboard` | admin | ตัวเลขตามตารางในข้อ 3 |
| POST | `/api/admin/rooms` · PATCH `/api/admin/rooms/{id}` | admin | จัดการห้อง |
| POST | `/api/admin/rooms/{id}/rotate-code` | admin | ออกรหัสห้องใหม่ |
| PATCH | `/api/admin/dorms/{id}/categories` | admin | เปิด-ปิดหมวด |

---

## 9. AI Insight Assistant — ออกแบบไว้แล้ว (Could — ยังไม่ต้องทำ)

**ห้ามให้ LLM ต่อ database หรือเขียน SQL เอง** สถาปัตยกรรมที่ตกลงกันคือ

```
คำถามของเจ้าของ → API แปลงเป็น intent → query ที่เขียนไว้ล่วงหน้า (บังคับ dorm_id จาก session + RLS)
→ ได้ตัวเลขสรุป → ส่งตัวเลขให้ LLM เรียบเรียงเป็นภาษาคน → ตอบ
```

เหตุผล 5 ข้อ:
1. **ตัวเลขผิด** — LLM คำนวณเองแล้วตอบผิดอย่างมั่นใจ เจ้าของตัดสินใจผิดตาม
2. **ข้อมูลข้ามหอ** — LLM เขียน query เองอาจดึงหอที่ไม่มีสิทธิ์
3. **Prompt injection** — รายละเอียดที่ผู้เช่ากรอกถือเป็น "ข้อมูล" เท่านั้น ห้ามให้ LLM ทำตามคำสั่งในนั้น และห้ามให้ LLM เรียกเครื่องมือใด ๆ
4. **PDPA** — ห้ามส่งชื่อ เบอร์ เลขห้อง หรือรูปออกไปยัง LLM ภายนอก ส่งเฉพาะตัวเลขรวม
5. **ขาออก / ค่าใช้จ่าย** — ต้องเปิด firewall ขาออกเฉพาะ LLM API และจำกัดจำนวนคำถามต่อเดือน

ตัวอย่างคำถามที่ต้องรองรับ: เดือนนี้ปัญหาไหนเยอะสุด / เหลือเรื่องค้างกี่เรื่อง / ห้องไหนแจ้งซ้ำบ่อย
ถ้าไม่มีเวลาทำ ให้โชว์ในสไลด์เป็น "roadmap + การออกแบบความปลอดภัย" — ได้คะแนนด้านคิดรอบคอบโดยไม่เสี่ยง demo ล่ม

---

## 10. งานที่ต้องทำต่อ (Sprint 1)

### ลำดับ — ทำข้อ 1–4 ให้ผ่านก่อนเขียนฟีเจอร์
1. **[Infra]** Firewall: แจ้งอาจารย์พร้อมหลักฐาน · ระหว่างรอตั้ง `pg_hba` + `listen_addresses` ให้รับเฉพาะโซน app/mon-01 แบบ `hostssl`
2. **[Infra]** เปลี่ยนรหัสผ่านเริ่มต้นทั้งหมด · สร้าง git repo + โฟลเดอร์ `infra/` เก็บ config ทุกไฟล์
3. **[Infra]** ตั้ง HTTPS + reverse proxy บน web-01 · ทำ `/api/health` บน api-01 → เรียกจากภายนอกได้ (ทดสอบ N1)
4. **[Infra]** ตรวจว่า Nginx เห็น IP จริงของผู้ใช้หรือไม่ (Architecture 12.8)
5. **[Backend]** schema + บัญชีแยกสิทธิ์ + RLS ตามข้อ 6.2 + seed 2 หอ → ทดสอบ A3 ทันที
6. **[Backend]** endpoint ฝั่งผู้เช่า → ฝั่ง admin → rate limit → อัปโหลดรูป → dashboard
7. **[Frontend]** หน้าแจ้งปัญหา (มือถือก่อน) → หน้าติดตาม → admin login → รายการคำขอ → dashboard → ตั้งค่าหมวด/ห้อง
8. **[Should]** api-02 + load balance · Grafana บน mon-01 · อีเมลแจ้งเตือน
9. **[ทุกคน]** รันแผนทดสอบ Architecture หัวข้อ 14 ครบ เก็บหลักฐานใน `evidence/` และเขียน `verify.sh`

### Definition of Done ของ Sprint 1
- เข้าเว็บจากภายนอกได้ผ่าน web-01 ทาง HTTPS เท่านั้น
- แจ้งปัญหา → เห็นในหน้า admin → เปลี่ยนสถานะ → ผู้เช่าเห็นสถานะใหม่จาก tracking link
- ทดสอบ N1–N6 และ A1–A8 ผ่าน พร้อมหลักฐาน · N7–N8 ผ่าน หรือมีคำอธิบายจากสถานะ firewall ของแล็บ

### Sprint 2
สไลด์ pitch 5 นาที, สคริปต์ demo 5 นาที (Architecture 14.3) + อัดวิดีโอสำรอง, ซ้อมตอบ Q&A (Tracker ข้อ 12), ซ้อมจับเวลา, ติดตั้ง mkcert CA บนเครื่อง demo

---

## 11. เตรียมตอบ Technical Q&A

คำถามพร้อมคำตอบสั้นอยู่ใน `PROJECT_TRACKER.md` ข้อ 12

---

## 12. วิธีทำงานกับไฟล์ชุดนี้ (สำหรับ AI assistant)
- ยึด `DormDesk_System_Architecture.md` เป็นข้อเท็จจริงด้าน network/เครื่อง/firewall อย่าเปลี่ยนเลข IP หรือ subnet เอง
- ข้อ 6 คือกฎที่ห้ามละเมิดเวลาเขียนโค้ด โดยเฉพาะ `dorm_id`, RLS และ token สุ่ม
- ถ้าเสนอทางเลือกใหม่ ให้บอกเหตุผลและผลกระทบต่อ 4 ข้อกำหนดบังคับของวิชาเสมอ
- ถ้ามีการตัดสินใจใหม่ ให้เพิ่มลง decision log ใน `PROJECT_TRACKER.md` และแก้ให้ทั้ง 3 ไฟล์ตรงกัน
- สิ่งที่ยังไม่ยืนยัน (ข้อ 4 ที่มี ❌ ⚠️ ❓) ห้ามเขียนเป็นข้อเท็จจริงในรายงานหรือสไลด์
