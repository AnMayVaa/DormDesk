"""Business rules shared by the tenant API, the owner API and the background job.

No scheduler is needed for correctness: every time-based state is *settled* (materialised) whenever someone
reads it — check-ins expire by time, a booking not confirmed within N minutes becomes a no-show, a parking
cancellation ends after N days. The background job (jobs.py) runs the same settle functions every minute only
so that e-mails go out and dashboards are fresh even when nobody opens a page.
"""
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
from typing import Optional

from .core import BKK, ApiError, next_period, now_utc, today_bkk, week_start

PRESET_LABEL = {"rent": "ค่าเช่าห้อง", "water": "ค่าน้ำ", "electric": "ค่าไฟ", "common": "ค่าส่วนกลาง",
                "parking": "ค่าที่จอดรถ", "fine": "ค่าปรับ", "late_fee": "ค่าปรับจ่ายช้า", "adjust": "ปรับยอด",
                "other": "อื่น ๆ"}
FINE_PRESET = {"late": "จ่ายช้า", "damage": "ทำของเสียหาย", "noise": "เสียงดังรบกวน", "parking": "ผิดกฎที่จอด", "other": "อื่น ๆ"}
VTYPE = {"car": "รถยนต์", "moto": "มอเตอร์ไซค์"}


@contextmanager
def dorm_scope(c):
    """Inside a tenant request, temporarily lift the tenancy filter to compute DORM-WIDE AGGREGATES only
    (how many people are in the gym, which booking slots are taken, parking spaces left, queue position).
    Callers must return counts / free-busy flags, never other tenants' rows."""
    prev = c.execute("SELECT current_setting('app.tenancy_id', true) AS t").fetchone()["t"] or ""
    c.execute("SELECT set_config('app.tenancy_id', '', true)")
    try:
        yield c
    finally:
        c.execute("SELECT set_config('app.tenancy_id', %s, true)", (prev,))


def bkk_dt(d: date, t: time) -> datetime:
    return datetime.combine(d, t, tzinfo=BKK)


def is_open_now(f: dict) -> bool:
    if not f["enabled"] or f["closed_note"]:
        return False
    now_t = datetime.now(BKK).time()
    return f["open_from"] <= now_t < f["open_to"]


# ================================================================ check-ins (fitness / pool)
def active_checkins_sql(where: str) -> str:
    return (f"SELECT c.id, c.facility_id, f.name AS facility, f.kind, c.started_at, c.expires_at FROM checkins c "
            f"JOIN facilities f ON f.id=c.facility_id WHERE c.checked_out_at IS NULL AND c.expires_at > now() AND {where}")


# ================================================================ bookings
def settle_bookings(c, s: dict) -> list:
    """booked + not confirmed within booking_confirm_min after start => no_show (frees the rest of the slot).
    Then apply the strike rule: strike_limit no-shows / late cancels within strike_window_d => ban for ban_days.
    Returns tenancy ids that just got banned (for e-mail)."""
    with dorm_scope(c):   # settle the whole dorm, so free/busy is right for everyone; nothing is returned to the tenant
        rows = c.execute("UPDATE bookings SET status='no_show' WHERE status='booked' "
                         "AND starts_at + make_interval(mins => %s) < now() RETURNING tenancy_id",
                         (s["booking_confirm_min"],)).fetchall()
        banned = []
        for t in {r["tenancy_id"] for r in rows}:
            if apply_strikes(c, s, t):
                banned.append(t)
    return banned


def strikes(c, s: dict, tenancy_id: int) -> int:
    """strikes inside the window, counted only AFTER the last ban started (a ban 'uses up' its strikes)."""
    cut = c.execute("SELECT max(starts_at) AS t FROM booking_bans WHERE tenancy_id=%s", (tenancy_id,)).fetchone()["t"]
    return c.execute("SELECT count(*) AS n FROM bookings WHERE tenancy_id=%s AND status IN ('no_show','cancelled_late') "
                     "AND starts_at > now() - make_interval(days => %s) AND (%s::timestamptz IS NULL OR "
                     "COALESCE(cancelled_at, starts_at) > %s)",
                     (tenancy_id, s["strike_window_d"], cut, cut)).fetchone()["n"]


def active_ban(c, tenancy_id: int) -> Optional[dict]:
    return c.execute("SELECT id, until FROM booking_bans WHERE tenancy_id=%s AND lifted_at IS NULL AND until > now() "
                     "ORDER BY until DESC LIMIT 1", (tenancy_id,)).fetchone()


def apply_strikes(c, s: dict, tenancy_id: int) -> bool:
    if active_ban(c, tenancy_id) or strikes(c, s, tenancy_id) < s["strike_limit"]:
        return False
    dorm = c.execute("SELECT dorm_id FROM tenancies WHERE id=%s", (tenancy_id,)).fetchone()["dorm_id"]
    c.execute("INSERT INTO booking_bans (dorm_id, tenancy_id, until) VALUES (%s,%s, now() + make_interval(days => %s))",
              (dorm, tenancy_id, s["ban_days"]))
    return True


def quota(c, s: dict, tenancy_id: int, day: Optional[date] = None) -> dict:
    ws = week_start(day or today_bkk())
    start, end = bkk_dt(ws, time(0)), bkk_dt(ws + timedelta(days=7), time(0))
    used = c.execute("SELECT count(*) AS n FROM bookings WHERE tenancy_id=%s AND starts_at >= %s AND starts_at < %s "
                     "AND status IN ('booked','confirmed','no_show','cancelled_late')", (tenancy_id, start, end)).fetchone()["n"]
    extra = c.execute("SELECT extra FROM booking_quota_extra WHERE tenancy_id=%s AND week_start=%s",
                      (tenancy_id, ws)).fetchone()
    total = s["booking_per_week"] + (extra["extra"] if extra else 0)
    return {"week_start": ws.isoformat(), "used": used, "total": total, "left": max(0, total - used)}


def slots_for(f: dict, day: date) -> list:
    out, step = [], timedelta(minutes=f["slot_minutes"])
    t = bkk_dt(day, f["open_from"])
    close = bkk_dt(day, f["open_to"])
    while t + step <= close:
        out.append((t, t + step))
        t += step
    return out


# ================================================================ parking
def settle_permits(c) -> list:
    """cancel_notice ends when the tenant acknowledged OR the notice period passed (whichever first)."""
    with dorm_scope(c):
        return c.execute("UPDATE parking_permits SET status='cancelled', cancelled_at=LEAST(COALESCE(ack_at, cancel_due_at), now()), "
                         "updated_at=now() WHERE status='cancel_notice' AND (ack_at IS NOT NULL OR cancel_due_at <= now()) "
                         "RETURNING id, tenancy_id").fetchall()


def lot_usage(c) -> dict:
    """dorm-wide count of spaces in use (call inside dorm_scope for tenants)."""
    rows = c.execute("SELECT vtype, count(*) AS n FROM parking_permits WHERE status IN ('active','cancel_notice') "
                     "GROUP BY vtype").fetchall()
    used = {"car": 0, "moto": 0}
    used.update({r["vtype"]: r["n"] for r in rows})
    return used


def room_usage(c, tenancy_id: int) -> dict:
    rows = c.execute("SELECT vtype, count(*) AS n FROM parking_permits WHERE tenancy_id=%s AND status IN ('active','cancel_notice') "
                     "GROUP BY vtype", (tenancy_id,)).fetchall()
    used = {"car": 0, "moto": 0}
    used.update({r["vtype"]: r["n"] for r in rows})
    return used


# ================================================================ bills
def effective_status(b: dict) -> str:
    if b["status"] in ("unpaid", "returned") and b["due_date"] < today_bkk():
        return "overdue"
    return b["status"]


def recalc(c, bill_id: int) -> int:
    total = c.execute("SELECT COALESCE(sum(amount),0) AS t FROM bill_lines WHERE bill_id=%s AND sort >= 0", (bill_id,)).fetchone()["t"]
    c.execute("UPDATE bills SET total=%s, updated_at=now() WHERE id=%s", (total, bill_id))
    return total


def due_date_for(period: str, s: dict) -> date:
    y, m = map(int, period.split("-"))
    return date(y, m, s["bill_due_day"])


def build_monthly_bill(c, s: dict, room: dict, tenancy_id: int, period: str) -> Optional[dict]:
    """Create a DRAFT monthly bill with the automatic lines. Returns {id, needs_meter} or None if it exists.
    unique (room, tenancy, period) makes this safe even if two API servers run it at the same time."""
    row = c.execute("INSERT INTO bills (dorm_id, tenancy_id, room_id, period, kind, status, due_date) "
                    "VALUES (%s,%s,%s,%s,'monthly','draft',%s) ON CONFLICT (room_id, tenancy_id, period) DO NOTHING RETURNING id",
                    (room["dorm_id"], tenancy_id, room["id"], period, due_date_for(period, s))).fetchone()
    if not row:
        return None
    bid = row["id"]
    lines, needs_meter = [], False
    if room["rent"]:
        lines.append(("rent", PRESET_LABEL["rent"], "", room["rent"], None, None))
    meter = c.execute("SELECT water_units, elec_units FROM meter_readings WHERE room_id=%s AND period=%s",
                      (room["id"], period)).fetchone() or {}
    for preset, mode, rate, flat, units in (("water", s["water_mode"], s["water_rate"], s["water_flat"], meter.get("water_units")),
                                            ("electric", s["elec_mode"], s["elec_rate"], s["elec_flat"], meter.get("elec_units"))):
        if mode == "flat" and flat:
            lines.append((preset, PRESET_LABEL[preset], "เหมาจ่าย", flat, None, None))
        elif mode == "meter":
            if units is None:
                needs_meter = True
            else:
                lines.append((preset, PRESET_LABEL[preset], f"{units:g} หน่วย", int(round(float(units) * rate)), None, None))
    if s["common_fee"]:
        lines.append(("common", PRESET_LABEL["common"], "", s["common_fee"], None, None))
    if s["f_parking"]:
        for p in c.execute("SELECT id, plate, vtype, fee FROM parking_permits WHERE tenancy_id=%s AND status='active' AND fee > 0",
                           (tenancy_id,)).fetchall():
            lines.append(("parking", f"ค่าที่จอด{VTYPE[p['vtype']]}", p["plate"], p["fee"], "permit", p["id"]))
    if s["f_fines"]:
        for f in c.execute("SELECT id, title, amount FROM fines WHERE tenancy_id=%s AND billing='next_bill' "
                           "AND status IN ('open','confirmed') AND bill_id IS NULL", (tenancy_id,)).fetchall():
            lines.append(("fine", PRESET_LABEL["fine"], f["title"], f["amount"], "fine", f["id"]))
            c.execute("UPDATE fines SET status='billed', bill_id=%s, updated_at=now() WHERE id=%s", (bid, f["id"]))
    for b in c.execute("SELECT id, period, late_fee FROM bills WHERE tenancy_id=%s AND late_fee > 0 AND NOT late_fee_billed",
                       (tenancy_id,)).fetchall():
        lines.append(("late_fee", PRESET_LABEL["late_fee"], f"งวด {b['period']}", b["late_fee"], "bill", b["id"]))
        c.execute("UPDATE bills SET late_fee_billed=true WHERE id=%s", (b["id"],))
    for i, (preset, label, note, amount, rt, rid) in enumerate(lines):
        c.execute("INSERT INTO bill_lines (dorm_id, bill_id, preset, label, note, amount, ref_type, ref_id, sort) "
                  "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)", (room["dorm_id"], bid, preset, label, note, amount, rt, rid, i))
    recalc(c, bid)
    return {"id": bid, "needs_meter": needs_meter}


def issue_bill(c, bill_id: int) -> bool:
    return bool(c.execute("UPDATE bills SET status='unpaid', issued_at=now(), updated_at=now() WHERE id=%s AND status='draft' "
                          "RETURNING id", (bill_id,)).fetchone())


def late_fee_for(s: dict, due: date, paid: date) -> int:
    if not s["late_fee_enabled"]:
        return 0
    days = (paid - due).days - s["late_fee_grace_d"]
    return max(0, days) * s["late_fee_per_day"]


def next_receipt_no(c, dorm_id: int) -> str:
    v = c.execute("INSERT INTO dorm_counters (dorm_id, name, value) VALUES (%s,'receipt',1) "
                  "ON CONFLICT (dorm_id, name) DO UPDATE SET value = dorm_counters.value + 1 RETURNING value",
                  (dorm_id,)).fetchone()["value"]
    d = today_bkk()
    return f"DD{dorm_id:02d}-{d:%y%m}-{v:04d}"


def bill_lines(c, bill_id: int) -> list:
    return c.execute("SELECT id, preset, label, note, amount FROM bill_lines WHERE bill_id=%s AND sort >= 0 ORDER BY sort, id",
                     (bill_id,)).fetchall()


def thread(c, subject_type: str, subject_id: int) -> list:
    return c.execute("SELECT author, body, created_at FROM messages WHERE subject_type=%s AND subject_id=%s "
                     "ORDER BY created_at, id", (subject_type, subject_id)).fetchall()


def post_message(c, dorm_id: int, tenancy_id: int, subject_type: str, subject_id: int, author: str, body: str):
    body = (body or "").strip()
    if not 1 <= len(body) <= 1000:
        raise ApiError(400, "bad_message", "ข้อความต้องยาว 1–1000 ตัวอักษร")
    c.execute("INSERT INTO messages (dorm_id, tenancy_id, subject_type, subject_id, author, body) VALUES (%s,%s,%s,%s,%s,%s)",
              (dorm_id, tenancy_id, subject_type, subject_id, author, body))


def plate_ok(p: str) -> str:
    p = " ".join((p or "").split())
    if not 2 <= len(p) <= 16:
        raise ApiError(400, "bad_plate", "ทะเบียนรถไม่ถูกต้อง")
    return p


__all__ = ["dorm_scope", "settle_bookings", "settle_permits", "build_monthly_bill", "issue_bill", "next_period"]
