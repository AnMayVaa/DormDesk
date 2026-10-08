"""Owner / manager login with REVOCABLE server-side sessions.

Cookie dd_session = random 256-bit token (HttpOnly, Secure, SameSite=Strict). The database stores only
sha256(token), so a database leak does not reveal usable cookies. Every request checks the row:
logout, "sign out other devices" or an owner revoking a session takes effect immediately on both API servers.
Absolute lifetime 8 h, idle timeout 2 h.
"""
import hashlib
import secrets
from typing import Optional

import bcrypt
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from .core import ApiError, client_ip, log_event, one, pool

router = APIRouter()
COOKIE = "dd_session"
SESSION_HOURS = 8
IDLE_MINUTES = 120
LOGIN_FAIL_LIMIT = 5
DUMMY_HASH = bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt())
COOKIE_SECURE = True


def configure(cookie_secure: bool):
    global COOKIE_SECURE
    COOKIE_SECURE = cookie_secure


def _sid(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def current_session(request: Request) -> Optional[dict]:
    tok = request.cookies.get(COOKIE)
    if not tok or len(tok) > 100:
        return None
    sid = _sid(tok)
    with pool.connection() as c:
        s = c.execute("SELECT id, admin_id, last_seen_at FROM admin_sessions WHERE id=%s AND revoked_at IS NULL "
                      "AND expires_at > now() AND last_seen_at > now() - make_interval(mins => %s)",
                      (sid, IDLE_MINUTES)).fetchone()
        if s:   # sliding idle timeout, written at most once a minute
            c.execute("UPDATE admin_sessions SET last_seen_at=now() WHERE id=%s AND last_seen_at < now() - interval '1 minute'",
                      (sid,))
    return s


def require_admin(request: Request) -> int:
    s = current_session(request)
    if not s:
        raise ApiError(401, "unauthenticated", "กรุณาเข้าสู่ระบบ")
    request.state.session_id = s["id"]
    return int(s["admin_id"])


def require_dorm_access(request: Request, dorm_id: Optional[int]) -> int:
    aid = require_admin(request)
    if dorm_id is None:
        raise ApiError(404, "not_found", "ไม่พบข้อมูล")
    ok = one("SELECT 1 FROM admin_dorms WHERE admin_id=%s AND dorm_id=%s", (aid, dorm_id))
    if not ok:
        log_event("cross_tenant", client_ip(request), dorm_id, f"admin={aid} path={request.url.path}")
        raise ApiError(403, "forbidden", "ไม่มีสิทธิ์เข้าถึงหอนี้")
    return aid


def scoped(request: Request, kind: str, obj_id: int) -> tuple:
    """Admin endpoint addressed by an object id (bill, fine, permit…): find its dorm, then check access."""
    aid = require_admin(request)
    d = one("SELECT entity_dorm(%s, %s) AS d", (kind, obj_id))["d"]
    if d is None:
        raise ApiError(404, "not_found", "ไม่พบข้อมูล")
    require_dorm_access(request, d)
    return d, aid


class LoginIn(BaseModel):
    email: str = Field(..., max_length=254)
    password: str = Field(..., max_length=200)


@router.post("/api/auth/login")
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
    token = secrets.token_urlsafe(32)
    with pool.connection() as c:
        c.execute("INSERT INTO admin_sessions (id, admin_id, expires_at, ip, user_agent) "
                  "VALUES (%s,%s, now() + make_interval(hours => %s), %s, %s)",
                  (_sid(token), admin["id"], SESSION_HOURS, ip, (request.headers.get("user-agent") or "")[:200]))
    response.set_cookie(COOKIE, token, max_age=SESSION_HOURS * 3600, httponly=True, secure=COOKIE_SECURE,
                        samesite="strict", path="/")
    log_event("login_ok", ip, None, f"admin={admin['id']}")
    return {"display_name": admin["display_name"]}


@router.post("/api/auth/logout")
def logout(request: Request, response: Response):
    tok = request.cookies.get(COOKIE)
    if tok:
        with pool.connection() as c:
            c.execute("UPDATE admin_sessions SET revoked_at=now() WHERE id=%s AND revoked_at IS NULL", (_sid(tok),))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/api/auth/me")
def me(request: Request):
    aid = require_admin(request)
    a = one("SELECT email, display_name FROM admins WHERE id=%s", (aid,))
    if not a:
        raise ApiError(401, "unauthenticated", "กรุณาเข้าสู่ระบบ")
    return a


@router.get("/api/auth/sessions")
def sessions(request: Request):
    aid = require_admin(request)
    with pool.connection() as c:
        rows = c.execute("SELECT id, created_at, last_seen_at, expires_at, ip, user_agent FROM admin_sessions "
                         "WHERE admin_id=%s AND revoked_at IS NULL AND expires_at > now() "
                         "AND last_seen_at > now() - make_interval(mins => %s) ORDER BY last_seen_at DESC",
                         (aid, IDLE_MINUTES)).fetchall()
    cur = request.state.session_id
    return [{"id": r["id"][:16], "current": r["id"] == cur, "created_at": r["created_at"], "last_seen_at": r["last_seen_at"],
             "ip": r["ip"], "device": (r["user_agent"] or "")[:120]} for r in rows]


@router.post("/api/auth/sessions/{short_id}/revoke")
def revoke(short_id: str, request: Request):
    aid = require_admin(request)
    if len(short_id) != 16:
        raise ApiError(404, "not_found", "ไม่พบเซสชัน")
    with pool.connection() as c:
        n = c.execute("UPDATE admin_sessions SET revoked_at=now() WHERE admin_id=%s AND left(id,16)=%s AND revoked_at IS NULL",
                      (aid, short_id)).rowcount
    if not n:
        raise ApiError(404, "not_found", "ไม่พบเซสชัน")
    log_event("session_revoked", client_ip(request), None, f"admin={aid}")
    return {"ok": True}


@router.post("/api/auth/sessions/revoke-others")
def revoke_others(request: Request):
    aid = require_admin(request)
    with pool.connection() as c:
        n = c.execute("UPDATE admin_sessions SET revoked_at=now() WHERE admin_id=%s AND id<>%s AND revoked_at IS NULL",
                      (aid, request.state.session_id)).rowcount
    log_event("session_revoked", client_ip(request), None, f"admin={aid} others={n}")
    return {"revoked": n}
