"""Owner / manager endpoints for the v2 features: settings, facilities + QR, change of tenant, billing, fines,
parking, common-space bookings and the extra dashboard. Every handler checks the session AND admin_dorms,
then works inside tenant_tx(dorm) so RLS still applies (owners never set app.tenancy_id: they see all tenancies)."""
import secrets
from datetime import date, datetime, time, timedelta
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, Query, Request, Response, UploadFile
from pydantic import BaseModel, Field

from . import notify, promptpay, storage
from .auth import require_dorm_access, scoped
from .core import (BKK, FEATURES, ApiError, Idem, client_ip, log_event, now_utc, one, period_of, settings, tenant_tx,
                   today_bkk, week_start)
from .domain import (FINE_PRESET, PRESET_LABEL, VTYPE, bill_lines, build_monthly_bill, effective_status, issue_bill,
                     late_fee_for, lot_usage, next_receipt_no, post_message, recalc, settle_bookings, settle_permits, slots_for,
                     thread)
from .images import read_images

router = APIRouter()
PUBLIC = notify.PUBLIC_BASE_URL


def _mail_tenant(c, background, request, dorm_id, tenancy_id, subject, heading, lines, hash_part):
    """E-mail the tenant if they gave an address on the room page. The link is their room link (= their key)."""
    if not notify.enabled():
        return
    r = c.execute("SELECT t.contact_email, rm.room_code FROM tenancies t JOIN rooms rm ON rm.id=t.room_id "
                  "WHERE t.id=%s AND t.ended_at IS NULL", (tenancy_id,)).fetchone()
    if r and r["contact_email"]:
        background.add_task(notify.generic, r["contact_email"], subject, heading, lines, f"/r/{r['room_code']}#{hash_part}",
                            "เปิดหน้าห้องของฉัน", lambda why: log_event("email_failed", client_ip(request), dorm_id, why))


def satang(baht: float) -> int:
    v = int(round(float(baht) * 100))
    if abs(v) > 100_000_000:
        raise ApiError(400, "bad_amount", "ยอดเงินไม่ถูกต้อง")
    return v


# ================================================================ settings + features
SETTING_FIELDS = {
    "checkin_hours": int, "checkin_per_room": int, "booking_per_week": int, "booking_confirm_min": int,
    "booking_cancel_before_h": int, "strike_limit": int, "strike_window_d": int, "ban_days": int, "quota_car": int,
    "quota_moto": int, "spots_car": int, "spots_moto": int, "fee_car": int, "fee_moto": int, "parking_cancel_days": int,
    "guest_pass_approval": bool, "promptpay_id": str, "bill_auto": bool, "bill_issue_day": int, "bill_due_day": int,
    "common_fee": int, "water_mode": str, "water_rate": int, "water_flat": int, "elec_mode": str, "elec_rate": int,
    "elec_flat": int, "late_fee_enabled": bool, "late_fee_grace_d": int, "late_fee_per_day": int, "contact_phone": str,
    "contact_email": str, **{"f_" + f: bool for f in FEATURES}}


@router.get("/api/admin/dorms/{d}/settings")
def get_settings(d: int, request: Request):
    require_dorm_access(request, d)
    with tenant_tx(d) as c:
        s = settings(c, d)
        fac = c.execute("SELECT id, name, kind, capacity, open_from, open_to, slot_minutes, enabled, closed_note, sort, qr_token "
                        "FROM facilities ORDER BY sort, id").fetchall()
    s = {k: v for k, v in s.items() if k in SETTING_FIELDS}
    return {"settings": s, "facilities": [{**{k: v for k, v in f.items() if k != "qr_token"}, "open_from": f"{f['open_from']:%H:%M}",
                                           "open_to": f"{f['open_to']:%H:%M}", "qr_url": f"{PUBLIC}/q/{f['qr_token']}"} for f in fac]}


@router.put("/api/admin/dorms/{d}/settings")
def put_settings(d: int, body: dict, request: Request):
    aid = require_dorm_access(request, d)
    upd = {}
    for k, v in body.items():
        if k not in SETTING_FIELDS:
            raise ApiError(400, "bad_field", f"ไม่รู้จักค่า {k}")
        typ = SETTING_FIELDS[k]
        if v is None and k in ("promptpay_id", "contact_phone", "contact_email"):
            upd[k] = None
            continue
        try:
            upd[k] = (v if isinstance(v, bool) else str(v).lower() in ("1", "true", "on")) if typ is bool else typ(v)
        except (TypeError, ValueError):
            raise ApiError(400, "bad_value", f"ค่า {k} ไม่ถูกต้อง")
        if typ is str:
            upd[k] = upd[k].strip()[:120] or None
    if "promptpay_id" in upd and upd["promptpay_id"]:
        upd["promptpay_id"] = "".join(ch for ch in upd["promptpay_id"] if ch.isdigit())
    if not upd:
        return {"ok": True}
    cols = ", ".join(f"{k}=%s" for k in upd)
    try:
        with tenant_tx(d) as c:
            settings(c, d)
            c.execute(f"UPDATE dorm_settings SET {cols}, updated_at=now() WHERE dorm_id=%s", (*upd.values(), d))
    except Exception as e:
        if "check" in str(e).lower():
            raise ApiError(400, "bad_value", "มีค่าที่อยู่นอกช่วงที่อนุญาต")
        raise
    log_event("settings_changed", client_ip(request), d, f"admin={aid} " + ",".join(upd)[:150])
    return {"ok": True}


class FacilityIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    kind: str = Field(..., pattern="^(fitness|pool|space)$")
    capacity: Optional[int] = Field(None, ge=1, le=500)
    open_from: str = Field("06:00", pattern=r"^\d{2}:\d{2}$")
    open_to: str = Field("22:00", pattern=r"^\d{2}:\d{2}$")
    slot_minutes: int = 60


@router.post("/api/admin/dorms/{d}/facilities", status_code=201)
def add_facility(d: int, body: FacilityIn, request: Request):
    require_dorm_access(request, d)
    if body.slot_minutes not in (30, 60, 90, 120) or body.open_from >= body.open_to:
        raise ApiError(400, "bad_value", "เวลาเปิด-ปิดหรือความยาวช่วงจองไม่ถูกต้อง")
    with tenant_tx(d) as c:
        return c.execute("INSERT INTO facilities (dorm_id, name, kind, capacity, open_from, open_to, slot_minutes, qr_token) "
                         "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id", (d, body.name.strip(), body.kind, body.capacity,
                                                                         body.open_from, body.open_to, body.slot_minutes,
                                                                         secrets.token_urlsafe(18))).fetchone()


class FacilityPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=60)
    capacity: Optional[int] = Field(None, ge=0, le=500)
    open_from: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    open_to: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    slot_minutes: Optional[int] = None
    enabled: Optional[bool] = None
    closed_note: Optional[str] = Field(None, max_length=120)


@router.patch("/api/admin/facilities/{fid}")
def patch_facility(fid: int, body: FacilityPatch, request: Request):
    d, _ = scoped(request, "facility", fid)
    upd = body.model_dump(exclude_unset=True)
    if "capacity" in upd and upd["capacity"] == 0:
        upd["capacity"] = None
    if "closed_note" in upd:
        upd["closed_note"] = (upd["closed_note"] or "").strip() or None
    if "slot_minutes" in upd and upd["slot_minutes"] not in (30, 60, 90, 120):
        raise ApiError(400, "bad_value", "ความยาวช่วงจองต้องเป็น 30/60/90/120 นาที")
    if not upd:
        return {"ok": True}
    with tenant_tx(d) as c:
        c.execute(f"UPDATE facilities SET {', '.join(k + '=%s' for k in upd)} WHERE id=%s", (*upd.values(), fid))
    return {"ok": True}


@router.post("/api/admin/facilities/{fid}/rotate-qr")
def rotate_qr(fid: int, request: Request):
    d, aid = scoped(request, "facility", fid)
    with tenant_tx(d) as c:
        c.execute("UPDATE facilities SET qr_token=%s WHERE id=%s", (secrets.token_urlsafe(18), fid))
    log_event("qr_rotated", client_ip(request), d, f"admin={aid} facility={fid}")
    return {"ok": True}


@router.get("/api/admin/facilities/{fid}/qr.svg")
def facility_qr(fid: int, request: Request):
    d, _ = scoped(request, "facility", fid)
    with tenant_tx(d) as c:
        f = c.execute("SELECT name, kind, qr_token FROM facilities WHERE id=%s", (fid,)).fetchone()
    sub = "เปิดลิงก์ห้องของคุณ → เมนูส่วนกลาง → สแกน" if f["kind"] != "space" else "สแกนยืนยันจากเมนูจองห้องในลิงก์ห้อง"
    return Response(promptpay.labelled_svg(f"{PUBLIC}/q/{f['qr_token']}", f["name"], sub), media_type="image/svg+xml",
                    headers={"Cache-Control": "no-store", "Content-Disposition": f'inline; filename="qr-{fid}.svg"'})


# ================================================================ rooms: rent, change of tenant, history
class RoomPatch(BaseModel):
    rent: float = Field(..., ge=0, le=1_000_000)


@router.patch("/api/admin/rooms/{room_id}")
def patch_room(room_id: int, body: RoomPatch, request: Request):
    d = one("SELECT room_dorm(%s) AS d", (room_id,))["d"]
    require_dorm_access(request, d)
    with tenant_tx(d) as c:
        c.execute("UPDATE rooms SET rent=%s WHERE id=%s", (satang(body.rent), room_id))
    return {"ok": True}


def _tenancy_effects(c, t):
    q = lambda sql: c.execute(sql, (t,)).fetchone()["n"]
    return {
        "permits": q("SELECT count(*) AS n FROM parking_permits WHERE tenancy_id=%s AND status IN ('pending','returned','active','cancel_notice')"),
        "guest_passes": q("SELECT count(*) AS n FROM guest_passes WHERE tenancy_id=%s AND status IN ('active','pending') AND valid_date >= current_date"),
        "bookings": q("SELECT count(*) AS n FROM bookings WHERE tenancy_id=%s AND status='booked' AND starts_at > now()"),
        "checkins": q("SELECT count(*) AS n FROM checkins WHERE tenancy_id=%s AND checked_out_at IS NULL AND expires_at > now()"),
        "unpaid_total": c.execute("SELECT COALESCE(sum(total),0) AS n FROM bills WHERE tenancy_id=%s AND status IN ('unpaid','returned','slip_sent')",
                                  (t,)).fetchone()["n"],
        "open_fines": q("SELECT count(*) AS n FROM fines WHERE tenancy_id=%s AND status IN ('open','disputed','confirmed')"),
        "requests": q("SELECT count(*) AS n FROM requests WHERE tenancy_id=%s"),
    }


@router.get("/api/admin/rooms/{room_id}/tenancy")
def tenancy_info(room_id: int, request: Request):
    d = one("SELECT room_dorm(%s) AS d", (room_id,))["d"]
    require_dorm_access(request, d)
    with tenant_tx(d) as c:
        cur = c.execute("SELECT id, started_at FROM tenancies WHERE room_id=%s AND ended_at IS NULL", (room_id,)).fetchone()
        prev = c.execute("SELECT id, started_at, ended_at FROM tenancies WHERE room_id=%s AND ended_at IS NOT NULL "
                         "ORDER BY ended_at DESC LIMIT 10", (room_id,)).fetchall()
        return {"current": {**cur, **_tenancy_effects(c, cur["id"])},
                "previous": [{**p, **_tenancy_effects(c, p["id"])} for p in prev]}


@router.post("/api/admin/rooms/{room_id}/new-tenancy")
def new_tenancy(room_id: int, request: Request):
    """Close the current tenancy and open a new one with a NEW room link. Nothing is deleted:
    old bills/fines/requests stay for the owner (history), the new tenant sees none of it."""
    d = one("SELECT room_dorm(%s) AS d", (room_id,))["d"]
    aid = require_dorm_access(request, d)
    with tenant_tx(d) as c:
        cur = c.execute("SELECT id FROM tenancies WHERE room_id=%s AND ended_at IS NULL FOR UPDATE", (room_id,)).fetchone()
        t = cur["id"]
        eff = _tenancy_effects(c, t)
        c.execute("UPDATE parking_permits SET status=CASE WHEN status IN ('pending','returned') THEN 'withdrawn' ELSE 'cancelled' END, "
                  "cancelled_at=now(), cancel_reason=COALESCE(cancel_reason,'เปลี่ยนผู้เช่า'), updated_at=now() "
                  "WHERE tenancy_id=%s AND status IN ('pending','returned','active','cancel_notice')", (t,))
        c.execute("UPDATE guest_passes SET status='cancelled' WHERE tenancy_id=%s AND status IN ('active','pending')", (t,))
        c.execute("UPDATE bookings SET status='void', cancelled_at=now() WHERE tenancy_id=%s AND status='booked' AND starts_at > now()", (t,))
        c.execute("UPDATE checkins SET checked_out_at=now() WHERE tenancy_id=%s AND checked_out_at IS NULL", (t,))
        c.execute("UPDATE parking_waitlist SET status='cancelled' WHERE tenancy_id=%s AND status IN ('waiting','offered')", (t,))
        c.execute("UPDATE tenancies SET ended_at=now() WHERE id=%s", (t,))
        new_t = c.execute("INSERT INTO tenancies (dorm_id, room_id) VALUES (%s,%s) RETURNING id", (d, room_id)).fetchone()["id"]
        code = secrets.token_urlsafe(16)
        room = c.execute("UPDATE rooms SET room_code=%s, code_rotated_at=now() WHERE id=%s RETURNING room_no, room_code",
                         (code, room_id)).fetchone()
    log_event("tenancy_changed", client_ip(request), d, f"admin={aid} room={room_id} old={t} new={new_t}")
    return {"tenancy_id": new_t, "room_no": room["room_no"], "room_code": room["room_code"], "closed": eff}


# ================================================================ billing
@router.get("/api/admin/dorms/{d}/billing")
def billing(d: int, request: Request, period: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$")):
    require_dorm_access(request, d)
    period = period or period_of(today_bkk())
    with tenant_tx(d) as c:
        s = settings(c, d)
        rows = c.execute(
            "SELECT r.id AS room_id, r.room_no, r.rent, t.id AS tenancy_id, m.water_units, m.elec_units, "
            "b.id AS bill_id, b.status, b.total, b.due_date FROM rooms r "
            "JOIN tenancies t ON t.room_id=r.id AND t.ended_at IS NULL "
            "LEFT JOIN meter_readings m ON m.room_id=r.id AND m.period=%s "
            "LEFT JOIN bills b ON b.room_id=r.id AND b.tenancy_id=t.id AND b.period=%s ORDER BY r.room_no", (period, period)).fetchall()
        slips = c.execute(
            "SELECT s.id AS slip_id, b.id AS bill_id, b.period, b.total, rm.room_no, s.sent_at FROM bill_slips s "
            "JOIN bills b ON b.id=s.bill_id JOIN rooms rm ON rm.id=b.room_id WHERE s.decision='pending' AND b.status='slip_sent' "
            "ORDER BY s.sent_at").fetchall()
        other = c.execute(
            "SELECT b.id, b.period, b.kind, b.status, b.total, b.due_date, rm.room_no, (t.ended_at IS NOT NULL) AS prev_tenant "
            "FROM bills b JOIN rooms rm ON rm.id=b.room_id JOIN tenancies t ON t.id=b.tenancy_id "
            "WHERE (b.period <> %s OR t.ended_at IS NOT NULL) AND b.status IN ('unpaid','returned','slip_sent') ORDER BY b.due_date",
            (period,)).fetchall()
    for r in rows:
        if r["bill_id"]:
            r["eff_status"] = effective_status(r)
    for b in other:
        b["eff_status"] = effective_status(b)
    sm = {k: s[k] for k in ("bill_auto", "bill_issue_day", "bill_due_day", "common_fee", "water_mode", "water_rate", "water_flat",
                            "elec_mode", "elec_rate", "elec_flat", "late_fee_enabled", "late_fee_grace_d", "late_fee_per_day",
                            "promptpay_id", "f_bills")}
    return {"period": period, "rooms": rows, "slips_pending": slips, "outstanding_other": other, "settings": sm}


class MeterRow(BaseModel):
    room_id: int
    rent: Optional[float] = Field(None, ge=0, le=1_000_000)
    water_units: Optional[float] = Field(None, ge=0, le=100000)
    elec_units: Optional[float] = Field(None, ge=0, le=100000)


class MetersIn(BaseModel):
    period: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    rows: List[MeterRow] = Field(..., max_length=500)


@router.put("/api/admin/dorms/{d}/meters")
def put_meters(d: int, body: MetersIn, request: Request):
    require_dorm_access(request, d)
    with tenant_tx(d) as c:
        for r in body.rows:
            if not c.execute("SELECT 1 FROM rooms WHERE id=%s", (r.room_id,)).fetchone():
                raise ApiError(404, "not_found", "ไม่พบห้อง")
            if r.rent is not None:
                c.execute("UPDATE rooms SET rent=%s WHERE id=%s", (satang(r.rent), r.room_id))
            c.execute("INSERT INTO meter_readings (dorm_id, room_id, period, water_units, elec_units) VALUES (%s,%s,%s,%s,%s) "
                      "ON CONFLICT (room_id, period) DO UPDATE SET water_units=EXCLUDED.water_units, elec_units=EXCLUDED.elec_units, "
                      "updated_at=now()", (d, r.room_id, body.period, r.water_units, r.elec_units))
    return {"ok": True, "saved": len(body.rows)}


class GenerateIn(BaseModel):
    period: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    room_ids: Optional[List[int]] = None
    issue: bool = False


def generate_bills(c, s, d, period, room_ids=None, issue=False, background=None, request=None) -> dict:
    rooms = c.execute("SELECT r.id, r.dorm_id, r.room_no, r.rent, t.id AS tenancy_id FROM rooms r "
                      "JOIN tenancies t ON t.room_id=r.id AND t.ended_at IS NULL "
                      + ("WHERE r.id = ANY(%s) " if room_ids else "") + "ORDER BY r.room_no",
                      ((room_ids,) if room_ids else ())).fetchall()
    created, issued, needs_meter = 0, 0, []
    for r in rooms:
        res = build_monthly_bill(c, s, r, r["tenancy_id"], period)
        if res:
            created += 1
            if res["needs_meter"]:
                needs_meter.append(r["room_no"])
        bill = c.execute("SELECT id, status, total FROM bills WHERE room_id=%s AND tenancy_id=%s AND period=%s",
                         (r["id"], r["tenancy_id"], period)).fetchone()
        if issue and bill["status"] == "draft" and not (res and res["needs_meter"]) and bill["total"] > 0:
            if issue_bill(c, bill["id"]):
                issued += 1        # the tenant e-mail is sent by the background job, exactly once (jobs.py)
    return {"created": created, "issued": issued, "needs_meter": needs_meter}


@router.post("/api/admin/dorms/{d}/bills/generate")
def generate(d: int, body: GenerateIn, request: Request, background: BackgroundTasks):
    aid = require_dorm_access(request, d)
    with tenant_tx(d) as c:
        s = settings(c, d)
        if not s["f_bills"]:
            raise ApiError(403, "feature_disabled", "ยังไม่ได้เปิดฟีเจอร์บิล")
        out = generate_bills(c, s, d, body.period, body.room_ids, body.issue, background, request)
    log_event("bills_generated", client_ip(request), d, f"admin={aid} {body.period} {out}")
    return out


@router.get("/api/admin/bills/{bid}")
def bill_detail(bid: int, request: Request):
    d, _ = scoped(request, "bill", bid)
    with tenant_tx(d) as c:
        b = c.execute("SELECT b.*, rm.room_no, (t.ended_at IS NOT NULL) AS prev_tenant FROM bills b JOIN rooms rm ON rm.id=b.room_id "
                      "JOIN tenancies t ON t.id=b.tenancy_id WHERE b.id=%s", (bid,)).fetchone()
        b["eff_status"] = effective_status(b)
        b["lines"] = bill_lines(c, bid)
        b["edits"] = c.execute("SELECT before, after, reason, admin_id, at FROM bill_edits WHERE bill_id=%s ORDER BY at DESC", (bid,)).fetchall()
        b["slips"] = c.execute("SELECT id, decision, message, sent_at, decided_at FROM bill_slips WHERE bill_id=%s ORDER BY sent_at DESC",
                               (bid,)).fetchall()
        b["messages"] = thread(c, "bill", bid)
    return b


class LineIn(BaseModel):
    preset: str = Field(..., pattern="^(rent|water|electric|common|parking|fine|late_fee|adjust|other)$")
    label: str = Field("", max_length=80)
    note: str = Field("", max_length=80)
    amount: float = Field(..., ge=-1_000_000, le=1_000_000)


class BillPatch(BaseModel):
    lines: List[LineIn] = Field(..., max_length=40)
    reason: str = Field("", max_length=200)


@router.patch("/api/admin/bills/{bid}")
def edit_bill(bid: int, body: BillPatch, request: Request, background: BackgroundTasks):
    d, aid = scoped(request, "bill", bid)
    with tenant_tx(d) as c:
        b = c.execute("SELECT * FROM bills WHERE id=%s FOR UPDATE", (bid,)).fetchone()
        if b["status"] in ("paid", "cancelled"):
            raise ApiError(409, "locked", "บิลที่ชำระแล้วแก้ไม่ได้ ให้เพิ่มรายการปรับยอดในบิลถัดไป")
        if b["status"] != "draft" and len(body.reason.strip()) < 3:
            raise ApiError(400, "reason_required", "บิลที่ส่งให้ผู้เช่าแล้ว ต้องใส่เหตุผลที่แก้ไข")
        before = {"total": b["total"], "lines": [{k: l[k] for k in ("label", "note", "amount")} for l in bill_lines(c, bid)]}
        old = c.execute("SELECT ref_type, ref_id, preset, note FROM bill_lines WHERE bill_id=%s AND sort >= 0 AND ref_type IS NOT NULL",
                        (bid,)).fetchall()
        refs = {(o["preset"], o["note"]): (o["ref_type"], o["ref_id"]) for o in old}   # keep links to fines / permits
        # the API account has no DELETE right: superseded lines are archived (amount 0, sort -1) and stay as history
        c.execute("UPDATE bill_lines SET amount=0, sort=-1 WHERE bill_id=%s AND sort >= 0", (bid,))
        for i, l in enumerate(body.lines):
            label = l.label.strip() or PRESET_LABEL[l.preset]
            rt, rid = refs.get((l.preset, l.note.strip()), (None, None))
            c.execute("INSERT INTO bill_lines (dorm_id, bill_id, preset, label, note, amount, ref_type, ref_id, sort) "
                      "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)", (d, bid, l.preset, label, l.note.strip(), satang(l.amount), rt, rid, i))
        total = recalc(c, bid)
        after = {"total": total, "lines": [{"label": l.label or PRESET_LABEL[l.preset], "note": l.note, "amount": satang(l.amount)}
                                           for l in body.lines]}
        if b["status"] != "draft":
            import json
            c.execute("INSERT INTO bill_edits (dorm_id, bill_id, before, after, reason, admin_id) VALUES (%s,%s,%s,%s,%s,%s)",
                      (d, bid, json.dumps(before), json.dumps(after), body.reason.strip(), aid))
            room = c.execute("SELECT room_no FROM rooms WHERE id=%s", (b["room_id"],)).fetchone()["room_no"]
            _mail_tenant(c, background, request, d, b["tenancy_id"], f"แก้ไขบิลงวด {b['period']} ห้อง {room}", "บิลของคุณถูกแก้ไข",
                         [f"ยอดใหม่ {total / 100:,.2f} บาท (เดิม {b['total'] / 100:,.2f})", f"เหตุผล: {body.reason.strip()}"], "bills")
    return {"total": total}


@router.post("/api/admin/bills/{bid}/issue")
def issue(bid: int, request: Request, background: BackgroundTasks):
    d, _ = scoped(request, "bill", bid)
    with tenant_tx(d) as c:
        b = c.execute("SELECT b.*, rm.room_no FROM bills b JOIN rooms rm ON rm.id=b.room_id WHERE b.id=%s", (bid,)).fetchone()
        if b["total"] <= 0:
            raise ApiError(400, "empty", "บิลยังไม่มียอด")
        issue_bill(c, bid)          # e-mail goes out from the background job within a minute (exactly once)
    return {"status": "unpaid"}


@router.post("/api/admin/bills/{bid}/confirm")
def confirm_payment(bid: int, request: Request, background: BackgroundTasks):
    """Slip checked (or paid in cash): mark paid, issue a gapless receipt number, compute any late fee."""
    d, aid = scoped(request, "bill", bid)
    with tenant_tx(d) as c:
        s = settings(c, d)
        b = c.execute("SELECT b.*, rm.room_no FROM bills b JOIN rooms rm ON rm.id=b.room_id WHERE b.id=%s FOR UPDATE OF b",
                      (bid,)).fetchone()
        if b["status"] == "paid":
            return {"status": "paid", "receipt_no": b["receipt_no"]}
        if b["status"] not in ("unpaid", "returned", "slip_sent"):
            raise ApiError(409, "bad_state", "บิลนี้ยืนยันการชำระไม่ได้")
        rno = next_receipt_no(c, d)
        fee = late_fee_for(s, b["due_date"], today_bkk())
        c.execute("UPDATE bills SET status='paid', paid_at=now(), receipt_no=%s, late_fee=%s, updated_at=now() WHERE id=%s",
                  (rno, fee, bid))
        c.execute("UPDATE bill_slips SET decision='confirmed', decided_at=now(), decided_by=%s WHERE bill_id=%s AND decision='pending'",
                  (aid, bid))
        if b["kind"] == "separate":
            c.execute("UPDATE fines SET updated_at=now() WHERE bill_id=%s", (bid,))
        _mail_tenant(c, background, request, d, b["tenancy_id"], f"ได้รับชำระแล้ว งวด {b['period']} ห้อง {b['room_no']}",
                     "ชำระเงินเรียบร้อย · ใบเสร็จพร้อมแล้ว", [f"เลขที่ใบเสร็จ {rno} · ยอด {b['total'] / 100:,.2f} บาท"], "bills")
    return {"status": "paid", "receipt_no": rno, "late_fee": fee}


class ReturnIn(BaseModel):
    message: str = Field(..., min_length=3, max_length=500)


@router.post("/api/admin/bills/{bid}/return")
def return_slip(bid: int, body: ReturnIn, request: Request, background: BackgroundTasks):
    d, aid = scoped(request, "bill", bid)
    with tenant_tx(d) as c:
        b = c.execute("SELECT b.*, rm.room_no FROM bills b JOIN rooms rm ON rm.id=b.room_id WHERE b.id=%s FOR UPDATE OF b",
                      (bid,)).fetchone()
        if b["status"] != "slip_sent":
            raise ApiError(409, "bad_state", "บิลนี้ไม่มีสลิปรอตรวจ")
        c.execute("UPDATE bill_slips SET decision='returned', decided_at=now(), decided_by=%s, message=%s WHERE bill_id=%s "
                  "AND decision='pending'", (aid, body.message.strip(), bid))
        c.execute("UPDATE bills SET status='returned', updated_at=now() WHERE id=%s", (bid,))
        post_message(c, d, b["tenancy_id"], "bill", bid, f"admin:{aid}", body.message)
        _mail_tenant(c, background, request, d, b["tenancy_id"], f"สลิปถูกตีกลับ งวด {b['period']} ห้อง {b['room_no']}",
                     "สลิปของคุณถูกตีกลับ", [f"เจ้าของหอ: {body.message.strip()}"], "bills")
    return {"status": "returned"}


class CancelIn(BaseModel):
    reason: str = Field(..., min_length=3, max_length=200)


@router.post("/api/admin/bills/{bid}/cancel")
def cancel_bill(bid: int, body: CancelIn, request: Request):
    d, aid = scoped(request, "bill", bid)
    with tenant_tx(d) as c:
        b = c.execute("SELECT status FROM bills WHERE id=%s FOR UPDATE", (bid,)).fetchone()
        if b["status"] == "paid":
            raise ApiError(409, "locked", "บิลที่ชำระแล้วยกเลิกไม่ได้")
        c.execute("UPDATE bills SET status='cancelled', updated_at=now() WHERE id=%s", (bid,))
        c.execute("UPDATE fines SET status='confirmed', bill_id=NULL, updated_at=now() WHERE bill_id=%s AND status='billed'", (bid,))
    log_event("bill_cancelled", client_ip(request), d, f"admin={aid} bill={bid} {body.reason[:80]}")
    return {"status": "cancelled"}


@router.get("/api/admin/bills/{bid}/slips/{sid}")
def view_slip(bid: int, sid: int, request: Request):
    d, aid = scoped(request, "bill", bid)
    with tenant_tx(d) as c:
        r = c.execute("SELECT object_id FROM bill_slips WHERE id=%s AND bill_id=%s", (sid, bid)).fetchone()
        if not r:
            raise ApiError(404, "not_found", "ไม่พบสลิป")
        try:
            mime, data = storage.load_object(c, r["object_id"])
        except LookupError:
            raise ApiError(410, "purged", "สลิปนี้ถูกลบตามระยะเวลาเก็บข้อมูลแล้ว")
    log_event("slip_viewed", client_ip(request), d, f"admin={aid} bill={bid}")    # audit: who looked at bank details
    return Response(data, media_type=mime, headers={"Cache-Control": "private, no-store"})


class MsgIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)


def _admin_msg(kind, table, oid, body, request, background, hash_part, subject):
    d, aid = scoped(request, kind, oid)
    with tenant_tx(d) as c:
        row = c.execute(f"SELECT tenancy_id FROM {table} WHERE id=%s", (oid,)).fetchone()
        post_message(c, d, row["tenancy_id"], kind if kind != "bill" else "bill", oid, f"admin:{aid}", body.text)
        _mail_tenant(c, background, request, d, row["tenancy_id"], subject, "ข้อความใหม่จากเจ้าของหอ", [body.text[:400]], hash_part)
    return {"ok": True}


@router.post("/api/admin/bills/{bid}/messages")
def bill_msg(bid: int, body: MsgIn, request: Request, background: BackgroundTasks):
    return _admin_msg("bill", "bills", bid, body, request, background, "bills", "ข้อความเรื่องบิล")


# ================================================================ fines
@router.get("/api/admin/dorms/{d}/fines")
def list_fines(d: int, request: Request):
    require_dorm_access(request, d)
    with tenant_tx(d) as c:
        return c.execute(
            "SELECT f.id, f.title, f.preset, f.amount, f.status, f.billing, f.created_at, rm.room_no, b.period AS bill_period, "
            "(t.ended_at IS NOT NULL) AS prev_tenant, (SELECT count(*) FROM messages m WHERE m.subject_type='fine' AND m.subject_id=f.id "
            "AND m.author='tenant') AS tenant_msgs FROM fines f JOIN rooms rm ON rm.id=f.room_id JOIN tenancies t ON t.id=f.tenancy_id "
            "LEFT JOIN bills b ON b.id=f.bill_id ORDER BY (f.status IN ('open','disputed')) DESC, f.created_at DESC LIMIT 200").fetchall()


@router.post("/api/admin/dorms/{d}/fines", status_code=201)
async def create_fine(d: int, request: Request, background: BackgroundTasks,
                      room_id: int = Form(...), preset: str = Form(..., pattern="^(late|damage|noise|parking|other)$"),
                      title: str = Form("", max_length=80), amount: float = Form(..., gt=0, le=100000),
                      reason: str = Form(..., min_length=3, max_length=1000),
                      billing: str = Form("next_bill", pattern="^(next_bill|separate)$"),
                      photos: List[UploadFile] = File(default=[])):
    aid = require_dorm_access(request, d)
    imgs = await read_images(photos, 3, 8 * 1024 * 1024)
    with tenant_tx(d) as c:
        hit = Idem(c, d, "fine", request)
        if hit.done:
            return hit.response
        s = settings(c, d)
        if not s["f_fines"]:
            raise ApiError(403, "feature_disabled", "ยังไม่ได้เปิดฟีเจอร์ค่าปรับ")
        room = c.execute("SELECT r.room_no, t.id AS tenancy_id FROM rooms r JOIN tenancies t ON t.room_id=r.id AND t.ended_at IS NULL "
                         "WHERE r.id=%s", (room_id,)).fetchone()
        if not room:
            raise ApiError(404, "not_found", "ไม่พบห้อง")
        amt = satang(amount)
        ttl = title.strip() or FINE_PRESET[preset]
        fid = c.execute("INSERT INTO fines (dorm_id, tenancy_id, room_id, preset, title, amount, original_amount, reason, billing, created_by) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                        (d, room["tenancy_id"], room_id, preset, ttl, amt, amt, reason.strip(), billing, aid)).fetchone()["id"]
        for mime, data in imgs:
            oid = storage.save_object(c, d, "fine_photo", mime, data)
            c.execute("INSERT INTO fine_photos (dorm_id, fine_id, object_id) VALUES (%s,%s,%s)", (d, fid, oid))
        if billing == "separate":
            bid = c.execute("INSERT INTO bills (dorm_id, tenancy_id, room_id, period, kind, status, due_date, issued_at) "
                            "VALUES (%s,%s,%s,%s,'separate','unpaid',%s, now()) RETURNING id",
                            (d, room["tenancy_id"], room_id, f"F{fid}", today_bkk() + timedelta(days=7))).fetchone()["id"]
            c.execute("INSERT INTO bill_lines (dorm_id, bill_id, preset, label, note, amount, ref_type, ref_id) "
                      "VALUES (%s,%s,'fine',%s,%s,%s,'fine',%s)", (d, bid, PRESET_LABEL["fine"], ttl, amt, fid))
            recalc(c, bid)
            c.execute("UPDATE fines SET bill_id=%s WHERE id=%s", (bid, fid))
        _mail_tenant(c, background, request, d, room["tenancy_id"], f"ค่าปรับ ห้อง {room['room_no']}: {ttl}", "มีค่าปรับใหม่",
                     [f"{ttl} · {amt / 100:,.2f} บาท", f"เหตุผล: {reason.strip()[:300]}", "ตอบกลับหรือโต้แย้งได้จากหน้าห้องของคุณ"],
                     f"fine/{fid}")
        return hit.save({"id": fid})


@router.get("/api/admin/fines/{fid}")
def fine_detail(fid: int, request: Request):
    d, _ = scoped(request, "fine", fid)
    with tenant_tx(d) as c:
        f = c.execute("SELECT f.*, rm.room_no, b.period AS bill_period, b.status AS bill_status FROM fines f JOIN rooms rm ON rm.id=f.room_id "
                      "LEFT JOIN bills b ON b.id=f.bill_id WHERE f.id=%s", (fid,)).fetchone()
        f["photos"] = [r["id"] for r in c.execute("SELECT id FROM fine_photos WHERE fine_id=%s ORDER BY id", (fid,)).fetchall()]
        f["messages"] = thread(c, "fine", fid)
    return f


class FinePatch(BaseModel):
    amount: Optional[float] = Field(None, gt=0, le=100000)
    status: Optional[str] = Field(None, pattern="^(confirmed|cancelled)$")


@router.patch("/api/admin/fines/{fid}")
def patch_fine(fid: int, body: FinePatch, request: Request, background: BackgroundTasks):
    d, aid = scoped(request, "fine", fid)
    with tenant_tx(d) as c:
        f = c.execute("SELECT f.*, b.status AS bill_status FROM fines f LEFT JOIN bills b ON b.id=f.bill_id WHERE f.id=%s FOR UPDATE OF f",
                      (fid,)).fetchone()
        if f["status"] == "cancelled" or (f["status"] == "billed" and f["bill_status"] == "paid"):
            raise ApiError(409, "locked", "ค่าปรับนี้ปิดแล้ว")
        changes = []
        if body.amount is not None:
            amt = satang(body.amount)
            if amt > f["original_amount"]:
                raise ApiError(400, "bad_amount", "ลดยอดได้ แต่เพิ่มเกินยอดเดิมไม่ได้")
            c.execute("UPDATE fines SET amount=%s, updated_at=now() WHERE id=%s", (amt, fid))
            if f["bill_id"]:
                c.execute("UPDATE bill_lines SET amount=%s WHERE bill_id=%s AND ref_type='fine' AND ref_id=%s", (amt, f["bill_id"], fid))
                recalc(c, f["bill_id"])
            changes.append(f"ยอดใหม่ {amt / 100:,.2f} บาท")
        if body.status == "cancelled":
            c.execute("UPDATE fines SET status='cancelled', updated_at=now() WHERE id=%s", (fid,))
            if f["bill_id"]:
                c.execute("UPDATE bill_lines SET amount=0, note='(ยกเลิกค่าปรับ) ' || note WHERE bill_id=%s AND ref_type='fine' AND ref_id=%s",
                          (f["bill_id"], fid))
                recalc(c, f["bill_id"])
                if f["status"] == "billed":
                    c.execute("UPDATE bills SET status='cancelled' WHERE id=%s AND kind='separate' AND status <> 'paid'", (f["bill_id"],))
            changes.append("ยกเลิกค่าปรับแล้ว")
        elif body.status == "confirmed" and f["status"] in ("open", "disputed"):
            c.execute("UPDATE fines SET status='confirmed', updated_at=now() WHERE id=%s", (fid,))
            changes.append("ยืนยันค่าปรับ")
        if changes:
            _mail_tenant(c, background, request, d, f["tenancy_id"], f"อัปเดตค่าปรับ: {f['title']}", "ค่าปรับของคุณมีการเปลี่ยนแปลง",
                         changes, f"fine/{fid}")
    return {"ok": True}


@router.post("/api/admin/fines/{fid}/messages")
def fine_msg(fid: int, body: MsgIn, request: Request, background: BackgroundTasks):
    return _admin_msg("fine", "fines", fid, body, request, background, f"fine/{fid}", "ข้อความเรื่องค่าปรับ")


@router.get("/api/admin/fines/{fid}/photos/{pid}")
def fine_photo(fid: int, pid: int, request: Request):
    d, _ = scoped(request, "fine", fid)
    with tenant_tx(d) as c:
        p = c.execute("SELECT object_id FROM fine_photos WHERE id=%s AND fine_id=%s", (pid, fid)).fetchone()
        if not p:
            raise ApiError(404, "not_found", "ไม่พบรูป")
        mime, data = storage.load_object(c, p["object_id"])
    return Response(data, media_type=mime, headers={"Cache-Control": "private, max-age=3600"})


# ================================================================ parking
@router.get("/api/admin/dorms/{d}/parking")
def admin_parking(d: int, request: Request):
    require_dorm_access(request, d)
    with tenant_tx(d) as c:
        s = settings(c, d)
        settle_permits(c)
        base = ("SELECT p.*, rm.room_no, (SELECT count(*) FROM parking_permits q WHERE q.tenancy_id=p.tenancy_id AND q.vtype=p.vtype "
                "AND q.status IN ('active','cancel_notice')) AS has FROM parking_permits p JOIN tenancies t ON t.id=p.tenancy_id "
                "JOIN rooms rm ON rm.id=t.room_id ")
        pending = c.execute(base + "WHERE p.status='pending' ORDER BY p.updated_at").fetchall()
        cancelling = c.execute(base + "WHERE p.status='cancel_notice' OR (p.status='cancelled' AND p.cancel_notice_at IS NOT NULL "
                               "AND p.cancelled_at > now() - interval '14 days') ORDER BY p.cancel_notice_at DESC").fetchall()
        active = c.execute(base + "WHERE p.status='active' ORDER BY rm.room_no").fetchall()
        for p in cancelling:
            p["messages"] = thread(c, "permit", p["id"])
            p["tenant_replied"] = any(m["author"] == "tenant" and m["created_at"] > p["cancel_notice_at"] for m in p["messages"])
        waitlist = c.execute("SELECT w.id, w.vtype, w.status, w.created_at, w.offered_at, rm.room_no FROM parking_waitlist w "
                             "JOIN tenancies t ON t.id=w.tenancy_id JOIN rooms rm ON rm.id=t.room_id WHERE w.status IN ('waiting','offered') "
                             "ORDER BY w.vtype, w.created_at").fetchall()
        guests = c.execute("SELECT g.id, g.plate, g.valid_date, g.status, rm.room_no FROM guest_passes g JOIN tenancies t ON t.id=g.tenancy_id "
                           "JOIN rooms rm ON rm.id=t.room_id WHERE g.valid_date >= %s AND g.status IN ('active','pending') "
                           "ORDER BY g.valid_date, rm.room_no", (today_bkk(),)).fetchall()
        used = lot_usage(c)
    q = {"car": s["quota_car"], "moto": s["quota_moto"]}
    for p in pending:
        p["quota"] = q[p["vtype"]]
    return {"pending": pending, "cancelling": cancelling, "active": active, "waitlist": waitlist, "guest_passes": guests,
            "used": used, "spots": {"car": s["spots_car"], "moto": s["spots_moto"]}, "quota": q,
            "fees": {"car": s["fee_car"], "moto": s["fee_moto"]}, "cancel_days": s["parking_cancel_days"], "enabled": s["f_parking"]}


class ApproveIn(BaseModel):
    sticker: str = Field("", max_length=20)
    spot: str = Field("", max_length=20)
    confirm_over_quota: bool = False


@router.post("/api/admin/parking/permits/{pid}/approve")
def approve_permit(pid: int, body: ApproveIn, request: Request, background: BackgroundTasks):
    d, aid = scoped(request, "permit", pid)
    with tenant_tx(d) as c:
        s = settings(c, d)
        p = c.execute("SELECT * FROM parking_permits WHERE id=%s FOR UPDATE", (pid,)).fetchone()
        if p["status"] == "active":
            return {"status": "active"}
        if p["status"] != "pending":
            raise ApiError(409, "bad_state", "คำขอนี้ไม่ได้รออนุมัติ")
        has = c.execute("SELECT count(*) AS n FROM parking_permits WHERE tenancy_id=%s AND vtype=%s AND status IN ('active','cancel_notice')",
                        (p["tenancy_id"], p["vtype"])).fetchone()["n"]
        quota = s[f"quota_{p['vtype']}"]
        if has >= quota and not body.confirm_over_quota:
            others = c.execute("SELECT plate, spot FROM parking_permits WHERE tenancy_id=%s AND vtype=%s AND status IN ('active','cancel_notice')",
                               (p["tenancy_id"], p["vtype"])).fetchall()
            raise ApiError(409, "over_quota", "ห้องนี้มีที่จอดครบโควตาแล้ว", {"has": has, "quota": quota, "existing": others})
        c.execute("UPDATE parking_permits SET status='active', sticker=%s, spot=%s, fee=%s, over_quota=%s, approved_at=now(), updated_at=now() "
                  "WHERE id=%s", (body.sticker.strip() or None, body.spot.strip() or None, s[f"fee_{p['vtype']}"], has >= quota, pid))
        c.execute("UPDATE parking_waitlist SET status='cancelled' WHERE tenancy_id=%s AND vtype=%s AND status='offered'",
                  (p["tenancy_id"], p["vtype"]))
        _mail_tenant(c, background, request, d, p["tenancy_id"], "อนุมัติสิทธิ์ที่จอดรถแล้ว", "สิทธิ์ที่จอดรถของคุณได้รับอนุมัติ",
                     [f"{VTYPE[p['vtype']]} {p['plate']}" + (f" · สติกเกอร์ {body.sticker}" if body.sticker else "")
                      + (f" · ช่อง {body.spot}" if body.spot else "")], "parking")
    return {"status": "active", "over_quota": has >= quota}


@router.post("/api/admin/parking/permits/{pid}/return")
def return_permit(pid: int, body: ReturnIn, request: Request, background: BackgroundTasks):
    d, aid = scoped(request, "permit", pid)
    with tenant_tx(d) as c:
        p = c.execute("SELECT * FROM parking_permits WHERE id=%s FOR UPDATE", (pid,)).fetchone()
        if p["status"] != "pending":
            raise ApiError(409, "bad_state", "คำขอนี้ไม่ได้รออนุมัติ")
        c.execute("UPDATE parking_permits SET status='returned', updated_at=now() WHERE id=%s", (pid,))
        post_message(c, d, p["tenancy_id"], "permit", pid, f"admin:{aid}", body.message)
        _mail_tenant(c, background, request, d, p["tenancy_id"], "คำขอที่จอดรถถูกตีกลับ", "กรุณาตรวจข้อมูลรถอีกครั้ง",
                     [f"เจ้าของหอ: {body.message.strip()}"], "parking")
    return {"status": "returned"}


class ReasonIn(BaseModel):
    reason: str = Field(..., min_length=3, max_length=300)


@router.post("/api/admin/parking/permits/{pid}/cancel")
def cancel_permit(pid: int, body: ReasonIn, request: Request, background: BackgroundTasks):
    d, aid = scoped(request, "permit", pid)
    with tenant_tx(d) as c:
        s = settings(c, d)
        p = c.execute("SELECT * FROM parking_permits WHERE id=%s FOR UPDATE", (pid,)).fetchone()
        if p["status"] != "active":
            raise ApiError(409, "bad_state", "ยกเลิกได้เฉพาะสิทธิ์ที่ใช้งานอยู่")
        row = c.execute("UPDATE parking_permits SET status='cancel_notice', cancel_reason=%s, cancel_notice_at=now(), ack_at=NULL, "
                        "cancel_due_at=now() + make_interval(days => %s), updated_at=now() WHERE id=%s RETURNING cancel_due_at",
                        (body.reason.strip(), s["parking_cancel_days"], pid)).fetchone()
        post_message(c, d, p["tenancy_id"], "permit", pid, f"admin:{aid}", body.reason)
        _mail_tenant(c, background, request, d, p["tenancy_id"], "แจ้งยกเลิกสิทธิ์ที่จอดรถ", "เจ้าของหอแจ้งยกเลิกสิทธิ์ที่จอดรถ",
                     [f"{p['plate']} · เหตุผล: {body.reason.strip()}",
                      f"สิทธิ์สิ้นสุดเมื่อคุณกดรับทราบ หรือครบ {s['parking_cancel_days']} วัน · ตอบกลับได้จากหน้าห้อง"], "parking")
    return {"status": "cancel_notice", "cancel_due_at": row["cancel_due_at"]}


@router.post("/api/admin/parking/permits/{pid}/withdraw-cancel")
def withdraw_cancel(pid: int, request: Request, background: BackgroundTasks):
    d, aid = scoped(request, "permit", pid)
    with tenant_tx(d) as c:
        settle_permits(c)
        p = c.execute("UPDATE parking_permits SET status='active', cancel_reason=NULL, cancel_notice_at=NULL, cancel_due_at=NULL, ack_at=NULL, "
                      "updated_at=now() WHERE id=%s AND status='cancel_notice' RETURNING tenancy_id, plate", (pid,)).fetchone()
        if not p:
            raise ApiError(409, "bad_state", "สิทธิ์นี้สิ้นสุดไปแล้ว หรือไม่ได้อยู่ระหว่างยกเลิก")
        post_message(c, d, p["tenancy_id"], "permit", pid, f"admin:{aid}", "ถอนการยกเลิกแล้ว ใช้ที่จอดต่อได้ตามเดิม")
        _mail_tenant(c, background, request, d, p["tenancy_id"], "ถอนการยกเลิกสิทธิ์ที่จอดรถ", "คุณใช้ที่จอดรถต่อได้ตามเดิม",
                     [p["plate"]], "parking")
    return {"status": "active"}


@router.post("/api/admin/parking/permits/{pid}/messages")
def permit_msg(pid: int, body: MsgIn, request: Request, background: BackgroundTasks):
    return _admin_msg("permit", "parking_permits", pid, body, request, background, "parking", "ข้อความเรื่องที่จอดรถ")


@router.post("/api/admin/parking/waitlist/{wid}/offer")
def offer_spot(wid: int, request: Request, background: BackgroundTasks):
    d, _ = scoped(request, "waitlist", wid)
    with tenant_tx(d) as c:
        w = c.execute("UPDATE parking_waitlist SET status='offered', offered_at=now() WHERE id=%s AND status='waiting' "
                      "RETURNING tenancy_id, vtype", (wid,)).fetchone()
        if not w:
            raise ApiError(409, "bad_state", "คิวนี้ไม่ได้รออยู่")
        _mail_tenant(c, background, request, d, w["tenancy_id"], "มีที่จอดว่างแล้ว", "ถึงคิวของคุณแล้ว",
                     [f"ที่จอด{VTYPE[w['vtype']]}ว่างแล้ว ยื่นขอสิทธิ์ได้จากหน้าห้อง"], "parking")
    return {"status": "offered"}


class DecideIn(BaseModel):
    approve: bool


@router.post("/api/admin/parking/guest-passes/{gid}/decide")
def decide_guest(gid: int, body: DecideIn, request: Request):
    d, _ = scoped(request, "guest", gid)
    with tenant_tx(d) as c:
        c.execute("UPDATE guest_passes SET status=%s WHERE id=%s AND status='pending'", ("active" if body.approve else "rejected", gid))
    return {"ok": True}


# ================================================================ common spaces + check-ins (owner view)
@router.get("/api/admin/dorms/{d}/spaces")
def admin_spaces(d: int, request: Request, start: Optional[date] = None):
    require_dorm_access(request, d)
    start = start or today_bkk()
    with tenant_tx(d) as c:
        s = settings(c, d)
        settle_bookings(c, s)
        fac = c.execute("SELECT id, name, kind, capacity, open_from, open_to, slot_minutes, enabled, closed_note FROM facilities "
                        "ORDER BY sort, id").fetchall()
        lo = datetime.combine(start, time(0), tzinfo=BKK)
        bookings = c.execute("SELECT b.id, b.facility_id, b.starts_at, b.ends_at, b.status, rm.room_no FROM bookings b "
                             "JOIN tenancies t ON t.id=b.tenancy_id JOIN rooms rm ON rm.id=t.room_id "
                             "WHERE b.starts_at >= %s AND b.starts_at < %s AND b.status <> 'void' ORDER BY b.starts_at",
                             (lo, lo + timedelta(days=7))).fetchall()
        bans = c.execute("SELECT x.id, x.until, x.starts_at, rm.room_no FROM booking_bans x JOIN tenancies t ON t.id=x.tenancy_id "
                         "JOIN rooms rm ON rm.id=t.room_id WHERE x.lifted_at IS NULL AND x.until > now() ORDER BY x.until").fetchall()
        now_in = {r["facility_id"]: r["n"] for r in c.execute(
            "SELECT facility_id, count(*) AS n FROM checkins WHERE checked_out_at IS NULL AND expires_at > now() GROUP BY facility_id").fetchall()}
        ws = week_start(today_bkk())
        extra = c.execute("SELECT e.extra, rm.room_no FROM booking_quota_extra e JOIN tenancies t ON t.id=e.tenancy_id "
                          "JOIN rooms rm ON rm.id=t.room_id WHERE e.week_start=%s AND t.ended_at IS NULL", (ws,)).fetchall()
    return {"facilities": [{**f, "open_from": f"{f['open_from']:%H:%M}", "open_to": f"{f['open_to']:%H:%M}", "now": now_in.get(f["id"], 0)}
                           for f in fac], "bookings": bookings, "bans": bans, "quota_extra": extra, "week_start": ws,
            "rules": {k: s[k] for k in ("booking_per_week", "booking_confirm_min", "booking_cancel_before_h", "strike_limit",
                                        "strike_window_d", "ban_days", "checkin_hours", "checkin_per_room")},
            "enabled": {"fitness": s["f_fitness"], "pool": s["f_pool"], "spaces": s["f_spaces"]}}


class ExtraIn(BaseModel):
    room_no: str = Field(..., max_length=20)
    extra: int = Field(..., ge=0, le=20)


@router.post("/api/admin/dorms/{d}/quota-extra")
def quota_extra(d: int, body: ExtraIn, request: Request):
    require_dorm_access(request, d)
    with tenant_tx(d) as c:
        t = c.execute("SELECT t.id FROM rooms r JOIN tenancies t ON t.room_id=r.id AND t.ended_at IS NULL WHERE r.room_no=%s",
                      (body.room_no.strip(),)).fetchone()
        if not t:
            raise ApiError(404, "not_found", "ไม่พบห้อง")
        c.execute("INSERT INTO booking_quota_extra (dorm_id, tenancy_id, week_start, extra) VALUES (%s,%s,%s,%s) "
                  "ON CONFLICT (tenancy_id, week_start) DO UPDATE SET extra=EXCLUDED.extra", (d, t["id"], week_start(today_bkk()), body.extra))
    return {"ok": True}


@router.post("/api/admin/bans/{ban_id}/lift")
def lift_ban(ban_id: int, request: Request):
    d, aid = scoped(request, "ban", ban_id)
    with tenant_tx(d) as c:
        c.execute("UPDATE booking_bans SET lifted_at=now(), lifted_by=%s WHERE id=%s AND lifted_at IS NULL", (aid, ban_id))
    return {"ok": True}


@router.post("/api/admin/bookings/{bid}/cancel")
def owner_cancel_booking(bid: int, request: Request):
    d, _ = scoped(request, "booking", bid)
    with tenant_tx(d) as c:
        c.execute("UPDATE bookings SET status='void', cancelled_at=now() WHERE id=%s AND status IN ('booked','confirmed')", (bid,))
    return {"ok": True}


# ================================================================ dashboard: new section (kept apart from repair data)
@router.get("/api/admin/dorms/{d}/dashboard/extras")
def dashboard_extras(d: int, request: Request):
    require_dorm_access(request, d)
    p = period_of(today_bkk())
    with tenant_tx(d) as c:
        s = settings(c, d)
        out = {"features": {f: s["f_" + f] for f in FEATURES}, "period": p}
        if s["f_bills"]:
            bl = c.execute("SELECT status, due_date, total FROM bills WHERE period=%s AND status NOT IN ('draft','cancelled')", (p,)).fetchall()
            eff = [effective_status(b) for b in bl]
            rooms = c.execute("SELECT count(*) AS n FROM tenancies WHERE ended_at IS NULL").fetchone()["n"]
            od = c.execute("SELECT b.id, b.total, b.due_date, rm.room_no FROM bills b JOIN rooms rm ON rm.id=b.room_id "
                           "WHERE b.status IN ('unpaid','returned') AND b.due_date < %s ORDER BY b.due_date LIMIT 10", (today_bkk(),)).fetchall()
            for o in od:
                o["days"] = (today_bkk() - o["due_date"]).days
                o["late_fee"] = late_fee_for(s, o["due_date"], today_bkk())
            out["finance"] = {"rooms": rooms, "paid": eff.count("paid"), "slip_pending": eff.count("slip_sent"),
                              "unpaid": eff.count("unpaid") + eff.count("returned"), "overdue": eff.count("overdue"),
                              "drafts": c.execute("SELECT count(*) AS n FROM bills WHERE period=%s AND status='draft'", (p,)).fetchone()["n"],
                              "collected": sum(b["total"] for b in bl if b["status"] == "paid"),
                              "expected": sum(b["total"] for b in bl), "overdue_rooms": od}
        if s["f_fines"]:
            out["fines"] = c.execute("SELECT f.id, f.title, f.amount, f.status, rm.room_no FROM fines f JOIN rooms rm ON rm.id=f.room_id "
                                     "WHERE f.status IN ('open','disputed') ORDER BY (f.status='disputed') DESC, f.created_at DESC LIMIT 6").fetchall()
        if s["f_parking"]:
            settle_permits(c)
            st = {r["status"]: r["n"] for r in c.execute("SELECT status, count(*) AS n FROM parking_permits GROUP BY status").fetchall()}
            out["parking"] = {"pending": st.get("pending", 0), "used": st.get("active", 0) + st.get("cancel_notice", 0),
                              "total": s["spots_car"] + s["spots_moto"], "cancelling": st.get("cancel_notice", 0),
                              "over_quota": c.execute("SELECT count(*) AS n FROM parking_permits WHERE over_quota AND status='active'").fetchone()["n"],
                              "waitlist": c.execute("SELECT count(*) AS n FROM parking_waitlist WHERE status='waiting'").fetchone()["n"]}
        if s["f_spaces"]:
            settle_bookings(c, s)
            lo = datetime.combine(today_bkk(), time(0), tzinfo=BKK)
            today_n = c.execute("SELECT count(*) AS n FROM bookings WHERE starts_at >= %s AND starts_at < %s AND status IN ('booked','confirmed')",
                                (lo, lo + timedelta(days=1))).fetchone()["n"]
            r = c.execute("SELECT count(*) FILTER (WHERE status='no_show') AS ns, count(*) FILTER (WHERE status IN ('confirmed','no_show')) AS tot "
                          "FROM bookings WHERE starts_at > now() - interval '30 days' AND starts_at < now()").fetchone()
            bans = c.execute("SELECT x.until, rm.room_no FROM booking_bans x JOIN tenancies t ON t.id=x.tenancy_id JOIN rooms rm ON rm.id=t.room_id "
                             "WHERE x.lifted_at IS NULL AND x.until > now()").fetchall()
            out["spaces"] = {"today": today_n, "no_show_rate_30d": round(100 * r["ns"] / r["tot"]) if r["tot"] else 0, "banned": bans}
        if s["f_fitness"] or s["f_pool"]:
            now_rows = c.execute("SELECT f.id, f.name, f.kind, f.capacity, (SELECT count(*) FROM checkins c WHERE c.facility_id=f.id "
                                 "AND c.checked_out_at IS NULL AND c.expires_at > now()) AS n FROM facilities f WHERE f.kind IN ('fitness','pool') "
                                 "ORDER BY f.sort, f.id").fetchall()
            busy = c.execute("SELECT extract(hour FROM started_at AT TIME ZONE 'Asia/Bangkok')::int AS h, round(count(*)/30.0, 1) AS avg "
                             "FROM checkins WHERE started_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1").fetchall()
            out["checkin"] = {"now": now_rows, "busy_hours": busy}
    return out
