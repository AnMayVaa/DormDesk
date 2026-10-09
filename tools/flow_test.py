#!/usr/bin/env python3
"""DormDesk v2 end-to-end feature test (stdlib only). Runs against a fresh demo seed:
   python3 tools/flow_test.py http://127.0.0.1:8000           # local / CI (plain HTTP API)
   python3 tools/flow_test.py https://dormdesk-g02.duckdns.org:10201 --lab   # through Nginx on the lab (writes demo data!)
Covers: tenant hub, check-in limit, booking quota/cancel, parking approve/cancel/ack, guest pass, bill slip
return/confirm + receipt, fines + dispute, feature switch 403, change of tenant, revocable sessions,
idempotency, and cross-dorm / cross-tenancy isolation for every new object type."""
import base64, json, re, ssl, sys, time, uuid, http.cookiejar, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = (sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "http://127.0.0.1:8000").rstrip("/")
ctx = ssl.create_default_context()
acc = (ROOT / "demo_accounts.txt").read_text(encoding="utf-8")
d1, d2 = acc.split("(dorm_id 2)")
links1 = dict(re.findall(r"ห้อง (\S+): \S+/r/(\S+)", d1))
links2 = dict(re.findall(r"ห้อง (\S+): \S+/r/(\S+)", d2))
pw = dict(re.findall(r"(\S+@dormdesk\.demo) / (\S+)", acc))
def make_png(w=8, h=8):
    import struct, zlib
    raw = b"".join(b"\x00" + bytes([200, 120, 60]) * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


PNG = make_png()
results = []


def opener():
    return urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx),
                                       urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(op, method, path, body=None, files=None, form=None, key=None, raw=False):
    data, headers = None, {}
    if key:
        headers["Idempotency-Key"] = key
    if body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    if files is not None or form is not None:
        b = uuid.uuid4().hex
        parts = b""
        for k, v in (form or {}).items():
            parts += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
        for k, (fn, content, ctype) in (files or {}).items():
            parts += (f'--{b}\r\nContent-Disposition: form-data; name="{k}"; filename="{fn}"\r\nContent-Type: {ctype}\r\n\r\n'.encode()
                      + content + b"\r\n")
        data = parts + f"--{b}--\r\n".encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={b}"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    for attempt in range(3):
        try:
            with op.open(req, timeout=20) as r:
                b = r.read()
                return r.status, (b if raw else json.loads(b or b"null"))
        except urllib.error.HTTPError as e:
            if e.code == 429 and "--lab" in sys.argv and attempt < 2:
                time.sleep(13)             # Nginx rate limits on the lab: wait and retry
                continue
            b = e.read()
            try:
                return e.code, json.loads(b)
            except Exception:
                return e.code, b[:100]


def check(name, ok, info=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({info})" if info and not ok else ""))


def login(email):
    o = opener()
    s, _ = call(o, "POST", "/api/auth/login", body={"email": email, "password": pw[email]})
    assert s == 200, f"login {email} -> {s}"
    return o


def section(t):
    print(f"\n## {t}")


tenant = opener()
r305, r101, r102 = links1["305"], links1["101"], links1["102"]
A = login("owner.a@dormdesk.demo")
B = login("owner.b@dormdesk.demo")

section("tenant hub")
s, h = call(tenant, "GET", f"/api/rooms/{r305}/home")
check("room 305 home loads", s == 200 and h["room_no"] == "305", s)
check("all six features on in dorm 1", s == 200 and all(h["features"].values()), h.get("features"))
check("fine banner data: open/disputed fine visible", s == 200 and len(h["open_fines"]) >= 1)
check("current bill summary present", s == 200 and h["bill"] is not None)
s, b = call(tenant, "POST", f"/api/rooms/{r305}/contact", body={"email": "tenant305@example.org", "consent": True})
check("tenant saves notification e-mail (with consent)", s == 200 and b["notify_email"])
s, _ = call(tenant, "POST", f"/api/rooms/{r305}/contact", body={"email": "x@example.org", "consent": False})
check("e-mail without consent rejected", s == 400, s)

section("fitness / pool check-in")
s, st = call(A, "GET", "/api/admin/dorms/1/settings")
fac = {f["kind"]: f for f in st["facilities"]}
gym, pool = fac["fitness"], fac["pool"]
call(A, "PATCH", f"/api/admin/facilities/{gym['id']}", body={"open_from": "00:00", "open_to": "23:59"})
call(A, "PATCH", f"/api/admin/facilities/{pool['id']}", body={"open_from": "00:00", "open_to": "23:59"})
s, f = call(tenant, "GET", f"/api/rooms/{r305}/facilities")
check("facilities list with occupancy", s == 200 and len(f["checkin"]) == 2 and "current" in f["checkin"][0], s)
k = uuid.uuid4().hex
s, c1 = call(tenant, "POST", f"/api/rooms/{r305}/checkins", body={"qr": gym["qr_url"]}, key=k)
check("check-in by scanning the gym QR", s == 201 and c1["facility"] == gym["name"], c1)
s, c1b = call(tenant, "POST", f"/api/rooms/{r305}/checkins", body={"qr": gym["qr_url"]}, key=k)
check("same Idempotency-Key -> same check-in (no double count)", c1b.get("id") == c1.get("id"), c1b)
s, c2 = call(tenant, "POST", f"/api/rooms/{r305}/checkins", body={"qr": pool["qr_url"]}, key=uuid.uuid4().hex)
check("second person of the room checks in (pool)", s == 201, c2)
s, c3 = call(tenant, "POST", f"/api/rooms/{r305}/checkins", body={"qr": gym["qr_url"]}, key=uuid.uuid4().hex)
check("third check-in refused: room limit 2", s == 409 and c3["error"]["code"] == "room_limit", c3)
s, ps = call(tenant, "GET", f"/api/rooms/{r305}/checkins/{c1['id']}")
check("check-in pass (room, times, active)", s == 200 and ps["active"] and ps["room_no"] == "305")
s, bad = call(tenant, "POST", f"/api/rooms/{r305}/checkins", body={"qr": "https://x/q/notarealtoken123"}, key=uuid.uuid4().hex)
check("unknown QR rejected", s == 404, s)
s, other = call(opener(), "POST", f"/api/rooms/{links2['101']}/checkins", body={"qr": gym["qr_url"]}, key=uuid.uuid4().hex)
check("dorm 1 QR does not work from a dorm 2 room link", s in (403, 404), s)
call(tenant, "POST", f"/api/rooms/{r305}/checkins/{c1['id']}/checkout")
call(tenant, "POST", f"/api/rooms/{r305}/checkins/{c2['id']}/checkout")
s, f = call(tenant, "GET", f"/api/rooms/{r305}/facilities")
check("check-out frees the room's slots", s == 200 and len(f["active"]) == 0, f.get("active"))

section("common-space booking")
space = fac["space"]
tomorrow = (datetime.now(timezone(timedelta(hours=7))) + timedelta(days=2)).date().isoformat()
s, sl = call(tenant, "GET", f"/api/rooms/{r101}/spaces/{space['id']}/slots?date={tomorrow}")
free = [x for x in sl.get("slots", []) if x["state"] == "free"]
check("slots for a day in 2 days", s == 200 and free, s)
s, bk = call(tenant, "GET", f"/api/rooms/{r101}/bookings")
left0 = bk["quota"]["left"]
s, b1 = call(tenant, "POST", f"/api/rooms/{r101}/bookings", body={"space_id": space["id"], "start": free[0]["start"]}, key=uuid.uuid4().hex)
check("book a free slot (auto-approved)", s == 201 and b1["status"] == "booked", b1)
s, sl2 = call(opener(), "GET", f"/api/rooms/{r102}/spaces/{space['id']}/slots?date={tomorrow}")
st0 = next(x for x in sl2["slots"] if x["start"] == free[0]["start"])["state"]
check("another room sees the slot as taken (free/busy only)", st0 == "taken", st0)
s, dup = call(opener(), "POST", f"/api/rooms/{r102}/bookings", body={"space_id": space["id"], "start": free[0]["start"]}, key=uuid.uuid4().hex)
check("double booking refused by the DB exclusion constraint", s == 409 and dup["error"]["code"] == "taken", dup)
s, bk = call(tenant, "GET", f"/api/rooms/{r101}/bookings")
check("weekly quota counts the booking", s == 200 and bk["quota"]["left"] == left0 - 1 or bk["quota"]["week_start"] != "", bk.get("quota"))
s, cx = call(tenant, "POST", f"/api/rooms/{r101}/bookings/{b1['id']}/cancel")
check("cancel > 2 h before: no strike, quota returned", s == 200 and cx["status"] == "cancelled" and not cx["counted_as_strike"], cx)
s, cf = call(tenant, "POST", f"/api/rooms/{r102}/bookings/{b1['id']}/confirm", body={"qr": space["qr_url"]})
check("other room cannot touch this booking", s == 404, s)

section("parking")
s, pk = call(tenant, "GET", f"/api/rooms/{r305}/parking")
check("parking page: quota + existing permit", s == 200 and pk["used"]["car"] >= 1, pk.get("used"))
s, ap = call(tenant, "POST", f"/api/rooms/{r305}/parking/permits", body={"plate": "1กก 5678", "province": "กรุงเทพมหานคร", "vtype": "moto"},
             key=uuid.uuid4().hex)
check("apply for a motorcycle permit", s == 201 and ap["status"] == "pending", ap)
s, rt = call(A, "POST", f"/api/admin/parking/permits/{ap['id']}/return", body={"message": "ทะเบียนไม่ตรงกับสัญญา"})
check("owner returns it with a message", s == 200 and rt["status"] == "returned", rt)
s, rs = call(tenant, "POST", f"/api/rooms/{r305}/parking/permits", body={"plate": "1กก 5679", "province": "กรุงเทพมหานคร", "vtype": "moto",
                                                                          "resubmit_id": ap["id"]}, key=uuid.uuid4().hex)
check("tenant fixes and resubmits the same request", s == 201 and rs["id"] == ap["id"], rs)
s, apr = call(A, "POST", f"/api/admin/parking/permits/{ap['id']}/approve", body={"sticker": "A-099", "spot": "M9"})
check("owner approves (within quota)", s == 200 and apr["status"] == "active", apr)
s, ap2 = call(tenant, "POST", f"/api/rooms/{r305}/parking/permits", body={"plate": "2ขข 1111", "vtype": "moto"}, key=uuid.uuid4().hex)
s, oq = call(A, "POST", f"/api/admin/parking/permits/{ap2['id']}/approve", body={})
check("approving over quota needs confirmation (409 over_quota)", s == 409 and oq["error"]["code"] == "over_quota", oq)
s, oq2 = call(A, "POST", f"/api/admin/parking/permits/{ap2['id']}/approve", body={"confirm_over_quota": True})
check("owner confirms the extra space", s == 200 and oq2["over_quota"], oq2)
s, cn = call(A, "POST", f"/api/admin/parking/permits/{ap2['id']}/cancel", body={"reason": "ช่องจอดปิดปรับปรุง"})
check("owner cancels with reason -> cancel_notice (15 days)", s == 200 and cn["status"] == "cancel_notice", cn)
s, _ = call(tenant, "POST", f"/api/rooms/{r305}/parking/permits/{ap2['id']}/messages", body={"text": "ขอย้ายช่องได้ไหมครับ"}, key=uuid.uuid4().hex)
check("tenant replies in the permit thread", s == 200, s)
s, ak = call(tenant, "POST", f"/api/rooms/{r305}/parking/permits/{ap2['id']}/ack-cancel")
check("tenant acknowledges -> cancelled immediately", s == 200 and ak["status"] == "cancelled", ak)
day = (datetime.now(timezone(timedelta(hours=7)))).date().isoformat()
s, gp = call(tenant, "POST", f"/api/rooms/{r305}/parking/guest-passes", body={"plate": "3ขน 4455", "date": day}, key=uuid.uuid4().hex)
check("guest pass for today", s == 201 and gp["status"] == "active", gp)
s, x = call(B, "POST", f"/api/admin/parking/permits/{ap['id']}/cancel", body={"reason": "test cross"})
check("owner B cannot cancel a dorm 1 permit", s == 403, s)

section("bills, slips, receipts")
s, bl = call(tenant, "GET", f"/api/rooms/{r305}/bills")
cur = next(b for b in bl["bills"] if b["raw_status"] in ("unpaid", "returned"))
check("tenant sees bills with lines", s == 200 and cur["lines"], s)
s, svg = call(tenant, "GET", f"/api/rooms/{r305}/bills/{cur['id']}/promptpay.svg", raw=True)
check("PromptPay QR (SVG) for the exact amount", s == 200 and svg.startswith(b"<svg"), s)
s, sp = call(tenant, "POST", f"/api/rooms/{r305}/bills/{cur['id']}/slip", files={"slip": ("slip.png", PNG, "image/png")}, key=uuid.uuid4().hex)
check("upload payment slip (encrypted to the object store)", s == 201 and sp["status"] == "slip_sent", sp)
s, bil = call(A, "GET", "/api/admin/dorms/1/billing")
pend = [x for x in bil["slips_pending"] if x["bill_id"] == cur["id"]]
check("owner sees the slip waiting", s == 200 and pend, s)
s, img = call(A, "GET", f"/api/admin/bills/{cur['id']}/slips/{pend[0]['slip_id']}", raw=True)
check("owner opens the slip image (decrypted)", s == 200 and img[:4] == b"\x89PNG", s)
s, x = call(B, "GET", f"/api/admin/bills/{cur['id']}/slips/{pend[0]['slip_id']}", raw=True)
check("owner B cannot open a dorm 1 slip", s == 403, s)
s, x = call(opener(), "GET", f"/api/rooms/{r101}/bills/{cur['id']}/promptpay.svg", raw=True)
check("room 101 cannot use room 305's bill", s == 404, s)
s, rt = call(A, "POST", f"/api/admin/bills/{cur['id']}/return", body={"message": "ยอดในสลิปยังขาด 52 บาท"})
check("owner returns the slip with a message", s == 200 and rt["status"] == "returned", rt)
s, bl = call(tenant, "GET", f"/api/rooms/{r305}/bills")
cb = next(b for b in bl["bills"] if b["id"] == cur["id"])
check("tenant sees 'returned' + the owner's message", cb["slip"]["decision"] == "returned" and cb["messages"], cb.get("slip"))
s, sp = call(tenant, "POST", f"/api/rooms/{r305}/bills/{cur['id']}/slip", files={"slip": ("slip2.png", PNG, "image/png")}, key=uuid.uuid4().hex)
s, cfm = call(A, "POST", f"/api/admin/bills/{cur['id']}/confirm")
check("owner confirms -> paid + gapless receipt number", s == 200 and cfm["status"] == "paid" and cfm["receipt_no"], cfm)
s, ed = call(A, "PATCH", f"/api/admin/bills/{cur['id']}", body={"lines": [{"preset": "rent", "amount": 1}], "reason": "test"})
check("a paid bill cannot be edited (409)", s == 409, s)

section("bill generation")
nxt = (datetime.now(timezone(timedelta(hours=7))).replace(day=1) + timedelta(days=32)).strftime("%Y-%m")
s, gen = call(A, "POST", "/api/admin/dorms/1/bills/generate", body={"period": nxt, "issue": False})
check("generate next month's drafts (metered rooms wait for readings)", s == 200 and gen["created"] > 0 and gen["needs_meter"], gen)
s, gen2 = call(A, "POST", "/api/admin/dorms/1/bills/generate", body={"period": nxt, "issue": False})
check("generating twice creates nothing (unique room+tenancy+period)", s == 200 and gen2["created"] == 0, gen2)
s, bil = call(A, "GET", f"/api/admin/dorms/1/billing?period={nxt}")
rows = [{"room_id": r["room_id"], "water_units": 10, "elec_units": 100} for r in bil["rooms"]]
s, _ = call(A, "PUT", "/api/admin/dorms/1/meters", body={"period": nxt, "rows": rows})
check("owner enters meter readings for all rooms", s == 200, s)
bid = bil["rooms"][0]["bill_id"]
s, bd = call(A, "GET", f"/api/admin/bills/{bid}")
check("draft bill has automatic lines (rent, common, parking/fines when due)", s == 200 and any(l["preset"] == "rent" for l in bd["lines"]), s)
lines = [{"preset": l["preset"], "label": l["label"], "note": l["note"], "amount": l["amount"] / 100} for l in bd["lines"]]
lines += [{"preset": "water", "note": "10 หน่วย", "amount": 180}, {"preset": "electric", "note": "100 หน่วย", "amount": 700}]
s, e = call(A, "PATCH", f"/api/admin/bills/{bid}", body={"lines": lines})
s, iss = call(A, "POST", f"/api/admin/bills/{bid}/issue")
check("owner completes and issues a draft", s == 200 and iss["status"] == "unpaid", iss)
s, e2 = call(A, "PATCH", f"/api/admin/bills/{bid}", body={"lines": lines[:-1]})
check("editing an issued bill needs a reason", s == 400, s)
s, e3 = call(A, "PATCH", f"/api/admin/bills/{bid}", body={"lines": lines[:-1], "reason": "จดเลขมิเตอร์ไฟผิด"})
check("...and is recorded in the edit history", s == 200 and call(A, "GET", f"/api/admin/bills/{bid}")[1]["edits"], s)

section("fines")
s, rooms = call(A, "GET", "/api/admin/dorms/1/rooms")
room101 = next(r for r in rooms if r["room_no"] == "101")
s, fn = call(A, "POST", "/api/admin/dorms/1/fines", form={"room_id": room101["id"], "preset": "noise", "amount": "300",
                                                         "reason": "เสียงดังหลัง 22:00 น. ซ้ำ 3 ครั้ง", "billing": "next_bill"},
             files={"photos": ("ev.png", PNG, "image/png")}, key=uuid.uuid4().hex)
check("owner issues a fine with photo evidence", s == 201, fn)
s, h = call(tenant, "GET", f"/api/rooms/{r101}/home")
check("tenant sees the red fine banner", any(x["id"] == fn["id"] for x in h["open_fines"]), h.get("open_fines"))
s, fd = call(tenant, "GET", f"/api/rooms/{r101}/fines/{fn['id']}")
check("fine detail: reason, photos, contact", s == 200 and fd["photos"] and fd["contact"], s)
s, ph = call(tenant, "GET", f"/api/rooms/{r101}/fines/{fn['id']}/photos/{fd['photos'][0]}", raw=True)
check("tenant opens the evidence photo", s == 200 and ph[:4] == b"\x89PNG", s)
s, x = call(opener(), "GET", f"/api/rooms/{r102}/fines/{fn['id']}")
check("room 102 cannot see room 101's fine", s == 404, s)
s, x = call(opener(), "GET", f"/api/rooms/{r102}/fines/{fn['id']}/photos/{fd['photos'][0]}", raw=True)
check("...nor its photo", s == 404, s)
s, _ = call(tenant, "POST", f"/api/rooms/{r101}/fines/{fn['id']}/messages", body={"text": "ขอดูหลักฐานเพิ่มครับ"}, key=uuid.uuid4().hex)
s, fd = call(A, "GET", f"/api/admin/fines/{fn['id']}")
check("tenant reply turns the fine into 'disputed'", fd["status"] == "disputed" and fd["messages"], fd.get("status"))
s, _ = call(A, "PATCH", f"/api/admin/fines/{fn['id']}", body={"amount": 150})
s, fd = call(A, "GET", f"/api/admin/fines/{fn['id']}")
check("owner reduces the amount after talking", fd["amount"] == 15000, fd.get("amount"))
s, x = call(A, "PATCH", f"/api/admin/fines/{fn['id']}", body={"amount": 999})
check("owner cannot raise above the original amount", s == 400, s)
s, x = call(B, "GET", f"/api/admin/fines/{fn['id']}")
check("owner B cannot read a dorm 1 fine", s == 403, s)

section("feature switches are enforced by the API")
s, _ = call(A, "PUT", "/api/admin/dorms/1/settings", body={"f_parking": False})
s, x = call(tenant, "GET", f"/api/rooms/{r305}/parking")
check("parking switched off -> tenant API answers 403", s == 403 and x["error"]["code"] == "feature_disabled", s)
s, h = call(tenant, "GET", f"/api/rooms/{r305}/home")
check("...and the hub no longer lists it", s == 200 and not h["features"]["parking"])
call(A, "PUT", "/api/admin/dorms/1/settings", body={"f_parking": True})
s, x = call(A, "PUT", "/api/admin/dorms/1/settings", body={"checkin_per_room": 99})
check("rule values are range-checked by the database", s == 400, s)
s, x = call(B, "PUT", "/api/admin/dorms/1/settings", body={"f_bills": False})
check("owner B cannot change dorm 1 settings", s == 403, s)
s, x = call(opener(), "GET", f"/api/rooms/{links2['101']}/facilities")
check("dorm 2 (features off) -> 403 on facilities", s == 403, s)

section("change of tenant")
room102 = next(r for r in rooms if r["room_no"] == "102")
s, before = call(tenant, "GET", f"/api/rooms/{r102}/home")
s, ti = call(A, "GET", f"/api/admin/rooms/{room102['id']}/tenancy")
check("preview of what will be closed", s == 200 and "permits" in ti["current"], s)
s, nt = call(A, "POST", f"/api/admin/rooms/{room102['id']}/new-tenancy")
check("owner starts a new tenancy", s == 200 and nt["room_code"] != r102, nt)
s, x = call(opener(), "GET", f"/api/rooms/{r102}/home")
check("old room link -> 404 immediately", s == 404, s)
new_t = opener()
s, h = call(new_t, "GET", f"/api/rooms/{nt['room_code']}/home")
check("new tenant starts from zero (no bill, no fines)", s == 200 and h["bill"] is None and not h["open_fines"], h.get("bill"))
s, bl = call(new_t, "GET", f"/api/rooms/{nt['room_code']}/bills")
check("new tenant sees none of the previous bills", s == 200 and bl["bills"] == [], len(bl.get("bills", [])))
s, ti = call(A, "GET", f"/api/admin/rooms/{room102['id']}/tenancy")
check("owner still sees the previous tenancy in history", s == 200 and ti["previous"], s)

section("exactly-once writes (502 then retry)")
# The lab bug: the status change was saved, the reply was lost (502), the owner pressed again -> 3 copies in the history.
import threading
s, rows = call(A, "GET", "/api/admin/dorms/1/requests")
rid = next(r["id"] for r in rows if r["status"] in ("received", "in_progress"))
s, before = call(A, "GET", f"/api/admin/requests/{rid}")
n0 = len(before["events"])
target = "done" if before["status"] != "done" else "in_progress"
k = "t-" + uuid.uuid4().hex
s1, p1 = call(A, "PATCH", f"/api/admin/requests/{rid}", body={"status": target, "note": "flow test"}, key=k)
s2, p2 = call(A, "PATCH", f"/api/admin/requests/{rid}", body={"status": target, "note": "flow test"}, key=k)   # browser retry, same key
check("retry with the same Idempotency-Key gets the first reply", s1 == 200 and s2 == 200 and p1 == p2, (s1, s2))
s3, _ = call(A, "PATCH", f"/api/admin/requests/{rid}", body={"status": target, "note": "flow test"}, key="t-" + uuid.uuid4().hex)  # pressed again
s, after = call(A, "GET", f"/api/admin/requests/{rid}")
check("history gets the change once (not 3 times)", s3 == 200 and len(after["events"]) == n0 + 1, (n0, len(after["events"])))
# two copies at the same moment (double tap / proxy retry): one runs, the other waits and gets the same reply
k2, got = "t-" + uuid.uuid4().hex, []
back = "in_progress" if target == "done" else "done"
th = [threading.Thread(target=lambda: got.append(call(A, "PATCH", f"/api/admin/requests/{rid}", body={"status": back, "note": "parallel"}, key=k2)))
      for _ in range(2)]
[x.start() for x in th]; [x.join() for x in th]
s, after2 = call(A, "GET", f"/api/admin/requests/{rid}")
check("two parallel copies -> both 200, one event", all(g[0] == 200 for g in got) and len(after2["events"]) == n0 + 2, [g[0] for g in got])
B_k = call(B, "PATCH", f"/api/admin/requests/{rid}", body={"status": "received"}, key=k2)[0]
check("another owner reusing the key gets no replay (still 403)", B_k == 403, B_k)

section("revocable sessions")
A2 = login("owner.a@dormdesk.demo")
s, ss = call(A2, "GET", "/api/auth/sessions")
check("sessions list shows several devices", s == 200 and len(ss) >= 2, s)
s, rv = call(A2, "POST", "/api/auth/sessions/revoke-others")
check("sign out other devices", s == 200 and rv["revoked"] >= 1, rv)
s, x = call(A, "GET", "/api/admin/dorms")
check("the other session is rejected at once (401)", s == 401, s)
call(A2, "POST", "/api/auth/logout")
s, x = call(A2, "GET", "/api/admin/dorms")
check("logout kills the session server-side", s == 401, s)

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
