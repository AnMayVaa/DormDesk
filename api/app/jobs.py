"""Background job — runs inside every API process, but only ONE runs at a time across api-01/api-02
(PostgreSQL advisory lock), so there is no extra "cron" machine to manage and nothing runs twice.

Every minute:
  * heartbeat row for this API server (Grafana alerts if one goes quiet)
  * settle time-based states for every dorm (no-shows, ended parking cancellations)
  * on/after the issue day: create this month's draft bills, auto-issue the ones that need no meter reading
  * e-mail tenants once per event (new bill, overdue, booking ban) — `notifications` makes it exactly-once
Every hour:
  * PDPA retention: personal data on closed repair requests and payment slips removed after 180 days
"""
import logging
import threading
import time

from . import notify, storage
from .core import HOSTNAME, VERSION, pool, settings, tenant_tx, today_bkk, period_of
from .domain import build_monthly_bill, effective_status, issue_bill, settle_bookings, settle_permits

log = logging.getLogger("dormdesk.jobs")
LOCK_ID = 727001
RETENTION_DAYS = 180
_stop = threading.Event()


def _once(c, dorm_id: int, kind: str, ref_id: int) -> bool:
    return bool(c.execute("INSERT INTO notifications (dorm_id, kind, ref_id) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING RETURNING ref_id",
                          (dorm_id, kind, ref_id)).fetchone())


def _tenant_mail(c, tenancy_id, subject, heading, lines, hash_part):
    if not notify.enabled():
        return
    r = c.execute("SELECT t.contact_email, rm.room_code FROM tenancies t JOIN rooms rm ON rm.id=t.room_id "
                  "WHERE t.id=%s AND t.ended_at IS NULL", (tenancy_id,)).fetchone()
    if r and r["contact_email"]:
        threading.Thread(target=notify.generic, daemon=True,
                         args=(r["contact_email"], subject, heading, lines, f"/r/{r['room_code']}#{hash_part}", "เปิดหน้าห้องของฉัน")).start()


def heartbeat():
    with pool.connection() as c:
        db = c.execute("SELECT host(inet_server_addr()) AS a").fetchone()["a"]
        c.execute("INSERT INTO api_heartbeats (host, last_seen, db_host, version) VALUES (%s, now(), %s, %s) "
                  "ON CONFLICT (host) DO UPDATE SET last_seen=now(), db_host=EXCLUDED.db_host, version=EXCLUDED.version",
                  (HOSTNAME, db, VERSION))


def per_dorm(dorm_id: int):
    with tenant_tx(dorm_id) as c:
        s = settings(c, dorm_id)
        if s["f_spaces"]:
            for t in settle_bookings(c, s):
                if _once(c, dorm_id, "ban", t):
                    _tenant_mail(c, t, "งดการจองห้องส่วนกลางชั่วคราว", "งดการจองชั่วคราว",
                                 [f"จองแล้วไม่มาครบ {s['strike_limit']} ครั้ง จึงงดการจอง {s['ban_days']} วัน ติดต่อเจ้าของหอได้"], "facilities")
        if s["f_parking"]:
            settle_permits(c)
        if s["f_bills"] and s["bill_auto"] and today_bkk().day >= s["bill_issue_day"]:
            period = period_of(today_bkk())
            rooms = c.execute("SELECT r.id, r.dorm_id, r.room_no, r.rent, t.id AS tenancy_id FROM rooms r "
                              "JOIN tenancies t ON t.room_id=r.id AND t.ended_at IS NULL "
                              "WHERE NOT EXISTS (SELECT 1 FROM bills b WHERE b.room_id=r.id AND b.tenancy_id=t.id AND b.period=%s)",
                              (period,)).fetchall()
            for r in rooms:
                res = build_monthly_bill(c, s, r, r["tenancy_id"], period)
                if res and not res["needs_meter"]:
                    issue_bill(c, res["id"])
        if s["f_bills"]:
            for b in c.execute("SELECT b.id, b.tenancy_id, b.period, b.total, b.due_date, b.status, rm.room_no FROM bills b "
                               "JOIN rooms rm ON rm.id=b.room_id WHERE b.status IN ('unpaid','returned') AND b.issued_at IS NOT NULL").fetchall():
                if _once(c, dorm_id, "bill_issued", b["id"]):
                    _tenant_mail(c, b["tenancy_id"], f"บิลงวด {b['period']} ห้อง {b['room_no']}", "บิลใหม่ของห้องคุณ",
                                 [f"ยอด {b['total'] / 100:,.2f} บาท · ครบกำหนด {b['due_date']}"], "bills")
                if effective_status(b) == "overdue" and _once(c, dorm_id, "bill_overdue", b["id"]):
                    _tenant_mail(c, b["tenancy_id"], f"บิลเกินกำหนด งวด {b['period']}", "บิลของคุณเกินกำหนดชำระ",
                                 [f"ยอด {b['total'] / 100:,.2f} บาท · ครบกำหนด {b['due_date']}"], "bills")


def retention(dorm_id: int):
    """PDPA: the repair form promises deletion 180 days after a request is closed. Payment slips (bank details)
    follow the same rule after the bill is paid. Rows stay (statistics), personal fields are blanked."""
    with tenant_tx(dorm_id) as c:
        c.execute("UPDATE requests SET reporter_name='(ลบตามนโยบาย)', reporter_phone='-', reporter_email=NULL, pii_purged_at=now() "
                  "WHERE status IN ('done','rejected') AND pii_purged_at IS NULL AND updated_at < now() - make_interval(days => %s)",
                  (RETENTION_DAYS,))
        c.execute("UPDATE tenancies SET contact_email=NULL WHERE ended_at < now() - make_interval(days => %s) AND contact_email IS NOT NULL",
                  (RETENTION_DAYS,))
        if storage.enabled():
            for r in c.execute("SELECT s.object_id FROM bill_slips s JOIN bills b ON b.id=s.bill_id JOIN objects o ON o.id=s.object_id "
                               "WHERE o.purged_at IS NULL AND ((b.status='paid' AND b.paid_at < now() - make_interval(days => %s)) "
                               "OR (s.decision='returned' AND s.decided_at < now() - make_interval(days => %s)))",
                               (RETENTION_DAYS, RETENTION_DAYS)).fetchall():
                try:
                    storage.purge_object(c, r["object_id"])
                except storage.StorageError:
                    log.warning("could not purge object %s", r["object_id"])


def run_job(name: str, fn):
    with pool.connection() as c:
        c.execute("INSERT INTO job_state (name, last_run_at) VALUES (%s, now()) ON CONFLICT (name) DO UPDATE SET last_run_at=now()", (name,))
    try:
        fn()
        with pool.connection() as c:
            c.execute("UPDATE job_state SET last_ok_at=now(), detail=NULL WHERE name=%s", (name,))
    except Exception as e:  # keep the loop alive; the error is visible in Grafana (job_state) and the log
        log.exception("job %s failed", name)
        with pool.connection() as c:
            c.execute("UPDATE job_state SET detail=%s WHERE name=%s", (f"{type(e).__name__}: {e}"[:200], name))


def tick(minute: int):
    heartbeat()
    with pool.connection() as conn:
        got = conn.execute("SELECT pg_try_advisory_lock(%s) AS ok", (LOCK_ID,)).fetchone()["ok"]
        if not got:
            return
        try:
            dorms = [r["id"] for r in conn.execute("SELECT id FROM dorms ORDER BY id").fetchall()]
            run_job("settle_and_bill", lambda: [per_dorm(d) for d in dorms])
            if minute % 60 == 0:
                run_job("retention", lambda: [retention(d) for d in dorms])
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK_ID,))


def loop(interval: int = 60):
    minute = 0
    time.sleep(5)
    while not _stop.is_set():
        try:
            tick(minute)
        except Exception:
            log.exception("job tick failed (database unreachable?)")
        minute += 1
        _stop.wait(interval)


def start():
    threading.Thread(target=loop, name="dormdesk-jobs", daemon=True).start()


def stop():
    _stop.set()
