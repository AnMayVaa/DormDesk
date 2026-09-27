"""DormDesk REST API (FastAPI) — runs on api-01 / api-02 in the private subnet.

Rules (see docs/DormDesk_HANDOFF.md section 6):
- dorm_id comes only from the room code, the tracking token, or the admin session (checked against admin_dorms)
- every tenant query runs inside tenant_tx(), which does SET LOCAL app.dorm_id so PostgreSQL RLS filters rows
- the API keeps no state on disk: sessions are signed cookies, photos live in the database
"""
import io
import os
import re
import secrets
import socket
from contextlib import asynccontextmanager, contextmanager
from typing import List, Optional

import bcrypt
from fastapi import BackgroundTasks, FastAPI, File, Form, Query, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer
from PIL import Image, ImageOps, UnidentifiedImageError
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import insight, notify

# ---------------------------------------------------------------- config
DATABASE_URL = os.environ["DATABASE_URL"]
SESSION_SECRET = os.environ["SESSION_SECRET"]
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "1") == "1"
SESSION_MAX_AGE = 8 * 3600
ROOM_LIMIT = int(os.environ.get("ROOM_LIMIT_PER_10MIN", "5"))
LOGIN_FAIL_LIMIT = 5
MAX_PHOTOS = 3
MAX_TOTAL_BYTES = 5 * 1024 * 1024
MAX_SIDE = 1600
HOSTNAME = socket.gethostname()
STATUSES = ("received", "in_progress", "done", "rejected")
PRIORITIES = ("normal", "urgent")
Image.MAX_IMAGE_PIXELS = 40_000_000  # decompression-bomb guard

pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=5, open=False,
                      kwargs={"row_factory": dict_row, "autocommit": True})
signer = URLSafeTimedSerializer(SESSION_SECRET, salt="dormdesk-session")
DUMMY_HASH = bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt())


@asynccontextmanager
async def lifespan(_app):
    pool.open(wait=False)
    yield
    pool.close()


app = FastAPI(title="DormDesk API", lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)


# ---------------------------------------------------------------- errors: one format everywhere
class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def err(status, code, message):
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


@app.exception_handler(ApiError)
async def _api_error(_req, e: ApiError):
    return err(e.status, e.code, e.message)


@app.exception_handler(RequestValidationError)
async def _validation_error(_req, e: RequestValidationError):
    first = e.errors()[0] if e.errors() else {}
    field = ".".join(str(x) for x in first.get("loc", [])[1:]) or "input"
    return err(422, "validation_error", f"ข้อมูลไม่ถูกต้อง: {field}")


@app.exception_handler(StarletteHTTPException)
async def _http_error(_req, e: StarletteHTTPException):
    return err(e.status_code, "http_error", str(e.detail))


@app.exception_handler(Exception)
async def _unhandled(_req, _e: Exception):
    return err(500, "internal_error", "เกิดข้อผิดพลาดภายในระบบ")


# ---------------------------------------------------------------- helpers
def client_ip(request: Request) -> str:
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "-")


@contextmanager
def tenant_tx(dorm_id: int):
    """Transaction scoped to one dorm. SET LOCAL disappears at COMMIT, so a pooled
    connection never carries one dorm's setting into the next request."""
    with pool.connection() as conn:
        with conn.transaction():
            conn.execute("SELECT set_config('app.dorm_id', %s, true)", (str(int(dorm_id)),))
            yield conn


def one(sql, params=()):
    with pool.connection() as conn:
        return conn.execute(sql, params).fetchone()


def log_event(etype: str, ip: str, dorm_id: Optional[int] = None, detail: Optional[str] = None):
    try:
        with pool.connection() as conn:
            conn.execute("INSERT INTO security_events (type, ip, dorm_id, detail) VALUES (%s,%s,%s,%s)",
                         (etype, ip, dorm_id, (detail or "")[:200]))
    except Exception:
        pass  # logging must never break the request


def mask_token(t: str) -> str:
    return (t[:4] + "…") if t else ""


# ---------------------------------------------------------------- sessions (admin)
def require_admin(request: Request) -> int:
    raw = request.cookies.get("dd_session")
    if not raw:
        raise ApiError(401, "unauthenticated", "กรุณาเข้าสู่ระบบ")
    try:
        data = signer.loads(raw, max_age=SESSION_MAX_AGE)
    except BadSignature:
        raise ApiError(401, "unauthenticated", "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่")
    return int(data["aid"])


def require_dorm_access(request: Request, dorm_id: Optional[int]) -> int:
    aid = require_admin(request)
    if dorm_id is None:
        raise ApiError(404, "not_found", "ไม่พบข้อมูล")
    ok = one("SELECT 1 FROM admin_dorms WHERE admin_id=%s AND dorm_id=%s", (aid, dorm_id))
    if not ok:
        log_event("cross_tenant", client_ip(request), dorm_id, f"admin={aid} path={request.url.path}")
        raise ApiError(403, "forbidden", "ไม่มีสิทธิ์เข้าถึงหอนี้")
    return aid


# ---------------------------------------------------------------- health
@app.get("/api/health")
def health():
    db = "ok"
    try:
        one("SELECT 1")
    except Exception:
        db = "down"
    return {"status": "ok" if db == "ok" else "degraded", "db": db, "served_by": HOSTNAME}


# ================================================================= TENANT (no login)
def resolve_room(request: Request, code: str):
    row = one("SELECT * FROM resolve_room(%s)", (code,)) if len(code) <= 64 else None
    if not row:
        log_event("bad_room_code", client_ip(request), None, mask_token(code))
        raise ApiError(404, "room_not_found", "ลิงก์ห้องไม่ถูกต้องหรือถูกเปลี่ยนแล้ว กรุณาติดต่อเจ้าของหอ")
    return row["dorm_id"], row["room_id"]


@app.get("/api/rooms/{code}")
def room_info(code: str, request: Request):
    dorm_id, room_id = resolve_room(request, code)
    with tenant_tx(dorm_id) as c:
        room = c.execute("SELECT r.room_no, d.name AS dorm_name FROM rooms r JOIN dorms d ON d.id=r.dorm_id "
                         "WHERE r.id=%s", (room_id,)).fetchone()
        cats = c.execute("SELECT c.id, c.name_th FROM categories c JOIN dorm_categories dc ON dc.category_id=c.id "
                         "WHERE dc.enabled ORDER BY c.sort").fetchall()
    return {"dorm_name": room["dorm_name"], "room_no": room["room_no"], "categories": cats}


PHONE_RE = re.compile(r"^[0-9+\-\s]{9,20}$")
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$")


def clean_image(raw: bytes):
    """Accept only real JPEG/PNG/WEBP, re-encode to drop EXIF (GPS) and hidden data."""
    try:
        probe = Image.open(io.BytesIO(raw))
        fmt = probe.format
        probe.verify()
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError):
        raise ApiError(400, "bad_image", "ไฟล์ต้องเป็นรูปภาพ JPG, PNG หรือ WEBP")
    if fmt not in ("JPEG", "PNG", "WEBP"):
        raise ApiError(400, "bad_image", "ไฟล์ต้องเป็นรูปภาพ JPG, PNG หรือ WEBP")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    if fmt == "PNG":
        img.save(out, "PNG", optimize=True)
        mime = "image/png"
    elif fmt == "WEBP":
        img.save(out, "WEBP", quality=85)
        mime = "image/webp"
    else:
        img.convert("RGB").save(out, "JPEG", quality=85)
        mime = "image/jpeg"
    return mime, out.getvalue()


@app.post("/api/rooms/{code}/requests", status_code=201)
async def create_request(code: str, request: Request, background: BackgroundTasks,
                         category_id: int = Form(...),
                         title: str = Form(..., min_length=3, max_length=120),
                         detail: str = Form("", max_length=2000),
                         reporter_name: str = Form(..., min_length=1, max_length=80),
                         reporter_phone: str = Form(...),
                         reporter_email: str = Form(""),
                         consent: str = Form(...),
                         photos: List[UploadFile] = File(default=[])):
    ip = client_ip(request)
    dorm_id, room_id = resolve_room(request, code)

    if consent not in ("true", "on", "1", "yes"):
        raise ApiError(400, "consent_required", "กรุณายินยอมให้เก็บข้อมูลเพื่อใช้ติดต่อเรื่องแจ้งซ่อม")
    if not PHONE_RE.match(reporter_phone.strip()):
        raise ApiError(400, "bad_phone", "เบอร์โทรไม่ถูกต้อง")
    email = reporter_email.strip() or None
    if email and not EMAIL_RE.match(email):
        raise ApiError(400, "bad_email", "อีเมลไม่ถูกต้อง")

    photos = [p for p in photos if p and p.filename]
    if len(photos) > MAX_PHOTOS:
        raise ApiError(400, "too_many_photos", f"แนบรูปได้ไม่เกิน {MAX_PHOTOS} รูป")
    cleaned, total = [], 0
    for p in photos:
        raw = await p.read(MAX_TOTAL_BYTES + 1)
        total += len(raw)
        if total > MAX_TOTAL_BYTES:
            raise ApiError(413, "too_large", "รูปรวมกันต้องไม่เกิน 5 MB")
        cleaned.append(clean_image(raw))

    # Idempotency-Key: the browser sends one random key per form submission. If Nginx retries the POST on the
    # other API instance (failover), or the tenant double-clicks, the same key returns the same request.
    idem = (request.headers.get("idempotency-key") or "").strip()[:64] or None
    token = secrets.token_urlsafe(16)
    with tenant_tx(dorm_id) as c:
        if idem:
            dup = c.execute("SELECT tracking_token FROM requests WHERE idem_key=%s", (idem,)).fetchone()
            if dup:
                return {"tracking_token": dup["tracking_token"], "tracking_url": f"/t/{dup['tracking_token']}"}
        recent = c.execute("SELECT count(*) AS n FROM requests WHERE room_id=%s "
                           "AND created_at > now() - interval '10 minutes'", (room_id,)).fetchone()["n"]
        if recent >= ROOM_LIMIT:
            log_event("rate_limited", ip, dorm_id, f"room={room_id}")
            raise ApiError(429, "rate_limited", "ห้องนี้แจ้งเรื่องถี่เกินไป กรุณารอสักครู่แล้วลองใหม่")
        enabled = c.execute("SELECT 1 FROM dorm_categories WHERE category_id=%s AND enabled", (category_id,)).fetchone()
        if not enabled:
            raise ApiError(400, "bad_category", "หมวดปัญหาไม่ถูกต้อง")
        rid = c.execute(
            "INSERT INTO requests (dorm_id, room_id, category_id, title, detail, reporter_name, reporter_phone, "
            "reporter_email, consent_at, tracking_token, idem_key) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,now(),%s,%s) RETURNING id",
            (dorm_id, room_id, category_id, title.strip(), detail.strip(), reporter_name.strip(),
             reporter_phone.strip(), email, token, idem)).fetchone()["id"]
        c.execute("INSERT INTO request_events (dorm_id, request_id, from_status, to_status, actor) "
                  "VALUES (%s,%s,NULL,'received','tenant')", (dorm_id, rid))
        for mime, data in cleaned:
            c.execute("INSERT INTO request_photos (dorm_id, request_id, mime, size, data) VALUES (%s,%s,%s,%s,%s)",
                      (dorm_id, rid, mime, len(data), data))
        info = c.execute("SELECT d.name AS dorm, rm.room_no, cat.name_th AS category FROM rooms rm JOIN dorms d ON d.id=rm.dorm_id "
                         "JOIN categories cat ON cat.id=%s WHERE rm.id=%s", (category_id, room_id)).fetchone()
    if notify.enabled():
        on_err = lambda why: log_event("email_failed", ip, dorm_id, why)
        if email:
            background.add_task(notify.tenant_received, email, title.strip(), info["room_no"], info["dorm"], token, on_err)
        for to in owner_recipients(dorm_id):
            background.add_task(notify.owner_new_request, to, title.strip(), info["room_no"], info["dorm"], info["category"], False, on_err)
    return {"tracking_token": token, "tracking_url": f"/t/{token}"}


def owner_recipients(dorm_id: int):
    """OWNER_ALERT_TO (comma list) overrides; otherwise real e-mails of this dorm's admins (demo addresses skipped)."""
    fixed = [x.strip() for x in os.environ.get("OWNER_ALERT_TO", "").split(",") if x.strip()]
    if fixed:
        return fixed
    with pool.connection() as c:
        rows = c.execute("SELECT a.email FROM admins a JOIN admin_dorms ad ON ad.admin_id=a.id WHERE ad.dorm_id=%s", (dorm_id,)).fetchall()
    return [r["email"] for r in rows if not r["email"].endswith(".demo")]


def resolve_tracking(request: Request, token: str):
    row = one("SELECT * FROM resolve_tracking(%s)", (token,)) if len(token) <= 64 else None
    if not row:
        log_event("bad_tracking_token", client_ip(request), None, mask_token(token))
        raise ApiError(404, "not_found", "ไม่พบคำขอนี้")
    return row["dorm_id"], row["request_id"]


@app.get("/api/track/{token}")
def track(token: str, request: Request):
    dorm_id, rid = resolve_tracking(request, token)
    with tenant_tx(dorm_id) as c:
        r = c.execute(
            "SELECT q.title, q.detail, q.status, q.priority, q.created_at, q.updated_at, q.done_at, "
            "c.name_th AS category, rm.room_no, d.name AS dorm_name "
            "FROM requests q JOIN categories c ON c.id=q.category_id JOIN rooms rm ON rm.id=q.room_id "
            "JOIN dorms d ON d.id=q.dorm_id WHERE q.id=%s", (rid,)).fetchone()
        events = c.execute("SELECT to_status, note, created_at FROM request_events WHERE request_id=%s "
                           "ORDER BY created_at, id", (rid,)).fetchall()
        photos = [p["id"] for p in c.execute("SELECT id FROM request_photos WHERE request_id=%s ORDER BY id",
                                             (rid,)).fetchall()]
    return {**r, "events": events, "photos": photos}


def photo_response(c, request_id: int, photo_id: int):
    p = c.execute("SELECT mime, data FROM request_photos WHERE id=%s AND request_id=%s",
                  (photo_id, request_id)).fetchone()
    if not p:
        raise ApiError(404, "not_found", "ไม่พบรูป")
    return Response(bytes(p["data"]), media_type=p["mime"],
                    headers={"Cache-Control": "private, max-age=3600"})


@app.get("/api/track/{token}/photos/{photo_id}")
def track_photo(token: str, photo_id: int, request: Request):
    dorm_id, rid = resolve_tracking(request, token)
    with tenant_tx(dorm_id) as c:
        return photo_response(c, rid, photo_id)


# ================================================================= AUTH
class LoginIn(BaseModel):
    email: str = Field(..., max_length=254)
    password: str = Field(..., max_length=200)


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request, response: Response):
    ip = client_ip(request)
    email = body.email.strip().lower()
    fails = one("SELECT count(*) AS n FROM security_events WHERE type='login_failed' AND detail=%s "
                "AND occurred_at > now() - interval '10 minutes'", (email,))["n"]
    if fails >= LOGIN_FAIL_LIMIT:
        log_event("rate_limited", ip, None, "login")
        raise ApiError(429, "rate_limited", "เข้าสู่ระบบผิดหลายครั้ง กรุณารอ 10 นาที")
    admin = one("SELECT id, display_name, password_hash FROM admins WHERE email=%s", (email,))
    hashed = admin["password_hash"].encode() if admin else DUMMY_HASH  # same timing either way
    if not bcrypt.checkpw(body.password.encode(), hashed) or not admin:
        log_event("login_failed", ip, None, email)
        raise ApiError(401, "bad_credentials", "อีเมลหรือรหัสผ่านไม่ถูกต้อง")
    response.set_cookie("dd_session", signer.dumps({"aid": admin["id"]}), max_age=SESSION_MAX_AGE,
                        httponly=True, secure=COOKIE_SECURE, samesite="strict", path="/")
    return {"display_name": admin["display_name"]}


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie("dd_session", path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(request: Request):
    aid = require_admin(request)
    a = one("SELECT email, display_name FROM admins WHERE id=%s", (aid,))
    if not a:
        raise ApiError(401, "unauthenticated", "กรุณาเข้าสู่ระบบ")
    return a


# ================================================================= ADMIN
@app.get("/api/admin/dorms")
def admin_dorms(request: Request):
    aid = require_admin(request)
    with pool.connection() as c:
        return c.execute("SELECT d.id, d.name FROM dorms d JOIN admin_dorms ad ON ad.dorm_id=d.id "
                         "WHERE ad.admin_id=%s ORDER BY d.id", (aid,)).fetchall()


@app.get("/api/admin/dorms/{dorm_id}/requests")
def admin_requests(dorm_id: int, request: Request,
                   status: Optional[str] = Query(None), category_id: Optional[int] = Query(None),
                   priority: Optional[str] = Query(None)):
    require_dorm_access(request, dorm_id)
    if status and status not in STATUSES or priority and priority not in PRIORITIES:
        raise ApiError(400, "bad_filter", "ตัวกรองไม่ถูกต้อง")
    sql = ("SELECT q.id, q.title, q.status, q.priority, q.created_at, q.updated_at, q.reporter_name, "
           "c.name_th AS category, rm.room_no, "
           "(SELECT count(*) FROM request_photos p WHERE p.request_id=q.id) AS photo_count "
           "FROM requests q JOIN categories c ON c.id=q.category_id JOIN rooms rm ON rm.id=q.room_id WHERE true")
    params = []
    if status:
        sql += " AND q.status=%s"; params.append(status)
    if category_id:
        sql += " AND q.category_id=%s"; params.append(category_id)
    if priority:
        sql += " AND q.priority=%s"; params.append(priority)
    sql += (" ORDER BY (q.status IN ('received','in_progress')) DESC, (q.priority='urgent') DESC, "
            "q.created_at DESC LIMIT 300")
    with tenant_tx(dorm_id) as c:  # RLS adds "AND dorm_id = <this dorm>" on every table
        return c.execute(sql, params).fetchall()


def request_scope(request: Request, rid: int) -> int:
    dorm_id = one("SELECT request_dorm(%s) AS d", (rid,))["d"]
    require_admin(request)
    if dorm_id is None:
        raise ApiError(404, "not_found", "ไม่พบคำขอ")
    require_dorm_access(request, dorm_id)
    return dorm_id


@app.get("/api/admin/requests/{rid}")
def admin_request_detail(rid: int, request: Request):
    dorm_id = request_scope(request, rid)
    with tenant_tx(dorm_id) as c:
        r = c.execute("SELECT q.*, c.name_th AS category, rm.room_no FROM requests q "
                      "JOIN categories c ON c.id=q.category_id JOIN rooms rm ON rm.id=q.room_id "
                      "WHERE q.id=%s", (rid,)).fetchone()
        r.pop("tracking_token", None)
        r["events"] = c.execute("SELECT from_status, to_status, note, actor, created_at FROM request_events "
                                "WHERE request_id=%s ORDER BY created_at, id", (rid,)).fetchall()
        r["photos"] = [p["id"] for p in c.execute("SELECT id FROM request_photos WHERE request_id=%s ORDER BY id",
                                                  (rid,)).fetchall()]
    return r


@app.get("/api/admin/requests/{rid}/photos/{photo_id}")
def admin_photo(rid: int, photo_id: int, request: Request):
    dorm_id = request_scope(request, rid)
    with tenant_tx(dorm_id) as c:
        return photo_response(c, rid, photo_id)


class RequestPatch(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    note: Optional[str] = Field(None, max_length=500)


@app.patch("/api/admin/requests/{rid}")
def admin_update_request(rid: int, body: RequestPatch, request: Request, background: BackgroundTasks):
    dorm_id = request_scope(request, rid)
    aid = require_admin(request)
    if body.status and body.status not in STATUSES or body.priority and body.priority not in PRIORITIES:
        raise ApiError(400, "bad_value", "ค่าสถานะหรือความเร่งด่วนไม่ถูกต้อง")
    with tenant_tx(dorm_id) as c:
        cur = c.execute("SELECT q.status, q.priority, q.title, q.reporter_email, q.tracking_token, rm.room_no, d.name AS dorm "
                        "FROM requests q JOIN rooms rm ON rm.id=q.room_id JOIN dorms d ON d.id=q.dorm_id "
                        "WHERE q.id=%s FOR UPDATE OF q", (rid,)).fetchone()
        new_status = body.status or cur["status"]
        new_priority = body.priority or cur["priority"]
        c.execute("UPDATE requests SET status=%s, priority=%s, updated_at=now(), "
                  "done_at = CASE WHEN %s='done' THEN COALESCE(done_at, now()) ELSE NULL END WHERE id=%s",
                  (new_status, new_priority, new_status, rid))
        if new_status != cur["status"] or body.note:
            c.execute("INSERT INTO request_events (dorm_id, request_id, from_status, to_status, note, actor) "
                      "VALUES (%s,%s,%s,%s,%s,%s)",
                      (dorm_id, rid, cur["status"], new_status, (body.note or "").strip() or None, f"admin:{aid}"))
    if new_status != cur["status"] and cur["reporter_email"] and notify.enabled():
        background.add_task(notify.tenant_status_changed, cur["reporter_email"], cur["title"], cur["room_no"], cur["dorm"],
                            new_status, (body.note or "").strip(), cur["tracking_token"],
                            lambda why: log_event("email_failed", client_ip(request), dorm_id, why))
    return {"id": rid, "status": new_status, "priority": new_priority, "emailed": bool(cur["reporter_email"] and notify.enabled()
                                                                                        and new_status != cur["status"])}


@app.get("/api/admin/dorms/{dorm_id}/dashboard")
def dashboard(dorm_id: int, request: Request):
    require_dorm_access(request, dorm_id)
    with tenant_tx(dorm_id) as c:
        by_status = {r["status"]: r["n"] for r in c.execute(
            "SELECT status, count(*) AS n FROM requests GROUP BY status").fetchall()}
        by_category = c.execute(
            "SELECT c.name_th AS category, count(*) AS n FROM requests q JOIN categories c ON c.id=q.category_id "
            "WHERE q.created_at > now() - interval '30 days' GROUP BY c.name_th ORDER BY n DESC").fetchall()
        resolve = c.execute(
            "SELECT c.name_th AS category, round(avg(extract(epoch FROM q.done_at - q.created_at))/3600, 1) AS hours, "
            "count(*) AS n FROM requests q JOIN categories c ON c.id=q.category_id "
            "WHERE q.done_at IS NOT NULL AND q.created_at > now() - interval '90 days' "
            "GROUP BY c.name_th ORDER BY hours DESC").fetchall()
        overall = c.execute(
            "SELECT round(avg(extract(epoch FROM done_at - created_at))/3600, 1) AS hours FROM requests "
            "WHERE done_at IS NOT NULL AND created_at > now() - interval '30 days'").fetchone()["hours"]
        overdue = c.execute(
            "SELECT q.id, q.title, rm.room_no, q.status, q.priority, q.created_at FROM requests q "
            "JOIN rooms rm ON rm.id=q.room_id WHERE q.status IN ('received','in_progress') "
            "AND q.created_at < now() - interval '48 hours' ORDER BY q.created_at LIMIT 10").fetchall()
        repeat_rooms = c.execute(
            "SELECT rm.room_no, c.name_th AS category, count(*) AS n FROM requests q "
            "JOIN rooms rm ON rm.id=q.room_id JOIN categories c ON c.id=q.category_id "
            "WHERE q.created_at > now() - interval '90 days' GROUP BY rm.room_no, c.name_th "
            "HAVING count(*) >= 2 ORDER BY n DESC, rm.room_no LIMIT 10").fetchall()
    open_n = by_status.get("received", 0) + by_status.get("in_progress", 0)
    return {"by_status": by_status, "open": open_n, "avg_resolve_hours_30d": overall,
            "by_category_30d": by_category, "resolve_hours_by_category_90d": resolve,
            "overdue_48h": overdue, "repeat_rooms_90d": repeat_rooms}


# ---------------------------------------------------------------- rooms & categories
@app.get("/api/admin/dorms/{dorm_id}/rooms")
def list_rooms(dorm_id: int, request: Request):
    require_dorm_access(request, dorm_id)
    with tenant_tx(dorm_id) as c:
        return c.execute(
            "SELECT r.id, r.room_no, r.room_code, r.code_rotated_at, "
            "(SELECT count(*) FROM requests q WHERE q.room_id=r.id AND q.status IN ('received','in_progress')) AS open "
            "FROM rooms r ORDER BY r.room_no").fetchall()


class RoomIn(BaseModel):
    room_no: str = Field(..., min_length=1, max_length=20, pattern=r"^[0-9A-Za-z\-/ ]+$")


@app.post("/api/admin/dorms/{dorm_id}/rooms", status_code=201)
def create_room(dorm_id: int, body: RoomIn, request: Request):
    require_dorm_access(request, dorm_id)
    with tenant_tx(dorm_id) as c:
        if c.execute("SELECT 1 FROM rooms WHERE room_no=%s", (body.room_no.strip(),)).fetchone():
            raise ApiError(409, "duplicate", "มีห้องนี้อยู่แล้ว")
        return c.execute("INSERT INTO rooms (dorm_id, room_no, room_code) VALUES (%s,%s,%s) "
                         "RETURNING id, room_no, room_code",
                         (dorm_id, body.room_no.strip(), secrets.token_urlsafe(16))).fetchone()


@app.post("/api/admin/rooms/{room_id}/rotate-code")
def rotate_code(room_id: int, request: Request):
    require_admin(request)
    dorm_id = one("SELECT room_dorm(%s) AS d", (room_id,))["d"]
    require_dorm_access(request, dorm_id)
    with tenant_tx(dorm_id) as c:
        return c.execute("UPDATE rooms SET room_code=%s, code_rotated_at=now() WHERE id=%s "
                         "RETURNING id, room_no, room_code, code_rotated_at",
                         (secrets.token_urlsafe(16), room_id)).fetchone()


@app.get("/api/admin/dorms/{dorm_id}/categories")
def list_categories(dorm_id: int, request: Request):
    require_dorm_access(request, dorm_id)
    with tenant_tx(dorm_id) as c:
        return c.execute("SELECT c.id, c.name_th, COALESCE(dc.enabled, false) AS enabled FROM categories c "
                         "LEFT JOIN dorm_categories dc ON dc.category_id=c.id ORDER BY c.sort").fetchall()


class CategoryPatch(BaseModel):
    category_id: int
    enabled: bool


@app.patch("/api/admin/dorms/{dorm_id}/categories")
def set_category(dorm_id: int, body: CategoryPatch, request: Request):
    require_dorm_access(request, dorm_id)
    with tenant_tx(dorm_id) as c:
        if not c.execute("SELECT 1 FROM categories WHERE id=%s", (body.category_id,)).fetchone():
            raise ApiError(404, "not_found", "ไม่พบหมวด")
        c.execute("INSERT INTO dorm_categories (dorm_id, category_id, enabled) VALUES (%s,%s,%s) "
                  "ON CONFLICT (dorm_id, category_id) DO UPDATE SET enabled=EXCLUDED.enabled",
                  (dorm_id, body.category_id, body.enabled))
    return {"category_id": body.category_id, "enabled": body.enabled}


# ================================================================= AI INSIGHT (owner / manager)
class AskIn(BaseModel):
    question: str = Field(..., min_length=2, max_length=300)
    lang: str = Field("th", pattern="^(th|en)$")


AI_LIMIT_PER_10MIN = int(os.environ.get("AI_LIMIT_PER_10MIN", "20"))


@app.get("/api/admin/ai/status")
def ai_status(request: Request, lang: str = Query("th", pattern="^(th|en)$")):
    require_admin(request)
    return {"llm": "up" if insight.llm_up() else "down", "suggestions": insight.SUGGESTIONS[lang]}


@app.post("/api/admin/dorms/{dorm_id}/ask")
def ask(dorm_id: int, body: AskIn, request: Request):
    aid = require_dorm_access(request, dorm_id)
    n = one("SELECT count(*) AS n FROM security_events WHERE type='ai_question' AND detail=%s "
            "AND occurred_at > now() - interval '10 minutes'", (f"admin={aid}",))["n"]
    if n >= AI_LIMIT_PER_10MIN:
        raise ApiError(429, "rate_limited", "ถามถี่เกินไป กรุณารอสักครู่")
    log_event("ai_question", client_ip(request), dorm_id, f"admin={aid}")
    intent = insight.detect_intent(body.question)
    with tenant_tx(dorm_id) as c:            # RLS: facts can only come from this dorm
        facts = insight.gather(c, intent, body.lang)
    draft = insight.template(facts, body.lang)          # always correct: built only from FACTS
    answer = insight.llm(body.question, draft, body.lang, insight._labels(facts))  # optional nicer wording
    return {"answer": answer or draft, "source": "ai" if answer else "template", "intent": intent, "facts": facts}
