"""Shared plumbing for every DormDesk API module: DB pool, tenant transactions, errors, settings, time.

Isolation rules (HANDOFF section 6):
- dorm_id comes only from a room code, a tracking token, or an admin session checked against admin_dorms
- every tenant/owner query runs inside tenant_tx(), which SET LOCALs app.dorm_id (and app.tenancy_id for tenants),
  so PostgreSQL Row-Level Security filters every row even if a query forgets a WHERE clause
"""
import json
import os
import socket
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import Request
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

DATABASE_URL = os.environ["DATABASE_URL"]
HOSTNAME = socket.gethostname()
VERSION = "2.1.0"
BKK = ZoneInfo("Asia/Bangkok")

# The DSN lists db-01 AND db-02 with target_session_attrs=read-write: libpq connects to whichever is the
# primary, so after a failover the API follows the promoted standby without a config change.
pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=5, open=False, check=ConnectionPool.check_connection,
                      kwargs={"row_factory": dict_row, "autocommit": True}, reconnect_timeout=30)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, extra: Optional[dict] = None):
        self.status, self.code, self.message, self.extra = status, code, message, extra or {}


@contextmanager
def tenant_tx(dorm_id: int, tenancy_id: Optional[int] = None):
    """Transaction scoped to one dorm (and, for tenant requests, one tenancy). SET LOCAL disappears at COMMIT,
    so a pooled connection never carries one dorm's setting into the next request."""
    with pool.connection() as conn:
        with conn.transaction():
            conn.execute("SELECT set_config('app.dorm_id', %s, true)", (str(int(dorm_id)),))
            conn.execute("SELECT set_config('app.tenancy_id', %s, true)",
                         (str(int(tenancy_id)) if tenancy_id else "",))
            yield conn


def one(sql, params=()):
    with pool.connection() as conn:
        return conn.execute(sql, params).fetchone()


def client_ip(request: Request) -> str:
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "-")


def log_event(etype: str, ip: str, dorm_id: Optional[int] = None, detail: Optional[str] = None):
    try:
        with pool.connection() as conn:
            conn.execute("INSERT INTO security_events (type, ip, dorm_id, detail) VALUES (%s,%s,%s,%s)",
                         (etype, ip, dorm_id, (detail or "")[:200]))
    except Exception:
        pass  # logging must never break the request


def mask_token(t: str) -> str:
    return (t[:4] + "…") if t else ""


# ---------------------------------------------------------------- time (business rules use Bangkok local time)
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_bkk() -> date:
    return datetime.now(BKK).date()


def period_of(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def next_period(p: str) -> str:
    y, m = map(int, p.split("-"))
    return f"{y + (m == 12):04d}-{(m % 12) + 1:02d}"


def week_start(d: date) -> date:          # Monday (spec: quota counted Mon–Sun)
    return d - timedelta(days=d.weekday())


# ---------------------------------------------------------------- per-dorm settings + feature switches
FEATURES = ("fitness", "pool", "spaces", "parking", "bills", "fines")


def settings(c, dorm_id: int) -> dict:
    s = c.execute("SELECT * FROM dorm_settings WHERE dorm_id=%s", (dorm_id,)).fetchone()
    if not s:
        c.execute("INSERT INTO dorm_settings (dorm_id) VALUES (%s) ON CONFLICT DO NOTHING", (dorm_id,))
        s = c.execute("SELECT * FROM dorm_settings WHERE dorm_id=%s", (dorm_id,)).fetchone()
    return s


def features_of(s: dict) -> dict:
    return {f: bool(s["f_" + f]) for f in FEATURES}


def require_feature(s: dict, *names: str):
    """A switched-off feature is refused by the API itself (403), not just hidden in the UI."""
    if not any(s["f_" + n] for n in names):
        raise ApiError(403, "feature_disabled", "หอนี้ไม่ได้เปิดใช้ฟีเจอร์นี้")


# ---------------------------------------------------------------- idempotency for POSTs that Nginx may retry
class Idem:
    """Usage inside a tenant_tx:  hit = Idem(c, dorm_id, "scope", request); if hit.done: return hit.response
    ... work ...; return hit.save(result).  The key row is inserted first in the same transaction, so a retry that
    arrives while the first attempt is still running waits on the unique index, then reads the saved response."""

    def __init__(self, c, dorm_id: int, scope: str, request: Request):
        self.c, self.dorm_id, self.scope = c, dorm_id, scope
        self.key = (request.headers.get("idempotency-key") or "").strip()[:64] or None
        self.done, self.response = False, None
        if not self.key:
            return
        row = c.execute("INSERT INTO idem_keys (dorm_id, scope, key) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING "
                        "RETURNING key", (dorm_id, scope, self.key)).fetchone()
        if row is None:
            prev = c.execute("SELECT response FROM idem_keys WHERE dorm_id=%s AND scope=%s AND key=%s",
                             (dorm_id, scope, self.key)).fetchone()
            if prev and prev["response"] is not None:
                self.done, self.response = True, prev["response"]
            else:
                raise ApiError(409, "in_progress", "คำขอนี้กำลังดำเนินการ กรุณารอสักครู่")

    def save(self, result):
        if self.key:
            self.c.execute("UPDATE idem_keys SET response=%s, status=200 WHERE dorm_id=%s AND scope=%s AND key=%s",
                           (json.dumps(result, default=str), self.dorm_id, self.scope, self.key))
        return result


def baht(satang: int) -> str:
    return f"{satang / 100:,.2f}"
