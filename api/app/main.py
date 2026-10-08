"""DormDesk REST API (FastAPI) — runs on api-01 / api-02 in the private subnet.

Rules (see docs/DormDesk_HANDOFF.md section 6):
- dorm_id comes only from the room code, the tracking token, or the admin session (checked against admin_dorms)
- every tenant query runs inside tenant_tx(), which does SET LOCAL app.dorm_id (+ app.tenancy_id) so PostgreSQL RLS filters rows
- the API keeps no state on disk: sessions live in the database, photos/slips in the object store (encrypted)
Modules: auth (revocable sessions) · tenant (room hub) · admin_features (owner tools) · jobs (background) · storage (S3)
"""
import logging
import os
import re
import secrets
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, Query, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import admin_features, auth, insight, jobs, notify, storage, tenant
from .auth import require_admin, require_dorm_access
from .core import (HOSTNAME, VERSION, ApiError, client_ip, features_of, log_event, mask_token, one, pool, settings,
                   tenant_tx)
from .images import read_images

# ---------------------------------------------------------------- config
auth.configure(os.environ.get("COOKIE_SECURE", "1") == "1")
ROOM_LIMIT = int(os.environ.get("ROOM_LIMIT_PER_10MIN", "5"))
MAX_PHOTOS = 3
MAX_TOTAL_BYTES = 5 * 1024 * 1024
STATUSES = ("received", "in_progress", "done", "rejected")
PRIORITIES = ("normal", "urgent")
RUN_JOBS = os.environ.get("RUN_JOBS", "1") == "1"


@asynccontextmanager
async def lifespan(_app):
    pool.open(wait=False)
    if RUN_JOBS:
        jobs.start()
    yield
    jobs.stop()
    pool.close()


app = FastAPI(title="DormDesk API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(auth.router)
app.include_router(tenant.router)
app.include_router(admin_features.router)


# ---------------------------------------------------------------- errors: one format everywhere
def err(status, code, message, extra=None):
    body = {"error": {"code": code, "message": message, **(extra or {})}}
    return JSONResponse(body, status_code=status)


@app.exception_handler(ApiError)
async def _api_error(_req, e: ApiError):
    return err(e.status, e.code, e.message, e.extra)


@app.exception_handler(storage.StorageError)
async def _storage_error(_req, e):
    return err(503, "storage_unavailable", "ระบบเก็บรูปไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่")


@app.exception_handler(RequestValidationError)
async def _validation_error(_req, e: RequestValidationError):
    first = e.errors()[0] if e.errors() else {}
    field = ".".join(str(x) for x in first.get("loc", [])[1:]) or "input"
    return err(422, "validation_error", f"ข้อมูลไม่ถูกต้อง: {field}")


@app.exception_handler(StarletteHTTPException)
async def _http_error(_req, e: StarletteHTTPException):
    return err(e.status_code, "http_error", str(e.detail))


@app.exception_handler(Exception)
async def _unhandled(req, e: Exception):
    logging.getLogger("dormdesk").error("unhandled %s %s", req.method, req.url.path, exc_info=e)   # path only, no query/body
    return err(500, "internal_error", "เกิดข้อผิดพลาดภายในระบบ")


# ---------------------------------------------------------------- health
@app.get("/api/health")
def health():
    db, role = "ok", None
    try:
        role = one("SELECT CASE WHEN pg_is_in_recovery() THEN 'standby' ELSE 'primary' END AS r, host(inet_server_addr()) AS a")
    except Exception:
        db = "down"
    st = "off" if not storage.enabled() else ("ok" if storage.ping() else "down")
    return {"status": "ok" if db == "ok" else "degraded", "db": db, "db_host": role and role["a"], "storage": st,
            "served_by": HOSTNAME, "version": VERSION}


# ================================================================= TENANT: repair requests (v1, now per tenancy)
@app.get("/api/rooms/{code}")
def room_info(code: str, request: Request):
    dorm_id, room_id, t = tenant.room_ctx(request, code)
    with tenant_tx(dorm_id, t) as c:
        room = c.execute("SELECT r.room_no, d.name AS dorm_name FROM rooms r JOIN dorms d ON d.id=r.dorm_id "
                         "WHERE r.id=%s", (room_id,)).fetchone()
        cats = c.execute("SELECT c.id, c.name_th FROM categories c JOIN dorm_categories dc ON dc.category_id=c.id "
                         "WHERE dc.enabled ORDER BY c.sort").fetchall()
        feats = features_of(settings(c, dorm_id))
    return {"dorm_name": room["dorm_name"], "room_no": room["room_no"], "categories": cats, "features": feats}


PHONE_RE = re.compile(r"^[0-9+\-\s]{9,20}$")
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$")


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
    dorm_id, room_id, tenancy_id = tenant.room_ctx(request, code)

    if consent not in ("true", "on", "1", "yes"):
        raise ApiError(400, "consent_required", "กรุณายินยอมให้เก็บข้อมูลเพื่อใช้ติดต่อเรื่องแจ้งซ่อม")
    if not PHONE_RE.match(reporter_phone.strip()):
        raise ApiError(400, "bad_phone", "เบอร์โทรไม่ถูกต้อง")
    email = reporter_email.strip() or None
    if email and not EMAIL_RE.match(email):
        raise ApiError(400, "bad_email", "อีเมลไม่ถูกต้อง")
    cleaned = await read_images(photos, MAX_PHOTOS, MAX_TOTAL_BYTES)

    # Idempotency-Key: the browser sends one random key per form submission. If Nginx retries the POST on the
    # other API instance (failover), or the tenant double-clicks, the same key returns the same request.
    idem = (request.headers.get("idempotency-key") or "").strip()[:64] or None
    token = secrets.token_urlsafe(16)
    with tenant_tx(dorm_id, tenancy_id) as c:
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
            "INSERT INTO requests (dorm_id, room_id, tenancy_id, category_id, title, detail, reporter_name, reporter_phone, "
            "reporter_email, consent_at, tracking_token, idem_key) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),%s,%s) RETURNING id",
            (dorm_id, room_id, tenancy_id, category_id, title.strip(), detail.strip(), reporter_name.strip(),
             reporter_phone.strip(), email, token, idem)).fetchone()["id"]
        c.execute("INSERT INTO request_events (dorm_id, request_id, from_status, to_status, actor) "
                  "VALUES (%s,%s,NULL,'received','tenant')", (dorm_id, rid))
        for mime, data in cleaned:
            if storage.enabled():     # v2: encrypted object store; v1 fallback: bytea in PostgreSQL
                oid = storage.save_object(c, dorm_id, "request_photo", mime, data)
                c.execute("INSERT INTO request_photos (dorm_id, request_id, mime, size, object_id) VALUES (%s,%s,%s,%s,%s)",
                          (dorm_id, rid, mime, len(data), oid))
            else:
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
    return row["dorm_id"], row["request_id"], row["tenancy_id"]


@app.get("/api/track/{token}")
def track(token: str, request: Request):
    dorm_id, rid, t = resolve_tracking(request, token)
    with tenant_tx(dorm_id, t) as c:
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
    p = c.execute("SELECT mime, data, object_id FROM request_photos WHERE id=%s AND request_id=%s",
                  (photo_id, request_id)).fetchone()
    if not p:
        raise ApiError(404, "not_found", "ไม่พบรูป")
    if p["object_id"]:
        try:
            mime, data = storage.load_object(c, p["object_id"])
        except LookupError:
            raise ApiError(404, "not_found", "ไม่พบรูป")
    else:
        mime, data = p["mime"], bytes(p["data"])
    return Response(data, media_type=mime, headers={"Cache-Control": "private, max-age=3600"})


@app.get("/api/track/{token}/photos/{photo_id}")
def track_photo(token: str, photo_id: int, request: Request):
    dorm_id, rid, t = resolve_tracking(request, token)
    with tenant_tx(dorm_id, t) as c:
        return photo_response(c, rid, photo_id)


# ================================================================= ADMIN (repair requests, rooms, categories)
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
           "c.name_th AS category, rm.room_no, (t.ended_at IS NOT NULL) AS prev_tenant, "
           "(SELECT count(*) FROM request_photos p WHERE p.request_id=q.id) AS photo_count "
           "FROM requests q JOIN categories c ON c.id=q.category_id JOIN rooms rm ON rm.id=q.room_id "
           "JOIN tenancies t ON t.id=q.tenancy_id WHERE true")
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
        r = c.execute("SELECT q.*, c.name_th AS category, rm.room_no, (t.ended_at IS NOT NULL) AS prev_tenant FROM requests q "
                      "JOIN categories c ON c.id=q.category_id JOIN rooms rm ON rm.id=q.room_id JOIN tenancies t ON t.id=q.tenancy_id "
                      "WHERE q.id=%s", (rid,)).fetchone()
        r.pop("tracking_token", None)
        r.pop("idem_key", None)
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
        repeat_rooms = c.execute(   # per ROOM across tenancies on purpose: a room that keeps breaking needs new equipment
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
            "SELECT r.id, r.room_no, r.room_code, r.code_rotated_at, r.rent, t.started_at AS tenancy_started, "
            "(SELECT count(*) FROM tenancies p WHERE p.room_id=r.id AND p.ended_at IS NOT NULL) AS previous_tenancies, "
            "(SELECT count(*) FROM requests q WHERE q.room_id=r.id AND q.status IN ('received','in_progress')) AS open "
            "FROM rooms r LEFT JOIN tenancies t ON t.room_id=r.id AND t.ended_at IS NULL ORDER BY r.room_no").fetchall()


class RoomIn(BaseModel):
    room_no: str = Field(..., min_length=1, max_length=20, pattern=r"^[0-9A-Za-z\-/ ]+$")


@app.post("/api/admin/dorms/{dorm_id}/rooms", status_code=201)
def create_room(dorm_id: int, body: RoomIn, request: Request):
    require_dorm_access(request, dorm_id)
    with tenant_tx(dorm_id) as c:
        if c.execute("SELECT 1 FROM rooms WHERE room_no=%s", (body.room_no.strip(),)).fetchone():
            raise ApiError(409, "duplicate", "มีห้องนี้อยู่แล้ว")
        r = c.execute("INSERT INTO rooms (dorm_id, room_no, room_code) VALUES (%s,%s,%s) "
                      "RETURNING id, room_no, room_code", (dorm_id, body.room_no.strip(), secrets.token_urlsafe(16))).fetchone()
        c.execute("INSERT INTO tenancies (dorm_id, room_id) VALUES (%s,%s)", (dorm_id, r["id"]))
        return r


@app.post("/api/admin/rooms/{room_id}/rotate-code")
def rotate_code(room_id: int, request: Request):
    """Link leaked, same tenant: new link, tenancy (and the tenant's data) unchanged. For a new tenant use new-tenancy."""
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
