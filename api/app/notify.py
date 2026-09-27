"""E-mail notifications through Gmail SMTP (STARTTLS, port 587, App Password).

Runs in FastAPI BackgroundTasks, so a slow mail server never delays the tenant or the owner.
If SMTP_USER / SMTP_PASS are not set, mail is simply skipped (feature off).
Only the API tier may reach port 587 (firewall), and mails never contain photos or other tenants' data.
"""
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASS = os.environ.get("SMTP_PASS", "").replace(" ", "").strip()
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "https://45.77.40.35:10201").rstrip("/")

STATUS_TH = {"received": "รับเรื่องแล้ว", "in_progress": "กำลังดำเนินการ", "done": "เสร็จสิ้น", "rejected": "ปฏิเสธ / แจ้งซ้ำ"}
STATUS_EN = {"received": "Received", "in_progress": "In progress", "done": "Done", "rejected": "Rejected / duplicate"}


def enabled() -> bool:
    return bool(SMTP_USER and SMTP_PASS)


def _send(to: str, subject: str, text: str, html: str, on_error=None):
    if not enabled() or not to:
        return
    msg = EmailMessage()
    msg["From"] = formataddr(("DormDesk", SMTP_USER))
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as s:
            s.starttls(context=ssl.create_default_context())
            s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
    except Exception as e:  # never break the request; record it for monitoring
        if on_error:
            on_error(f"{type(e).__name__}")


def _esc(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _html(title: str, lines: list, link: str, button: str) -> str:
    body = "".join(f"<p style='margin:0 0 10px'>{l}</p>" for l in lines)
    return f"""<div style="font-family:Prompt,Segoe UI,sans-serif;background:#eef2f7;padding:24px">
  <div style="max-width:520px;margin:auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #dde3ec">
    <div style="font-weight:700;font-size:18px;color:#1f2733">Dorm<span style="color:#1b6a8f">Desk</span></div>
    <h2 style="font-size:18px;color:#1f2733;margin:16px 0 12px">{title}</h2>
    <div style="color:#445063;font-size:15px;line-height:1.6">{body}</div>
    <a href="{link}" style="display:inline-block;margin-top:12px;background:#87ceeb;color:#0f2f3d;text-decoration:none;
       font-weight:600;padding:12px 18px;border-radius:10px">{button}</a>
    <p style="color:#5f6b7c;font-size:12px;margin-top:20px">อีเมลนี้ส่งอัตโนมัติจาก DormDesk · This is an automated message.</p>
  </div></div>"""


def tenant_status_changed(to, title, room_no, dorm, new_status, note, token, on_error=None):
    link = f"{PUBLIC_BASE_URL}/t/{token}"
    st_th, st_en = STATUS_TH.get(new_status, new_status), STATUS_EN.get(new_status, new_status)
    subject = f"[DormDesk] {st_th} · {title} (ห้อง {room_no})"
    note_line = f"ข้อความจากเจ้าของหอ: {note}" if note else ""
    text = (f"เรื่อง \"{title}\" ห้อง {room_no} ({dorm}) เปลี่ยนสถานะเป็น: {st_th}\n{note_line}\n"
            f"ดูรายละเอียด: {link}\n\nYour request \"{title}\" is now: {st_en}\n{link}\n")
    lines = [f"เรื่อง <b>{_esc(title)}</b> · ห้อง {_esc(room_no)} · {_esc(dorm)}",
             f"สถานะใหม่: <b>{st_th}</b> <span style='color:#5f6b7c'>({st_en})</span>"]
    if note:
        lines.append(f"ข้อความจากเจ้าของหอ: “{_esc(note)}”")
    _send(to, subject, text, _html("สถานะเรื่องแจ้งซ่อมของคุณเปลี่ยนแล้ว", lines, link, "ดูสถานะ / View status"), on_error)


def tenant_received(to, title, room_no, dorm, token, on_error=None):
    link = f"{PUBLIC_BASE_URL}/t/{token}"
    subject = f"[DormDesk] รับเรื่องแล้ว · {title} (ห้อง {room_no})"
    text = f"เราได้รับเรื่อง \"{title}\" ห้อง {room_no} ({dorm}) แล้ว\nติดตามสถานะ: {link}\n\nWe received your request. Track it: {link}\n"
    lines = [f"เราได้รับเรื่อง <b>{_esc(title)}</b> · ห้อง {_esc(room_no)} · {_esc(dorm)} แล้ว",
             "เก็บอีเมลนี้ไว้เพื่อเปิดลิงก์ติดตามสถานะ เราจะแจ้งอีกครั้งเมื่อสถานะเปลี่ยน"]
    _send(to, subject, text, _html("รับเรื่องแจ้งซ่อมแล้ว", lines, link, "ติดตามสถานะ / Track"), on_error)


def owner_new_request(to, title, room_no, dorm, category, urgent, on_error=None):
    link = f"{PUBLIC_BASE_URL}/admin"
    subject = f"[DormDesk] {'ด่วน · ' if urgent else ''}เรื่องใหม่ ห้อง {room_no}: {title}"
    text = f"เรื่องใหม่จากห้อง {room_no} ({dorm}) หมวด {category}: {title}\nเปิดระบบ: {link}\n"
    lines = [f"ห้อง <b>{_esc(room_no)}</b> · {_esc(dorm)} · หมวด {_esc(category)}", f"หัวข้อ: <b>{_esc(title)}</b>"]
    _send(to, subject, text, _html("มีเรื่องแจ้งซ่อมใหม่", lines, link, "เปิด DormDesk"), on_error)
