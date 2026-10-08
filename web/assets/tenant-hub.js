// Tenant hub (v2): the room link /r/{code} becomes a small app with tabs —
// แจ้งซ่อม (repair, tenant.js) · ส่วนกลาง (fitness/pool check-in + space booking) · ที่จอดรถ · บิล (+ ค่าปรับ).
// Tabs the owner switched off are not rendered (and the API answers 403 anyway). Routing is the URL hash.
(function () {
  const t = (k, v) => DD_I18N.t(k, v);
  const $ = (id) => document.getElementById(id);
  const el = DD.el;
  const code = DD.lastPathPart();
  const base = "/api/rooms/" + encodeURIComponent(code);
  const VIEWS = ["repair", "facilities", "booking", "parking", "bills", "fines", "pass"];
  let H = null;            // /home payload
  let clockTimer = null;

  // ---------------------------------------------------------------- formatting
  const money = (s) => (Number(s || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const baht = (s) => t("{n} บาท", { n: money(s) });
  const dDate = (x) => new Date(x).toLocaleDateString(DD_I18N.locale, { day: "numeric", month: "short", year: "numeric" });
  const dShort = (x) => new Date(x).toLocaleDateString(DD_I18N.locale, { weekday: "short", day: "numeric", month: "short" });
  const hm = (x) => new Date(x).toLocaleTimeString(DD_I18N.locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  const periodName = (p) => {
    if (!p) return "";
    if (p[0] === "F") return t("ค่าปรับ (เรียกเก็บแยก)");
    const [y, m] = p.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(DD_I18N.locale, { month: "short", year: "numeric" });
  };
  const key = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random()).toString();
  const BILL = { unpaid: ["รอชำระ", "in_progress"], slip_sent: ["รอตรวจสลิป", "received"], returned: ["สลิปถูกตีกลับ", "urgent"],
    overdue: ["เกินกำหนด", "urgent"], paid: ["ชำระแล้ว", "done"], cancelled: ["ยกเลิก", "rejected"] };
  const PERMIT = { pending: ["รอเจ้าของหอตรวจ", "received"], returned: ["ถูกตีกลับ", "in_progress"], active: ["ใช้งานอยู่", "done"],
    cancel_notice: ["แจ้งยกเลิก", "urgent"], cancelled: ["ยกเลิกแล้ว", "rejected"], withdrawn: ["ถอนคำขอ", "rejected"] };
  const BOOK = { booked: ["จองแล้ว", "received"], confirmed: ["ยืนยันแล้ว", "done"], cancelled: ["ยกเลิกแล้ว", "rejected"],
    cancelled_late: ["ยกเลิกช้า (นับเป็นไม่มา)", "urgent"], no_show: ["จองแล้วไม่มา", "urgent"], void: ["ถูกยกเลิก", "rejected"] };
  const FINE = { open: ["รอคุณตอบกลับ", "in_progress"], disputed: ["โต้แย้งแล้ว · รอเจ้าของหอ", "received"], confirmed: ["ยืนยันแล้ว", "urgent"],
    billed: ["รวมในบิลแล้ว", "done"], cancelled: ["ยกเลิกแล้ว", "rejected"] };
  const VT = { car: "รถยนต์", moto: "มอเตอร์ไซค์" };
  const badge = (map, s) => el("span", { class: "badge " + ((map[s] || [])[1] || "") }, (map[s] || [s])[0]);
  const card = (icon, title, ...body) => el("section", { class: "card mt-2" },
    el("div", { class: "card-title" }, DD.icon(icon), el("h2", { class: "mt-0", text: title })), ...body);
  const errorTo = (box) => (e) => { box.replaceChildren(DD.errorBox(e)); };
  const busy = async (btn, fn) => {
    const old = [...btn.childNodes]; btn.disabled = true; btn.replaceChildren(el("span", { class: "bar-loader" }), t("กำลังส่ง…"));
    try { return await fn(); } finally { btn.disabled = false; btn.replaceChildren(...old); }
  };
  const unitNote = (n) => { const m = /^([\d.,]+) หน่วย$/.exec(n || ""); return m ? t("{n} หน่วย", { n: m[1] }) : n === "เหมาจ่าย" ? t(n) : n; };
  const data = (s) => el("span", { translate: "no", text: s });          // user / owner data: never machine-translated
  const facRow = (icon, title, meta, right) => el("div", { class: "facility" }, el("span", { class: "fac-icon" }, DD.icon(icon)),
    el("span", {}, el("strong", {}, title), meta ? el("span", { class: "row-meta" }, meta) : null), right || el("span"));
  function thread(msgs) {
    if (!msgs || !msgs.length) return null;
    return el("div", { class: "thread mt-2" }, msgs.map((m) => el("div", { class: "msg " + (m.author === "tenant" ? "me" : "owner") },
      el("span", { class: "who", text: (m.author === "tenant" ? t("ห้องของฉัน") : t("เจ้าของหอ")) + " · " + DD.fmt(m.created_at) }),
      el("span", { translate: "no", text: m.body }))));
  }
  function composer(send) {
    const inp = el("input", { class: "input", maxlength: 1000, placeholder: "พิมพ์ข้อความถึงเจ้าของหอ", "aria-label": "ข้อความ" });
    const err = el("div");
    const btn = el("button", { class: "btn", type: "submit", "aria-label": "ส่ง" }, DD.icon("send"));
    const f = el("form", { class: "composer", onsubmit: async (ev) => {
      ev.preventDefault(); err.replaceChildren();
      if (!inp.value.trim()) return inp.focus();
      try { await busy(btn, () => send(inp.value.trim())); inp.value = ""; } catch (e) { errorTo(err)(e); }
    } }, el("label", { class: "sr-only", text: "ตอบกลับ" }), inp, btn);
    return el("div", {}, f, err);
  }
  function contactLine(c) {
    if (!c || (!c.phone && !c.email)) return null;
    return el("p", { class: "xs muted mt-1" }, t("ติดต่อเจ้าของหอ:") + " ",
      c.phone ? el("a", { href: "tel:" + c.phone.replace(/[^0-9+]/g, ""), text: c.phone, translate: "no" }) : null,
      c.phone && c.email ? " · " : null, c.email ? el("a", { href: "mailto:" + c.email, text: c.email, translate: "no" }) : null);
  }

  // ---------------------------------------------------------------- shell: banner, hub, summary
  async function loadHome() { H = await DD.api(base + "/home"); return H; }
  function renderShell() {
    const f = H.features;
    const fines = H.open_fines || [];
    const banner = $("fineBanner");
    if (f.fines && fines.length) {
      const total = fines.reduce((s, x) => s + x.amount, 0);
      banner.replaceChildren(DD.icon("alert"), el("span", {},
        el("strong", { text: t("มีค่าปรับ {n} รายการ · {a}", { n: fines.length, a: baht(total) }) }),
        el("span", { class: "small", text: fines[0].title + " · " + t("แตะเพื่อดูเหตุผลและตอบกลับ"), translate: "no" })));
      banner.href = fines.length === 1 ? "#fine/" + fines[0].id : "#fines";
      banner.classList.remove("hidden");
    } else banner.classList.add("hidden");
    const tabs = [["repair", "wrench", "แจ้งซ่อม", true], ["facilities", "dumbbell", "ส่วนกลาง", f.fitness || f.pool || f.spaces],
      ["parking", "car", "ที่จอดรถ", f.parking], ["bills", "receipt", "บิล", f.bills]].filter((x) => x[3]);
    const hub = $("hub");
    if (tabs.length > 1) {
      hub.style.gridTemplateColumns = `repeat(${tabs.length}, minmax(0,1fr))`;
      const dot = { bills: H.bill && ["overdue", "returned", "unpaid"].includes(H.bill.status), parking: H.parking && H.parking.attention };
      hub.replaceChildren(...tabs.map(([v, icon, label]) => el("a", { href: "#" + v, "data-view": v }, DD.icon(icon), label,
        dot[v] ? el("span", { class: "dot", "aria-label": t("มีรายการที่ต้องดู") }) : null)));
      hub.classList.remove("hidden");
    }
    // summary card on the repair tab
    const rows = [];
    if (H.bill) rows.push(facRow("receipt", t("บิล {p}", { p: periodName(H.bill.period) }),
      [t("ครบกำหนด {d}", { d: dDate(H.bill.due_date) }), " · ", baht(H.bill.total)], el("a", { href: "#bills" }, badge(BILL, H.bill.status))));
    if (H.next_booking) rows.push(facRow("calendar", data(H.next_booking.facility), `${dShort(H.next_booking.starts_at)} · ${hm(H.next_booking.starts_at)}–${hm(H.next_booking.ends_at)}`,
      el("a", { href: "#booking" }, badge(BOOK, H.next_booking.status))));
    if (H.parking) rows.push(facRow("car", t("ที่จอดรถ"), t("รถยนต์ {a}/{b} · มอเตอร์ไซค์ {c}/{d}", { a: H.parking.used.car, b: H.parking.quota.car,
      c: H.parking.used.moto, d: H.parking.quota.moto }), H.parking.attention ? el("a", { href: "#parking" }, el("span", { class: "badge urgent", text: t("ต้องดู") })) : null));
    if (f.bills || f.parking || f.fines) rows.push(emailRow());
    if (rows.length) { $("sumRows").replaceChildren(...rows); $("homeSum").classList.remove("hidden"); }
  }
  function emailRow() {
    const box = el("div", { class: "facility" });
    const draw = (editing) => {
      if (!editing) {
        box.replaceChildren(el("span", { class: "fac-icon" }, DD.icon("mail")),
          el("span", {}, el("strong", { text: t("แจ้งเตือนทางอีเมล") }),
            el("span", { class: "row-meta", text: H.notify_email ? t("เปิดอยู่ (บิลใหม่ ค่าปรับ ที่จอดรถ)") : t("ยังไม่ได้ตั้ง") })),
          el("button", { class: "btn ghost sm", type: "button", onclick: () => draw(true) }, H.notify_email ? t("เปลี่ยน") : t("ตั้งค่า")));
        return;
      }
      const inp = el("input", { class: "input", type: "email", placeholder: "you@example.com", "aria-label": "อีเมล", autocomplete: "email" });
      const ok = el("input", { type: "checkbox", id: "mailOk" });
      const err = el("div");
      box.replaceChildren(el("form", { class: "stack spacer", onsubmit: async (ev) => {
        ev.preventDefault();
        try { const r = await DD.api(base + "/contact", { method: "POST", json: { email: inp.value.trim(), consent: ok.checked } });
          H.notify_email = r.notify_email; DD.toast(r.notify_email ? t("บันทึกอีเมลแล้ว") : t("ปิดการแจ้งเตือนแล้ว")); draw(false); }
        catch (e) { errorTo(err)(e); }
      } }, el("label", { class: "field-label", for: "mailIn", text: "อีเมลรับแจ้งเตือน (เว้นว่าง = ปิด)" }), inp,
        el("label", { class: "check" }, ok, el("span", { class: "small", text: "ยินยอมให้หอใช้อีเมลนี้แจ้งเรื่องบิล ค่าปรับ และที่จอดรถของห้องนี้เท่านั้น ลบเมื่อย้ายออก" })),
        err, el("div", { class: "row" }, el("button", { class: "btn sm", type: "submit" }, "บันทึก"),
          el("button", { class: "btn ghost sm", type: "button", onclick: () => draw(false) }, "ยกเลิก"))));
      inp.id = "mailIn"; inp.focus();
    };
    draw(false);
    return box;
  }

  // ---------------------------------------------------------------- router
  function route() {
    const h = location.hash.replace(/^#/, "");
    let [view, arg] = h.split("/");
    if (view === "fine") view = "fines";            // #fine/<id> = one fine, #fines = list
    if (!VIEWS.includes(view)) view = "repair";
    const f = H ? H.features : {};
    if ((view === "facilities" || view === "pass") && !(f.fitness || f.pool || f.spaces)) view = "repair";
    if (view === "booking" && !f.spaces) view = "repair";
    if (view === "parking" && !f.parking) view = "repair";
    if (view === "bills" && !f.bills) view = "repair";
    if (view === "fines" && !f.fines) view = "repair";
    VIEWS.forEach((v) => $("v-" + v).classList.toggle("hidden", v !== view));
    $("hub").querySelectorAll("[data-view]").forEach((a) => {
      const cur = a.dataset.view === view || (a.dataset.view === "facilities" && ["booking", "pass"].includes(view)) || (a.dataset.view === "bills" && view === "fines");
      a.setAttribute("aria-current", cur ? "page" : "false");
    });
    clearInterval(clockTimer);
    const r = { facilities: renderFacilities, booking: renderBooking, parking: renderParking, bills: renderBills, fines: () => renderFines(arg), pass: () => renderPass(arg) }[view];
    if (r) {
      const box = $("v-" + view);
      box.replaceChildren(el("div", { class: "card mt-2" }, DD.skeletonLines(5)));
      r(arg).catch((e) => box.replaceChildren(el("div", { class: "card mt-2" }, DD.errorBox(e))));
    }
    if (view !== "repair") window.scrollTo({ top: 0 });
  }
  window.addEventListener("hashchange", route);

  // ================================================================ facilities (fitness / pool) + entry to booking
  async function renderFacilities() {
    const d = await DD.api(base + "/facilities");
    const box = $("v-facilities");
    const out = [];
    if (d.active.length) {
      out.push(card("clock", t("กำลังใช้งานอยู่"), el("div", { class: "row" }, el("span", { class: "spacer" }),
        el("span", { class: "badge received", text: t("ห้องนี้ {a}/{b} คน", { a: d.active.length, b: d.room_limit }) })),
      ...d.active.map((c) => facRow(c.kind === "pool" ? "waves" : "dumbbell", data(c.facility), t("เข้า {a} · หมดเวลา {b}", { a: hm(c.started_at), b: hm(c.expires_at) }),
        el("div", { class: "row" }, el("a", { class: "btn sm", href: "#pass/" + c.id }, "แสดงบัตร"),
          el("button", { class: "btn ghost sm", type: "button", onclick: async () => {
            try { await DD.api(`${base}/checkins/${c.id}/checkout`, { method: "POST" }); DD.toast(t("เช็กเอาท์แล้ว")); renderFacilities(); } catch (e) { DD.toast(e.message, "err"); }
          } }, "เช็กเอาท์"))))));
    }
    const rows = [...d.checkin.map((f) => {
      const pct = f.capacity ? Math.min(100, Math.round((f.current / f.capacity) * 100)) : null;
      const state = !f.open_now ? ["ปิดอยู่", "rejected"] : pct === null ? ["เปิดอยู่", "done"] : pct >= 100 ? ["เต็ม", "urgent"] : pct >= 80 ? ["ใกล้เต็ม", "in_progress"] : ["ว่าง", "done"];
      return el("div", { class: "facility" }, el("span", { class: "fac-icon" }, DD.icon(f.kind === "pool" ? "waves" : "dumbbell")),
        el("span", {}, el("strong", { text: f.name, translate: "no" }),
          el("span", { class: "row-meta" }, f.hours, " · ", f.capacity ? t("ใช้อยู่ {n}/{c} คน", { n: f.current, c: f.capacity }) : t("ใช้อยู่ {n} คน", { n: f.current })),
          f.closed_note ? el("span", { class: "row-meta danger-text", text: f.closed_note, translate: "no" }) : null,
          pct !== null ? el("span", { class: "meter" + (pct >= 80 ? " busy" : "") }, el("span", { style: `width:${pct}%` })) : null),
        el("span", { class: "badge " + state[1], text: t(state[0]) }));
    }), ...d.spaces.map((s) => facRow("calendar", data(s.name), d.quota ? t("ต้องจองล่วงหน้า · สัปดาห์นี้จองได้อีก {n} ครั้ง", { n: d.quota.left }) : t("ต้องจองล่วงหน้า"),
      el("a", { class: "btn sm ghost", href: "#booking" }, "จอง")))];
    out.push(card("users", t("ตอนนี้มีคนใช้กี่คน"), ...(rows.length ? rows : [DD.empty("dumbbell", t("หอนี้ยังไม่มีพื้นที่ส่วนกลาง"), null)])));
    if (d.checkin.length) {
      const err = el("div", { class: "mt-2" });
      const btn = el("button", { class: "btn block", type: "button" }, DD.icon("scan"), "สแกน QR เพื่อเช็กอิน");
      btn.addEventListener("click", async () => {
        err.replaceChildren();
        const qr = await DD_SCAN.open({ title: t("เช็กอินฟิตเนส / สระ"), hint: t("เล็งกล้องไปที่ QR บนโต๊ะคนตรวจ") });
        if (!qr) return;
        try {
          const r = await busy(btn, () => DD.api(base + "/checkins", { method: "POST", json: { qr }, headers: { "Idempotency-Key": key() } }));
          if (r.full) DD.toast(t("ตอนนี้เต็มแล้ว ให้คนตรวจตัดสินที่หน้างาน"));
          location.hash = "#pass/" + r.id;
        } catch (e) { err.replaceChildren(el("div", { class: "alert " + (e.status === 409 ? "warn" : "err") }, DD.icon("alert"), el("span", { text: e.message }))); }
      });
      out.push(card("scan", t("เช็กอินฟิตเนส / สระ"),
        el("p", { class: "small muted", text: t("สแกน QR ที่โต๊ะคนตรวจ แล้วแสดงบัตรให้คนตรวจดู เช็กอินมีผล {h} ชั่วโมง ครบแล้วระบบเช็กเอาท์ให้เอง", { h: d.checkin_hours }) }),
        btn, err, el("p", { class: "xs muted mt-1", text: t("ห้องเดียวกันเช็กอินพร้อมกันได้ไม่เกิน {n} คน", { n: d.room_limit }) })));
    }
    box.replaceChildren(...out);
  }

  // ---------------------------------------------------------------- check-in pass (live clock: a screenshot does not pass)
  async function renderPass(id) {
    const p = await DD.api(`${base}/checkins/${encodeURIComponent(id)}`);
    const box = $("v-pass");
    const clock = el("div", { class: "clock mt-2", "aria-live": "off" });
    const left = el("b");
    const pass = el("section", { class: "pass mt-2" + (p.active ? "" : " expired"), "aria-label": t("บัตรเช็กอิน") },
      el("span", { class: "live" }, el("i"), p.active ? t("กำลังใช้งาน") : t("หมดเวลาแล้ว")),
      el("p", { class: "facility-name", text: p.facility, translate: "no" }),
      el("div", { class: "small" }, el("span", { translate: "no", text: p.dorm_name }), " · ", t("ห้อง")),
      el("div", { class: "big", text: p.room_no, translate: "no" }), clock, el("div", { class: "xs", text: t("เวลาตอนนี้") }),
      el("div", { class: "kv" },
        el("div", {}, el("span", { class: "xs", text: t("เข้า") }), el("b", { text: hm(p.started_at) })),
        el("div", {}, el("span", { class: "xs", text: t("หมดเวลา") }), el("b", { text: hm(p.expires_at) })),
        el("div", {}, el("span", { class: "xs", text: t("เหลือเวลา") }), left),
        el("div", {}, el("span", { class: "xs", text: t("ห้องนี้ใช้อยู่") }), el("b", { text: t("{a}/{b} คน", { a: p.room_active, b: p.room_limit }) }))));
    const exp = new Date(p.expires_at).getTime();
    const paint = () => {
      clock.textContent = new Date().toLocaleTimeString("th-TH", { hour12: false });
      const ms = exp - Date.now();
      if (ms <= 0 || !p.active) { left.textContent = "—"; pass.classList.add("expired"); return; }
      const m = Math.floor(ms / 6e4);
      left.textContent = t("{h} ชม. {m} นาที", { h: Math.floor(m / 60), m: m % 60 });
    };
    paint(); clockTimer = setInterval(paint, 1000);
    box.replaceChildren(el("a", { class: "btn ghost sm mt-2", href: "#facilities" }, DD.icon("back"), "กลับ"), pass,
      el("p", { class: "small muted center mt-2", text: t("แสดงหน้านี้ให้คนตรวจที่โต๊ะดู นาฬิกาต้องเดินอยู่ ภาพหน้าจอที่แคปไว้ใช้ไม่ได้") }),
      p.active ? el("button", { class: "btn ghost block mt-2", type: "button", onclick: async () => {
        try { await DD.api(`${base}/checkins/${p.id}/checkout`, { method: "POST" }); DD.toast(t("เช็กเอาท์แล้ว")); location.hash = "#facilities"; } catch (e) { DD.toast(e.message, "err"); }
      } }, "เช็กเอาท์") : null);
  }

  // ================================================================ booking common spaces
  let BK = { space: null, day: null, slot: null };
  async function renderBooking() {
    const [fac, bk] = await Promise.all([DD.api(base + "/facilities"), DD.api(base + "/bookings")]);
    const box = $("v-booking");
    const spaces = fac.spaces;
    if (!spaces.length) { box.replaceChildren(card("calendar", t("จองห้องส่วนกลาง"), DD.empty("calendar", t("ยังไม่มีห้องให้จอง"), null))); return; }
    if (!BK.space || !spaces.find((s) => s.id === BK.space)) BK.space = spaces[0].id;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!BK.day) BK.day = iso(today);
    const out = [el("a", { class: "btn ghost sm mt-2", href: "#facilities" }, DD.icon("back"), "ส่วนกลาง")];
    // my bookings
    const live = bk.items.filter((b) => ["booked", "confirmed"].includes(b.status) && new Date(b.ends_at) > new Date());
    const myCard = card("calendar", t("การจองของฉัน"));
    if (!live.length) myCard.append(el("p", { class: "small muted", text: t("ยังไม่มีการจองที่กำลังจะถึง") }));
    for (const b of live) {
      const until = new Date(new Date(b.starts_at).getTime() + bk.rules.confirm_min * 6e4);
      const err = el("div");
      myCard.append(facRow("calendar", data(b.facility), `${dShort(b.starts_at)} · ${hm(b.starts_at)}–${hm(b.ends_at)}`,
        badge(BOOK, b.status === "booked" && new Date(b.starts_at) <= new Date() ? "booked" : b.status)));
      if (b.status === "booked") {
        myCard.append(el("div", { class: "alert info" }, DD.icon("clock"), el("span", {},
          t("สแกน QR ที่หน้าห้องภายใน {t} ถ้าไม่สแกน ระบบจะปล่อยห้องให้คนอื่นและนับเป็นจองแล้วไม่มา", { t: hm(until) }))));
        const scanBtn = el("button", { class: "btn spacer", type: "button" }, DD.icon("scan"), "สแกนยืนยัน");
        scanBtn.addEventListener("click", async () => {
          const qr = await DD_SCAN.open({ title: t("ยืนยันว่ามาใช้ห้องจริง"), hint: t("สแกน QR ที่ติดหน้าห้อง") });
          if (!qr) return;
          try { await busy(scanBtn, () => DD.api(`${base}/bookings/${b.id}/confirm`, { method: "POST", json: { qr } })); DD.toast(t("ยืนยันแล้ว ใช้ห้องได้เลย")); renderBooking(); }
          catch (e) { errorTo(err)(e); }
        });
        myCard.append(el("div", { class: "row mt-1" }, scanBtn, el("button", { class: "btn ghost", type: "button", onclick: async () => {
          const late = new Date(b.starts_at).getTime() - Date.now() < bk.rules.cancel_before_h * 3.6e6;
          const ok = await DD.confirm({ title: t("ยกเลิกการจองนี้?"), danger: late, ok: t("ยกเลิกการจอง"),
            text: late ? t("เหลือน้อยกว่า {h} ชั่วโมง การยกเลิกตอนนี้นับเป็น \"จองแล้วไม่มา\" 1 ครั้ง", { h: bk.rules.cancel_before_h }) : t("ได้โควตาคืน ไม่นับเป็นจองแล้วไม่มา") });
          if (!ok) return;
          try { await DD.api(`${base}/bookings/${b.id}/cancel`, { method: "POST" }); DD.toast(t("ยกเลิกแล้ว")); renderBooking(); } catch (e) { errorTo(err)(e); }
        } }, "ยกเลิก")), err);
      }
    }
    myCard.append(el("p", { class: "xs muted mt-1", text: t("ยกเลิกก่อนเวลาเริ่มอย่างน้อย {h} ชั่วโมงจะได้โควตาคืน และไม่นับเป็นจองแล้วไม่มา", { h: bk.rules.cancel_before_h }) }));
    out.push(myCard);
    if (bk.banned_until) out.push(el("div", { class: "alert err mt-2" }, DD.icon("ban"), el("span", {},
      t("งดการจองถึง {d} เพราะจองแล้วไม่มาครบ {n} ครั้ง", { d: dDate(bk.banned_until), n: bk.strike_limit }), contactLine(bk.contact))));
    else if (bk.strikes > 0) out.push(el("div", { class: "alert warn mt-2" }, DD.icon("alert"), el("span", {},
      t("คุณจองแล้วไม่มา {n} ครั้งใน {w} วันที่ผ่านมา ถ้าครบ {m} ครั้ง จะจองไม่ได้ {d} วัน", { n: bk.strikes, w: bk.rules.window_d, m: bk.strike_limit, d: bk.ban_days }))));
    // new booking
    const q = bk.quota;
    const slotsBox = el("div", { class: "slots mt-2" });
    const bookBtn = el("button", { class: "btn block mt-2", type: "button", disabled: true }, "เลือกช่วงเวลา");
    const err = el("div");
    const spaceSeg = el("div", { class: "seg", role: "group", "aria-label": t("เลือกห้อง") }, spaces.map((s) =>
      el("button", { type: "button", "aria-pressed": String(s.id === BK.space), translate: "no", onclick: () => { BK.space = s.id; BK.slot = null; renderBooking(); } }, s.name)));
    const days = el("div", { class: "days mt-2", role: "group", "aria-label": t("เลือกวัน") }, Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today); d.setDate(d.getDate() + i);
      return el("button", { class: "day", type: "button", "aria-pressed": String(iso(d) === BK.day), onclick: () => { BK.day = iso(d); BK.slot = null; renderBooking(); } },
        d.toLocaleDateString(DD_I18N.locale, { weekday: "short" }), el("b", { text: d.getDate() }));
    }));
    out.push(card("plus", t("จองช่วงเวลา"), spaceSeg,
      el("div", { class: "row mt-2" }, el("span", { class: "small spacer" }, t("สัปดาห์นี้จองได้อีก {a} จาก {b} ครั้ง", { a: q.left, b: q.total })),
        el("span", { class: "quota", "aria-hidden": "true" }, Array.from({ length: Math.max(q.total, 1) }, (_, i) => el("i", { class: i < q.used ? "off" : "" })))),
      days, slotsBox, bookBtn, err, el("p", { class: "xs muted mt-1", text: t("จองแล้วได้ห้องทันที ไม่ต้องรอเจ้าของหออนุมัติ") })));
    box.replaceChildren(...out);
    // slots for the chosen space + day
    try {
      const sl = await DD.api(`${base}/spaces/${BK.space}/slots?date=${BK.day}`);
      if (sl.closed_note) slotsBox.before(el("div", { class: "alert warn mt-2" }, DD.icon("alert"), el("span", { text: sl.closed_note, translate: "no" })));
      slotsBox.replaceChildren(...(sl.slots.length ? sl.slots.map((s) => {
        const label = { free: "ว่าง", taken: "มีคนจอง", mine: "ของฉัน", closed: "ปิด" }[s.state];
        const b = el("button", { class: "slot" + (s.state === "mine" ? " mine" : ""), type: "button", disabled: s.state !== "free" || !!bk.banned_until || q.left <= 0,
          "aria-pressed": String(BK.slot === s.start) }, hm(s.start), el("small", { text: t(label) }));
        b.addEventListener("click", () => {
          BK.slot = s.start; slotsBox.querySelectorAll(".slot").forEach((x) => x.setAttribute("aria-pressed", "false")); b.setAttribute("aria-pressed", "true");
          bookBtn.disabled = false; bookBtn.textContent = t("จอง {d} {a}–{b}", { d: dShort(s.start), a: hm(s.start), b: hm(s.end) });
        });
        return b;
      }) : [el("p", { class: "small muted", text: t("ไม่มีช่วงเวลาที่จองได้ในวันนี้") })]));
    } catch (e) { slotsBox.replaceChildren(DD.errorBox(e)); }
    bookBtn.addEventListener("click", async () => {
      if (!BK.slot) return;
      err.replaceChildren();
      try { await busy(bookBtn, () => DD.api(base + "/bookings", { method: "POST", json: { space_id: BK.space, start: BK.slot }, headers: { "Idempotency-Key": key() } }));
        DD.toast(t("จองแล้ว")); BK.slot = null; renderBooking(); }
      catch (e) { errorTo(err)(e); }
    });
  }

  // ================================================================ parking
  async function renderParking() {
    const d = await DD.api(base + "/parking");
    const box = $("v-parking");
    const out = [];
    const mine = card("car", t("สิทธิ์ที่จอดของห้อง"),
      el("p", { class: "small muted", text: t("รถยนต์ {a}/{b} ที่ · มอเตอร์ไซค์ {c}/{e} ที่", { a: d.used.car, b: d.quota.car, c: d.used.moto, e: d.quota.moto }) }));
    const shown = d.permits.filter((p) => p.status !== "returned");
    if (!shown.length) mine.append(el("p", { class: "small muted", text: t("ห้องนี้ยังไม่มีสิทธิ์ที่จอด") }));
    for (const p of shown) {
      const meta = [VT[p.vtype] ? t(VT[p.vtype]) : p.vtype, p.sticker ? t("สติกเกอร์ {s}", { s: p.sticker }) : null, p.spot ? t("ช่อง {s}", { s: p.spot }) : null,
        p.fee ? t("{n} บาท/เดือน", { n: money(p.fee) }) : null].filter(Boolean).join(" · ");
      mine.append(facRow("car", data(`${p.plate} ${p.province || ""}`.trim()), meta, badge(PERMIT, p.status)));
      if (p.status === "cancel_notice") {
        const total = d.cancel_days * 864e5, end = new Date(p.cancel_due_at).getTime();
        const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / 864e5));
        const pct = Math.min(100, Math.max(0, Math.round(100 - ((end - Date.now()) / total) * 100)));
        const ring = el("span", { class: "ring" }, el("span", {}, String(daysLeft), el("small", { text: t("วัน") })));
        ring.style.setProperty("--p", pct + "%");
        const err = el("div");
        mine.append(el("div", { class: "alert err" }, DD.icon("alert"), el("span", {}, el("strong", { text: t("เจ้าของหอแจ้งยกเลิกสิทธิ์ที่จอดนี้") }), el("br"),
            t("เหตุผล:") + " ", el("span", { translate: "no", text: p.cancel_reason }))),
          el("div", { class: "countdown mt-2" }, ring, el("span", { class: "small" },
            t("สิทธิ์จะสิ้นสุดเมื่อคุณกดรับทราบ หรือครบ {n} วัน ({d}) ค่าจอดจะหยุดเก็บตั้งแต่บิลเดือนถัดไป", { n: d.cancel_days, d: dDate(p.cancel_due_at) }))),
          thread(p.messages) || el("span"),
          composer(async (text) => { await DD.api(`${base}/parking/permits/${p.id}/messages`, { method: "POST", json: { text }, headers: { "Idempotency-Key": key() } }); DD.toast(t("ส่งข้อความแล้ว")); renderParking(); }),
          el("div", { class: "row mt-2" }, el("button", { class: "btn danger spacer", type: "button", onclick: async () => {
            const ok = await DD.confirm({ title: t("รับทราบการยกเลิก?"), text: t("สิทธิ์ที่จอดนี้จะสิ้นสุดทันที"), ok: t("รับทราบ"), danger: true });
            if (!ok) return;
            try { await DD.api(`${base}/parking/permits/${p.id}/ack-cancel`, { method: "POST" }); DD.toast(t("รับทราบแล้ว")); renderParking(); } catch (e) { errorTo(err)(e); }
          } }, "รับทราบการยกเลิก"), d.contact.phone ? el("a", { class: "btn ghost", href: "tel:" + d.contact.phone.replace(/[^0-9+]/g, "") }, DD.icon("phone"), "โทร") : null), err);
      } else if (p.messages.length && p.status === "active") mine.append(thread(p.messages));
    }
    mine.append(contactLine(d.contact) || el("span"));
    out.push(mine);
    // apply / resubmit
    const returned = d.permits.find((p) => p.status === "returned");
    const pending = d.permits.filter((p) => p.status === "pending");
    const form = card("plus", t("ยื่นขอสิทธิ์ที่จอด"));
    if (returned) form.append(el("div", { class: "alert warn" }, DD.icon("message"), el("span", {},
      el("strong", { text: t("คำขอ{v}ถูกตีกลับ", { v: t(VT[returned.vtype]) }) }), el("br"),
      el("span", { translate: "no", text: ((returned.messages.filter((m) => m.author !== "tenant").pop() || {}).body) || "" }))));
    if (pending.length) form.append(el("div", { class: "alert info" }, DD.icon("clock"), el("span", { text: t("ส่งคำขอแล้ว {n} รายการ รอเจ้าของหอตรวจ", { n: pending.length }) })));
    let vtype = returned ? returned.vtype : "car";
    const plate = el("input", { class: "input", id: "pPlate", maxlength: 16, value: returned ? returned.plate : "", placeholder: "เช่น กข 1234", required: true });
    const prov = el("input", { class: "input", id: "pProv", maxlength: 40, value: returned ? returned.province : "กรุงเทพมหานคร" });
    const bc = el("input", { class: "input", id: "pBc", maxlength: 60, value: returned ? returned.brand_color : "", placeholder: "เช่น Honda สีแดง" });
    const seg = el("div", { class: "seg", role: "group", "aria-label": t("ประเภทรถ") }, ["car", "moto"].map((v) => el("button", { type: "button", "aria-pressed": String(v === vtype),
      onclick: (ev) => { vtype = v; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false")); ev.currentTarget.setAttribute("aria-pressed", "true"); drawFull(); } }, t(VT[v]))));
    const fullBox = el("div");
    const err = el("div");
    const submit = el("button", { class: "btn block mt-2", type: "submit" }, returned ? "ส่งให้เจ้าของหอตรวจอีกครั้ง" : "ส่งคำขอ");
    const drawFull = () => {
      const full = d.lot_full[vtype];
      submit.disabled = full && !returned;
      fullBox.replaceChildren();
      if (!full) return;
      if (d.waitlist) fullBox.append(el("div", { class: "alert info mt-2" }, DD.icon("clock"), el("span", {},
        d.waitlist.status === "offered" ? t("มีที่จอดว่างแล้ว ยื่นคำขอได้เลย") : t("ที่จอด{v}เต็ม คุณอยู่คิวที่ {n} ระบบจะแจ้งเมื่อมีช่องว่าง", { v: t(VT[d.waitlist.vtype]), n: d.waitlist.position || "-" })),
        el("button", { class: "btn ghost sm", type: "button", onclick: async () => { await DD.api(base + "/parking/waitlist/cancel", { method: "POST" }); renderParking(); } }, "ออกจากคิว")));
      else fullBox.append(el("div", { class: "alert warn mt-2" }, DD.icon("alert"), el("span", { text: t("ที่จอด{v}เต็มแล้ว", { v: t(VT[vtype]) }) }),
        el("button", { class: "btn sm", type: "button", onclick: async () => {
          try { await DD.api(base + "/parking/waitlist", { method: "POST", json: { vtype } }); DD.toast(t("ลงชื่อรอคิวแล้ว")); renderParking(); } catch (e) { errorTo(err)(e); }
        } }, "ลงชื่อรอคิว")));
    };
    form.append(el("form", { novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault(); err.replaceChildren();
      if (plate.value.trim().length < 2) return plate.focus();
      try { await busy(submit, () => DD.api(base + "/parking/permits", { method: "POST", headers: { "Idempotency-Key": key() },
        json: { plate: plate.value.trim(), province: prov.value.trim(), vtype, brand_color: bc.value.trim(), resubmit_id: returned ? returned.id : null } }));
        DD.toast(t("ส่งคำขอแล้ว รอเจ้าของหอตรวจ")); renderParking(); }
      catch (e) { errorTo(err)(e); }
    } }, el("div", { class: "field" }, el("label", { for: "pPlate", text: "ทะเบียนรถ" }), plate),
      el("div", { class: "field" }, el("label", { for: "pProv", text: "จังหวัด" }), prov),
      el("div", { class: "field" }, el("span", { class: "field-label", text: "ประเภท" }), seg),
      el("div", { class: "field" }, el("label", { for: "pBc" }, t("ยี่ห้อ / สี") + " ", el("span", { class: "hint", text: "(ไม่บังคับ)" })), bc),
      fullBox, submit, err));
    drawFull();
    out.push(form);
    // guest passes
    const g = card("ticket", t("บัตรจอดแขก"));
    for (const p of d.guest_passes) g.append(el("div", { class: "pass guest-pass mt-1" + (p.status !== "active" ? " expired" : "") },
      el("div", { class: "xs", text: p.status === "pending" ? t("รอเจ้าของหออนุมัติ") : p.status === "rejected" ? t("ไม่อนุมัติ") : t("บัตรจอดแขก · ใช้ได้ถึง 23:59") }),
      el("div", { class: "plate", text: p.plate, translate: "no" }),
      el("div", { class: "small", text: t("{d} · มาหาห้อง {r}", { d: dDate(p.valid_date), r: H.room_no }) })));
    const gp = el("input", { class: "input", id: "gPlate", maxlength: 16, placeholder: "ทะเบียนรถแขก" });
    const gd = el("input", { class: "input", id: "gDate", type: "date", value: d.today, min: d.today });
    const gErr = el("div");
    const gBtn = el("button", { class: "btn ghost block mt-2", type: "submit" }, "ขอบัตรจอดแขก");
    g.append(el("form", { class: "mt-2", onsubmit: async (ev) => {
      ev.preventDefault(); gErr.replaceChildren();
      if (gp.value.trim().length < 2) return gp.focus();
      try { await busy(gBtn, () => DD.api(base + "/parking/guest-passes", { method: "POST", json: { plate: gp.value.trim(), date: gd.value }, headers: { "Idempotency-Key": key() } }));
        DD.toast(t("ออกบัตรจอดแขกแล้ว")); renderParking(); } catch (e) { errorTo(gErr)(e); }
    } }, el("div", { class: "grid-2" }, el("div", { class: "field mt-0" }, el("label", { for: "gPlate", text: "ทะเบียนรถแขก" }), gp),
      el("div", { class: "field mt-0" }, el("label", { for: "gDate", text: "วันที่" }), gd)), gBtn, gErr,
      el("p", { class: "xs muted mt-1", text: d.guest_pass_approval ? t("หอนี้ต้องให้เจ้าของหออนุมัติก่อน") : t("แสดงบัตรนี้ให้ รปภ. ดู ใช้ได้ 1 วัน") })));
    out.push(g);
    box.replaceChildren(...out);
  }

  // ================================================================ bills (+ slip, receipt)
  async function renderBills() {
    const d = await DD.api(base + "/bills");
    const box = $("v-bills");
    const out = [];
    const current = d.bills.filter((b) => b.raw_status !== "paid");
    const paid = d.bills.filter((b) => b.raw_status === "paid");
    if (!d.bills.length) out.push(card("receipt", t("บิล"), DD.empty("receipt", t("ยังไม่มีบิล"), t("เมื่อเจ้าของหอออกบิล บิลจะแสดงที่นี่"))));
    for (const b of current) out.push(billCard(b, d), payCard(b, d));
    paid.slice(0, 1).forEach((b) => out.push(receiptCard(b, d)));
    if (paid.length > 1) out.push(card("clock", t("บิลที่ชำระแล้ว"), ...paid.slice(1).map((b) => el("div", { class: "history-row" },
      el("span", { class: "spacer" }, el("strong", { text: periodName(b.period) }), el("div", { class: "row-meta", text: b.receipt_no ? t("เลขที่ {n}", { n: b.receipt_no }) : "" })),
      el("span", { class: "num", text: money(b.total) }), el("button", { class: "btn ghost sm", type: "button", onclick: () => printReceipt(b, d) }, DD.icon("printer"), "ใบเสร็จ")))));
    box.replaceChildren(...out);
  }
  function linesBox(b) {
    return el("div", {}, b.lines.map((l) => el("div", { class: "bill-line" },
      el("span", {}, el("span", { text: t(l.label) }), l.note ? el("span", { class: "muted small", translate: "no", text: " (" + unitNote(l.note) + ")" }) : null),
      el("span", { class: "num", text: money(l.amount) }))),
      el("div", { class: "bill-total" }, el("span", { text: t("รวม") }), el("span", { class: "num", text: baht(b.total) })));
  }
  function billCard(b, d) {
    return el("section", { class: "card mt-2" },
      el("div", { class: "card-title" }, DD.icon("receipt"), el("h2", { class: "mt-0", text: t("บิล {p}", { p: periodName(b.period) }) }), el("span", { class: "spacer" }), badge(BILL, b.status)),
      el("p", { class: "small muted" }, t("ครบกำหนด") + " ", el("strong", { text: dDate(b.due_date) })),
      b.edits && b.edits.length ? el("div", { class: "alert info" }, DD.icon("refresh"), el("span", {}, t("เจ้าของหอแก้ไขบิลนี้ · เหตุผล:") + " ", el("span", { translate: "no", text: b.edits[0].reason }))) : null,
      linesBox(b),
      b.status === "overdue" && d.late_fee.enabled ? el("p", { class: "xs muted mt-1", text: t("เกินกำหนด {g} วันขึ้นไป คิดค่าปรับจ่ายช้าวันละ {n} บาท (รวมในบิลถัดไป)", { g: d.late_fee.grace_d, n: money(d.late_fee.per_day) }) }) : null);
  }
  function payCard(b, d) {
    const c = card("wallet", t("ชำระเงิน"));
    if (b.raw_status === "slip_sent") {
      c.append(el("div", { class: "alert info" }, DD.icon("clock"), el("span", { text: t("ส่งสลิปแล้ว รอเจ้าของหอยืนยัน จะได้อีเมลแจ้งพร้อมใบเสร็จ") })));
      return c;
    }
    if (b.raw_status === "returned" && b.slip) c.append(el("div", { class: "alert warn" }, DD.icon("message"), el("span", {},
      el("strong", { text: t("สลิปถูกตีกลับ") }), el("br"), t("เจ้าของหอ:") + " ", el("span", { translate: "no", text: b.slip.message || "" }))));
    if (d.promptpay && b.total > 0) c.append(el("img", { class: "qr-img", src: `${base}/bills/${b.id}/promptpay.svg`, alt: t("QR พร้อมเพย์ ยอด {a}", { a: baht(b.total) }) }),
      el("p", { class: "small muted center mt-1" }, t("พร้อมเพย์:") + " ", el("span", { translate: "no", text: d.promptpay_hint }), " · ", baht(b.total)));
    else c.append(el("p", { class: "small muted", text: t("หอนี้ยังไม่ได้ตั้งเลขพร้อมเพย์ โอนตามบัญชีที่เจ้าของหอแจ้ง แล้วแนบสลิป") }));
    const inp = el("input", { class: "sr-only", id: "slip-" + b.id, type: "file", accept: "image/jpeg,image/png,image/webp" });
    const name = el("span", { class: "small muted", text: t("JPG, PNG, WEBP · ไม่เกิน 5 MB") });
    const err = el("div");
    const btn = el("button", { class: "btn block mt-2", type: "button" }, "ส่งสลิปให้เจ้าของหอ");
    inp.addEventListener("change", () => { if (inp.files[0]) name.textContent = inp.files[0].name; });
    btn.addEventListener("click", async () => {
      err.replaceChildren();
      const f = inp.files[0];
      if (!f) { err.replaceChildren(DD.errorBox({ message: t("กรุณาเลือกรูปสลิป") })); return; }
      if (f.size > 5 * 1024 * 1024) { err.replaceChildren(DD.errorBox({ message: t("รูปต้องไม่เกิน 5 MB") })); return; }
      const fd = new FormData(); fd.append("slip", f, f.name);
      try { await busy(btn, () => DD.api(`${base}/bills/${b.id}/slip`, { method: "POST", body: fd, headers: { "Idempotency-Key": key() } }));
        DD.toast(t("ส่งสลิปแล้ว")); await loadHome(); renderShell(); renderBills(); } catch (e) { errorTo(err)(e); }
    });
    c.append(el("div", { class: "field" }, el("span", { class: "field-label", text: "แนบสลิปการโอน" }),
      el("label", { class: "drop", for: "slip-" + b.id }, DD.icon("upload"), el("span", {}, el("strong", { text: t("แตะเพื่อเลือกรูปสลิป") }), el("br"), name)), inp), btn, err,
      thread(b.messages) || el("span"),
      composer(async (text) => { await DD.api(`${base}/bills/${b.id}/messages`, { method: "POST", json: { text }, headers: { "Idempotency-Key": key() } }); DD.toast(t("ส่งข้อความแล้ว")); renderBills(); }));
    return c;
  }
  function receiptBox(b, d) {
    return el("div", { class: "receipt" },
      el("div", { class: "row" }, el("strong", { text: d.dorm_name, translate: "no" }), el("span", { class: "spacer" }), el("span", { class: "xs muted", text: t("เลขที่ {n}", { n: b.receipt_no || "-" }) })),
      el("div", { class: "small muted", text: t("ใบเสร็จรับเงิน · ห้อง {r} · งวด {p} · ชำระ {d}", { r: d.room_no, p: periodName(b.period), d: b.paid_at ? dDate(b.paid_at) : "-" }) }),
      linesBox(b), el("p", { class: "xs muted mt-1", text: t("หลักฐานการชำระเงินในระบบ DormDesk ไม่ใช่ใบกำกับภาษี") }));
  }
  function receiptCard(b, d) {
    return el("section", { class: "card mt-2" },
      el("div", { class: "card-title" }, DD.icon("checkCircle"), el("h2", { class: "mt-0", text: t("ใบเสร็จ {p}", { p: periodName(b.period) }) }), el("span", { class: "spacer" }), badge(BILL, "paid")),
      receiptBox(b, d), el("button", { class: "btn ghost block mt-2", type: "button", onclick: () => printReceipt(b, d) }, DD.icon("printer"), "บันทึกใบเสร็จ (PDF)"));
  }
  function printReceipt(b, d) {   // only the receipt is printed (no tenant name on it — room number only, spec 6.3)
    const r = receiptBox(b, d); r.classList.add("printing");
    document.body.append(r); document.body.classList.add("print-one");
    const done = () => { r.remove(); document.body.classList.remove("print-one"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print(); setTimeout(done, 1500);
  }

  // ================================================================ fines
  async function renderFines(id) {
    const box = $("v-fines");
    if (!id) {
      const list = await DD.api(base + "/fines");
      if (list.length === 1) { location.replace("#fine/" + list[0].id); return; }
      box.replaceChildren(card("alert", t("ค่าปรับของห้องนี้"), ...(list.length ? list.map((f) => el("a", { class: "my-item", href: "#fine/" + f.id },
        badge(FINE, f.status), el("span", { class: "spacer", text: f.title, translate: "no" }), el("span", { class: "num", text: money(f.amount) }), DD.icon("chevron")))
        : [DD.empty("checkCircle", t("ไม่มีค่าปรับ"), null)])));
      return;
    }
    const f = await DD.api(`${base}/fines/${encodeURIComponent(id)}`);
    box.replaceChildren(
      el("a", { class: "btn ghost sm mt-2", href: H.features.bills ? "#bills" : "#repair" }, DD.icon("back"), "กลับ"),
      el("section", { class: "card mt-2 fine-card" },
        el("div", { class: "row" }, el("span", { class: "badge urgent" }, DD.icon("alert"), t("ค่าปรับ")), el("span", { class: "spacer" }), badge(FINE, f.status)),
        el("h1", { class: "mt-2", text: f.title, translate: "no" }),
        el("div", { class: "amount-lg num", text: baht(f.amount) }),
        f.original_amount !== f.amount ? el("p", { class: "small ok-text", text: t("ลดจาก {a}", { a: baht(f.original_amount) }) }) : null,
        el("p", { class: "small muted", text: t("ออกเมื่อ {d} · ห้อง {r} · หมวด {p}", { d: dDate(f.created_at), r: f.room_no, p: t({ late: "จ่ายช้า", damage: "ทำของเสียหาย", noise: "เสียงดังรบกวน", parking: "ผิดกฎที่จอด", other: "อื่น ๆ" }[f.preset]) }) }),
        el("div", { class: "field-label mt-2", text: t("เหตุผลจากเจ้าของหอ") }), el("p", { class: "reason-box", text: f.reason, translate: "no" }),
        f.photos.length ? el("div", {}, el("div", { class: "field-label mt-2", text: t("รูปหลักฐาน") }),
          el("div", { class: "photos" }, f.photos.map((pid, i) => { const src = `${base}/fines/${f.id}/photos/${pid}`;
            return el("a", { href: src, target: "_blank", rel: "noopener" }, el("img", { src, alt: t("รูปหลักฐาน {n}", { n: i + 1 }), loading: "lazy" })); }))) : null,
        f.status === "billed" ? el("div", { class: "alert info mt-2" }, DD.icon("receipt"), el("span", { text: t("รวมในบิล {p} แล้ว", { p: periodName(f.bill_period) }) }))
          : ["open", "disputed", "confirmed"].includes(f.status) ? el("div", { class: "alert info mt-2" }, DD.icon("receipt"), el("span", {
            text: f.billing === "separate" ? t("เรียกเก็บแยก ดูได้ในแท็บบิล") : f.status === "disputed" ? t("รอเจ้าของหอตรวจข้อโต้แย้ง") : t("ถ้าไม่โต้แย้ง ค่าปรับนี้จะรวมในบิลเดือนถัดไป") })) : null),
      card("phone", t("ติดต่อเจ้าของหอ"), contactLine(f.contact) || el("p", { class: "small muted", text: t("ติดต่อผ่านข้อความด้านล่าง") })),
      card("message", t("ข้อความ"), thread(f.messages) || el("p", { class: "small muted", text: t("ยังไม่มีข้อความ ตอบกลับหรือโต้แย้งได้ที่นี่") }),
        ["open", "disputed", "confirmed", "billed"].includes(f.status) ? composer(async (text) => {
          await DD.api(`${base}/fines/${f.id}/messages`, { method: "POST", json: { text }, headers: { "Idempotency-Key": key() } });
          DD.toast(t("ส่งข้อความแล้ว")); renderFines(f.id);
        }) : null));
  }

  // ---------------------------------------------------------------- boot (after tenant.js loaded the room)
  async function start() {
    try { await loadHome(); renderShell(); } catch (e) { return; }   // tenant.js already shows the error page
    route();
  }
  document.addEventListener("dd:room", start, { once: true });
})();
