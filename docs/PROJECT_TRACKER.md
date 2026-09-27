# ☁️ Cloud Network and Computing — Mini Project Tracker

> ไฟล์กลางสำหรับติดตามทุกอย่างที่ทำในโปรเจคนี้ อัพเดทได้เรื่อย ๆ ทุก Sprint
> สถาปัตยกรรม (เครื่อง, IP, firewall, แผนทดสอบ) ยึด `DormDesk_System_Architecture.md`
> บริบท สเปค และกฎการเขียนโค้ดอยู่ใน `DormDesk_HANDOFF.md`

| หัวข้อ | รายละเอียด |
|---|---|
| วิชา | 010123218 Cloud Network and Computing |
| ชื่อระบบ | **DormDesk** |
| ทีม | group02 (3 คน) |
| Cloud | Cloud Lab v1.0 ของอาจารย์ (45.77.40.35) |
| สถานะปัจจุบัน | 🟢 Sprint 1 เกือบครบ — **ระบบต้นแบบออนไลน์** https://45.77.40.35:10201 · 5 เครื่องทำงานครบ (HA 2 API, Grafana, firewall ทุกเครื่อง) · smoke 16/16 · verify 20/20 · เหลือ: อีเมลแจ้งเตือน, push GitHub, ซ้อม demo |

---

## 1. โจทย์และเกณฑ์การประเมิน

**บทบาท:** กลุ่มสวมบทเป็นสตาร์ทอัพ สร้าง MVP ที่ใช้งานได้จริง แล้ว pitch ให้อาจารย์ (Technical Review Board)

**อาจารย์ประเมิน 2 เรื่องหลัก**
1. สถาปัตยกรรมออกแบบดีไหม — network, security, การแบ่ง Tier
2. แก้ปัญหาจริงของธุรกิจหรือไม่

### ข้อกำหนด Architecture (บังคับ)
| # | ข้อกำหนด | DormDesk | สถานะ | หลักฐาน |
|---|---|---|---|---|
| 1 | Two-Tier Network | `group02-public` 10.0.2.0/25 · `group02-private` 10.0.2.128/25 | ✅ สร้างแล้ว | ภาพหน้า Networks ใน Console |
| 2 | Frontend ใน public subnet | web-01 (Nginx) 10.0.2.10 | 🟡 เครื่องพร้อม ยังไม่ตั้ง HTTPS | ทดสอบ N1 |
| 3 | REST API ใน private subnet | api-01 10.0.2.140, api-02 10.0.2.141 (FastAPI) | ⬜ ยังไม่มีโค้ด | ทดสอบ N1, N4 |
| 4 | เปิดพอร์ตเท่าที่จำเป็น | เปิดพอร์ตเดียว 10201 → web-01:443 · firewall default deny ทั้งขาเข้า/ขาออก | 🟡 port mapping ✅ · firewall ❌ | ทดสอบ N2–N8 |

### สิ่งที่ทำให้ได้คะแนนเกินเกณฑ์ (ต้องมีหลักฐานจริง ไม่ใช่แค่ในเอกสาร)
| จุดเด่น | ระดับ | หลักฐานใน demo |
|---|---|---|
| ป้องกันหลายชั้น + แยกโซนใน private subnet | Must | ตาราง firewall + ทดสอบ N5 |
| แยกข้อมูลแต่ละหอ 3 ชั้น (รหัสสุ่ม + API + RLS) | Must | ทดสอบ A1–A3 สด |
| HTTPS + บังคับ TLS ระหว่าง API กับ DB | Must | แม่กุญแจในเบราว์เซอร์ + N6 |
| HA ชั้น API (2 เครื่อง + Nginx load balance) | Should | ปิด api-01 สด (A9) |
| Monitoring ความปลอดภัยด้วย Grafana | Should | เหตุการณ์ A1/A5 ขึ้นกราฟทันที |
| Backup + ทดสอบกู้คืน | Should | A10 |
| สร้างใหม่ได้จาก git (Infrastructure as documentation + `verify.sh`) | Should | โชว์ repo + ผล `verify.sh` |
| เปรียบเทียบ Cloud Lab ↔ AWS จริง | – | สไลด์ 1 หน้า (Architecture หัวข้อ 11) |

---

## 2. ทีมและหน้าที่ (ภายในทีม)

| สมาชิก | บทบาทหลัก | ความรับผิดชอบ |
|---|---|---|
| คนที่ 1 | Infra / Network | instance, firewall, HTTPS, Nginx, pg_hba, backup, `verify.sh`, Grafana |
| คนที่ 2 | Backend | FastAPI, schema, RLS, rate limit, รูป, dashboard query |
| คนที่ 3 | Frontend / Pitch | Web app, สไลด์, business case, สัมภาษณ์เจ้าของหอ, วิดีโอสำรอง |

---

## 3. Business Case

### ปัญหา
หอพัก/คอนโดระดับกลางรับแจ้งปัญหาผ่าน LINE หรือ DM เมื่อผู้เช่าหลายห้องแจ้งพร้อมกัน ข้อความจมหาย
ติดตามสถานะไม่ได้ ผู้เช่าต้องทักซ้ำ และเจ้าของไม่มีภาพรวมว่าปัญหาไหนเกิดบ่อยหรือแก้ช้า

### ลูกค้า
- **คนจ่ายเงิน:** เจ้าของหอ / ผู้จัดการอาคารระดับกลาง (ดูแลได้หลายอาคาร)
- **ผู้ใช้อีกฝั่ง:** ผู้เช่า — ใช้ฟรี ไม่ต้องสมัคร
- **รายได้:** SaaS รายเดือนต่อหอ (ราคายังเป็นสมมติฐาน), AI Insight เป็นแพ็กเกจเสริม

### โซลูชัน
เว็บแอปรับแจ้งซ่อมแบบ multi-tenant
- ผู้เช่า: ลิงก์ประจำห้อง → เลือกหมวด กรอกชื่อ เบอร์ รายละเอียด รูป (+ อีเมลถ้าอยากได้แจ้งเตือน) → ได้ลิงก์ติดตามสถานะ
- เจ้าของ: login → เลือกหอ → จัดการคำขอตามหมวด/ความเร่งด่วน → เปลี่ยนสถานะ → dashboard
- ไอเดียขาย: **AI Insight Assistant** ถามตอบสรุปข้อมูลเป็นภาษาคน

### ทำไมดีกว่า LINE OA + Google Form (ต้องอยู่ในสไลด์)
| | LINE / Google Form | DormDesk |
|---|---|---|
| รู้ว่าแจ้งจากห้องไหนจริง | ❌ ใครก็กรอกได้ | ✅ ลิงก์ประจำห้อง |
| ผู้เช่ารู้สถานะ | ❌ ต้องทักถาม | ✅ ลิงก์ติดตาม + อีเมลแจ้งเตือน |
| เวลาเฉลี่ยที่ใช้ซ่อม / เรื่องค้าง / ห้องเสียซ้ำ | ❌ | ✅ dashboard |
| ดูแลหลายหอในบัญชีเดียว | ❌ | ✅ |

**หมวดปัญหา** (เปิด-ปิดต่อหอ): ไฟฟ้า · น้ำ · แอร์ · ลิฟต์ · ของชำรุดในห้อง · Laundry · พัสดุ · Parking · อื่น ๆ
**สถานะ:** รับเรื่องแล้ว → กำลังดำเนินการ → เสร็จสิ้น (+ ปฏิเสธ/ซ้ำ)

### การยืนยันกับลูกค้าจริง
- [ ] สัมภาษณ์เจ้าของ/ผู้จัดการหอ 2–3 ราย (วิธีรับแจ้งซ่อมตอนนี้, เวลาที่เสีย, ยอมจ่ายไหม/เท่าไร)
- [ ] ใส่คำพูดจริง 1 ประโยค + ตัวเลขจากการสัมภาษณ์ในสไลด์ปัญหา

---

## 4. ขอบเขต MVP (ใช้ภายในทีม — ไม่ใส่ใน One-Pager)

| ระดับ | ฟีเจอร์ |
|---|---|
| Must | Admin login (1 บัญชีหลายหอ), จัดการหอ/ห้อง + ลิงก์ประจำห้อง, แจ้งปัญหาพร้อมรูป + ยินยอม PDPA, ลิงก์ติดตาม, เปลี่ยนสถานะ, แยกข้อมูลหอ (API + RLS), rate limit ต่อห้อง |
| Should | Dashboard (เวลาเฉลี่ยซ่อม, เรื่องค้าง >48 ชม., หมวดยอดนิยม, ห้องแจ้งซ้ำ), ตั้งค่าเปิด-ปิดหมวด, ความเร่งด่วน, อีเมลแจ้งเตือน, api-02 (HA), Grafana |
| Could | AI Insight Assistant, แจ้งเตือนผ่าน LINE Messaging API |

---

## 5. Cloud Lab Environment

ข้อมูลเต็มอยู่ใน `DormDesk_HANDOFF.md` ข้อ 4 และ Architecture หัวข้อ 12.1

| รายการ | ค่า |
|---|---|
| Public subnet | `group02-public` 10.0.2.0/25 — gateway 10.0.2.1 |
| Private subnet | `group02-private` 10.0.2.128/25 — gateway 10.0.2.129 |
| Bastion | 10.0.2.131 — SSH จากภายนอก `45.77.40.35:22002` |
| เปิดสู่ภายนอก | port mapping 10200–10299 · ใช้ 10201 → web-01:443 |
| ขาออก internet | ทั้งสอง subnet ออกได้ → ต้องจำกัดเองด้วย firewall ขาออก |
| Object storage | ไม่มี → เก็บรูปในฐานข้อมูล |

---

## 6. Architecture

> แผนภาพ, ตาราง IP, โซน, กฎ firewall ขาเข้า/ขาออก, config ตัวอย่าง: ดู `DormDesk_System_Architecture.md` (หัวข้อ 2, 13, ภาคผนวก A–C)

| Instance | Subnet | Image | IP | CPU / RAM | Port mapping | ระดับ |
|---|---|---|---|---|---|---|
| web-01 | public | Nginx 1.31 | 10.0.2.10 | 0.25 / 128 MB | 10201 → 443 | Must |
| api-01 | private | Ubuntu 24.04 + FastAPI | 10.0.2.140 | 0.5 / 512 MB | – | Must |
| db-01 | private | PostgreSQL 16 | 10.0.2.150 | 0.5 / 512 MB | – | Must |
| api-02 | private | Ubuntu 24.04 + FastAPI | 10.0.2.141 | 0.5 / 256 MB | – | Should |
| mon-01 | private | Grafana | 10.0.2.165 | 0.25 / 256 MB | – | Should |
| bastion | private | (แล็บให้) | 10.0.2.131 | – | 22002 → 22 (แล็บ) | – |

### API Endpoints
รายการเต็มอยู่ใน `DormDesk_HANDOFF.md` ข้อ 8 · endpoint ที่ใช้พิสูจน์ข้อกำหนดข้อ 3 คือ `GET /api/health`

---

## 7. Tech Stack

| ส่วน | ใช้ | เหตุผลสั้น |
|---|---|---|
| Frontend | HTML + JavaScript ล้วน (ไม่มี build step) | เสิร์ฟจาก Nginx บน web-01 (128 MB) · CSP ห้าม inline script |
| Reverse proxy / LB / TLS | Nginx | ทางเข้าเดียว, HTTPS, rate limit, กระจายไป api-01/02 |
| Backend | Python + FastAPI | ตรวจข้อมูลขาเข้าอัตโนมัติ (Pydantic) |
| Database | PostgreSQL 16 | ข้อมูลมีความสัมพันธ์ + Row-Level Security |
| เก็บรูป | ฐานข้อมูล (`bytea`) | ไม่มี object storage + ให้ API ไม่มีสถานะ → ทำ HA ได้ |
| HTTPS | mkcert | ไม่มีโดเมน · ติดตั้ง CA บนเครื่อง demo |
| Monitoring | Grafana (mon-01) | อ่าน `security_events` ด้วยบัญชี read-only |
| Backup | pg_dump / pg_restore | เก็บนอกแล็บ |
| AI Insight (Could) | API สรุปตัวเลข → LLM เรียบเรียง | ดูข้อ 7.1 |

## 7.1 AI Insight Assistant — ออกแบบไว้แล้ว

**หลัก:** คำถาม → API แปลงเป็น intent → query ที่กำหนดไว้ล่วงหน้า (บังคับ `dorm_id` จาก session + RLS) → ตัวเลขสรุป → LLM เรียบเรียง → ตอบ
LLM ไม่มี credential ของ database และไม่ต่อ DB โดยตรง

| ปัญหา | แนวทางแก้ |
|---|---|
| ตัวเลขผิด (hallucination) | Backend คำนวณเอง LLM แค่เรียบเรียง |
| ข้อมูลข้ามหอ | query ล่วงหน้า + `dorm_id` จาก session + RLS |
| Prompt injection | ข้อความผู้เช่าเป็นข้อมูลเท่านั้น, LLM เรียกเครื่องมือไม่ได้ |
| PDPA | ส่งเฉพาะตัวเลขรวม |
| ขาออก / ค่าใช้จ่าย | เปิด firewall ขาออกเฉพาะ LLM API, จำกัดคำถามต่อเดือน |

---

## 8. ความเสี่ยง

| ความเสี่ยง | แนวทางรับมือ |
|---|---|
| API ถูกสแปมเรื่องปลอม | Rate limit ต่อห้อง (หลัก) + ต่อ IP (ชั้นนอก), สถานะ ปฏิเสธ/ซ้ำ |
| ข้อมูลรั่วข้ามหอ | `dorm_id` จาก session + ตรวจ `admin_dorms` + RLS แบบ FORCE + ทดสอบ A1–A3 |
| ลิงก์ห้อง/ลิงก์ติดตามหลุดหรือถูกเดา | ค่าสุ่ม 128 bit, เปลี่ยนรหัสห้องได้ทันที, `Referrer-Policy: no-referrer`, ไม่บันทึกใน log |
| ข้อมูลส่วนบุคคล (PDPA) | เก็บเท่าที่จำเป็น, ขอความยินยอม, ลบหลัง 180 วัน, Grafana/AI เห็นแค่ตัวเลขรวม |
| เครื่องใดเครื่องหนึ่งถูกยึด | แยกโซน + firewall ขาเข้า/ขาออก + pg_hba + บัญชี DB สิทธิ์ต่ำ |
| web-01 / db-01 ล่ม (single point of failure) | ยอมรับใน MVP · backup + ขั้นตอนสร้างใหม่ (Architecture 13) |
| AI ตอบตัวเลขผิดหรือดึงข้อมูลข้ามหอ | Backend คำนวณเอง, query ล่วงหน้า, RLS |

**ความเสี่ยงของทีม (ไม่ใส่ใน One-Pager)**

| ความเสี่ยง | แนวทางรับมือ | สถานะ |
|---|---|---|
| Firewall ของแล็บบังคับใช้ไม่ได้ (กระทบข้อกำหนดข้อ 4) | แจ้งอาจารย์พร้อมหลักฐาน · pg_hba เป็นชั้นสำรอง · บอกตรงๆ ใน pitch ถ้ายังไม่ได้ | 🔴 เกิดแล้ว |
| งานเยอะเกิน 3 สัปดาห์ / ยังไม่มีโค้ด | ล็อก Must ก่อน · api-02, mon-01, อีเมล ทำหลัง Must ผ่าน | 🟠 |
| Rate limit ต่อ IP ใช้ไม่ได้ถ้า NAT ซ่อน IP จริง | ทดสอบจาก 2 เครือข่าย · พึ่ง limit ต่อห้องเป็นหลัก | 🟡 ต้องตรวจ |
| คำเตือนใบรับรองตอน demo | ติดตั้ง mkcert CA บนเครื่อง demo · อธิบายล่วงหน้า | 🟡 |
| Demo ล่มวันจริง / แล็บ reset | อัดวิดีโอสำรอง · โค้ด+config ใน git · backup นอกแล็บ | 🟡 |
| RAM ไม่พอ (web-01 128 MB, api-02 256 MB) | เฝ้าดูด้วย `free -m` · ใช้ uvicorn worker เดียว · เพิ่ม RAM ถ้าจำเป็น | 🟡 |

---

## 9. Sprint Plan

### ✅ Sprint 0 — One-Pager
- [x] สรุปไอเดีย / ขอบเขต / ความเสี่ยง
- [x] ดูสภาพแวดล้อม Cloud Lab
- [x] เลือกชื่อระบบ — DormDesk
- [x] Architecture sketch
- [x] จัดหน้า One-Pager และส่ง

### 🟡 Sprint 1 — Infra + Security + Feature
**Infra (ทำก่อน)**
- [x] สร้าง web-01 / api-01 / api-02 / db-01 / mon-01 ตาม IP Plan
- [x] Port mapping 10201 → web-01:443 เท่านั้น
- [ ] แจ้งอาจารย์เรื่องบั๊ก Console firewall + ทราฟฟิกข้าม subnet ถูกทิ้ง (มีหลักฐานแล้ว — ไม่บล็อกงาน)
- [x] เปลี่ยนรหัสผ่านเริ่มต้น PostgreSQL
- [x] เปลี่ยนรหัสผ่านเริ่มต้น Grafana
- [x] `infra/` (config Nginx, pg_hba, SQL, start.sh, firewall, deploy)
- [ ] push ขึ้น GitHub (AnMayVaa)
- [x] pg_hba + listen_addresses รับเฉพาะโซน app / mon-01 แบบ `hostssl`
- [x] HTTPS บน web-01 + reverse proxy → `/api/health` ทะลุจากภายนอก (N1)
- [x] ตรวจว่า Nginx เห็น IP จริงของผู้ใช้
- [x] ตั้ง firewall ตามภาคผนวก B ด้วย iptables เอง (`infra/firewall/`) → ตรวจแล้ว (N8)

**Backend / Frontend (Must)**
- [x] Schema + บัญชี `dormdesk_app` / `dormdesk_ro` + RLS แบบ FORCE + seed 2 หอ → ทดสอบ A3
- [x] Endpoint ผู้เช่า: ห้อง, แจ้งปัญหา + รูป, ติดตาม
- [x] Endpoint admin: login, รายการคำขอ, เปลี่ยนสถานะ, จัดการห้อง, rotate-code
- [x] Rate limit ต่อห้อง + login + บันทึก `security_events`
- [x] Frontend: หน้าแจ้งปัญหา (มือถือ), ติดตาม, admin, รายการคำขอ

**Should (หลัง Must ผ่าน)**
- [x] Dashboard 5 ตัวเลข + ตั้งค่าหมวด
- [x] api-02 + Nginx load balance → ทดสอบ A9 ผ่าน (รวม POST ด้วย Idempotency-Key)
- [x] Grafana บน mon-01 + dashboard `security_events`
- [ ] อีเมลแจ้งเตือนเมื่อสถานะเปลี่ยน
- [x] Backup + ทดสอบกู้คืน (A10) — `tools/backup.sh`

**ทดสอบ (Architecture หัวข้อ 14)**
- [x] N1–N8 · A1–A10 ผ่าน เก็บหลักฐานใน `evidence/` (A5/A6/A7 ทดสอบในเครื่อง dev)
- [x] เขียน `tools/verify.sh` รวมการทดสอบ network + DB (20 ข้อ)

### ⬜ Sprint 2 — Demo Day
- [ ] สัมภาษณ์เจ้าของหอ 2–3 ราย → ใส่ในสไลด์
- [ ] สไลด์ pitch 5 นาที (โครงด้านล่าง)
- [ ] สคริปต์ live demo 5 นาที (Architecture 14.3) + อัดวิดีโอสำรอง
- [ ] ติดตั้ง mkcert CA บนเครื่อง demo · ทดสอบเน็ตห้องนำเสนอ
- [ ] ซ้อมตอบ Q&A ข้อ 12 · ซ้อมจับเวลา 2 รอบ
- [ ] (ถ้ามีเวลา) AI Insight

**โครงสไลด์ pitch 5 นาที**
1. ปัญหา + คำพูดจริงจากเจ้าของหอ (45 วิ)
2. ลูกค้า + ทำไม LINE/Google Form ไม่พอ (45 วิ)
3. โซลูชัน + ภาพหน้าจอ (45 วิ)
4. สถาปัตยกรรม: แผนภาพ 2 subnet + ทางเข้าเดียว + ตาราง firewall (1 นาที)
5. ความปลอดภัยหลายชั้น + แยกข้อมูลหอ 3 ชั้น (45 วิ)
6. ข้อจำกัดของ Cloud Lab → ถ้าย้ายไป AWS จะเป็นอย่างไร (30 วิ)
7. โมเดลธุรกิจ + roadmap (AI Insight) (30 วิ)

### ⬜ สิ้นเทอม
- [ ] รายงานฉบับเต็ม (ใช้ Architecture + HANDOFF + ผลทดสอบใน `evidence/` เป็นฐาน)

---

## 10. Decision Log
| การตัดสินใจ | เหตุผล |
|---|---|
| ไอเดีย: ระบบแจ้งซ่อมหอพัก เจ้าของ + ผู้เช่า | ปัญหาจริงจากการแจ้งผ่าน LINE ที่ข้อมูลกระจัดกระจาย |
| MVP รองรับหลายหอ | แสดงศักยภาพธุรกิจ + โชว์การแยกข้อมูล |
| ลิงก์/รหัสประจำห้อง แทน QR ติดหอหรือเบอร์อย่างเดียว | รู้เลขห้อง, ไม่มีต้นทุนพิมพ์, หลุดแล้วเปลี่ยนได้ |
| ใช้ Cloud Lab ของอาจารย์ | ฟรี, ตรงกับที่ตรวจ, ตั้ง subnet/firewall เองได้ |
| แยก web / api / db เป็นคนละเครื่อง | แยก tier + ป้องกันเป็นชั้น |
| Nginx reverse proxy ใน web-01 | browser เรียก private subnet ตรง ๆ ไม่ได้, API ไม่ต้องเปิดสู่ภายนอก, ไม่ต้องใช้ CORS |
| Port mapping เฉพาะ web-01 | จุดเข้าเดียว |
| Static IP ทุก instance + แบ่งโซนย่อยใน private subnet | firewall อ้างอิงเป็น IP/CIDR · เพิ่มเครื่องในโซนเดิมไม่ต้องแก้กฎ |
| SSH ผ่าน bastion ที่ lab ให้ | ไม่ต้องเปิด SSH สู่ภายนอกที่ instance ใด |
| **HTTPS 443 แทน HTTP 80** (mkcert) | ข้อมูลผู้เช่าและ session ต้องเข้ารหัส · ไม่มีโดเมนจึงใช้ mkcert |
| **เพิ่ม api-02 + Nginx load balance** | โชว์ HA ชั้น API · API ไม่มีสถานะจึงทำได้ง่าย · ระดับ Should |
| **เพิ่ม mon-01 (Grafana)** | ทีมเห็นการโจมตี/ใช้งานผิดปกติ · ระดับ Should |
| **เก็บรูปในฐานข้อมูล** แทนดิสก์ของ api-01 | ไม่มี object storage + ให้ api-01/02 ไม่มีสถานะ |
| **Row-Level Security แบบ FORCE + SET LOCAL** | ชั้นป้องกันสุดท้ายถ้าโค้ดลืมกรอง · กันค่าค้างข้าม connection |
| **Firewall ขาออกด้วย (default deny)** | ถ้าเครื่องถูกยึด ส่งข้อมูลออกไม่ได้ |
| **Rate limit ต่อห้องเป็นหลัก ต่อ IP เป็นชั้นนอกแบบหลวม** | ผู้เช่าทั้งหอใช้ IP เดียวกัน + NAT ของแล็บอาจซ่อน IP จริง |
| **ยอมรับ web-01 / db-01 เป็น single point of failure** | replication DB เกินกรอบ 3 สัปดาห์ · ชดเชยด้วย backup + สร้างใหม่ได้ |
| **POST/PATCH retry ข้ามเครื่องได้ด้วย Idempotency-Key** | tunnel ทำให้ Nginx แยก "API ล่ม" กับ "ส่งแล้วขาด" ไม่ได้ · คีย์กันคำขอซ้ำ |
| **ตั้ง iptables ในแต่ละเครื่องเอง** | Console firewall มีบั๊ก · เครื่องมี NET_ADMIN · กฎชุดเดียวกับภาคผนวก B · มี rollback 60 วิ กันล็อกตัวเอง |
| **อีเมลแจ้งเตือนเป็น Should** | ผู้เช่าไม่ต้องคอยเปิดลิงก์ติดตาม — แก้ปัญหา "ต้องทักซ้ำ" จริง · LINE Notify ปิดแล้ว |
| **SSH tunnel ผ่าน bastion ให้ web-01 คุยกับ API** | แล็บทิ้งทราฟฟิกข้าม subnet · API ยังอยู่ private + เปิดพอร์ตเดียว · กุญแจจำกัดด้วย from/permitopen |
| **Frontend เป็น HTML/JS ล้วน แทน React** | web-01 มี 128 MB · ไม่ต้อง build · ใช้ CSP เข้มงวดได้ |
| **บอกข้อจำกัดของแล็บตรงๆ ใน pitch** | อ้างสิ่งที่ยังไม่ทำงานเสี่ยงเสียความน่าเชื่อถือใน Q&A |
| **System_Architecture.md เป็นแหล่งข้อมูลหลัก** | 3 เอกสารเคยขัดกัน (3 vs 5 เครื่อง, 80 vs 443, รูปบนดิสก์ vs DB) |
| MVP scope และ tech stack ไม่ใส่ใน One-Pager | ไม่ใช่สิ่งที่โจทย์ขอ และอาจเปลี่ยน |
| Chatbot ใส่ใน One-Pager เป็นไอเดียขาย | เพิ่มคุณค่าธุรกิจ ไม่ผูกมัดว่าต้องทำใน MVP |
| ชื่อระบบ: DormDesk | สื่อชัดว่าเป็นระบบรับเรื่องของหอพัก จำง่าย |
| AI ไม่ต่อ database เอง | กัน hallucination, ข้อมูลข้ามหอ และ prompt injection |

---

## 11. Work Log
| วันที่ | ทำอะไร |
|---|---|
| | สร้างไฟล์ tracker |
| | สรุปไอเดีย, วิธียืนยันผู้เช่า, ขอบเขต, ความเสี่ยง |
| | ดู Cloud Lab, วาง IP plan + firewall, ร่าง One-Pager |
| 27 ก.ย. 2026 | สร้าง 5 เครื่องบน Cloud Lab, ตั้ง port mapping 10201, ตรวจพบ firewall ของแล็บยังไม่ทำงาน |
| 27 ก.ย. 2026 | Review แบบอาจารย์ → ปรับ 3 เอกสารให้ตรงกัน, เพิ่มแผนทดสอบ, RLS hardening, rate limit ต่อห้อง, PDPA, dashboard metrics |
| 27 ก.ย. 2026 | ต่อยอด: api-02 + HA (Idempotency-Key), Grafana dashboard, iptables ทุกเครื่อง, backup/restore, `tools/verify.sh` 20/20, แก้ http→https redirect + favicon |
| 27 ก.ย. 2026 | เขียนโค้ดต้นแบบ (FastAPI + PostgreSQL RLS + หน้าเว็บผู้เช่า/เจ้าของ) · deploy db-01, api-01, web-01 · seed 2 หอ 63 คำขอ · พบว่าแล็บทิ้งทราฟฟิกข้าม subnet → ใช้ SSH tunnel ผ่าน bastion · smoke test 15/15 ผ่าน |

---

## 12. เตรียมตอบ Technical Q&A

| คำถาม | คำตอบสั้น |
|---|---|
| ทำไมแยกหลายเครื่อง? ถ้า web-01 โดนเจาะ DB ปลอดภัยแค่ไหน? | web-01 คุยได้แค่ API พอร์ต 8000 · ต่อ DB ตรงไม่ได้ (firewall + pg_hba) · API ต้องตรวจสิทธิ์ · DB ยังมี RLS · ขาออกถูกปิด |
| ผู้ใช้เข้าถึง API ใน private subnet ได้อย่างไร? | ผ่าน Nginx reverse proxy บน web-01 เท่านั้น (`/api/*` → โซน app) |
| เปิดพอร์ตอะไรสู่ภายนอกบ้าง? | พอร์ตเดียวของระบบเรา: 10201 → 443 · 22002 เป็น bastion ของแล็บสำหรับทีมดูแล ไม่ใช่ผู้ใช้ |
| Bastion อยู่ใน private subnet แต่เข้าจากนอกได้ ขัดกันไหม? | เป็นข้อยกเว้นเดียวที่แล็บเปิด ใช้ได้แค่ SSH + รหัสของกลุ่ม · บน AWS จะใช้ SSM Session Manager แทน ไม่ต้องเปิดพอร์ต |
| Firewall ทำงานจริงไหม? | ตอบตามสถานะจริง + แสดง N5 และ pg_hba เป็นชั้นสำรอง |
| ทำไมใช้ static IP? | firewall ของแล็บอ้างอิงด้วย IP/CIDR · แบ่งโซนให้กฎอ้างเป็นกลุ่มได้ |
| แยกข้อมูลแต่ละหออย่างไร ทดสอบอย่างไร? | 3 ชั้น: รหัสสุ่ม · `dorm_id` จาก session + `admin_dorms` · RLS แบบ FORCE — โชว์ A1–A3 สด |
| ถ้าโค้ดลืมกรอง `dorm_id`? | RLS คืน 0 แถว เพราะไม่ได้ตั้ง `app.dorm_id` (A3) |
| ผู้เช่าไม่ login แล้วกันสแปมอย่างไร? | ต้องมีรหัสห้องสุ่ม · 5 เรื่อง/10 นาที/ห้อง · limit ต่อ IP ชั้นนอก · เจ้าของปฏิเสธ/เปลี่ยนรหัสห้องได้ |
| ทำไม API 2 เครื่อง แต่ DB เครื่องเดียว? | API ไม่มีสถานะ เพิ่มง่าย · DB replication เกินกรอบ → backup + ทดสอบกู้คืน · บน cloud จริงใช้ managed DB แบบ Multi-AZ |
| ถ้า api-01 ล่มกลาง POST? | Nginx ส่งซ้ำไป api-02 อัตโนมัติ · ไม่เกิดคำขอซ้ำเพราะมี Idempotency-Key (กดส่งซ้ำ 2 ครั้งก็ได้เรื่องเดียว) · ทดสอบแล้ว `evidence/A9_failover.txt` |
| ถ้าผู้ใช้เพิ่ม 10 เท่า scale อย่างไร? | เพิ่ม api-03… ในโซน app โดยไม่แก้กฎ DB · ย้ายรูปไป object storage · DB เพิ่ม RAM / read replica สำหรับ dashboard |
| ทำไม HTTPS ขึ้นคำเตือน? | ไม่มีโดเมนจึงขอใบรับรองสาธารณะไม่ได้ · ยังเข้ารหัสเหมือนกัน · บน cloud จริงใช้ใบรับรองที่ load balancer |
| เก็บ secret และรูปภาพอย่างไร? | `.env` สิทธิ์ 600 บน api ไม่เข้า git · รูปใน DB อ่านผ่าน API ที่ตรวจสิทธิ์ · ลบ EXIF |
| PDPA? | เก็บเท่าที่จำเป็น, ขอความยินยอม, ลบหลัง 180 วัน, Grafana/AI เห็นแค่ตัวเลขรวม |
| AI Insight ป้องกันการเข้าถึงข้อมูลหออื่นอย่างไร? | LLM ไม่ต่อ DB · query ล่วงหน้า + `dorm_id` จาก session + RLS · ส่งแค่ตัวเลขรวม |
| ต่างจาก LINE OA + Google Form อย่างไร? | รู้ห้องจริง, ผู้เช่าเห็นสถานะ, dashboard เวลาซ่อม/เรื่องค้าง/ห้องเสียซ้ำ, หลายหอในบัญชีเดียว |
