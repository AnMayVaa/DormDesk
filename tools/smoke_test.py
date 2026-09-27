#!/usr/bin/env python3
"""End-to-end smoke test from OUTSIDE the lab (evidence for Architecture section 14).
Uses demo_accounts.txt (from tools/seed_gen.py). Stdlib only.
   python3 tools/smoke_test.py [https://45.77.40.35:10201]
"""
import json, random, re, ssl, sys, uuid, http.cookiejar, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = sys.argv[1] if len(sys.argv) > 1 else "https://45.77.40.35:10201"
ctx = ssl.create_default_context(cafile=str(ROOT / "infra/tls/dormdesk-ca.crt"))
acc = (ROOT / "demo_accounts.txt").read_text(encoding="utf-8")
codes = re.findall(r"/r/(\S+)", acc.split("(dorm_id 2)")[0])  # dorm 1 rooms
pw = dict(re.findall(r"(\S+@dormdesk\.demo) / (\S+)", acc))
results = []


def opener():
    return urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx),
                                       urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(op, method, path, body=None, form=None, headers=None):
    data, headers = None, dict(headers or {})
    if body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    if form is not None:
        b = uuid.uuid4().hex
        parts = [f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in form.items()]
        data = ("".join(parts) + f"--{b}--\r\n").encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={b}"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with op.open(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:80]


def check(name, ok, info=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  ({info})" if info else ""))


tenant = opener()
s, b = call(tenant, "GET", "/api/health"); check("N1 health over HTTPS", s == 200 and b["db"] == "ok", b)
s, b = call(tenant, "GET", f"/api/rooms/{codes[0]}"); check("tenant opens room link", s == 200, b.get("room_no") if s == 200 else b)
form = dict(category_id=3, title="ทดสอบระบบ (smoke test)", detail="auto test", reporter_name="smoke",
            reporter_phone="0800000000", consent="true")
room = random.choice(codes)  # spread over rooms so repeated runs don't hit the 5-per-10-min room limit
key = uuid.uuid4().hex
s, b = call(tenant, "POST", f"/api/rooms/{room}/requests", form=form, headers={"Idempotency-Key": key})
check("tenant creates request", s == 201, s)
tok = b.get("tracking_token") if s == 201 else ""
s, b2 = call(tenant, "POST", f"/api/rooms/{room}/requests", form=form, headers={"Idempotency-Key": key})
check("same Idempotency-Key does not create a duplicate", b2.get("tracking_token") == tok)
s, b = call(tenant, "GET", f"/api/track/{tok}"); check("tracking link works", s == 200 and b["status"] == "received")
s, _ = call(tenant, "GET", "/api/rooms/" + "x" * 22); check("A4 guessed room code rejected", s == 404)
s, _ = call(tenant, "GET", "/api/track/" + "y" * 22); check("A4 guessed tracking token rejected", s == 404)

a = opener()
s, _ = call(a, "GET", "/api/admin/dorms"); check("admin API needs login", s == 401)
s, b = call(a, "POST", "/api/auth/login", body={"email": "owner.a@dormdesk.demo", "password": pw["owner.a@dormdesk.demo"]})
check("owner A login", s == 200)
s, b = call(a, "GET", "/api/admin/dorms"); check("owner A sees only dorm 1", s == 200 and [d["id"] for d in b] == [1], b)
s, b = call(a, "GET", "/api/admin/dorms/2/requests"); check("A1 owner A blocked from dorm 2 list", s == 403, s)
s, b = call(a, "GET", "/api/admin/dorms/2/dashboard"); check("A1 owner A blocked from dorm 2 dashboard", s == 403, s)
s, rows = call(a, "GET", "/api/admin/dorms/1/requests")
s, b = call(tenant, "GET", f"/api/track/{tok}")
mine = max(r["id"] for r in rows if r["title"].startswith("ทดสอบระบบ") and r["room_no"] == b.get("room_no"))
s, b = call(a, "PATCH", f"/api/admin/requests/{mine}", body={"status": "rejected", "note": "smoke test — ปิดเรื่อง"})
check("owner A updates status", s == 200)
s, b = call(tenant, "GET", f"/api/track/{tok}"); check("tenant sees new status", b.get("status") == "rejected")
b_ = opener()
call(b_, "POST", "/api/auth/login", body={"email": "owner.b@dormdesk.demo", "password": pw["owner.b@dormdesk.demo"]})
s, _ = call(b_, "PATCH", f"/api/admin/requests/{mine}", body={"status": "done"}); check("A2 owner B cannot modify dorm 1 request", s == 403, s)
s, b = call(a, "GET", "/api/admin/dorms/1/dashboard"); check("dashboard", s == 200 and "open" in b)
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
