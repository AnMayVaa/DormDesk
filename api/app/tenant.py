"""Tenant hub endpoints: everything behind the room link /r/{code} (no sign-up, the link is the key).

Every handler: resolve the room code -> (dorm, room, CURRENT tenancy) -> tenant_tx(dorm, tenancy).
RLS limits rows to the dorm, and the restrictive tenancy policy limits them to the current tenant, so a
new tenant starts from zero. Dorm-wide numbers (gym occupancy, free slots, parking spaces) are computed
inside dorm_scope() and only counts / free-busy flags are returned.
"""
import re
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, File, Query, Request, Response, UploadFile
from pydantic import BaseModel, Field

from . import notify, promptpay, storage
from .core import (BKK, ApiError, Idem, client_ip, features_of, log_event, mask_token, now_utc, one, require_feature,
                   settings, tenant_tx, today_bkk)
from .domain import (VTYPE, active_checkins_sql, active_ban, bill_lines, dorm_scope, effective_status, is_open_now,
                     lot_usage, plate_ok, post_message, quota, room_usage, settle_bookings, settle_permits, slots_for,
                     strikes, thread)
from .images import read_images

router = APIRouter()
EMAIL_OK = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$")


def room_ctx(request: Request, code: str):
    row = one("SELECT * FROM resolve_room(%s)", (code,)) if len(code) <= 64 else None
    if not row:
        log_event("bad_room_code", client_ip(request), None, mask_token(code))
        raise ApiError(404, "room_not_found", "ลิงก์ห้องไม่ถูกต้องหรือถูกเปลี่ยนแล้ว กรุณาติดต่อเจ้าของหอ")
    return row["dorm_id"], row["room_id"], row["tenancy_id"]


def contact(s):
    return {"phone": s["contact_phone"], "email": s["contact_email"]}


def owner_mail(dorm_id, subject, heading, lines, background, request):
    from .main import owner_recipients
    if not notify.enabled():
        return
    for to in owner_recipients(dorm_id):
        background.add_task(notify.generic, to, subject, heading, lines, "/admin", "เปิด DormDesk",
                            lambda why: log_event("email_failed", client_ip(request), dorm_id, why))


# ================================================================ home
@router.get("/api/rooms/{code}/home")
def home(code: str, request: Request):
    d, room_id, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        s = settings(c, d)
        feats = features_of(s)
        room = c.execute("SELECT r.room_no, dm.name AS dorm_name FROM rooms r JOIN dorms dm ON dm.id=r.dorm_id WHERE r.id=%s",
                         (room_id,)).fetchone()
        ten = c.execute("SELECT contact_email FROM tenancies WHERE id=%s", (t,)).fetchone()
        out = {"dorm_name": room["dorm_name"], "room_no": room["room_no"], "features": feats, "contact": contact(s),
               "notify_email": bool(ten["contact_email"]), "open_fines": [], "bill": None, "next_booking": None,
               "parking": None, "active_checkins": 0}
        if feats["fines"]:
            out["open_fines"] = c.execute("SELECT id, title, amount, status FROM fines WHERE status IN ('open','disputed') "
                                          "ORDER BY created_at DESC").fetchall()
        if feats["bills"]:
            b = c.execute("SELECT id, period, kind, status, due_date, total FROM bills WHERE status IN ('unpaid','returned','slip_sent') "
                          "ORDER BY due_date LIMIT 1").fetchone()
            if b:
                out["bill"] = {**b, "status": effective_status(b)}
        if feats["spaces"]:
            settle_bookings(c, s)
            out["next_booking"] = c.execute("SELECT b.id, f.name AS facility, b.starts_at, b.ends_at, b.status FROM bookings b "
                                            "JOIN facilities f ON f.id=b.facility_id WHERE b.status IN ('booked','confirmed') "
                                            "AND b.ends_at > now() ORDER BY b.starts_at LIMIT 1").fetchone()
        if feats["parking"]:
            settle_permits(c)
            used = room_usage(c, t)
            notice = c.execute("SELECT count(*) AS n FROM parking_permits WHERE status IN ('cancel_notice','returned')").fetchone()["n"]
            out["parking"] = {"used": used, "quota": {"car": s["quota_car"], "moto": s["quota_moto"]}, "attention": notice > 0}
        if feats["fitness"] or feats["pool"]:
            out["active_checkins"] = c.execute("SELECT count(*) AS n FROM checkins WHERE checked_out_at IS NULL AND expires_at > now()"
                                               ).fetchone()["n"]
    return out


class ContactIn(BaseModel):
    email: str = Field("", max_length=254)
    consent: bool = False


@router.post("/api/rooms/{code}/contact")
def set_contact(code: str, body: ContactIn, request: Request):
    d, _, t = room_ctx(request, code)
    email = body.email.strip()
    if email and (not EMAIL_OK.match(email) or not body.consent):
        raise ApiError(400, "bad_email", "อีเมลไม่ถูกต้อง หรือยังไม่ได้ยินยอม")
    with tenant_tx(d, t) as c:
        c.execute("UPDATE tenancies SET contact_email=%s, email_consent_at=CASE WHEN %s THEN now() END WHERE id=%s",
                  (email or None, bool(email), t))
    return {"notify_email": bool(email)}


# ================================================================ facilities: fitness / pool check-in
@router.get("/api/rooms/{code}/facilities")
def facilities(code: str, request: Request):
    d, _, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        s = settings(c, d)
        require_feature(s, "fitness", "pool", "spaces")
        kinds = [k for k, f in (("fitness", "f_fitness"), ("pool", "f_pool"), ("space", "f_spaces")) if s[f]]
        rows = c.execute("SELECT id, name, kind, capacity, open_from, open_to, slot_minutes, enabled, closed_note FROM facilities "
                         "WHERE kind = ANY(%s) ORDER BY sort, id", (kinds,)).fetchall()
        with dorm_scope(c):   # occupancy = dorm-wide COUNT only
            occ = {r["facility_id"]: r["n"] for r in c.execute(
                "SELECT facility_id, count(*) AS n FROM checkins WHERE checked_out_at IS NULL AND expires_at > now() "
                "GROUP BY facility_id").fetchall()}
        mine = c.execute(active_checkins_sql("true") + " ORDER BY c.started_at").fetchall()
        q = quota(c, s, t) if s["f_spaces"] else None
    fac = [{"id": r["id"], "name": r["name"], "kind": r["kind"], "capacity": r["capacity"],
            "hours": f"{r['open_from']:%H:%M}–{r['open_to']:%H:%M}", "open_now": is_open_now(r), "closed_note": r["closed_note"],
            "current": occ.get(r["id"], 0), "slot_minutes": r["slot_minutes"]} for r in rows if r["enabled"] or r["closed_note"]]
    return {"checkin": [f for f in fac if f["kind"] != "space"], "spaces": [f for f in fac if f["kind"] == "space"],
            "active": mine, "room_limit": s["checkin_per_room"], "checkin_hours": s["checkin_hours"], "quota": q}


class ScanIn(BaseModel):
    qr: str = Field(..., min_length=8, max_length=300)


def qr_token(raw: str) -> str:
    """QR content is https://<site>/q/<token>; accept the bare token too."""
    tok = raw.strip().rstrip("/").split("/q/")[-1].split("?")[0]
    if not 8 <= len(tok) <= 64:
        raise ApiError(400, "bad_qr", "QR นี้ไม่ใช่ของ DormDesk")
    return tok


@router.post("/api/rooms/{code}/checkins", status_code=201)
def checkin(code: str, body: ScanIn, request: Request):
    d, _, t = room_ctx(request, code)
    tok = qr_token(body.qr)
    with tenant_tx(d, t) as c:
        hit = Idem(c, d, "checkin", request)
        if hit.done:
            return hit.response
        s = settings(c, d)
        f = c.execute("SELECT * FROM facilities WHERE qr_token=%s", (tok,)).fetchone()   # RLS: only this dorm's QR codes
        if not f or f["kind"] == "space":
            log_event("bad_qr", client_ip(request), d, mask_token(tok))
            raise ApiError(404, "bad_qr", "QR นี้ใช้เช็กอินฟิตเนส/สระของหอนี้ไม่ได้")
        require_feature(s, f["kind"])
        if not is_open_now(f):
            raise ApiError(409, "closed", f["closed_note"] or "ตอนนี้อยู่นอกเวลาเปิด")
        c.execute("SELECT id FROM tenancies WHERE id=%s FOR UPDATE", (t,))     # serialise this room's check-ins (2 API servers)
        n = c.execute("SELECT count(*) AS n FROM checkins WHERE checked_out_at IS NULL AND expires_at > now()").fetchone()["n"]
        if n >= s["checkin_per_room"]:
            raise ApiError(409, "room_limit", f"ห้องนี้เช็กอินครบ {s['checkin_per_room']} คนแล้ว ให้คนใดคนหนึ่งเช็กเอาท์ก่อน หรือรอให้หมดเวลา")
        row = c.execute("INSERT INTO checkins (dorm_id, tenancy_id, facility_id, expires_at) "
                        "VALUES (%s,%s,%s, now() + make_interval(hours => %s)) RETURNING id, started_at, expires_at",
                        (d, t, f["id"], s["checkin_hours"])).fetchone()
        with dorm_scope(c):
            cur = c.execute("SELECT count(*) AS n FROM checkins WHERE facility_id=%s AND checked_out_at IS NULL AND expires_at > now()",
                            (f["id"],)).fetchone()["n"]
        full = bool(f["capacity"] and cur > f["capacity"])
        return hit.save({**row, "facility": f["name"], "kind": f["kind"], "full": full})


@router.get("/api/rooms/{code}/checkins/{cid}")
def checkin_pass(code: str, cid: int, request: Request):
    d, room_id, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        r = c.execute("SELECT c.id, f.name AS facility, f.kind, c.started_at, c.expires_at, c.checked_out_at, rm.room_no, "
                      "dm.name AS dorm_name FROM checkins c JOIN facilities f ON f.id=c.facility_id JOIN rooms rm ON rm.id=%s "
                      "JOIN dorms dm ON dm.id=c.dorm_id WHERE c.id=%s", (room_id, cid)).fetchone()
        if not r:
            raise ApiError(404, "not_found", "ไม่พบบัตรเช็กอิน")
        n = c.execute("SELECT count(*) AS n FROM checkins WHERE checked_out_at IS NULL AND expires_at > now()").fetchone()["n"]
        s = settings(c, d)
    active = r["checked_out_at"] is None and r["expires_at"] > now_utc()
    return {**r, "active": active, "room_active": n, "room_limit": s["checkin_per_room"]}


@router.post("/api/rooms/{code}/checkins/{cid}/checkout")
def checkout(code: str, cid: int, request: Request):
    d, _, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        c.execute("UPDATE checkins SET checked_out_at=now() WHERE id=%s AND checked_out_at IS NULL", (cid,))
    return {"ok": True}


# ================================================================ bookings (common spaces)
@router.get("/api/rooms/{code}/bookings")
def my_bookings(code: str, request: Request):
    d, _, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        s = settings(c, d)
        require_feature(s, "spaces")
        settle_bookings(c, s)
        items = c.execute("SELECT b.id, b.facility_id, f.name AS facility, b.starts_at, b.ends_at, b.status, b.confirmed_at FROM bookings b "
                          "JOIN facilities f ON f.id=b.facility_id WHERE b.starts_at > now() - interval '30 days' "
                          "ORDER BY (b.status IN ('booked','confirmed') AND b.ends_at > now()) DESC, b.starts_at DESC LIMIT 30").fetchall()
        ban = active_ban(c, t)
        q = quota(c, s, t)
        st = strikes(c, s, t)
    return {"quota": q, "strikes": st, "strike_limit": s["strike_limit"], "ban_days": s["ban_days"],
            "banned_until": ban["until"] if ban else None, "items": items, "contact": contact(s),
            "rules": {"confirm_min": s["booking_confirm_min"], "cancel_before_h": s["booking_cancel_before_h"],
                      "per_week": s["booking_per_week"], "window_d": s["strike_window_d"]}}


@router.get("/api/rooms/{code}/spaces/{fid}/slots")
def slots(code: str, fid: int, request: Request, day: date = Query(..., alias="date")):
    d, _, t = room_ctx(request, code)
    if not (today_bkk() <= day <= today_bkk() + timedelta(days=13)):
        raise ApiError(400, "bad_date", "จองล่วงหน้าได้ไม่เกิน 14 วัน")
    with tenant_tx(d, t) as c:
        s = settings(c, d)
        require_feature(s, "spaces")
        settle_bookings(c, s)
        f = c.execute("SELECT * FROM facilities WHERE id=%s AND kind='space'", (fid,)).fetchone()
        if not f:
            raise ApiError(404, "not_found", "ไม่พบห้องส่วนกลาง")
        mine = {r["starts_at"] for r in c.execute("SELECT starts_at FROM bookings WHERE facility_id=%s AND status IN ('booked','confirmed')",
                                                  (fid,)).fetchall()}
        with dorm_scope(c):   # free/busy only
            taken = [(r["starts_at"], r["ends_at"]) for r in c.execute(
                "SELECT starts_at, ends_at FROM bookings WHERE facility_id=%s AND status IN ('booked','confirmed') "
                "AND ends_at > now()", (fid,)).fetchall()]
    now = now_utc()
    out = []
    closed = not f["enabled"] or bool(f["closed_note"])
    for a, b in slots_for(f, day):
        if b <= now:
            continue
        state = "free"
        if a in mine:
            state = "mine"
        elif any(x < b and a < y for x, y in taken):
            state = "taken"
        elif closed:
            state = "closed"
        out.append({"start": a, "end": b, "state": state})
    return {"facility": f["name"], "closed_note": f["closed_note"], "slots": out}


class BookIn(BaseModel):
    space_id: int
    start: datetime


@router.post("/api/rooms/{code}/bookings", status_code=201)
def book(code: str, body: BookIn, request: Request, background: BackgroundTasks):
    d, _, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        hit = Idem(c, d, "booking", request)
        if hit.done:
            return hit.response
        s = settings(c, d)
        require_feature(s, "spaces")
        settle_bookings(c, s)
        f = c.execute("SELECT * FROM facilities WHERE id=%s AND kind='space'", (body.space_id,)).fetchone()
        if not f or not f["enabled"] or f["closed_note"]:
            raise ApiError(409, "closed", "ห้องนี้ปิดการจองอยู่")
        start = body.start
        if start.tzinfo is None:
            raise ApiError(400, "bad_time", "เวลาไม่ถูกต้อง")
        slot = next(((a, b) for a, b in slots_for(f, start.astimezone(BKK).date())
                     if a == start), None)
        if not slot or slot[1] <= now_utc() or start.date() > (today_bkk() + timedelta(days=14)):
            raise ApiError(400, "bad_slot", "ช่วงเวลานี้จองไม่ได้")
        ban = active_ban(c, t)
        if ban:
            raise ApiError(403, "banned", "งดการจองชั่วคราวเพราะจองแล้วไม่มาครบกำหนด", {"banned_until": str(ban["until"])})
        c.execute("SELECT id FROM tenancies WHERE id=%s FOR UPDATE", (t,))    # serialise quota checks for this room
        q = quota(c, s, t, start.astimezone(BKK).date())
        if q["left"] <= 0:
            raise ApiError(429, "quota", f"สัปดาห์นี้จองครบ {q['total']} ครั้งแล้ว")
        try:
            with c.transaction():   # savepoint: the exclusion constraint decides races between API servers
                row = c.execute("INSERT INTO bookings (dorm_id, tenancy_id, facility_id, starts_at, ends_at) VALUES (%s,%s,%s,%s,%s) "
                                "RETURNING id, starts_at, ends_at, status", (d, t, f["id"], slot[0], slot[1])).fetchone()
        except Exception as e:
            if "bookings_no_overlap" in str(e):
                raise ApiError(409, "taken", "มีคนจองช่วงนี้ไปแล้ว ลองช่วงอื่น")
            raise
        return hit.save({**row, "facility": f["name"]})


class ConfirmIn(BaseModel):
    qr: str = Field(..., min_length=8, max_length=300)


@router.post("/api/rooms/{code}/bookings/{bid}/confirm")
def confirm_booking(code: str, bid: int, body: ConfirmIn, request: Request):
    d, _, t = room_ctx(request, code)
    tok = qr_token(body.qr)
    with tenant_tx(d, t) as c:
        s = settings(c, d)
        require_feature(s, "spaces")
        settle_bookings(c, s)
        b = c.execute("SELECT b.*, f.qr_token FROM bookings b JOIN facilities f ON f.id=b.facility_id WHERE b.id=%s FOR UPDATE OF b",
                      (bid,)).fetchone()
        if not b:
            raise ApiError(404, "not_found", "ไม่พบการจอง")
        if b["status"] == "confirmed":
            return {"status": "confirmed"}
        if b["status"] != "booked":
            raise ApiError(409, "not_active", "การจองนี้หมดเวลายืนยันแล้ว")
        if b["qr_token"] != tok:
            raise ApiError(400, "wrong_qr", "QR นี้ไม่ใช่ของห้องที่คุณจอง")
        if now_utc() < b["starts_at"] - timedelta(minutes=15):
            raise ApiError(409, "too_early", "สแกนยืนยันได้ตั้งแต่ 15 นาทีก่อนเวลาเริ่ม")
        c.execute("UPDATE bookings SET status='confirmed', confirmed_at=now() WHERE id=%s", (bid,))
    return {"status": "confirmed"}


@router.post("/api/rooms/{code}/bookings/{bid}/cancel")
def cancel_booking(code: str, bid: int, request: Request):
    d, _, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        s = settings(c, d)
        require_feature(s, "spaces")
        b = c.execute("SELECT * FROM bookings WHERE id=%s FOR UPDATE", (bid,)).fetchone()
        if not b:
            raise ApiError(404, "not_found", "ไม่พบการจอง")
        if b["status"] not in ("booked",):
            return {"status": b["status"]}
        late = now_utc() > b["starts_at"] - timedelta(hours=s["booking_cancel_before_h"])
        status = "cancelled_late" if late else "cancelled"
        c.execute("UPDATE bookings SET status=%s, cancelled_at=now() WHERE id=%s", (status, bid))
        if late:
            from .domain import apply_strikes
            apply_strikes(c, s, t)
    return {"status": status, "counted_as_strike": late}


# ================================================================ parking
def permit_view(c, p):
    return {**p, "messages": thread(c, "permit", p["id"])}


@router.get("/api/rooms/{code}/parking")
def parking(code: str, request: Request):
    d, _, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        s = settings(c, d)
        require_feature(s, "parking")
        settle_permits(c)
        permits = c.execute("SELECT id, plate, province, vtype, brand_color, status, sticker, spot, fee, cancel_reason, "
                            "cancel_notice_at, cancel_due_at, ack_at, cancelled_at, created_at, updated_at FROM parking_permits "
                            "WHERE status <> 'withdrawn' AND (status <> 'cancelled' OR cancelled_at > now() - interval '30 days') "
                            "ORDER BY created_at DESC").fetchall()
        permits = [permit_view(c, p) for p in permits]
        wl = c.execute("SELECT id, vtype, status, created_at, offered_at FROM parking_waitlist WHERE status IN ('waiting','offered') "
                       "ORDER BY created_at LIMIT 1").fetchone()
        guests = c.execute("SELECT id, plate, valid_date, status FROM guest_passes WHERE valid_date >= %s AND status <> 'cancelled' "
                           "ORDER BY valid_date, id", (today_bkk(),)).fetchall()
        used = room_usage(c, t)
        with dorm_scope(c):   # counts only
            lot = lot_usage(c)
            pos = None
            if wl and wl["status"] == "waiting":
                pos = c.execute("SELECT count(*) AS n FROM parking_waitlist WHERE vtype=%s AND status='waiting' AND created_at <= %s",
                                (wl["vtype"], wl["created_at"])).fetchone()["n"]
    full = {k: bool(s[f"spots_{k}"] and lot[k] >= s[f"spots_{k}"]) for k in ("car", "moto")}
    return {"quota": {"car": s["quota_car"], "moto": s["quota_moto"]}, "used": used, "fees": {"car": s["fee_car"], "moto": s["fee_moto"]},
            "lot_full": full, "permits": permits, "waitlist": {**wl, "position": pos} if wl else None, "guest_passes": guests,
            "guest_pass_approval": s["guest_pass_approval"], "cancel_days": s["parking_cancel_days"], "contact": contact(s),
            "today": today_bkk()}


class PermitIn(BaseModel):
    plate: str = Field(..., max_length=20)
    province: str = Field("", max_length=40)
    vtype: str = Field(..., pattern="^(car|moto)$")
    brand_color: str = Field("", max_length=60)
    resubmit_id: Optional[int] = None


@router.post("/api/rooms/{code}/parking/permits", status_code=201)
def apply_permit(code: str, body: PermitIn, request: Request, background: BackgroundTasks):
    d, room_id, t = room_ctx(request, code)
    plate = plate_ok(body.plate)
    with tenant_tx(d, t) as c:
        hit = Idem(c, d, "permit", request)
        if hit.done:
            return hit.response
        s = settings(c, d)
        require_feature(s, "parking")
        if body.resubmit_id:
            p = c.execute("UPDATE parking_permits SET plate=%s, province=%s, vtype=%s, brand_color=%s, status='pending', updated_at=now() "
                          "WHERE id=%s AND status='returned' RETURNING id, status", (plate, body.province.strip(), body.vtype,
                                                                                      body.brand_color.strip(), body.resubmit_id)).fetchone()
            if not p:
                raise ApiError(404, "not_found", "ไม่พบคำขอที่ถูกตีกลับ")
        else:
            open_n = c.execute("SELECT count(*) AS n FROM parking_permits WHERE status IN ('pending','returned')").fetchone()["n"]
            if open_n >= 3:
                raise ApiError(429, "too_many", "มีคำขอที่รอตรวจอยู่แล้ว")
            with dorm_scope(c):
                lot = lot_usage(c)
            if s[f"spots_{body.vtype}"] and lot[body.vtype] >= s[f"spots_{body.vtype}"]:
                raise ApiError(409, "lot_full", f"ที่จอด{VTYPE[body.vtype]}เต็ม ลงชื่อรอคิวได้")
            p = c.execute("INSERT INTO parking_permits (dorm_id, tenancy_id, plate, province, vtype, brand_color) "
                          "VALUES (%s,%s,%s,%s,%s,%s) RETURNING id, status", (d, t, plate, body.province.strip(), body.vtype,
                                                                              body.brand_color.strip())).fetchone()
        room = c.execute("SELECT room_no FROM rooms WHERE id=%s", (room_id,)).fetchone()["room_no"]
    owner_mail(d, f"คำขอที่จอดรถ ห้อง {room}", "มีคำขอสิทธิ์ที่จอดรถใหม่", [f"ห้อง {room} · {VTYPE[body.vtype]} {plate}"],
               background, request)
    return hit.save(p)


class MsgIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)


def _tenant_msg(code, request, background, subject_type, sid, text, tbl):
    d, room_id, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        hit = Idem(c, d, f"msg-{subject_type}", request)
        if hit.done:
            return d, room_id, None, hit
        row = c.execute(f"SELECT id FROM {tbl} WHERE id=%s", (sid,)).fetchone()      # RLS + tenancy policy
        if not row:
            raise ApiError(404, "not_found", "ไม่พบเรื่องนี้")
        post_message(c, d, t, subject_type, sid, "tenant", text)
        room = c.execute("SELECT room_no FROM rooms WHERE id=%s", (room_id,)).fetchone()["room_no"]
        hit.save({"ok": True})
        return d, room_id, room, hit


@router.post("/api/rooms/{code}/parking/permits/{pid}/messages")
def permit_message(code: str, pid: int, body: MsgIn, request: Request, background: BackgroundTasks):
    d, _, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        require_feature(settings(c, d), "parking")
    d, _, room, hit = _tenant_msg(code, request, background, "permit", pid, body.text, "parking_permits")
    if room:
        owner_mail(d, f"ข้อความเรื่องที่จอดรถ ห้อง {room}", "ผู้เช่าตอบกลับเรื่องที่จอดรถ", [f"ห้อง {room}: {body.text[:300]}"],
                   background, request)
    return {"ok": True}


@router.post("/api/rooms/{code}/parking/permits/{pid}/ack-cancel")
def ack_cancel(code: str, pid: int, request: Request):
    d, _, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        require_feature(settings(c, d), "parking")
        c.execute("UPDATE parking_permits SET ack_at=now(), updated_at=now() WHERE id=%s AND status='cancel_notice' AND ack_at IS NULL",
                  (pid,))
        settle_permits(c)
        p = c.execute("SELECT status FROM parking_permits WHERE id=%s", (pid,)).fetchone()
    if not p:
        raise ApiError(404, "not_found", "ไม่พบสิทธิ์ที่จอด")
    return p


class GuestIn(BaseModel):
    plate: str = Field(..., max_length=20)
    day: date = Field(..., alias="date")


@router.post("/api/rooms/{code}/parking/guest-passes", status_code=201)
def guest_pass(code: str, body: GuestIn, request: Request, background: BackgroundTasks):
    d, room_id, t = room_ctx(request, code)
    plate = plate_ok(body.plate)
    if not today_bkk() <= body.day <= today_bkk() + timedelta(days=7):
        raise ApiError(400, "bad_date", "ขอบัตรจอดแขกได้ล่วงหน้าไม่เกิน 7 วัน")
    with tenant_tx(d, t) as c:
        hit = Idem(c, d, "guest", request)
        if hit.done:
            return hit.response
        s = settings(c, d)
        require_feature(s, "parking")
        n = c.execute("SELECT count(*) AS n FROM guest_passes WHERE valid_date=%s AND status IN ('active','pending')", (body.day,)).fetchone()["n"]
        if n >= 2:
            raise ApiError(429, "too_many", "ขอบัตรจอดแขกได้วันละไม่เกิน 2 ใบ")
        st = "pending" if s["guest_pass_approval"] else "active"
        row = c.execute("INSERT INTO guest_passes (dorm_id, tenancy_id, plate, valid_date, status) VALUES (%s,%s,%s,%s,%s) "
                        "RETURNING id, plate, valid_date, status", (d, t, plate, body.day, st)).fetchone()
        return hit.save(row)


class WaitIn(BaseModel):
    vtype: str = Field(..., pattern="^(car|moto)$")


@router.post("/api/rooms/{code}/parking/waitlist", status_code=201)
def join_waitlist(code: str, body: WaitIn, request: Request):
    d, _, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        require_feature(settings(c, d), "parking")
        if c.execute("SELECT 1 FROM parking_waitlist WHERE status IN ('waiting','offered')").fetchone():
            raise ApiError(409, "already", "ห้องนี้อยู่ในคิวแล้ว")
        return c.execute("INSERT INTO parking_waitlist (dorm_id, tenancy_id, vtype) VALUES (%s,%s,%s) RETURNING id, vtype, status",
                         (d, t, body.vtype)).fetchone()


@router.post("/api/rooms/{code}/parking/waitlist/cancel")
def leave_waitlist(code: str, request: Request):
    d, _, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        require_feature(settings(c, d), "parking")
        c.execute("UPDATE parking_waitlist SET status='cancelled' WHERE status IN ('waiting','offered')")
    return {"ok": True}


# ================================================================ bills
@router.get("/api/rooms/{code}/bills")
def bills(code: str, request: Request):
    d, room_id, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        s = settings(c, d)
        require_feature(s, "bills")
        rows = c.execute("SELECT id, period, kind, status, due_date, total, late_fee, receipt_no, issued_at, paid_at FROM bills "
                         "WHERE status NOT IN ('draft','cancelled') ORDER BY (status <> 'paid') DESC, due_date DESC LIMIT 24").fetchall()
        out = []
        for b in rows:
            slip = c.execute("SELECT decision, message, sent_at, decided_at FROM bill_slips WHERE bill_id=%s ORDER BY sent_at DESC LIMIT 1",
                             (b["id"],)).fetchone()
            out.append({**b, "status": effective_status(b), "raw_status": b["status"], "lines": bill_lines(c, b["id"]),
                        "slip": slip, "messages": thread(c, "bill", b["id"]),
                        "edits": c.execute("SELECT reason, at FROM bill_edits WHERE bill_id=%s ORDER BY at DESC LIMIT 3",
                                           (b["id"],)).fetchall()})
        room = c.execute("SELECT r.room_no, dm.name AS dorm_name FROM rooms r JOIN dorms dm ON dm.id=r.dorm_id WHERE r.id=%s",
                         (room_id,)).fetchone()
    pp = s["promptpay_id"]
    return {"bills": out, "promptpay": bool(pp), "promptpay_hint": (pp[:3] + "•••" + pp[-3:]) if pp else None,
            "late_fee": {"enabled": s["late_fee_enabled"], "grace_d": s["late_fee_grace_d"], "per_day": s["late_fee_per_day"]},
            "room_no": room["room_no"], "dorm_name": room["dorm_name"], "contact": contact(s)}


@router.get("/api/rooms/{code}/bills/{bid}/promptpay.svg")
def bill_qr(code: str, bid: int, request: Request):
    d, _, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        s = settings(c, d)
        require_feature(s, "bills")
        b = c.execute("SELECT total, status FROM bills WHERE id=%s AND status IN ('unpaid','returned','slip_sent')", (bid,)).fetchone()
    if not b or not s["promptpay_id"] or b["total"] <= 0:
        raise ApiError(404, "not_found", "ไม่มี QR สำหรับบิลนี้")
    return Response(promptpay.svg(promptpay.payload(s["promptpay_id"], b["total"])), media_type="image/svg+xml",
                    headers={"Cache-Control": "private, no-store"})


@router.post("/api/rooms/{code}/bills/{bid}/slip", status_code=201)
async def send_slip(code: str, bid: int, request: Request, background: BackgroundTasks, slip: UploadFile = File(...)):
    d, room_id, t = room_ctx(request, code)
    imgs = await read_images([slip], 1, 5 * 1024 * 1024)
    if not imgs:
        raise ApiError(400, "no_file", "กรุณาแนบรูปสลิป")
    with tenant_tx(d, t) as c:
        hit = Idem(c, d, "slip", request)
        if hit.done:
            return hit.response
        require_feature(settings(c, d), "bills")
        b = c.execute("SELECT id, period, total, status FROM bills WHERE id=%s FOR UPDATE", (bid,)).fetchone()
        if not b or b["status"] not in ("unpaid", "returned"):
            raise ApiError(409, "bad_state", "บิลนี้ส่งสลิปไม่ได้ (ชำระแล้ว หรือรอตรวจอยู่)")
        oid = storage.save_object(c, d, "slip", *imgs[0])
        c.execute("INSERT INTO bill_slips (dorm_id, bill_id, object_id) VALUES (%s,%s,%s)", (d, bid, oid))
        c.execute("UPDATE bills SET status='slip_sent', updated_at=now() WHERE id=%s", (bid,))
        room = c.execute("SELECT room_no FROM rooms WHERE id=%s", (room_id,)).fetchone()["room_no"]
    owner_mail(d, f"สลิปใหม่ ห้อง {room} งวด {b['period']}", "มีสลิปรอยืนยัน",
               [f"ห้อง {room} · งวด {b['period']} · ยอด {b['total'] / 100:,.2f} บาท"], background, request)
    return hit.save({"status": "slip_sent"})


@router.post("/api/rooms/{code}/bills/{bid}/messages")
def bill_message(code: str, bid: int, body: MsgIn, request: Request, background: BackgroundTasks):
    d, _, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        require_feature(settings(c, d), "bills")
    d, _, room, _ = _tenant_msg(code, request, background, "bill", bid, body.text, "bills")
    if room:
        owner_mail(d, f"ข้อความเรื่องบิล ห้อง {room}", "ผู้เช่าส่งข้อความเรื่องบิล", [f"ห้อง {room}: {body.text[:300]}"], background, request)
    return {"ok": True}


# ================================================================ fines
@router.get("/api/rooms/{code}/fines")
def fines(code: str, request: Request):
    d, _, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        require_feature(settings(c, d), "fines")
        return c.execute("SELECT f.id, f.title, f.preset, f.amount, f.status, f.billing, f.created_at, b.period AS bill_period FROM fines f "
                         "LEFT JOIN bills b ON b.id=f.bill_id ORDER BY f.created_at DESC LIMIT 30").fetchall()


@router.get("/api/rooms/{code}/fines/{fid}")
def fine_detail(code: str, fid: int, request: Request):
    d, room_id, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        s = settings(c, d)
        require_feature(s, "fines")
        f = c.execute("SELECT f.id, f.title, f.preset, f.amount, f.original_amount, f.reason, f.status, f.billing, f.created_at, "
                      "b.period AS bill_period, b.status AS bill_status, rm.room_no FROM fines f LEFT JOIN bills b ON b.id=f.bill_id "
                      "JOIN rooms rm ON rm.id=f.room_id WHERE f.id=%s", (fid,)).fetchone()
        if not f:
            raise ApiError(404, "not_found", "ไม่พบค่าปรับนี้")
        photos = [r["id"] for r in c.execute("SELECT id FROM fine_photos WHERE fine_id=%s ORDER BY id", (fid,)).fetchall()]
        msgs = thread(c, "fine", fid)
    return {**f, "photos": photos, "messages": msgs, "contact": contact(s)}


@router.get("/api/rooms/{code}/fines/{fid}/photos/{pid}")
def fine_photo(code: str, fid: int, pid: int, request: Request):
    d, _, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        require_feature(settings(c, d), "fines")
        if not c.execute("SELECT 1 FROM fines WHERE id=%s", (fid,)).fetchone():     # tenancy policy: own fines only
            raise ApiError(404, "not_found", "ไม่พบรูป")
        p = c.execute("SELECT object_id FROM fine_photos WHERE id=%s AND fine_id=%s", (pid, fid)).fetchone()
        if not p:
            raise ApiError(404, "not_found", "ไม่พบรูป")
        try:
            mime, data = storage.load_object(c, p["object_id"])
        except LookupError:
            raise ApiError(404, "not_found", "ไม่พบรูป")
    return Response(data, media_type=mime, headers={"Cache-Control": "private, max-age=3600"})


@router.post("/api/rooms/{code}/fines/{fid}/messages")
def fine_message(code: str, fid: int, body: MsgIn, request: Request, background: BackgroundTasks):
    d, _, t = room_ctx(request, code)
    with tenant_tx(d, t) as c:
        require_feature(settings(c, d), "fines")
    d, _, room, _ = _tenant_msg(code, request, background, "fine", fid, body.text, "fines")
    if room:
        _, _, t = room_ctx(request, code)
        with tenant_tx(d, t) as c:      # a tenant reply = dispute (owner decides: confirm / reduce / cancel)
            c.execute("UPDATE fines SET status='disputed', updated_at=now() WHERE id=%s AND status='open'", (fid,))
        owner_mail(d, f"ผู้เช่าตอบกลับค่าปรับ ห้อง {room}", "มีข้อความใหม่เรื่องค่าปรับ", [f"ห้อง {room}: {body.text[:300]}"],
                   background, request)
    return {"ok": True}
