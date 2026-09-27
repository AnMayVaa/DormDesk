"""AI Insight for dorm owners — "ask your data" without letting a model touch the database.

Flow:  question -> intent (keyword rules) -> fixed, parameterised SQL inside tenant_tx(dorm_id) (RLS)
       -> FACTS (aggregates only: counts, hours, room numbers, category names — no tenant text/PII)
       -> writer: local LLM on ai-01 phrases the facts  |  template writer (instant, always available)
Guards: the LLM never sees credentials or tenant-written text; its answer is rejected if it mentions a
number that is not in FACTS (anti-hallucination) or if it is slow/down -> template answer instead.
"""
import json
import os
import re
import urllib.request

LLM_URL = os.environ.get("LLM_URL", "http://10.0.2.160:8080/v1/chat/completions")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_TIMEOUT = float(os.environ.get("LLM_TIMEOUT", "40"))

CAT_EN = {"electric": "Electrical", "water": "Water / plumbing", "aircon": "Air-con", "elevator": "Elevator",
          "furniture": "Broken item in room", "laundry": "Laundry", "parcel": "Parcels", "parking": "Parking", "other": "Other"}

INTENTS = [  # (intent, keywords) — Thai + English
    ("overdue", ["เกิน 48", "ค้างนาน", "ล่าช้า", "นานเกิน", "overdue", "late", "stuck", "48"]),
    ("repeat_rooms", ["ห้องไหน", "ซ้ำ", "เสียบ่อย", "repeat", "which room", "rooms"]),
    ("resolve_time", ["เวลา", "เร็ว", "ช้า", "กี่ชั่วโมง", "กี่ชม", "ซ่อมนาน", "average", "time", "fast", "slow", "hours", "how long"]),
    ("trend", ["เทียบ", "เดือนก่อน", "แนวโน้ม", "เพิ่มขึ้น", "ลดลง", "trend", "compare", "last month", "increase", "decrease"]),
    ("top_categories", ["หมวด", "ปัญหาไหน", "อะไรเสีย", "เยอะสุด", "บ่อยสุด", "most", "common", "category", "categories", "top"]),
    ("open_status", ["ค้าง", "เหลือ", "ยังไม่เสร็จ", "กี่เรื่อง", "open", "pending", "backlog", "left"]),
    ("summary", ["สรุป", "ภาพรวม", "summary", "overview", "report"]),
]
SUGGESTIONS = {
    "th": ["สรุปภาพรวมหอให้หน่อย", "30 วันที่ผ่านมาปัญหาไหนเยอะสุด", "ตอนนี้ค้างกี่เรื่อง",
           "มีเรื่องไหนค้างเกิน 48 ชั่วโมงบ้าง", "ห้องไหนแจ้งซ้ำบ่อย", "ซ่อมเสร็จเฉลี่ยกี่ชั่วโมง", "เดือนนี้เทียบกับเดือนก่อนเป็นอย่างไร"],
    "en": ["Give me an overview", "Which problems were most common in the last 30 days?", "How many requests are open?",
           "Anything open for over 48 hours?", "Which rooms keep reporting the same problem?",
           "How long does a repair take on average?", "How does this month compare with last month?"],
}


def detect_intent(q: str) -> str:
    q = (q or "").lower()
    best, score = "summary", 0
    for intent, kws in INTENTS:
        s = sum(1 for k in kws if k in q)
        if s > score:
            best, score = intent, s
    return best


def _cat(row, lang):
    return CAT_EN.get(row["code"], row["name_th"]) if lang == "en" else row["name_th"]


def gather(c, intent: str, lang: str) -> dict:
    """Run the fixed queries for one intent. `c` is a tenant_tx connection: RLS limits every row to this dorm."""
    f = {"intent": intent}
    if intent in ("top_categories", "summary"):
        rows = c.execute("SELECT c.code, c.name_th, count(*) AS n FROM requests q JOIN categories c ON c.id=q.category_id "
                         "WHERE q.created_at > now() - interval '30 days' GROUP BY c.code, c.name_th ORDER BY n DESC LIMIT 5").fetchall()
        f["period_days"] = 30
        f["top_categories"] = [{"category": _cat(r, lang), "count": r["n"]} for r in rows]
        f["total_30d"] = c.execute("SELECT count(*) AS n FROM requests WHERE created_at > now() - interval '30 days'").fetchone()["n"]
    if intent in ("open_status", "summary"):
        r = c.execute("SELECT count(*) FILTER (WHERE status='received') AS received, count(*) FILTER (WHERE status='in_progress') AS in_progress, "
                      "count(*) FILTER (WHERE status IN ('received','in_progress') AND priority='urgent') AS urgent_open, "
                      "round(max(extract(epoch FROM now()-created_at)/3600) FILTER (WHERE status IN ('received','in_progress'))) AS oldest_open_hours "
                      "FROM requests").fetchone()
        f.update({"open_received": r["received"], "open_in_progress": r["in_progress"], "open_total": r["received"] + r["in_progress"],
                  "urgent_open": r["urgent_open"], "oldest_open_hours": int(r["oldest_open_hours"] or 0)})
    if intent in ("overdue", "summary"):
        rows = c.execute("SELECT rm.room_no, c.code, c.name_th, q.status, round(extract(epoch FROM now()-q.created_at)/3600) AS h "
                         "FROM requests q JOIN rooms rm ON rm.id=q.room_id JOIN categories c ON c.id=q.category_id "
                         "WHERE q.status IN ('received','in_progress') AND q.created_at < now() - interval '48 hours' "
                         "ORDER BY q.created_at LIMIT 5").fetchall()
        f["overdue_count"] = len(rows)
        if intent == "overdue":
            f["overdue"] = [{"room": r["room_no"], "category": _cat(r, lang), "hours_open": int(r["h"])} for r in rows]
    if intent == "repeat_rooms":
        rows = c.execute("SELECT rm.room_no, c.code, c.name_th, count(*) AS n FROM requests q JOIN rooms rm ON rm.id=q.room_id "
                         "JOIN categories c ON c.id=q.category_id WHERE q.created_at > now() - interval '90 days' "
                         "GROUP BY rm.room_no, c.code, c.name_th HAVING count(*) >= 2 ORDER BY n DESC, rm.room_no LIMIT 5").fetchall()
        f["period_days"] = 90
        f["repeat_rooms"] = [{"room": r["room_no"], "category": _cat(r, lang), "times": r["n"]} for r in rows]
    if intent in ("resolve_time", "summary"):
        r = c.execute("SELECT round(avg(extract(epoch FROM done_at-created_at))/3600) AS h, count(*) AS n FROM requests "
                      "WHERE done_at IS NOT NULL AND created_at > now() - interval '30 days'").fetchone()
        f["avg_repair_hours_30d"] = int(r["h"]) if r["h"] is not None else None
        if intent == "resolve_time":
            rows = c.execute("SELECT c.code, c.name_th, round(avg(extract(epoch FROM q.done_at-q.created_at))/3600) AS h "
                             "FROM requests q JOIN categories c ON c.id=q.category_id WHERE q.done_at IS NOT NULL "
                             "AND q.created_at > now() - interval '90 days' GROUP BY c.code, c.name_th ORDER BY h DESC").fetchall()
            f["repaired_30d"] = r["n"]
            f["slowest"] = [{"category": _cat(x, lang), "hours": int(x["h"])} for x in rows[:2]]
            f["fastest"] = [{"category": _cat(x, lang), "hours": int(x["h"])} for x in rows[-2:][::-1]] if len(rows) > 2 else []
    if intent == "trend":
        r = c.execute("SELECT count(*) FILTER (WHERE created_at > now() - interval '30 days') AS cur, "
                      "count(*) FILTER (WHERE created_at <= now() - interval '30 days' AND created_at > now() - interval '60 days') AS prev "
                      "FROM requests").fetchone()
        rows = c.execute("SELECT c.code, c.name_th, count(*) FILTER (WHERE q.created_at > now() - interval '30 days') AS cur, "
                         "count(*) FILTER (WHERE q.created_at <= now() - interval '30 days' AND q.created_at > now() - interval '60 days') AS prev "
                         "FROM requests q JOIN categories c ON c.id=q.category_id GROUP BY c.code, c.name_th").fetchall()
        up = sorted(rows, key=lambda x: x["cur"] - x["prev"], reverse=True)
        f.update({"this_30d": r["cur"], "previous_30d": r["prev"]})
        f["biggest_increase"] = [{"category": _cat(x, lang), "now": x["cur"], "before": x["prev"]} for x in up[:1] if x["cur"] > x["prev"]]
    return f


# ------------------------------------------------------------------ template writer (always works)
def template(f: dict, lang: str) -> str:
    th = lang != "en"
    i = f["intent"]
    if i == "top_categories":
        if not f["top_categories"]:
            return "ช่วง 30 วันที่ผ่านมายังไม่มีการแจ้งซ่อม" if th else "No requests in the last 30 days."
        top = f["top_categories"][0]
        rest = ", ".join(f"{x['category']} {x['count']}" for x in f["top_categories"][1:3])
        return (f"30 วันที่ผ่านมามีการแจ้งซ่อม {f['total_30d']} เรื่อง หมวดที่เยอะที่สุดคือ {top['category']} ({top['count']} เรื่อง)"
                + (f" รองลงมาคือ {rest}" if rest else "") + " ถ้าหมวดแรกเกิดซ้ำบ่อย อาจคุ้มที่จะตรวจเช็กเชิงป้องกัน") if th else \
               (f"There were {f['total_30d']} requests in the last 30 days. The most common category was {top['category']} ({top['count']})"
                + (f", followed by {rest}" if rest else "") + ". If it keeps coming back, a preventive check may pay off.")
    if i == "open_status":
        return (f"ตอนนี้มีเรื่องค้าง {f['open_total']} เรื่อง (รอดำเนินการ {f['open_received']}, กำลังซ่อม {f['open_in_progress']})"
                f" เป็นเรื่องด่วน {f['urgent_open']} เรื่อง เรื่องที่ค้างนานที่สุด {f['oldest_open_hours']} ชั่วโมง") if th else \
               (f"{f['open_total']} requests are open ({f['open_received']} waiting, {f['open_in_progress']} in progress), "
                f"{f['urgent_open']} of them urgent. The oldest has been open for {f['oldest_open_hours']} hours.")
    if i == "overdue":
        if not f["overdue"]:
            return "ไม่มีเรื่องที่ค้างเกิน 48 ชั่วโมง ดีมาก" if th else "Nothing has been open for more than 48 hours."
        items = ", ".join((f"ห้อง {x['room']} ({x['category']}, {x['hours_open']} ชม.)" if th else f"room {x['room']} ({x['category']}, {x['hours_open']} h)") for x in f["overdue"])
        return (f"มี {f['overdue_count']} เรื่องที่ค้างเกิน 48 ชั่วโมง: {items} ควรติดตามเรื่องเหล่านี้ก่อน") if th else \
               (f"{f['overdue_count']} requests have been open for over 48 hours: {items}. Follow up on these first.")
    if i == "repeat_rooms":
        if not f["repeat_rooms"]:
            return "90 วันที่ผ่านมายังไม่มีห้องที่แจ้งปัญหาเดิมซ้ำ" if th else "No room reported the same problem twice in the last 90 days."
        items = ", ".join((f"ห้อง {x['room']} {x['category']} {x['times']} ครั้ง" if th else f"room {x['room']} {x['category']} {x['times']} times") for x in f["repeat_rooms"])
        return (f"ห้องที่แจ้งปัญหาเดิมซ้ำใน 90 วัน: {items} อาจถึงเวลาเปลี่ยนอุปกรณ์แทนการซ่อมซ้ำ") if th else \
               (f"Rooms reporting the same problem in the last 90 days: {items}. Replacing the equipment may be cheaper than repeat repairs.")
    if i == "resolve_time":
        if f["avg_repair_hours_30d"] is None:
            return "ยังไม่มีงานที่ซ่อมเสร็จใน 30 วันที่ผ่านมา" if th else "No repairs were completed in the last 30 days."
        slow = ", ".join(f"{x['category']} {x['hours']}" for x in f.get("slowest", []))
        return (f"30 วันที่ผ่านมาซ่อมเสร็จ {f['repaired_30d']} เรื่อง ใช้เวลาเฉลี่ย {f['avg_repair_hours_30d']} ชั่วโมง"
                + (f" หมวดที่ใช้เวลานานที่สุด (ชั่วโมง): {slow}" if slow else "")) if th else \
               (f"{f['repaired_30d']} repairs were completed in the last 30 days, taking {f['avg_repair_hours_30d']} hours on average."
                + (f" Slowest categories (hours): {slow}." if slow else ""))
    if i == "trend":
        d = f["this_30d"] - f["previous_30d"]
        inc = f["biggest_increase"][0] if f["biggest_increase"] else None
        return (f"30 วันล่าสุดมี {f['this_30d']} เรื่อง เทียบกับ {f['previous_30d']} เรื่องในช่วงก่อนหน้า ("
                + ("เพิ่มขึ้น " if d > 0 else "ลดลง " if d < 0 else "เท่าเดิม ") + (f"{abs(d)} เรื่อง)" if d else ")")
                + (f" หมวดที่เพิ่มขึ้นมากที่สุดคือ {inc['category']} ({inc['before']} → {inc['now']})" if inc else "")) if th else \
               (f"{f['this_30d']} requests in the last 30 days vs {f['previous_30d']} in the 30 days before ("
                + ("up " if d > 0 else "down " if d < 0 else "no change") + (f"{abs(d)})" if d else ")")
                + (f". Biggest increase: {inc['category']} ({inc['before']} → {inc['now']})." if inc else "."))
    # summary
    top = f["top_categories"][0] if f.get("top_categories") else None
    avg = f.get("avg_repair_hours_30d")
    return (f"ภาพรวม: ค้างอยู่ {f['open_total']} เรื่อง (ด่วน {f['urgent_open']}) และค้างเกิน 48 ชั่วโมง {f['overdue_count']} เรื่อง"
            + (f" · 30 วันที่ผ่านมามี {f['total_30d']} เรื่อง หมวดที่เยอะที่สุดคือ {top['category']} ({top['count']})" if top else "")
            + (f" · ซ่อมเสร็จเฉลี่ย {avg} ชั่วโมง" if avg is not None else "")) if th else \
           (f"Overview: {f['open_total']} open ({f['urgent_open']} urgent), {f['overdue_count']} open for over 48 hours"
            + (f" · {f['total_30d']} requests in 30 days, mostly {top['category']} ({top['count']})" if top else "")
            + (f" · average repair time {avg} hours." if avg is not None else "."))


# ------------------------------------------------------------------ LLM writer (ai-01)
SYSTEM = {
    "th": "คุณเป็นผู้ช่วยของเจ้าของหอพัก เขียน DRAFT ใหม่ให้เป็นภาษาไทยที่สุภาพ อ่านง่าย เป็นกันเอง 2-3 ประโยค "
          "ต้องคงตัวเลข เลขห้อง และชื่อหมวดทุกตัวไว้ตรงตาม DRAFT ห้ามเพิ่มข้อมูลหรือตัวเลขใหม่ ห้ามใช้หัวข้อหรือ bullet /no_think",
    "en": "You help a dorm owner. Rewrite the DRAFT in friendly, natural English in 2-3 sentences. Keep every number, room number "
          "and category exactly as in the DRAFT. Do not add any new facts or numbers. No headings or bullet points. /no_think",
}


def _numbers(s: str):
    return {n.lstrip("0") or "0" for n in re.findall(r"\d+", s)}


def llm(question: str, draft: str, lang: str, labels=()):
    """Tiny local models phrase well but reason badly, so the model only REWRITES the template draft.
    Accepted only if it keeps exactly the same set of numbers as the draft; otherwise the draft is used."""
    if not LLM_API_KEY:
        return None
    payload = {"messages": [{"role": "system", "content": SYSTEM["en" if lang == "en" else "th"]},
                            {"role": "user", "content": f"QUESTION: {question[:300]}\nDRAFT: {draft}"}],
               "max_tokens": 220, "temperature": 0.2}
    req = urllib.request.Request(LLM_URL, data=json.dumps(payload).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {LLM_API_KEY}"})
    try:
        with urllib.request.urlopen(req, timeout=LLM_TIMEOUT) as r:
            out = json.load(r)["choices"][0]["message"]["content"]
    except Exception:
        return None
    out = re.sub(r"<think>.*?</think>", "", out, flags=re.S).replace("</think>", "").replace("<think>", "")
    out = re.sub(r"^[\s\-•*]+", "", re.sub(r"[*#`_]{1,3}", "", out), flags=re.M).strip()
    out = re.sub(r"\s*\n\s*", " ", out)
    out = re.sub(r"^(DRAFT|QUESTION|ANSWER|คำตอบ)\s*:\s*", "", out, flags=re.I)
    if not out or len(out) > 3 * len(draft) + 200:
        return None
    if _numbers(out) != _numbers(draft):      # lost or invented a number -> reject (anti-hallucination)
        return None
    if not _same_bindings(draft, out, labels):   # a number moved to the wrong category/room -> reject
        return None
    return out


def _labels(f: dict):
    """Names that numbers belong to: categories and rooms found in FACTS."""
    out = set()
    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                if k in ("category", "room") and isinstance(v, str):
                    out.add(v)
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(f)
    return sorted(out, key=len, reverse=True)


def _same_bindings(draft: str, out: str, labels) -> bool:
    """Every 'label ... number' pair in the answer must match the draft (e.g. Air-con stays 19, not 36)."""
    def pairs(text, lab):
        return [m.group(1) for m in re.finditer(re.escape(lab) + r"[^\d]{0,12}?(\d+)", text)]
    for lab in labels:
        want = set(pairs(draft, lab))
        if any(n not in want for n in pairs(out, lab)):
            return False
    return True


def llm_up() -> bool:
    if not LLM_API_KEY:
        return False
    try:
        with urllib.request.urlopen(LLM_URL.replace("/v1/chat/completions", "/health"), timeout=3) as r:
            return r.status == 200
    except Exception:
        return False
