# ทำงานร่วมกันใน DormDesk (group02)

## เริ่มต้น
1. Clone: `git clone https://github.com/AnMayVaa/DormDesk.git` (หรือ GitHub Desktop → Clone repository)
2. ขอไฟล์ลับจากคนดูแล infra ทางช่องทางส่วนตัว (**ห้ามใส่ใน git / ห้ามส่งในกลุ่มสาธารณะ**):
   `cloud_pass.txt` · `secrets.env` (ดูแบบฟอร์มใน `secrets.env.example`) · `demo_accounts.txt` · `infra/tls/*` (ใบรับรอง)
3. อ่าน `docs/DormDesk_HANDOFF.md` ก่อนเขียนโค้ด — กฎเรื่อง `dorm_id`, `tenancy_id`, RLS, token สุ่ม, เงินเป็นสตางค์ อยู่ในข้อ 6 · เหตุผลของการออกแบบอยู่ใน `docs/DECISIONS.md`

## ใครดูแลส่วนไหน
| ส่วน | โฟลเดอร์ |
|---|---|
| Infra / Network / Security | `infra/` (เริ่มที่ `topology.env`), `db/03_security.sql`, `tools/verify.sh`, `tools/backup.sh` |
| Backend (FastAPI + PostgreSQL) | `api/`, `db/` |
| Frontend / Pitch | `web/`, `docs/` |

## ขั้นตอนทำงาน (branch + Pull Request)
```bash
git switch main && git pull
git switch -c feat/<สิ่งที่ทำ>          # เช่น feat/email-notify, fix/login-error
# ...แก้โค้ด...
git add -A && git commit -m "feat: <อธิบายสั้น ๆ>"
git push -u origin HEAD                  # แล้วเปิด Pull Request บน GitHub ให้เพื่อนรีวิว
```
- รูปแบบ commit: `feat:` ฟีเจอร์ใหม่ · `fix:` แก้บั๊ก · `docs:` เอกสาร · `chore:` อื่น ๆ
- ห้าม push ตรงเข้า `main` ถ้าไม่ได้คุยกันก่อน · ห้าม `--force` บน `main`
- ก่อน commit ตรวจ `git status` ว่าไม่มีไฟล์ลับหลุดมา

## ทดสอบก่อนเปิด PR
CI บน GitHub รันให้อัตโนมัติทุก push (lint + nginx -t + PostgreSQL + SeaweedFS + API + smoke 16 + flow 77) — PR ต้องเขียว
```bash
python3 tools/flow_test.py http://127.0.0.1:8000   # ในเครื่อง (API + DB + SeaweedFS ของตัวเอง) 77 ข้อ
python3 tools/smoke_test.py                        # ทดสอบแล็บจากภายนอก 16 ข้อ (ต้องมี demo_accounts.txt)
tools/verify.sh                                    # network + DB + replication + object store 48 ข้อ (ต้อง SSH ผ่าน bastion ได้)
```
แก้ dashboard/alert ของ Grafana ที่ `infra/grafana/build.py` แล้วรัน `python3 infra/grafana/build.py` (CI ตรวจว่า JSON ตรงกับโค้ด)

## Deploy ขึ้น Cloud Lab
ดู `README.md` หัวข้อ Deploy — ตกลงกันในกลุ่มก่อนว่าใคร deploy เพื่อไม่ให้ทับกัน
หลังแล็บ restart เครื่อง ไม่ต้องทำอะไร (boot hook) · ถ้าจะเพิ่มเครื่อง แก้ `infra/topology.env` ที่เดียว (หรือใช้ `infra/scale_api.sh`)

## หน้าเว็บ (web/)
- ดีไซน์ตาม "Soft UI Evolution": ฟอนต์ Prompt (โฮสต์เอง), สีฟ้า/ชมพู/เขียวพาสเทล, มุมโค้ง 10px, รองรับธีมมืด
- ห้ามใช้ emoji ใน UI — ใช้ไอคอนจาก `web/assets/icons.js` (`DD.icon("ชื่อ")` หรือ `<i data-icon="ชื่อ"></i>`)
- CSP ห้าม inline script/style: ใส่ JS ในไฟล์ `.js` และ style ผ่าน class (หรือ `el.style` ใน JS)
- ข้อมูลจากผู้ใช้ใส่ด้วย `textContent` เท่านั้น (กัน XSS)
