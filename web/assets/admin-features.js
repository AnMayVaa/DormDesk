// Owner / manager tabs for the v2 features: บิล & ค่าปรับ · ที่จอดรถ · ส่วนกลาง · ตั้งค่าฟีเจอร์, the new dashboard
// section and "change tenant". admin.js calls these through window.DD_ADMIN_EXT. User data -> textContent only.
(function () {
  const t = (k, v) => DD_I18N.t(k, v);
  const el = DD.el;
  const money = (s) => (Number(s || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money0 = (s) => (Number(s || 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const baht = (s) => t("{n} บาท", { n: money(s) });
  const dDate = (x) => (x ? new Date(x).toLocaleDateString(DD_I18N.locale, { day: "numeric", month: "short", year: "2-digit" }) : "-");
  const dShort = (x) => new Date(x).toLocaleDateString(DD_I18N.locale, { weekday: "short", day: "numeric", month: "short" });
  const hm = (x) => new Date(x).toLocaleTimeString(DD_I18N.locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  const key = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random()).toString();
  const periodName = (p) => {
    if (!p) return "";
    if (p[0] === "F") return t("ค่าปรับแยก");
    const [y, m] = p.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(DD_I18N.locale, { month: "short", year: "numeric" });
  };
  const BILL = { draft: ["ร่าง", "rejected"], unpaid: ["รอชำระ", "in_progress"], slip_sent: ["สลิปรอตรวจ", "received"], returned: ["ตีกลับแล้ว", "urgent"],
    overdue: ["เกินกำหนด", "urgent"], paid: ["ชำระแล้ว", "done"], cancelled: ["ยกเลิก", "rejected"] };
  const FINE = { open: ["รอผู้เช่า", "in_progress"], disputed: ["โต้แย้ง", "urgent"], confirmed: ["ยืนยันแล้ว", "received"], billed: ["รวมในบิลแล้ว", "done"], cancelled: ["ยกเลิก", "rejected"] };
  const FPRE = { late: "จ่ายช้า", damage: "ทำของเสียหาย", noise: "เสียงดังรบกวน", parking: "ผิดกฎที่จอด", other: "อื่น ๆ" };
  const LPRE = { rent: ["home", "ค่าเช่าห้อง"], water: ["droplet", "ค่าน้ำ"], electric: ["zap", "ค่าไฟ"], parking: ["car", "ค่าที่จอดรถ"], common: ["building", "ค่าส่วนกลาง"],
    fine: ["alert", "ค่าปรับ"], late_fee: ["clock", "ค่าปรับจ่ายช้า"], adjust: ["repeat", "ปรับยอด"], other: ["plus", "อื่น ๆ"] };
  const VT = { car: "รถยนต์", moto: "มอเตอร์ไซค์" };
  const badge = (map, s) => el("span", { class: "badge " + ((map[s] || [])[1] || "") }, (map[s] || [s])[0]);
  const card = (icon, title, ...body) => el("section", { class: "card mt-2" },
    el("div", { class: "card-title" }, DD.icon(icon), el("h2", { class: "mt-0", text: title })), ...body);
  const kpi = (icon, tone, v, l) => el("div", { class: "card kpi" }, el("div", { class: "kpi-icon " + tone }, DD.icon(icon)), el("div", { class: "v", text: v }), el("div", { class: "l", text: l }));
  const tbl = (head, rows, empty) => rows.length ? el("div", { class: "tbl-wrap" }, el("table", { class: "tbl" },
    el("thead", {}, el("tr", {}, head.map((h) => el("th", { text: h })))), el("tbody", {}, rows))) : DD.empty("checkCircle", empty, null);
  const room = (no) => el("td", { class: "room-no", text: no, translate: "no" });
  const errorBox = (box, e) => box.replaceChildren(DD.errorBox(e));
  const steps = (items) => el("div", { class: "steps" }, items.map(([label, cls]) => el("span", { class: cls || "", text: label })));
  function thread(msgs) {
    if (!msgs || !msgs.length) return el("p", { class: "small muted", text: t("ยังไม่มีข้อความ") });
    return el("div", { class: "thread" }, msgs.map((m) => el("div", { class: "msg " + (m.author === "tenant" ? "owner" : "me") },
      el("span", { class: "who", text: (m.author === "tenant" ? t("ผู้เช่า") : t("เจ้าของหอ")) + " · " + DD.fmt(m.created_at) }), el("span", { translate: "no", text: m.body }))));
  }
  function composer(send) {
    const inp = el("input", { class: "input", maxlength: 1000, placeholder: "พิมพ์ข้อความถึงผู้เช่า", "aria-label": "ข้อความ" });
    const err = el("div");
    return el("div", {}, el("form", { class: "composer", onsubmit: async (ev) => {
      ev.preventDefault(); if (!inp.value.trim()) return;
      try { await send(inp.value.trim()); inp.value = ""; } catch (e) { errorBox(err, e); }
    } }, inp, el("button", { class: "btn", type: "submit", "aria-label": "ส่ง" }, DD.icon("send"))), err);
  }
  function drawer(label, build) {
    const prev = document.activeElement;
    const ov = el("div", { class: "overlay" });
    const dr = el("aside", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": label }, el("div", { class: "drawer-body" }, DD.skeletonLines(6)));
    const close = () => { ov.remove(); dr.remove(); document.removeEventListener("keydown", onKey); prev && prev.focus && prev.focus(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    ov.addEventListener("click", close); document.addEventListener("keydown", onKey);
    document.body.append(ov, dr);
    const head = (title, ...extra) => el("div", { class: "drawer-head" }, el("div", { class: "spacer" }, el("h2", { class: "mt-0", text: title, translate: "no" }), ...extra),
      el("button", { class: "icon-btn", type: "button", "aria-label": "ปิด", onclick: close }, DD.icon("x")));
    const fill = async () => { try { dr.replaceChildren(...await build({ close, head, refill: fill })); } catch (e) { close(); throw e; } };
    return fill();
  }
  function ask({ title, label, value = "", ok = "ยืนยัน", danger = false, min = 3 }) {   // small modal with one text field
    return new Promise((resolve) => {
      const ta = el("textarea", { class: "textarea", id: "askTa", maxlength: 500 }); ta.value = value;
      const err = el("div", { class: "err-text" }, DD.icon("alert"), t("กรอกอย่างน้อย {n} ตัวอักษร", { n: min }));
      const f = el("div", { class: "field mt-0" }, el("label", { for: "askTa", text: label }), ta, err);
      const close = (v) => { ov.remove(); m.remove(); resolve(v); };
      const ov = el("div", { class: "overlay", onclick: () => close(null) });
      const m = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title }, el("h2", { text: title }), f,
        el("div", { class: "row mt-2" }, el("span", { class: "spacer" }), el("button", { class: "btn ghost", type: "button", onclick: () => close(null) }, "ยกเลิก"),
          el("button", { class: "btn" + (danger ? " danger" : ""), type: "button", onclick: () => { if (ta.value.trim().length < min) { f.classList.add("invalid"); return; } close(ta.value.trim()); } }, ok)));
      document.body.append(ov, m); ta.focus();
    });
  }
  const api = DD.api;

  // ================================================================ tabs visibility + counts
  let SYNC = { dorm: null, at: 0, s: null };
  async function syncTabs(ctx) {
    if (SYNC.dorm !== ctx.dormId || Date.now() - SYNC.at > 30000) {
      const [st, ex] = await Promise.all([api(`/api/admin/dorms/${ctx.dormId}/settings`), api(`/api/admin/dorms/${ctx.dormId}/dashboard/extras`)]);
      SYNC = { dorm: ctx.dormId, at: Date.now(), s: st.settings, ex };
    }
    const s = SYNC.s, ex = SYNC.ex;
    let current = null;
    document.querySelectorAll("#tabs [data-feature]").forEach((b) => {
      const on = b.dataset.feature.split(" ").some((f) => s["f_" + f]);
      b.classList.toggle("hidden", !on);
      if (!on && b.getAttribute("aria-selected") === "true") current = "dash";
    });
    const bc = document.getElementById("billCount"), pc = document.getElementById("parkCount");
    const nb = (ex.finance ? ex.finance.slip_pending : 0) + (ex.fines || []).filter((f) => f.status === "disputed").length;
    bc.textContent = nb; bc.classList.toggle("hidden", !nb);
    const np = ex.parking ? ex.parking.pending : 0;
    pc.textContent = np; pc.classList.toggle("hidden", !np);
    return current;
  }
  const invalidate = () => { SYNC.at = 0; };

  // ================================================================ dashboard: "ส่วนกลาง & การเงิน" section
  async function dashExtras(panel, ctx) {
    const x = await api(`/api/admin/dorms/${ctx.dormId}/dashboard/extras`);
    const f = x.features;
    if (!Object.values(f).some(Boolean)) return;
    const box = el("div", {}, el("div", { class: "section-split" }, el("h2", { class: "mt-0", text: t("ส่วนกลาง & การเงิน") }), el("span", { class: "tag", text: t("ใหม่") })));
    if (x.finance) {
      const fin = x.finance, pct = fin.expected ? Math.round((fin.collected / fin.expected) * 100) : 0;
      box.append(el("h3", { text: t("การเงิน · บิล {p}", { p: periodName(x.period) }) }),
        el("div", { class: "kpis" }, kpi("checkCircle", "green", fin.paid, t("ห้องชำระแล้ว (จาก {n})", { n: fin.rooms })), kpi("upload", "sky", fin.slip_pending, t("สลิปรอยืนยัน")),
          kpi("clock", "amber", fin.unpaid, t("ยังไม่ชำระ (ยังไม่ถึงกำหนด)")), kpi("alert", "pink", fin.overdue, t("เกินกำหนด"))));
      const meter = el("div", { class: "meter lg" }, el("span", { style: `width:${pct}%` }));
      const fines = x.fines || [];
      box.append(el("div", { class: "two-col mt-2" },
        el("section", { class: "card" }, el("div", { class: "card-title" }, DD.icon("wallet"), el("h3", { class: "mt-0", text: t("ยอดเก็บได้เดือนนี้") })),
          el("div", { class: "row" }, el("span", { class: "big-num num", text: money0(fin.collected) }), el("span", { class: "muted", text: t("/ {n} บาท", { n: money0(fin.expected) }) }),
            el("span", { class: "spacer" }), el("span", { class: "badge received", text: pct + "%" })), meter,
          fin.drafts ? el("p", { class: "small mt-1" }, el("span", { class: "badge in_progress", text: t("ร่าง {n} ใบ รอกรอกมิเตอร์/ออกบิล", { n: fin.drafts }) })) : null,
          el("h3", { class: "mt-3", text: t("ห้องเกินกำหนด") }),
          tbl([t("ห้อง"), t("ยอดค้าง"), t("เกินมา"), t("ค่าปรับจ่ายช้า")], fin.overdue_rooms.map((o) => el("tr", {}, room(o.room_no),
            el("td", { class: "num", text: money(o.total) }), el("td", { text: t("{n} วัน", { n: o.days }) }), el("td", { class: "num", text: o.late_fee ? money(o.late_fee) : "-" }))), t("ไม่มีห้องค้างเกินกำหนด"))),
        el("section", { class: "card" }, el("div", { class: "card-title" }, DD.icon("alert"), el("h3", { class: "mt-0", text: t("ค่าปรับ") })),
          fines.length ? el("div", {}, fines.map((fi) => el("div", { class: "list-row c3" }, el("span", { class: "room-no", text: fi.room_no, translate: "no" }),
            el("span", {}, el("span", { translate: "no", text: fi.title }), el("div", { class: "row-meta", text: baht(fi.amount) })), badge(FINE, fi.status)))) : el("p", { class: "small muted", text: t("ไม่มีค่าปรับที่ค้างอยู่") }))));
    }
    const three = el("div", { class: "grid-3 mt-3" });
    if (x.parking) {
      const p = x.parking, mx = Math.max(p.pending, p.cancelling, p.over_quota, p.waitlist, 1);
      const bar = (l, v, warm) => el("div", { class: "bar" }, el("span", { text: l }), el("span", { class: "track" }, el("span", { class: "fill" + (warm ? " warm" : ""), style: `width:${(v / mx) * 100}%` })), el("span", { class: "val", text: v }));
      three.append(el("section", { class: "card" }, el("div", { class: "card-title" }, DD.icon("car"), el("h3", { class: "mt-0", text: t("ที่จอดรถ") })),
        el("div", { class: "row" }, el("span", { class: "big-num", text: p.used }), el("span", { class: "muted", text: p.total ? t("/ {n} ช่องถูกใช้", { n: p.total }) : t("สิทธิ์ที่ใช้งานอยู่") })),
        p.total ? el("div", { class: "meter" }, el("span", { style: `width:${Math.min(100, (p.used / p.total) * 100)}%` })) : null,
        el("div", { class: "bars mt-2" }, bar(t("รออนุมัติ"), p.pending), bar(t("กำลังยกเลิก"), p.cancelling, true), bar(t("เกินโควตา"), p.over_quota, true), bar(t("คิวรอ"), p.waitlist))));
    }
    if (x.spaces) {
      const sp = x.spaces;
      three.append(el("section", { class: "card" }, el("div", { class: "card-title" }, DD.icon("calendar"), el("h3", { class: "mt-0", text: t("ห้องส่วนกลาง") })),
        el("div", { class: "row" }, el("span", { class: "big-num", text: sp.today }), el("span", { class: "muted", text: t("การจองวันนี้") })),
        el("div", { class: "bars mt-2" }, el("div", { class: "bar" }, el("span", { text: t("จองแล้วไม่มา (30 วัน)") }),
          el("span", { class: "track" }, el("span", { class: "fill warm", style: `width:${sp.no_show_rate_30d}%` })), el("span", { class: "val", text: sp.no_show_rate_30d + "%" }))),
        sp.banned.length ? el("p", { class: "small mt-2" }, el("span", { class: "badge urgent" }, DD.icon("ban"), t("งดจอง {n} ห้อง", { n: sp.banned.length })), " ",
          el("span", { class: "muted", text: sp.banned.map((b) => t("ห้อง {r} ถึง {d}", { r: b.room_no, d: dDate(b.until) })).join(", ") })) : null));
    }
    if (x.checkin) {
      const c = x.checkin, mx = Math.max(...c.busy_hours.map((b) => Number(b.avg)), 1);
      const top = c.busy_hours.slice().sort((a, b) => b.avg - a.avg).slice(0, 4).sort((a, b) => a.h - b.h);
      three.append(el("section", { class: "card" }, el("div", { class: "card-title" }, DD.icon("dumbbell"), el("h3", { class: "mt-0", text: t("ฟิตเนสและสระ ตอนนี้") })),
        ...c.now.map((f) => el("div", {}, el("div", { class: "row mt-1" }, el("span", { translate: "no", text: f.name }), el("span", { class: "spacer" }), el("strong", { text: f.n }), el("span", { class: "muted", text: f.capacity ? "/" + f.capacity : "" })),
          f.capacity ? el("div", { class: "meter" + (f.n / f.capacity >= 0.8 ? " busy" : "") }, el("span", { style: `width:${Math.min(100, (f.n / f.capacity) * 100)}%` })) : null)),
        el("div", { class: "xs muted mt-2", text: t("ช่วงที่คนแน่น (เฉลี่ยต่อวัน 30 วัน)") }),
        el("div", { class: "bars mt-1" }, top.map((b) => el("div", { class: "bar" }, el("span", { text: `${String(b.h).padStart(2, "0")}:00` }),
          el("span", { class: "track" }, el("span", { class: "fill" + (b.avg >= mx * 0.8 ? " warm" : ""), style: `width:${(b.avg / mx) * 100}%` })), el("span", { class: "val", text: b.avg }))))));
    }
    if (three.children.length) box.append(three);
    panel.append(box);
  }

  // ================================================================ billing & fines
  const B = { period: null };
  async function billing(panel, ctx) {
    panel.replaceChildren(el("div", { class: "card" }, DD.skeletonLines(8)));
    const now = new Date();
    B.period = B.period || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const [b, st] = await Promise.all([api(`/api/admin/dorms/${ctx.dormId}/billing?period=${B.period}`), api(`/api/admin/dorms/${ctx.dormId}/settings`)]);
    const s = st.settings;
    const out = [];
    const per = el("input", { class: "input w-150", type: "month", value: b.period, "aria-label": "งวด" });
    per.addEventListener("change", () => { if (per.value) { B.period = per.value; billing(panel, ctx); } });
    // ---- slips waiting
    const slipDlg = el("div");
    if (s.f_bills) {
      out.push(el("section", { class: "card" }, el("div", { class: "card-title" }, DD.icon("upload"), el("h2", { class: "mt-0", text: t("สลิปรอยืนยัน") }),
        el("span", { class: "badge in_progress", text: String(b.slips_pending.length) })),
      tbl([t("ห้อง"), t("งวด"), t("ยอดบิล"), t("ส่งเมื่อ"), t("สลิป"), ""], b.slips_pending.map((x) => el("tr", {}, room(x.room_no), el("td", { text: periodName(x.period) }),
        el("td", { class: "num", text: money(x.total) }), el("td", { text: DD.fmt(x.sent_at) }),
        el("td", {}, el("a", { class: "btn ghost sm", href: `/api/admin/bills/${x.bill_id}/slips/${x.slip_id}`, target: "_blank", rel: "noopener" }, DD.icon("image"), "ดูสลิป")),
        el("td", {}, el("div", { class: "row" },
          el("button", { class: "btn ok sm", type: "button", onclick: async () => {
            try { const r = await api(`/api/admin/bills/${x.bill_id}/confirm`, { method: "POST" }); DD.toast(t("ยืนยันแล้ว · ใบเสร็จ {n}", { n: r.receipt_no })); invalidate(); billing(panel, ctx); } catch (e) { ctx.fail(e); }
          } }, DD.icon("check"), "ยืนยัน"),
          el("button", { class: "btn ghost sm", type: "button", onclick: async () => {
            const msg = await ask({ title: t("ตีกลับสลิปห้อง {r}", { r: x.room_no }), label: t("ข้อความถึงผู้เช่า"), ok: t("ส่งข้อความและตีกลับ") });
            if (!msg) return;
            try { await api(`/api/admin/bills/${x.bill_id}/return`, { method: "POST", json: { message: msg } }); DD.toast(t("ตีกลับแล้ว")); invalidate(); billing(panel, ctx); } catch (e) { ctx.fail(e); }
          } }, "ตีกลับ"))))), t("ไม่มีสลิปรอยืนยัน")), slipDlg));
    }
    // ---- monthly table: rent + meters + bill per room
    if (s.f_bills) {
      const metered = { water: s.water_mode === "meter", elec: s.elec_mode === "meter" };
      const inputs = [];
      const rows = b.rooms.map((r) => {
        const rent = el("input", { class: "input w-110", inputmode: "decimal", value: r.rent / 100, "aria-label": t("ค่าเช่าห้อง {r}", { r: r.room_no }) });
        const w = el("input", { class: "input w-80", inputmode: "decimal", value: r.water_units ?? "", disabled: !metered.water, "aria-label": t("หน่วยน้ำห้อง {r}", { r: r.room_no }) });
        const e = el("input", { class: "input w-80", inputmode: "decimal", value: r.elec_units ?? "", disabled: !metered.elec, "aria-label": t("หน่วยไฟห้อง {r}", { r: r.room_no }) });
        inputs.push({ r, rent, w, e });
        return el("tr", {}, room(r.room_no), el("td", {}, rent), el("td", {}, w), el("td", {}, e),
          el("td", {}, r.bill_id ? badge(BILL, r.eff_status) : el("span", { class: "muted small", text: t("ยังไม่มีบิล") })),
          el("td", { class: "num", text: r.bill_id ? money(r.total) : "" }),
          el("td", {}, r.bill_id ? el("button", { class: "btn ghost sm", type: "button", onclick: () => billDrawer(r.bill_id, ctx, () => billing(panel, ctx)) }, "เปิด") : null));
      });
      const err = el("div");
      const save = el("button", { class: "btn ghost", type: "button" }, DD.icon("check"), "บันทึกค่าเช่า/มิเตอร์");
      const num = (v) => (String(v).trim() === "" ? null : Number(String(v).replace(/,/g, "")));
      const saveMeters = () => api(`/api/admin/dorms/${ctx.dormId}/meters`, { method: "PUT", json: { period: b.period,
        rows: inputs.map(({ r, rent, w, e }) => ({ room_id: r.room_id, rent: num(rent.value) ?? 0, water_units: num(w.value), elec_units: num(e.value) })) } });
      save.addEventListener("click", async () => { try { await saveMeters(); DD.toast(t("บันทึกแล้ว")); } catch (x) { errorBox(err, x); } });
      const gen = el("button", { class: "btn", type: "button" }, DD.icon("receipt"), "สร้างบิลงวดนี้");
      gen.addEventListener("click", async () => {
        try {
          await saveMeters();
          const r = await api(`/api/admin/dorms/${ctx.dormId}/bills/generate`, { method: "POST", json: { period: b.period, issue: true } });
          DD.toast(t("สร้าง {a} ใบ · ส่งให้ผู้เช่า {b} ใบ", { a: r.created, b: r.issued }));
          if (r.needs_meter.length) DD.toast(t("ห้องที่ยังไม่มีเลขมิเตอร์: {r}", { r: r.needs_meter.join(", ") }), "err");
          invalidate(); billing(panel, ctx);
        } catch (x) { errorBox(err, x); }
      });
      out.push(el("section", { class: "card mt-2" }, el("div", { class: "card-title" }, DD.icon("receipt"), el("h2", { class: "mt-0", text: t("บิลรายเดือน") }), el("span", { class: "spacer" }), per),
        el("p", { class: "small muted", text: t("กรอกค่าเช่าและเลขหน่วยมิเตอร์ แล้วกด \"สร้างบิลงวดนี้\" ห้องที่ครบจะส่งบิลให้ผู้เช่าทันที ห้องที่ยังไม่มีมิเตอร์จะเป็นร่าง") }),
        tbl([t("ห้อง"), t("ค่าเช่า (บาท)"), t("น้ำ (หน่วย)"), t("ไฟ (หน่วย)"), t("สถานะ"), t("ยอด"), ""], rows, t("ยังไม่มีห้อง")),
        el("div", { class: "row wrap mt-2" }, save, gen), err));
      if (b.outstanding_other.length) out.push(card("clock", t("ค้างชำระงวดอื่น / ผู้เช่าก่อนหน้า"),
        tbl([t("ห้อง"), t("งวด"), t("ยอด"), t("ครบกำหนด"), t("สถานะ"), ""], b.outstanding_other.map((x) => el("tr", {}, room(x.room_no), el("td", { text: periodName(x.period) }),
          el("td", { class: "num", text: money(x.total) }), el("td", { text: dDate(x.due_date) }),
          el("td", {}, badge(BILL, x.eff_status), x.prev_tenant ? el("span", { class: "badge rejected", text: t("ผู้เช่าก่อนหน้า") }) : null),
          el("td", {}, el("button", { class: "btn ghost sm", type: "button", onclick: () => billDrawer(x.id, ctx, () => billing(panel, ctx)) }, "เปิด")))), "")));
      out.push(autoBillCard(s, ctx, () => billing(panel, ctx)));
    }
    if (s.f_fines) out.push(await finesSection(ctx, () => billing(panel, ctx)));
    panel.replaceChildren(...out);
  }

  function autoBillCard(s, ctx, reload) {
    const f = {};
    const sw = (k, label) => { f[k] = el("input", { type: "checkbox", checked: s[k], "aria-label": label }); return el("label", { class: "switch" }, f[k], el("span")); };
    const num = (k, cls, scale = 1) => { f[k] = el("input", { class: "input " + (cls || "w-80"), inputmode: "decimal", value: s[k] / scale }); f[k].dataset.scale = scale; return f[k]; };
    const sel = (k, opts) => { f[k] = el("select", { class: "select w-150" }, opts.map(([v, l]) => el("option", { value: v, text: t(l), selected: s[k] === v }))); return f[k]; };
    const err = el("div");
    const modes = [["meter", "ตามมิเตอร์"], ["flat", "เหมาจ่าย"], ["none", "ไม่เก็บ"]];
    return el("section", { class: "card mt-2" }, el("div", { class: "card-title" }, DD.icon("repeat"), el("h2", { class: "mt-0", text: t("บิลอัตโนมัติรายเดือน") })),
      el("div", { class: "set-row" }, el("span", { class: "spacer", text: t("เปิดใช้บิลอัตโนมัติ") }), sw("bill_auto", t("เปิดบิลอัตโนมัติ"))),
      el("div", { class: "set-row" }, el("span", { class: "spacer", text: t("ออกบิลทุกวันที่") }), num("bill_issue_day")),
      el("div", { class: "set-row" }, el("span", { class: "spacer", text: t("ครบกำหนดชำระวันที่") }), num("bill_due_day")),
      el("div", { class: "set-row" }, el("span", { class: "spacer", text: t("ค่าส่วนกลาง (บาท/เดือน)") }), num("common_fee", "w-110", 100)),
      el("div", { class: "set-row" }, el("span", { class: "spacer", text: t("ค่าน้ำ") }), sel("water_mode", modes), el("span", { class: "xs muted", text: t("บาท/หน่วย") }), num("water_rate", "w-80", 100),
        el("span", { class: "xs muted", text: t("เหมา") }), num("water_flat", "w-80", 100)),
      el("div", { class: "set-row" }, el("span", { class: "spacer", text: t("ค่าไฟ") }), sel("elec_mode", modes), el("span", { class: "xs muted", text: t("บาท/หน่วย") }), num("elec_rate", "w-80", 100),
        el("span", { class: "xs muted", text: t("เหมา") }), num("elec_flat", "w-80", 100)),
      el("div", { class: "alert warn mt-2" }, DD.icon("clock"), el("span", { text: t("ค่าน้ำไฟแบบมิเตอร์ ต้องกรอกเลขหน่วยก่อน บิลห้องนั้นจะเป็นร่างจนกว่าจะกรอก") })),
      el("div", { class: "set-row" }, el("span", { class: "spacer" }, t("ค่าปรับจ่ายช้าอัตโนมัติ"), el("br"),
        el("span", { class: "xs muted", text: t("เกินกำหนดกี่วัน · บาทต่อวัน (รวมในบิลถัดไป)") })), num("late_fee_grace_d"), num("late_fee_per_day", "w-80", 100), sw("late_fee_enabled", t("ค่าปรับจ่ายช้า"))),
      el("div", { class: "set-row" }, el("span", { class: "spacer", text: t("เลขพร้อมเพย์ของหอ") }),
        (f.promptpay_id = el("input", { class: "input w-150", inputmode: "numeric", value: s.promptpay_id || "", placeholder: "เบอร์ 10 หลัก / เลข 13 หลัก" }))),
      el("button", { class: "btn mt-2", type: "button", onclick: async () => {
        const body = {};
        for (const [k, inp] of Object.entries(f)) {
          if (inp.type === "checkbox") body[k] = inp.checked;
          else if (inp.tagName === "SELECT" || k === "promptpay_id") body[k] = inp.value.trim() || null;
          else body[k] = Math.round(Number(String(inp.value).replace(/,/g, "")) * Number(inp.dataset.scale || 1));
        }
        try { await api(`/api/admin/dorms/${ctx.dormId}/settings`, { method: "PUT", json: body }); DD.toast(t("บันทึกการตั้งค่าบิลแล้ว")); invalidate(); reload(); } catch (e) { errorBox(err, e); }
      } }, "บันทึก"), err);
  }

  async function billDrawer(id, ctx, reload) {
    await drawer(t("บิล"), async ({ close, head, refill }) => {
      const b = await api(`/api/admin/bills/${id}`);
      const editable = !["paid", "cancelled"].includes(b.status);
      const rows = b.lines.map((l) => ({ preset: l.preset, label: l.label, note: l.note, amount: l.amount / 100 }));
      const body = el("tbody");
      const total = el("span", { class: "num" });
      const draw = () => {
        body.replaceChildren(...rows.map((r, i) => {
          const note = el("input", { class: "input", value: r.note, maxlength: 80, "aria-label": t("หมายเหตุ"), disabled: !editable, oninput: (e) => { r.note = e.target.value; } });
          const amt = el("input", { class: "input w-110", inputmode: "decimal", value: r.amount, "aria-label": t("ยอด"), disabled: !editable, oninput: (e) => { r.amount = Number(e.target.value) || 0; sum(); } });
          return el("tr", {}, el("td", { text: t(r.label || LPRE[r.preset][1]) }), el("td", {}, note), el("td", {}, amt),
            el("td", {}, editable ? el("button", { class: "icon-btn", type: "button", "aria-label": t("ลบรายการ"), onclick: () => { rows.splice(i, 1); draw(); } }, DD.icon("x")) : null));
        }));
        sum();
      };
      const sum = () => { total.textContent = baht(Math.round(rows.reduce((s, r) => s + Number(r.amount || 0), 0) * 100)); };
      const presets = el("div", { class: "chips mt-0" }, Object.entries(LPRE).map(([k, [icon, label]]) =>
        el("button", { class: "preset", type: "button", disabled: !editable, onclick: () => { rows.push({ preset: k, label: k === "other" ? "" : label, note: "", amount: 0 }); draw(); } }, DD.icon(icon), label)));
      const reason = el("input", { class: "input", id: "billWhy", maxlength: 200, placeholder: "เช่น จดเลขมิเตอร์ไฟผิด" });
      const err = el("div");
      draw();
      const act = (label, cls, fn) => el("button", { class: "btn " + cls, type: "button", onclick: async () => { try { await fn(); invalidate(); reload(); await refill(); } catch (e) { errorBox(err, e); } } }, label);
      return [head(t("บิลห้อง {r} · {p}", { r: b.room_no, p: periodName(b.period) }), el("div", { class: "row wrap" }, badge(BILL, b.eff_status),
          b.prev_tenant ? el("span", { class: "badge rejected", text: t("ผู้เช่าก่อนหน้า") }) : null,
          el("span", { class: "xs muted", text: t("ครบกำหนด {d}", { d: dDate(b.due_date) }) }), b.receipt_no ? el("span", { class: "xs muted", text: t("ใบเสร็จ {n}", { n: b.receipt_no }) }) : null)),
        el("div", { class: "drawer-body stack" },
          editable ? el("div", {}, el("div", { class: "field-label", text: t("เพิ่มรายการ (กดหัวข้อ แล้วกรอกยอด)") }), presets) : el("div", { class: "alert info" }, DD.icon("shield"),
            el("span", { text: t("บิลที่ชำระแล้วแก้ไม่ได้ ถ้าต้องปรับ ให้ใส่รายการ \"ปรับยอด\" ในบิลถัดไป") })),
          el("div", { class: "tbl-wrap" }, el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, [t("รายการ"), t("หมายเหตุ"), t("ยอด (บาท)"), ""].map((h) => el("th", { text: h })))), body)),
          el("div", { class: "bill-total" }, el("span", { text: t("รวม") }), total),
          editable && b.status !== "draft" ? el("div", { class: "field" }, el("label", { for: "billWhy" }, t("เหตุผลที่แก้ไข") + " ", el("span", { class: "hint", text: t("(ต้องกรอก ผู้เช่าจะได้รับแจ้ง)") })), reason) : null,
          err,
          el("div", { class: "row wrap" },
            editable ? act(t("บันทึกการแก้ไข"), "", () => api(`/api/admin/bills/${id}`, { method: "PATCH", json: { lines: rows.map((r) => ({ preset: r.preset, label: r.label, note: r.note, amount: Number(r.amount) || 0 })), reason: reason.value.trim() } })) : null,
            b.status === "draft" ? act(t("ส่งบิลให้ผู้เช่า"), "ok", () => api(`/api/admin/bills/${id}/issue`, { method: "POST" })) : null,
            ["unpaid", "returned", "slip_sent"].includes(b.status) ? act(t("ยืนยันรับเงินแล้ว"), "ok", () => api(`/api/admin/bills/${id}/confirm`, { method: "POST" })) : null,
            editable ? el("button", { class: "btn ghost", type: "button", onclick: async () => {
              const why = await ask({ title: t("ยกเลิกบิลนี้?"), label: t("เหตุผล"), ok: t("ยกเลิกบิล"), danger: true });
              if (!why) return;
              try { await api(`/api/admin/bills/${id}/cancel`, { method: "POST", json: { reason: why } }); invalidate(); reload(); close(); } catch (e) { errorBox(err, e); }
            } }, "ยกเลิกบิล") : null),
          b.slips.length ? el("div", {}, el("h3", { text: t("สลิป") }), ...b.slips.map((sl) => el("div", { class: "history-row" }, badge({ pending: ["รอตรวจ", "received"], confirmed: ["ยืนยันแล้ว", "done"], returned: ["ตีกลับ", "urgent"] }, sl.decision),
            el("span", { class: "spacer small", text: DD.fmt(sl.sent_at) + (sl.message ? " · " + sl.message : "") }),
            el("a", { class: "btn ghost sm", href: `/api/admin/bills/${id}/slips/${sl.id}`, target: "_blank", rel: "noopener" }, DD.icon("image"), "ดู")))) : null,
          b.edits.length ? el("div", {}, el("h3", { text: t("ประวัติการแก้ไข") }), ...b.edits.map((e) => el("div", { class: "history-row small" },
            el("span", { class: "spacer", text: `${DD.fmt(e.at)} · ${money(e.before.total)} → ${money(e.after.total)}` }), el("span", { class: "muted", translate: "no", text: e.reason })))) : null,
          el("div", {}, el("h3", { text: t("ข้อความกับผู้เช่า") }), thread(b.messages),
            composer(async (text) => { await api(`/api/admin/bills/${id}/messages`, { method: "POST", json: { text } }); await refill(); })))];
    }).catch(ctx.fail);
  }

  async function finesSection(ctx, reload) {
    const [fines, rooms] = await Promise.all([api(`/api/admin/dorms/${ctx.dormId}/fines`), api(`/api/admin/dorms/${ctx.dormId}/rooms`)]);
    let preset = "damage", billingMode = "next_bill";
    const roomSel = el("select", { class: "select", id: "fRoom" }, rooms.map((r) => el("option", { value: r.id, text: r.room_no, translate: "no" })));
    const amount = el("input", { class: "input", id: "fAmt", inputmode: "decimal", placeholder: "500" });
    const title = el("input", { class: "input", id: "fTitle", maxlength: 80, placeholder: "เช่น เก้าอี้ห้องส่วนกลางหัก (ไม่บังคับ)" });
    const reason = el("textarea", { class: "textarea", id: "fWhy", maxlength: 1000 });
    const photos = el("input", { class: "sr-only", id: "fPhotos", type: "file", accept: "image/jpeg,image/png,image/webp", multiple: true });
    const pName = el("span", { class: "small muted", text: t("ไม่เกิน 3 รูป") });
    photos.addEventListener("change", () => { pName.textContent = [...photos.files].map((f) => f.name).join(", ") || t("ไม่เกิน 3 รูป"); });
    const chips = el("div", { class: "chips mt-0" }, Object.entries(FPRE).map(([k, l]) => el("button", { class: "preset", type: "button", "aria-pressed": String(k === preset),
      onclick: (ev) => { preset = k; chips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false")); ev.currentTarget.setAttribute("aria-pressed", "true"); } }, l)));
    const seg = el("div", { class: "seg" }, [["next_bill", "รวมในบิลถัดไป"], ["separate", "เรียกเก็บแยก"]].map(([k, l]) => el("button", { type: "button", "aria-pressed": String(k === billingMode),
      onclick: (ev) => { billingMode = k; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false")); ev.currentTarget.setAttribute("aria-pressed", "true"); } }, l)));
    const err = el("div");
    const submit = el("button", { class: "btn mt-2", type: "button" }, "ออกค่าปรับและแจ้งผู้เช่า");
    submit.addEventListener("click", async () => {
      err.replaceChildren();
      const fd = new FormData();
      fd.set("room_id", roomSel.value); fd.set("preset", preset); fd.set("title", title.value.trim()); fd.set("amount", amount.value.replace(/,/g, ""));
      fd.set("reason", reason.value.trim()); fd.set("billing", billingMode);
      [...photos.files].slice(0, 3).forEach((f) => fd.append("photos", f, f.name));
      if (!(Number(fd.get("amount")) > 0) || fd.get("reason").length < 3) { errorBox(err, { message: t("กรอกยอดและเหตุผล") }); return; }
      try { await api(`/api/admin/dorms/${ctx.dormId}/fines`, { method: "POST", body: fd, headers: { "Idempotency-Key": key() } }); DD.toast(t("ออกค่าปรับแล้ว")); invalidate(); reload(); }
      catch (e) { errorBox(err, e); }
    });
    return el("div", {},
      card("alert", t("ค่าปรับ"), tbl([t("ห้อง"), t("เรื่อง"), t("ยอด"), t("สถานะ"), ""], fines.map((f) => el("tr", {}, room(f.room_no),
        el("td", {}, el("span", { translate: "no", text: f.title }), f.tenant_msgs ? el("div", { class: "row-meta", text: t("ผู้เช่าตอบ {n} ข้อความ", { n: f.tenant_msgs }) }) : null),
        el("td", { class: "num", text: money(f.amount) }), el("td", {}, badge(FINE, f.status), f.prev_tenant ? el("span", { class: "badge rejected", text: t("ผู้เช่าก่อนหน้า") }) : null),
        el("td", {}, el("button", { class: "btn ghost sm", type: "button", onclick: () => fineDrawer(f.id, ctx, reload) }, "เปิด")))), t("ยังไม่มีค่าปรับ"))),
      card("plus", t("ออกค่าปรับ"),
        el("div", { class: "grid-auto" }, el("div", { class: "field mt-0" }, el("label", { for: "fRoom", text: "ห้อง" }), roomSel),
          el("div", { class: "field mt-0" }, el("label", { for: "fAmt", text: "ยอด (บาท)" }), amount),
          el("div", { class: "field mt-0" }, el("span", { class: "field-label", text: "เรียกเก็บ" }), seg)),
        el("div", { class: "field" }, el("span", { class: "field-label", text: "กรณี" }), chips),
        el("div", { class: "field" }, el("label", { for: "fTitle", text: "หัวข้อ" }), title),
        el("div", { class: "field" }, el("label", { for: "fWhy" }, t("เหตุผล") + " ", el("span", { class: "hint", text: "(ผู้เช่าจะเห็นข้อความนี้)" })), reason),
        el("div", { class: "field" }, el("span", { class: "field-label", text: "รูปหลักฐาน" }), el("label", { class: "drop", for: "fPhotos" }, DD.icon("imagePlus"), el("span", {}, el("strong", { text: t("แตะเพื่อเลือกรูป") }), el("br"), pName)), photos),
        submit, err));
  }

  async function fineDrawer(id, ctx, reload) {
    await drawer(t("ค่าปรับ"), async ({ close, head, refill }) => {
      const f = await api(`/api/admin/fines/${id}`);
      const open = ["open", "disputed", "confirmed", "billed"].includes(f.status) && f.bill_status !== "paid";
      const amt = el("input", { class: "input w-110", inputmode: "decimal", value: f.amount / 100, "aria-label": t("ยอดใหม่") });
      const err = el("div");
      const act = (label, cls, body) => el("button", { class: "btn " + cls, type: "button", onclick: async () => {
        try { await api(`/api/admin/fines/${id}`, { method: "PATCH", json: body() }); invalidate(); reload(); await refill(); } catch (e) { errorBox(err, e); }
      } }, label);
      return [head(f.title, el("div", { class: "row wrap" }, badge(FINE, f.status), el("span", { class: "xs muted", text: t("ห้อง {r} · {d}", { r: f.room_no, d: DD.fmt(f.created_at) }) }))),
        el("div", { class: "drawer-body stack" },
          el("div", { class: "amount-lg num", text: baht(f.amount) }), f.amount !== f.original_amount ? el("p", { class: "small muted", text: t("ยอดเดิม {a}", { a: baht(f.original_amount) }) }) : null,
          el("p", { class: "reason-box", text: f.reason, translate: "no" }),
          f.photos.length ? el("div", { class: "photos" }, f.photos.map((pid) => { const src = `/api/admin/fines/${id}/photos/${pid}`;
            return el("a", { href: src, target: "_blank", rel: "noopener" }, el("img", { src, alt: t("รูปหลักฐาน"), loading: "lazy" })); })) : null,
          f.bill_period ? el("div", { class: "alert info" }, DD.icon("receipt"), el("span", { text: t("อยู่ในบิล {p}", { p: periodName(f.bill_period) }) })) : null,
          open ? el("div", { class: "row wrap" }, el("span", { class: "small", text: t("ลดยอดเป็น") }), amt, act(t("บันทึกยอด"), "ghost", () => ({ amount: Number(amt.value) || 0 })),
            ["open", "disputed"].includes(f.status) ? act(t("ยืนยันค่าปรับ"), "ok", () => ({ status: "confirmed" })) : null,
            act(t("ยกเลิกค่าปรับ"), "danger", () => ({ status: "cancelled" }))) : null, err,
          el("div", {}, el("h3", { text: t("ข้อความกับผู้เช่า") }), thread(f.messages),
            open ? composer(async (text) => { await api(`/api/admin/fines/${id}/messages`, { method: "POST", json: { text } }); await refill(); }) : null))];
    }).catch(ctx.fail);
  }

  // ================================================================ parking
  async function parking(panel, ctx) {
    panel.replaceChildren(el("div", { class: "card" }, DD.skeletonLines(8)));
    const p = await api(`/api/admin/dorms/${ctx.dormId}/parking`);
    const reload = () => { invalidate(); parking(panel, ctx); };
    const spots = p.spots.car + p.spots.moto, used = p.used.car + p.used.moto;
    const dlg = el("div");
    const approve = async (x, confirmOver) => {
      const sticker = el("input", { class: "input", id: "aSt", maxlength: 20 }), spot = el("input", { class: "input", id: "aSp", maxlength: 20, placeholder: "เช่น C07" });
      const err = el("div");
      const go = async (over) => {
        try { const r = await api(`/api/admin/parking/permits/${x.id}/approve`, { method: "POST", json: { sticker: sticker.value.trim(), spot: spot.value.trim(), confirm_over_quota: over } });
          DD.toast(r.over_quota ? t("อนุมัติแล้ว (เกินโควตา)") : t("อนุมัติแล้ว")); reload(); }
        catch (e) {
          if (e.code === "over_quota") {
            dlg.replaceChildren(el("div", { class: "inline-dialog narrow mt-2", role: "alertdialog", "aria-label": t("เกินโควตา") },
              el("div", { class: "row" }, el("span", { class: "kpi-icon amber inline" }, DD.icon("alert")), el("h3", { class: "mt-0", text: t("ห้อง {r} มีที่จอด{v}อยู่แล้ว", { r: x.room_no, v: t(VT[x.vtype]) }) })),
              el("p", { class: "mt-2", text: t("ห้องนี้มีสิทธิ์อยู่แล้ว {a} ที่ (โควตาห้องละ {b} ที่) · คันเดิม: {c}", { a: e.has, b: e.quota, c: (e.existing || []).map((o) => o.plate + (o.spot ? " " + o.spot : "")).join(", ") }) }),
              el("p", { class: "small muted", text: t("ถ้าตกลงให้เพิ่ม ค่าจอดคันนี้จะเข้าบิลเดือนถัดไป") }),
              el("div", { class: "row mt-2" }, el("button", { class: "btn", type: "button", onclick: () => go(true) }, t("ยืนยัน เพิ่มเป็น {n} ที่", { n: e.has + 1 })),
                el("button", { class: "btn ghost", type: "button", onclick: () => dlg.replaceChildren() }, "ยกเลิก"))));
            return;
          }
          errorBox(err, e);
        }
      };
      dlg.replaceChildren(el("div", { class: "inline-dialog narrow mt-2" }, el("h3", { class: "mt-0", text: t("อนุมัติ {p} ห้อง {r}", { p: x.plate, r: x.room_no }) }),
        el("div", { class: "grid-2" }, el("div", { class: "field mt-0" }, el("label", { for: "aSt", text: "เลขสติกเกอร์" }), sticker),
          el("div", { class: "field mt-0" }, el("label", { for: "aSp" }, t("ช่องจอด") + " ", el("span", { class: "hint", text: "(ไม่บังคับ)" })), spot)),
        err, el("div", { class: "row mt-2" }, el("button", { class: "btn ok", type: "button", onclick: () => go(!!confirmOver) }, DD.icon("check"), "อนุมัติ"),
          el("button", { class: "btn ghost", type: "button", onclick: () => dlg.replaceChildren() }, "ยกเลิก"))));
      sticker.focus();
    };
    const msgDrawer = (x) => drawer(t("ข้อความ"), async ({ head, refill }) => {
      const pk = await api(`/api/admin/dorms/${ctx.dormId}/parking`);
      const cur = [...pk.cancelling, ...pk.active, ...pk.pending].find((y) => y.id === x.id) || x;
      return [head(t("{p} · ห้อง {r}", { p: cur.plate, r: cur.room_no })), el("div", { class: "drawer-body stack" }, thread(cur.messages),
        composer(async (text) => { await api(`/api/admin/parking/permits/${x.id}/messages`, { method: "POST", json: { text } }); await refill(); }))];
    }).catch(ctx.fail);
    const out = [
      el("div", { class: "kpis" }, kpi("inbox", "sky", p.pending.length, t("คำขอรออนุมัติ")), kpi("car", "green", spots ? `${used}/${spots}` : used, t("ช่องจอดที่ใช้อยู่")),
        kpi("clock", "amber", p.cancelling.filter((c) => c.status === "cancel_notice").length, t("กำลังยกเลิก (ภายใน {n} วัน)", { n: p.cancel_days })),
        kpi("users", "pink", p.waitlist.filter((w) => w.status === "waiting").length, t("คิวรอที่จอด"))),
      card("inbox", t("คำขอรออนุมัติ"), tbl([t("ห้อง"), t("ทะเบียน"), t("ประเภท"), t("สิทธิ์ที่มี / โควตา"), t("ส่งเมื่อ"), ""], p.pending.map((x) => el("tr", {}, room(x.room_no),
        el("td", { translate: "no", text: `${x.plate} ${x.province || ""}`.trim() + (x.brand_color ? " · " + x.brand_color : "") }), el("td", { text: t(VT[x.vtype]) }),
        el("td", {}, el("span", { class: "badge" + (x.has >= x.quota ? " urgent" : ""), text: `${x.has} / ${x.quota}` + (x.has >= x.quota ? " · " + t("เกินโควตา") : "") })),
        el("td", { text: dDate(x.updated_at) }),
        el("td", {}, el("div", { class: "row" }, el("button", { class: "btn ok sm", type: "button", onclick: () => approve(x) }, DD.icon("check"), "อนุมัติ"),
          el("button", { class: "btn ghost sm", type: "button", onclick: async () => {
            const m = await ask({ title: t("ตีกลับคำขอ {p}", { p: x.plate }), label: t("ข้อความถึงผู้เช่า"), ok: t("ตีกลับ") });
            if (!m) return; try { await api(`/api/admin/parking/permits/${x.id}/return`, { method: "POST", json: { message: m } }); reload(); } catch (e) { ctx.fail(e); }
          } }, "ตีกลับ"))))), t("ไม่มีคำขอรออนุมัติ")), dlg),
      card("clock", t("การยกเลิกสิทธิ์ที่กำลังดำเนินการ"), tbl([t("ห้อง"), t("ทะเบียน"), t("เหตุผล"), t("ความคืบหน้า"), t("สิ้นสุด"), ""], p.cancelling.map((x) => {
        const ended = x.status === "cancelled";
        const daysLeft = Math.max(0, Math.ceil((new Date(x.cancel_due_at) - Date.now()) / 864e5));
        return el("tr", {}, room(x.room_no), el("td", { translate: "no", text: x.plate }), el("td", { class: "small", translate: "no", text: x.cancel_reason || "" }),
          el("td", {}, steps([[t("แจ้งแล้ว {d}", { d: dDate(x.cancel_notice_at) }), "done"], x.ack_at ? [t("ผู้เช่ารับทราบ"), "done"] : x.tenant_replied ? [t("มีข้อความตอบกลับ"), "on"] : [t("รอผู้เช่า"), ended ? "done" : "on"],
            [t("ยกเลิกแล้ว"), ended ? "done" : ""]])),
          el("td", {}, ended ? dDate(x.cancelled_at) : el("span", {}, dDate(x.cancel_due_at), " ", el("span", { class: "xs muted", text: t("(อีก {n} วัน)", { n: daysLeft }) }))),
          el("td", {}, el("div", { class: "row" }, el("button", { class: "btn ghost sm", type: "button", onclick: () => msgDrawer(x) }, DD.icon("message"), "ข้อความ"),
            !ended ? el("button", { class: "btn ghost sm", type: "button", onclick: async () => {
              try { await api(`/api/admin/parking/permits/${x.id}/withdraw-cancel`, { method: "POST" }); DD.toast(t("ถอนการยกเลิกแล้ว")); reload(); } catch (e) { ctx.fail(e); }
            } }, "ถอนการยกเลิก") : null)));
      }), t("ไม่มีการยกเลิกที่กำลังดำเนินการ"))),
      card("car", t("สิทธิ์ที่ใช้งานอยู่"), tbl([t("ห้อง"), t("ทะเบียน"), t("ประเภท"), t("สติกเกอร์ / ช่อง"), t("ค่าจอด"), ""], p.active.map((x) => el("tr", {}, room(x.room_no),
        el("td", { translate: "no", text: `${x.plate} ${x.province || ""}`.trim() }), el("td", {}, t(VT[x.vtype]), x.over_quota ? el("span", { class: "badge urgent", text: t("เกินโควตา") }) : null),
        el("td", { translate: "no", text: [x.sticker, x.spot].filter(Boolean).join(" · ") || "-" }), el("td", { class: "num", text: money(x.fee) }),
        el("td", {}, el("button", { class: "btn ghost sm", type: "button", onclick: async () => {
          const why = await ask({ title: t("ยกเลิกสิทธิ์ {p} ห้อง {r}", { p: x.plate, r: x.room_no }), label: t("เหตุผล (ผู้เช่าจะเห็น)"), ok: t("แจ้งยกเลิก"), danger: true });
          if (!why) return; try { await api(`/api/admin/parking/permits/${x.id}/cancel`, { method: "POST", json: { reason: why } }); DD.toast(t("แจ้งยกเลิกแล้ว ผู้เช่ามีเวลา {n} วัน", { n: p.cancel_days })); reload(); } catch (e) { ctx.fail(e); }
        } }, "ยกเลิกสิทธิ์")))), t("ยังไม่มีสิทธิ์ที่จอด"))),
      el("div", { class: "two-col mt-2" },
        el("section", { class: "card" }, el("div", { class: "card-title" }, DD.icon("users"), el("h2", { class: "mt-0", text: t("คิวรอที่จอด") })),
          p.waitlist.length ? el("div", {}, p.waitlist.map((w, i) => el("div", { class: "list-row c4" }, el("span", { class: "muted", text: String(i + 1) }), el("span", { class: "room-no", text: w.room_no, translate: "no" }),
            el("span", { text: t("{v} · รอตั้งแต่ {d}", { v: t(VT[w.vtype]), d: dDate(w.created_at) }) }),
            w.status === "offered" ? el("span", { class: "badge received", text: t("แจ้งแล้ว") }) : el("button", { class: "btn sm", type: "button", onclick: async () => {
              try { await api(`/api/admin/parking/waitlist/${w.id}/offer`, { method: "POST" }); DD.toast(t("แจ้งผู้เช่าแล้ว")); reload(); } catch (e) { ctx.fail(e); }
            } }, "ให้สิทธิ์")))) : el("p", { class: "small muted", text: t("ไม่มีคิวรอ") })),
        el("section", { class: "card" }, el("div", { class: "card-title" }, DD.icon("ticket"), el("h2", { class: "mt-0", text: t("บัตรจอดแขก") })),
          p.guest_passes.length ? el("div", {}, p.guest_passes.map((g) => el("div", { class: "list-row c3" }, el("span", { class: "room-no", text: g.room_no, translate: "no" }),
            el("span", {}, el("span", { translate: "no", text: g.plate }), el("div", { class: "row-meta", text: dDate(g.valid_date) + " · " + t("ถึง 23:59") })),
            g.status === "pending" ? el("div", { class: "row" }, el("button", { class: "btn ok sm", type: "button", onclick: async () => { await api(`/api/admin/parking/guest-passes/${g.id}/decide`, { method: "POST", json: { approve: true } }); reload(); } }, "อนุมัติ"),
              el("button", { class: "btn ghost sm", type: "button", onclick: async () => { await api(`/api/admin/parking/guest-passes/${g.id}/decide`, { method: "POST", json: { approve: false } }); reload(); } }, "ไม่อนุมัติ")) : el("span")))) : el("p", { class: "small muted", text: t("ไม่มีบัตรจอดแขกวันนี้") }))),
    ];
    panel.replaceChildren(...out);
  }

  // ================================================================ common spaces + check-ins
  async function spaces(panel, ctx) {
    panel.replaceChildren(el("div", { class: "card" }, DD.skeletonLines(8)));
    const s = await api(`/api/admin/dorms/${ctx.dormId}/spaces`);
    const reload = () => spaces(panel, ctx);
    const facRows = s.facilities.map((f) => {
      const note = el("input", { class: "input w-150", maxlength: 120, value: f.closed_note || "", placeholder: "ปิดชั่วคราว เช่น ล้างสระ", "aria-label": t("ปิดชั่วคราว") });
      return el("tr", {}, el("td", {}, el("strong", { translate: "no", text: f.name }), el("div", { class: "row-meta", text: `${f.open_from}–${f.open_to}` + (f.kind === "space" ? " · " + t("ครั้งละ {n} นาที", { n: f.slot_minutes }) : "") })),
        el("td", { text: f.kind === "space" ? t("จอง") : t("ใช้อยู่ {n}{c}", { n: f.now, c: f.capacity ? "/" + f.capacity : "" }) }),
        el("td", {}, el("label", { class: "switch" }, el("input", { type: "checkbox", checked: f.enabled, "aria-label": t("เปิดใช้"), onchange: async (e) => {
          try { await api(`/api/admin/facilities/${f.id}`, { method: "PATCH", json: { enabled: e.target.checked } }); } catch (x) { e.target.checked = !e.target.checked; ctx.fail(x); }
        } }), el("span"))),
        el("td", {}, el("div", { class: "row" }, note, el("button", { class: "btn ghost sm", type: "button", onclick: async () => {
          try { await api(`/api/admin/facilities/${f.id}`, { method: "PATCH", json: { closed_note: note.value.trim() } }); DD.toast(note.value.trim() ? t("ปิดชั่วคราวแล้ว") : t("เปิดตามปกติแล้ว")); } catch (x) { ctx.fail(x); }
        } }, "บันทึก"))));
    });
    const byDay = {};
    for (const b of s.bookings) (byDay[new Date(b.starts_at).toDateString()] ||= []).push(b);
    const facName = Object.fromEntries(s.facilities.map((f) => [f.id, f.name]));
    const extraRoom = el("input", { class: "input w-110", id: "qxRoom", placeholder: "เลขห้อง" }), extraN = el("input", { class: "input w-80", id: "qxN", inputmode: "numeric", value: "1" });
    const out = [
      card("dumbbell", t("พื้นที่ส่วนกลาง"), tbl([t("ชื่อ"), t("ตอนนี้"), t("เปิดใช้"), t("ปิดชั่วคราว")], facRows, t("ยังไม่มีพื้นที่ (เพิ่มได้ในแท็บตั้งค่าฟีเจอร์)"))),
      card("calendar", t("การจอง 7 วันข้างหน้า"), ...(Object.keys(byDay).length ? Object.entries(byDay).map(([d, list]) => el("div", {}, el("div", { class: "day-head", text: dShort(list[0].starts_at) }),
        ...list.map((b) => el("div", { class: "list-row c3" }, el("span", { class: "room-no", text: b.room_no, translate: "no" }),
          el("span", {}, el("span", { translate: "no", text: facName[b.facility_id] || "" }), el("div", { class: "row-meta", text: `${hm(b.starts_at)}–${hm(b.ends_at)}` })),
          el("div", { class: "row" }, el("span", { class: "badge " + ({ booked: "received", confirmed: "done", no_show: "urgent", cancelled: "rejected", cancelled_late: "urgent" }[b.status] || ""), text: t({ booked: "จองแล้ว", confirmed: "ยืนยันแล้ว", no_show: "ไม่มา", cancelled: "ยกเลิก", cancelled_late: "ยกเลิกช้า" }[b.status] || b.status) }),
            ["booked", "confirmed"].includes(b.status) ? el("button", { class: "icon-btn", type: "button", "aria-label": t("ยกเลิกการจองนี้"), onclick: async () => {
              if (!await DD.confirm({ title: t("ยกเลิกการจองของห้อง {r}?", { r: b.room_no }), text: t("ไม่นับเป็นจองแล้วไม่มา"), ok: t("ยกเลิกการจอง"), danger: true })) return;
              try { await api(`/api/admin/bookings/${b.id}/cancel`, { method: "POST" }); reload(); } catch (e) { ctx.fail(e); }
            } }, DD.icon("x")) : null))))) : [el("p", { class: "small muted", text: t("ยังไม่มีการจอง") })])),
      el("div", { class: "two-col mt-2" },
        el("section", { class: "card" }, el("div", { class: "card-title" }, DD.icon("ban"), el("h2", { class: "mt-0", text: t("ห้องที่ถูกงดจอง") })),
          s.bans.length ? el("div", {}, s.bans.map((b) => el("div", { class: "list-row c3" }, el("span", { class: "room-no", text: b.room_no, translate: "no" }),
            el("span", { text: t("ถึง {d}", { d: dDate(b.until) }) }), el("button", { class: "btn ghost sm", type: "button", onclick: async () => {
              try { await api(`/api/admin/bans/${b.id}/lift`, { method: "POST" }); DD.toast(t("ปลดแบนแล้ว")); reload(); } catch (e) { ctx.fail(e); }
            } }, "ปลดแบน")))) : el("p", { class: "small muted", text: t("ไม่มีห้องที่ถูกงดจอง") }),
          el("p", { class: "xs muted mt-2", text: t("จองแล้วไม่มา {a} ครั้งใน {b} วัน งดจอง {c} วัน (แก้ได้ในแท็บตั้งค่าฟีเจอร์)", { a: s.rules.strike_limit, b: s.rules.strike_window_d, c: s.rules.ban_days }) })),
        el("section", { class: "card" }, el("div", { class: "card-title" }, DD.icon("plus"), el("h2", { class: "mt-0", text: t("เพิ่มโควตาพิเศษสัปดาห์นี้") })),
          el("p", { class: "small muted", text: t("ปกติห้องละ {n} ครั้ง/สัปดาห์ (จันทร์–อาทิตย์)", { n: s.rules.booking_per_week }) }),
          el("form", { class: "row wrap", onsubmit: async (ev) => {
            ev.preventDefault();
            try { await api(`/api/admin/dorms/${ctx.dormId}/quota-extra`, { method: "POST", json: { room_no: extraRoom.value.trim(), extra: Number(extraN.value) || 0 } }); DD.toast(t("เพิ่มโควตาแล้ว")); reload(); } catch (e) { ctx.fail(e); }
          } }, el("label", { class: "sr-only", for: "qxRoom", text: "เลขห้อง" }), extraRoom, el("label", { class: "sr-only", for: "qxN", text: "จำนวนครั้ง" }), extraN, el("button", { class: "btn sm", type: "submit" }, "เพิ่ม")),
          s.quota_extra.length ? el("p", { class: "small mt-1", text: s.quota_extra.map((q) => t("ห้อง {r} +{n}", { r: q.room_no, n: q.extra })).join(", ") }) : null)),
    ];
    panel.replaceChildren(...out);
  }

  // ================================================================ settings: features, QR, rules, facilities, change tenant, sessions
  async function settings(panel, ctx) {
    panel.replaceChildren(el("div", { class: "card" }, DD.skeletonLines(8)));
    const [st, rooms, sess] = await Promise.all([api(`/api/admin/dorms/${ctx.dormId}/settings`), api(`/api/admin/dorms/${ctx.dormId}/rooms`), api("/api/auth/sessions")]);
    const s = st.settings;
    const reload = () => { invalidate(); settings(panel, ctx); };
    const feat = (k, icon, title, sub) => el("div", { class: "set-row" }, el("span", { class: "fac-icon" }, DD.icon(icon)),
      el("span", { class: "spacer" }, el("strong", { text: title }), el("br"), el("span", { class: "xs muted", text: sub })),
      el("label", { class: "switch" }, el("input", { type: "checkbox", checked: s["f_" + k], "aria-label": title, onchange: async (e) => {
        try { await api(`/api/admin/dorms/${ctx.dormId}/settings`, { method: "PUT", json: { ["f_" + k]: e.target.checked } });
          DD.toast(t(e.target.checked ? "เปิด {f} แล้ว" : "ปิด {f} แล้ว", { f: title })); invalidate(); syncTabs(ctx).catch(() => {}); }
        catch (x) { e.target.checked = !e.target.checked; ctx.fail(x); }
      } }), el("span")));
    const rule = (k, label, suffix) => { const i = el("input", { class: "input", id: "r-" + k, inputmode: "numeric", value: s[k] }); i.dataset.k = k; return el("div", { class: "field" }, el("label", { for: "r-" + k }, t(label), suffix ? el("span", { class: "hint", text: " " + t(suffix) }) : null), i); };
    const money1 = (k, label) => { const i = el("input", { class: "input", id: "r-" + k, inputmode: "decimal", value: s[k] / 100 }); i.dataset.k = k; i.dataset.scale = "100"; return el("div", { class: "field" }, el("label", { for: "r-" + k, text: t(label) }), i); };
    const rulesBox = el("div", { class: "grid-3" },
      el("div", {}, el("h3", { text: t("ฟิตเนสและสระ") }), rule("checkin_hours", "เช็กอินมีผล (ชั่วโมง)"), rule("checkin_per_room", "เช็กอินพร้อมกันต่อห้อง (คน)")),
      el("div", {}, el("h3", { text: t("ห้องส่วนกลาง") }), rule("booking_per_week", "จองได้ต่อห้องต่อสัปดาห์ (ครั้ง)"), rule("booking_confirm_min", "ต้องสแกนยืนยันภายใน (นาทีหลังเวลาเริ่ม)"),
        rule("booking_cancel_before_h", "ยกเลิกโดยไม่นับโทษ ก่อนเวลาเริ่ม (ชั่วโมง)"), rule("strike_limit", "จองแล้วไม่มากี่ครั้ง จึงงดจอง"), rule("strike_window_d", "นับภายใน (วัน)"), rule("ban_days", "งดจอง (วัน)")),
      el("div", {}, el("h3", { text: t("ที่จอดรถ") }), rule("quota_car", "โควตาต่อห้อง: รถยนต์"), rule("quota_moto", "โควตาต่อห้อง: มอเตอร์ไซค์"),
        rule("spots_car", "ช่องจอดทั้งหมด: รถยนต์", "(0 = ไม่จำกัด)"), rule("spots_moto", "ช่องจอดทั้งหมด: มอเตอร์ไซค์", "(0 = ไม่จำกัด)"),
        money1("fee_car", "ค่าจอดรถยนต์ (บาท/เดือน)"), money1("fee_moto", "ค่าจอดมอเตอร์ไซค์ (บาท/เดือน)"), rule("parking_cancel_days", "ระยะยกเลิกสิทธิ์ (วัน)")));
    const gpa = el("input", { type: "checkbox", checked: s.guest_pass_approval, "aria-label": t("บัตรจอดแขกต้องอนุมัติก่อน") });
    const cPhone = el("input", { class: "input", id: "cPhone", value: s.contact_phone || "", maxlength: 40 }), cMail = el("input", { class: "input", id: "cMail", value: s.contact_email || "", maxlength: 120, type: "email" });
    const rErr = el("div");
    const saveRules = el("button", { class: "btn mt-3", type: "button" }, "บันทึกกฎ");
    saveRules.addEventListener("click", async () => {
      const body = { guest_pass_approval: gpa.checked, contact_phone: cPhone.value.trim() || null, contact_email: cMail.value.trim() || null };
      rulesBox.querySelectorAll("input[data-k]").forEach((i) => { body[i.dataset.k] = Math.round(Number(i.value) * Number(i.dataset.scale || 1)); });
      try { await api(`/api/admin/dorms/${ctx.dormId}/settings`, { method: "PUT", json: body }); DD.toast(t("บันทึกกฎแล้ว")); } catch (e) { errorBox(rErr, e); }
    });
    // facilities + printable QR
    const KIND = { fitness: ["dumbbell", "ฟิตเนส"], pool: ["waves", "สระว่ายน้ำ"], space: ["calendar", "ห้องส่วนกลาง (จอง)"] };
    const qrRows = st.facilities.map((f) => el("div", { class: "set-row" }, el("span", { class: "fac-icon" }, DD.icon(KIND[f.kind][0])),
      el("span", { class: "spacer" }, el("strong", { translate: "no", text: f.name }), el("br"), el("span", { class: "xs muted", text: t(KIND[f.kind][1]) + ` · ${f.open_from}–${f.open_to}` + (f.capacity ? " · " + t("ความจุ {n}", { n: f.capacity }) : "") })),
      el("a", { class: "btn ghost sm", href: `/api/admin/facilities/${f.id}/qr.svg`, target: "_blank", rel: "noopener" }, DD.icon("printer"), "พิมพ์"),
      el("button", { class: "btn ghost sm", type: "button", onclick: async () => {
        if (!await DD.confirm({ title: t("เปลี่ยน QR ของ {f}?", { f: f.name }), text: t("QR เดิมที่พิมพ์ไว้จะใช้ไม่ได้ทันที ต้องพิมพ์ใหม่"), ok: t("เปลี่ยน QR"), danger: true })) return;
        try { await api(`/api/admin/facilities/${f.id}/rotate-qr`, { method: "POST" }); DD.toast(t("เปลี่ยน QR แล้ว พิมพ์ใบใหม่ได้เลย")); } catch (e) { ctx.fail(e); }
      } }, DD.icon("refresh"), "เปลี่ยน QR")));
    const fName = el("input", { class: "input", id: "nfName", maxlength: 60, placeholder: "เช่น ห้องประชุมชั้น 1" });
    const fKind = el("select", { class: "select", id: "nfKind" }, Object.entries(KIND).map(([k, [, l]]) => el("option", { value: k, text: t(l) })));
    const fCap = el("input", { class: "input", id: "nfCap", inputmode: "numeric", placeholder: "15" });
    const fFrom = el("input", { class: "input", id: "nfFrom", type: "time", value: "06:00" }), fTo = el("input", { class: "input", id: "nfTo", type: "time", value: "22:00" });
    const fSlot = el("select", { class: "select", id: "nfSlot" }, [30, 60, 90, 120].map((m) => el("option", { value: m, text: t("{n} นาที", { n: m }), selected: m === 60 })));
    const fErr = el("div");
    // change tenant
    const ntSel = el("select", { class: "select", id: "ntRoom" }, rooms.map((r) => el("option", { value: r.id, text: r.room_no, translate: "no" })));
    const ntBtn = el("button", { class: "btn danger mt-2", type: "button" }, DD.icon("keyRotate"), "เปลี่ยนผู้เช่าและสร้างลิงก์ใหม่");
    ntBtn.addEventListener("click", () => { const r = rooms.find((x) => String(x.id) === ntSel.value); changeTenant(r, { ...ctx, rerender: reload }); });
    const out = [
      el("div", { class: "two-col" },
        el("section", { class: "card" }, el("div", { class: "card-title" }, DD.icon("sliders"), el("h2", { class: "mt-0", text: t("ฟีเจอร์ของหอนี้") })),
          el("p", { class: "small muted", text: t("ฟีเจอร์ที่ปิด ผู้เช่าจะไม่เห็นเมนูนั้นเลย และระบบจะไม่รับคำขอของฟีเจอร์นั้น") }),
          feat("fitness", "dumbbell", t("ฟิตเนส"), t("เช็กอินด้วย QR · ดูจำนวนคน")), feat("pool", "waves", t("สระว่ายน้ำ"), t("เช็กอินด้วย QR · ดูจำนวนคน")),
          feat("spaces", "calendar", t("ห้องส่วนกลาง"), t("จองช่วงเวลา · สแกนยืนยัน")), feat("parking", "car", t("ที่จอดรถ"), t("ยื่นขอสิทธิ์ · บัตรจอดแขก · คิวรอ")),
          feat("bills", "receipt", t("บิลออนไลน์"), t("บิล · แนบสลิป · ใบเสร็จ")), feat("fines", "alert", t("ค่าปรับ"), t("ออกค่าปรับ · ผู้เช่าตอบกลับได้"))),
        el("section", { class: "card" }, el("div", { class: "card-title" }, DD.icon("scan"), el("h2", { class: "mt-0", text: t("QR สำหรับพิมพ์") })),
          el("p", { class: "small muted", text: t("ติดที่โต๊ะคนตรวจหรือหน้าห้อง ผู้เช่าต้องสแกนจากเมนูในลิงก์ห้องเท่านั้น") }),
          ...(qrRows.length ? qrRows : [el("p", { class: "small muted", text: t("ยังไม่มีพื้นที่ส่วนกลาง") })]),
          el("details", { class: "mt-2" }, el("summary", { text: t("เพิ่มพื้นที่ส่วนกลาง") }),
            el("form", { class: "mt-1", onsubmit: async (ev) => {
              ev.preventDefault(); fErr.replaceChildren();
              try { await api(`/api/admin/dorms/${ctx.dormId}/facilities`, { method: "POST", json: { name: fName.value.trim(), kind: fKind.value, capacity: Number(fCap.value) || null, open_from: fFrom.value, open_to: fTo.value, slot_minutes: Number(fSlot.value) } });
                DD.toast(t("เพิ่มแล้ว")); reload(); } catch (e) { errorBox(fErr, e); }
            } }, el("div", { class: "grid-2" }, el("div", { class: "field mt-0" }, el("label", { for: "nfName", text: "ชื่อ" }), fName), el("div", { class: "field mt-0" }, el("label", { for: "nfKind", text: "ประเภท" }), fKind),
              el("div", { class: "field mt-0" }, el("label", { for: "nfFrom", text: "เปิด" }), fFrom), el("div", { class: "field mt-0" }, el("label", { for: "nfTo", text: "ปิด" }), fTo),
              el("div", { class: "field mt-0" }, el("label", { for: "nfCap" }, t("ความจุ") + " ", el("span", { class: "hint", text: "(ไม่บังคับ)" })), fCap),
              el("div", { class: "field mt-0" }, el("label", { for: "nfSlot", text: "ความยาวต่อการจอง" }), fSlot)), fErr, el("button", { class: "btn sm mt-2", type: "submit" }, DD.icon("plus"), "เพิ่ม"))))),
      el("section", { class: "card mt-2" }, el("div", { class: "card-title" }, DD.icon("shield"), el("h2", { class: "mt-0", text: t("กฎการใช้งาน") })), rulesBox,
        el("div", { class: "set-row" }, el("span", { class: "spacer", text: t("บัตรจอดแขกต้องให้เจ้าของหออนุมัติก่อน") }), el("label", { class: "switch" }, gpa, el("span"))),
        el("div", { class: "grid-2" }, el("div", { class: "field" }, el("label", { for: "cPhone", text: "เบอร์ติดต่อเจ้าของหอ (ผู้เช่าเห็น)" }), cPhone),
          el("div", { class: "field" }, el("label", { for: "cMail", text: "อีเมลติดต่อ (ผู้เช่าเห็น)" }), cMail)), saveRules, rErr),
      el("section", { class: "card mt-2 fine-card" }, el("div", { class: "card-title" }, DD.icon("keyRotate"), el("h2", { class: "mt-0", text: t("เปลี่ยนผู้เช่า") })),
        el("div", { class: "row wrap" }, el("label", { class: "field-label", for: "ntRoom", text: "ห้อง" }), ntSel),
        el("p", { class: "small muted", text: t("ลิงก์ใหม่จะเริ่มข้อมูลใหม่ทั้งหมด ลิงก์เดิมใช้ไม่ได้ทันที ข้อมูลของผู้เช่าเดิมย้ายไปเป็น \"ประวัติผู้เช่าก่อนหน้า\" (ไม่ลบ)") }), ntBtn),
      card("cpu", t("อุปกรณ์ที่เข้าสู่ระบบบัญชีนี้"),
        el("p", { class: "small muted", text: t("ออกจากระบบอุปกรณ์อื่นได้ทันที เช่น ทำมือถือหาย หรือผู้จัดการเลิกงาน (มีผลกับเซิร์ฟเวอร์ API ทั้ง 2 เครื่องพร้อมกัน)") }),
        ...sess.map((x) => el("div", { class: "history-row" }, DD.icon(x.current ? "checkCircle" : "user"),
          el("span", { class: "spacer" }, el("span", { class: "small", translate: "no", text: (x.device || "-").slice(0, 70) }),
            el("div", { class: "row-meta", text: t("IP {ip} · ใช้ล่าสุด {d}", { ip: x.ip || "-", d: DD.ago(x.last_seen_at) }) + (x.current ? " · " + t("เครื่องนี้") : "") })),
          x.current ? null : el("button", { class: "btn ghost sm", type: "button", onclick: async () => {
            try { await api(`/api/auth/sessions/${x.id}/revoke`, { method: "POST" }); DD.toast(t("ออกจากระบบอุปกรณ์นั้นแล้ว")); reload(); } catch (e) { ctx.fail(e); }
          } }, "ออกจากระบบ"))),
        sess.length > 1 ? el("button", { class: "btn ghost mt-2", type: "button", onclick: async () => {
          try { const r = await api("/api/auth/sessions/revoke-others", { method: "POST" }); DD.toast(t("ออกจากระบบ {n} อุปกรณ์แล้ว", { n: r.revoked })); reload(); } catch (e) { ctx.fail(e); }
        } }, DD.icon("logout"), "ออกจากระบบอุปกรณ์อื่นทั้งหมด") : null),
    ];
    panel.replaceChildren(...out);
  }

  // ================================================================ change of tenant (rooms tab + settings tab)
  async function changeTenant(r, ctx) {
    let info;
    try { info = await api(`/api/admin/rooms/${r.id}/tenancy`); } catch (e) { return ctx.fail(e); }
    const c = info.current;
    const items = [c.permits ? t("สิทธิ์ที่จอด {n} คัน", { n: c.permits }) : null, c.guest_passes ? t("บัตรจอดแขก {n} ใบ", { n: c.guest_passes }) : null,
      c.bookings ? t("การจองห้องส่วนกลางที่ยังไม่ถึงเวลา {n} รายการ", { n: c.bookings }) : null, c.checkins ? t("เช็กอินฟิตเนส/สระที่ค้างอยู่ {n}", { n: c.checkins }) : null].filter(Boolean);
    const ok = await DD.confirm({ danger: true, ok: t("เปลี่ยนผู้เช่าและสร้างลิงก์ใหม่"), title: t("เปลี่ยนผู้เช่าห้อง {r}?", { r: r.room_no }),
      text: t("ลิงก์ใหม่จะเริ่มข้อมูลใหม่ทั้งหมด ลิงก์เดิมใช้ไม่ได้ทันที") + " " + (items.length ? t("ระบบจะยกเลิกของผู้เช่าเดิม: {x}", { x: items.join(", ") }) : "") + " " +
        t("บิลค้าง {a} · ค่าปรับ {b} รายการ · แจ้งซ่อม {c} เรื่อง จะย้ายไปเก็บเป็นประวัติผู้เช่าก่อนหน้า ผู้เช่าใหม่มองไม่เห็น", { a: baht(c.unpaid_total), b: c.open_fines, c: c.requests }) });
    if (!ok) return;
    try {
      const res = await api(`/api/admin/rooms/${r.id}/new-tenancy`, { method: "POST" });
      const link = location.origin + "/r/" + res.room_code;
      try { await navigator.clipboard.writeText(link); DD.toast(t("ผู้เช่าใหม่ห้อง {r}: คัดลอกลิงก์ใหม่แล้ว", { r: res.room_no })); }
      catch (e) { DD.toast(t("ผู้เช่าใหม่ห้อง {r} พร้อมแล้ว ลิงก์ใหม่อยู่ในแท็บห้อง & ลิงก์", { r: res.room_no })); }
      invalidate(); ctx.rerender && ctx.rerender();
    } catch (e) { ctx.fail(e); }
  }

  window.DD_ADMIN_EXT = { syncTabs, dashExtras, billing, parking, spaces, settings, changeTenant };
})();
