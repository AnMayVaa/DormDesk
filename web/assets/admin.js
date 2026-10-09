(function () {
  const t = (k, v) => DD_I18N.t(k, v);
  const $ = (id) => document.getElementById(id);
  const el = DD.el;
  const S = { dorms: [], dormId: null, tab: "dash", reqs: [], filter: "open", urgentOnly: false, q: "" };
  // the open tab lives in the address (#settings), so a reload or the TH/EN switch (which reloads) keeps you where you were
  const TABS = ["dash", "reqs", "ai", "rooms", "cats", "billing", "parking", "spaces", "settings"];
  const fromHash = location.hash.replace(/^#/, "");
  if (TABS.includes(fromHash)) S.tab = fromHash;
  const OPEN = ["received", "in_progress"];

  // ================================================================ boot & auth
  async function boot() {
    let me;
    try { me = await DD.api("/api/auth/me"); } catch (e) { return showLogin(); }
    $("whoName").textContent = me.display_name;
    S.dorms = await DD.api("/api/admin/dorms");
    const last = DD.store.get("dd-admin-dorm", null);
    S.dormId = (S.dorms.find((d) => d.id === last) || S.dorms[0] || {}).id ?? null;
    $("dormSel").replaceChildren(...S.dorms.map((d) => el("option", { value: d.id, text: d.name, translate: "no" })));
    $("dormSel").value = S.dormId;
    $("dormSel").classList.toggle("hidden", S.dorms.length < 2);
    ["who", "logout"].forEach((i) => $(i).classList.remove("hidden"));
    $("boot").classList.add("hidden"); $("loginView").classList.add("hidden"); $("appView").classList.remove("hidden");
    $("appView").classList.add("reveal");
    if (S.dormId === null) { $("panel").replaceChildren(DD.empty("building", "ยังไม่มีหอในบัญชีนี้", "ติดต่อผู้ดูแลระบบเพื่อเพิ่มหอ")); return; }
    render();
  }
  function showLogin() {
    ["who", "logout", "dormSel"].forEach((i) => $(i).classList.add("hidden"));
    $("boot").classList.add("hidden"); $("appView").classList.add("hidden"); $("loginView").classList.remove("hidden");
    setTimeout(() => $("email").focus(), 50);
  }
  function fail(e) { if (e && e.status === 401) { DD.toast("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่", "err"); return showLogin(); } DD.toast((e && e.message) || "เกิดข้อผิดพลาด", "err"); }

  $("loginForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("loginBtn");
    $("loginErr").replaceChildren();
    if (!$("email").value.trim() || !$("password").value) { $("loginErr").replaceChildren(DD.errorBox({ message: "กรอกอีเมลและรหัสผ่าน" })); return; }
    btn.disabled = true; btn.replaceChildren(el("span", { class: "bar-loader" }), "กำลังเข้าสู่ระบบ…");
    try {
      await DD.api("/api/auth/login", { method: "POST", json: { email: $("email").value.trim(), password: $("password").value } });
      $("password").value = "";
      await boot();
    } catch (e) { $("loginErr").replaceChildren(DD.errorBox(e)); $("password").select(); }
    finally { btn.disabled = false; btn.textContent = "เข้าสู่ระบบ"; }
  });
  $("showPw").addEventListener("click", () => {
    const show = $("password").type === "password";
    $("password").type = show ? "text" : "password";
    $("showPw").setAttribute("aria-pressed", String(show));
  });
  $("logout").addEventListener("click", async () => {
    try { await DD.api("/api/auth/logout", { method: "POST" }); } catch (e) { /* ignore */ }
    DD.toast("ออกจากระบบแล้ว"); showLogin();
  });
  $("dormSel").addEventListener("change", () => { S.dormId = Number($("dormSel").value); DD.store.set("dd-admin-dorm", S.dormId); render(); });
  $("tabs").addEventListener("click", (ev) => { const b = ev.target.closest("[data-tab]"); if (b) { S.tab = b.dataset.tab; render(); } });
  $("tabs").addEventListener("keydown", (ev) => {           // arrow-key navigation between tabs
    if (!["ArrowRight", "ArrowLeft"].includes(ev.key)) return;
    const tabs = [...$("tabs").querySelectorAll("[data-tab]")];
    const i = tabs.indexOf(document.activeElement);
    const n = tabs[(i + (ev.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    n.focus(); n.click();
  });
  $("reload").addEventListener("click", () => render(true));

  // tabs scroll sideways on phones / iPad portrait: keep the chosen tab visible and show a fade where more tabs are hidden
  function showActiveTab() {
    const bar = $("tabs"), cur = bar.querySelector('[aria-selected="true"]');
    if (cur && bar.scrollWidth > bar.clientWidth) {
      const l = cur.offsetLeft - bar.offsetLeft, r = l + cur.offsetWidth;
      if (l < bar.scrollLeft || r > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: Math.max(0, l - 24), behavior: "smooth" });
    }
    tabFade();
  }
  function tabFade() {
    const bar = $("tabs"), more = bar.scrollWidth - bar.clientWidth;
    bar.classList.toggle("more-right", more > 2 && bar.scrollLeft < more - 2);
    bar.classList.toggle("more-left", more > 2 && bar.scrollLeft > 2);
  }
  $("tabs").addEventListener("scroll", tabFade, { passive: true });
  window.addEventListener("resize", tabFade);

  // ================================================================ render
  async function render(toastAfter) {
    const dorm = S.dorms.find((d) => d.id === S.dormId);
    $("dormTitle").textContent = dorm ? dorm.name : "";
    $("dormTitle").setAttribute("translate", "no");
    $("tabs").querySelectorAll("[data-tab]").forEach((b) => { b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)); b.tabIndex = b.dataset.tab === S.tab ? 0 : -1; });
    if (location.hash !== "#" + S.tab) window.history.replaceState(null, "", S.tab === "dash" ? location.pathname : "#" + S.tab);
    showActiveTab();
    const X = window.DD_ADMIN_EXT;
    const ctx = { dormId: S.dormId, dorm, fail, rerender: () => render() };
    try {
      X.syncTabs(ctx).then((tab) => { if (tab && tab !== S.tab) { S.tab = tab; render(); } else showActiveTab(); }).catch(() => {});
      const ext = { billing: X.billing, parking: X.parking, spaces: X.spaces, settings: X.settings }[S.tab];
      await (ext ? ext($("panel"), ctx) : ({ dash: renderDash, reqs: renderReqs, rooms: renderRooms, cats: renderCats, ai: renderAI })[S.tab]());
      $("updated").textContent = t("อัปเดต {t}", { t: new Date().toLocaleTimeString(DD_I18N.locale, { hour: "2-digit", minute: "2-digit" }) });
      if (toastAfter === true) DD.toast("อัปเดตข้อมูลแล้ว");
    } catch (e) { fail(e); }
  }
  function skeleton(kind) {
    if (kind === "dash") return el("div", {}, el("div", { class: "kpis" }, [1, 2, 3, 4].map(() => el("div", { class: "skel kpi" }))),
      el("div", { class: "dash-grid" }, el("div", { class: "card" }, DD.skeletonLines(6)), el("div", { class: "card" }, DD.skeletonLines(6))));
    return el("div", { class: "card" }, DD.skeletonLines(8));
  }

  // ---------------------------------------------------------------- dashboard
  function bars(rows, key, val, suffix, warmAbove) {
    if (!rows.length) return DD.empty("chart", "ยังไม่มีข้อมูลช่วงนี้", null);
    const max = Math.max(...rows.map((r) => Number(r[val]) || 0), 1);
    return el("div", { class: "bars" }, rows.map((r) => el("div", { class: "bar" },
      el("span", { text: r[key] }),
      el("span", { class: "track" }, el("span", { class: "fill" + (warmAbove && Number(r[val]) > warmAbove ? " warm" : ""), style: `width:${(Number(r[val]) / max) * 100}%` })),
      el("span", { class: "val", text: r[val] + (suffix || "") }))));
  }
  async function renderDash() {
    $("panel").replaceChildren(skeleton("dash"));
    const d = await DD.api(`/api/admin/dorms/${S.dormId}/dashboard`);
    setOpenCount(d.open);
    const kpi = (icon, tone, v, l) => el("div", { class: "card kpi" }, el("div", { class: "kpi-icon " + tone }, DD.icon(icon)),
      el("div", { class: "v", text: v }), el("div", { class: "l", text: l }));
    const avg = d.avg_resolve_hours_30d;
    $("panel").replaceChildren(
      el("div", { class: "kpis" }, DD.reveal([
        kpi("inbox", "sky", d.open, "เรื่องที่ยังไม่เสร็จ"),
        kpi("alert", "pink", d.overdue_48h.length, "ค้างเกิน 48 ชม."),
        kpi("clock", "amber", avg == null ? "–" : t("{h} ชม.", { h: avg }), "เวลาซ่อมเฉลี่ย (30 วัน)"),
        kpi("checkCircle", "green", d.by_status.done || 0, "ซ่อมเสร็จทั้งหมด")])),
      el("div", { class: "dash-grid" },
        el("section", { class: "card reveal", "data-i": 4 }, el("div", { class: "card-title" }, DD.icon("alert"), el("h2", { class: "mt-0", text: "ค้างเกิน 48 ชั่วโมง" })),
          d.overdue_48h.length ? el("div", { class: "list" }, d.overdue_48h.map(reqRow))
            : DD.empty("checkCircle", "ไม่มีเรื่องค้างเกินกำหนด", "ทุกเรื่องได้รับการดูแลภายใน 48 ชั่วโมง")),
        el("section", { class: "card reveal", "data-i": 5 }, el("div", { class: "card-title" }, DD.icon("chart"), el("h2", { class: "mt-0", text: "หมวดที่แจ้งบ่อย (30 วัน)" })),
          bars(d.by_category_30d, "category", "n"))),
      el("div", { class: "dash-grid b" },
        el("section", { class: "card reveal", "data-i": 6 }, el("div", { class: "card-title" }, DD.icon("repeat"), el("h2", { class: "mt-0", text: "ห้องที่แจ้งซ้ำหมวดเดิม (90 วัน)" })),
          d.repeat_rooms_90d.length ? el("div", { class: "list" }, d.repeat_rooms_90d.map((r) => el("div", { class: "cat-row" },
            el("span", { class: "room-no", text: r.room_no, translate: "no" }), el("span", { class: "spacer", text: r.category }),
            el("span", { class: "badge urgent", text: t("{n} ครั้ง", { n: r.n }) }))))
            : DD.empty("checkCircle", "ยังไม่มีห้องที่เสียซ้ำ", null)),
        el("section", { class: "card reveal", "data-i": 7 }, el("div", { class: "card-title" }, DD.icon("clock"), el("h2", { class: "mt-0", text: "เวลาซ่อมเฉลี่ยตามหมวด (ชม., 90 วัน)" })),
          bars(d.resolve_hours_by_category_90d, "category", "hours", "", avg || 48))));
    $("panel").querySelectorAll("[data-i]").forEach((n) => n.style.setProperty("--i", n.dataset.i));
    window.DD_ADMIN_EXT.dashExtras($("panel"), { dormId: S.dormId, fail }).catch(fail);   // v2 section, kept apart from repair data
  }
  function setOpenCount(n) { $("openCount").textContent = n; $("openCount").classList.toggle("hidden", !n); }

  // ---------------------------------------------------------------- requests
  function reqRow(r) {
    return el("button", { class: "list-row", type: "button", onclick: () => openRequest(r.id), "aria-label": t("ห้อง {room} {title}", { room: r.room_no, title: r.title }) },
      el("span", { class: "room-no", text: r.room_no, translate: "no" }),
      el("span", {}, el("div", { class: "row-title", text: r.title, translate: "no" }),
        el("div", { class: "row-meta" }, r.category ? el("span", { text: r.category }) : null, el("span", { text: DD.ago(r.created_at) }),
          r.prev_tenant ? el("span", { class: "badge rejected", text: "ผู้เช่าก่อนหน้า" }) : null,
          r.photo_count ? el("span", { class: "row" }, DD.icon("camera"), r.photo_count) : null)),
      el("span", { class: "row row-end" }, r.priority === "urgent" ? DD.urgent() : null, DD.badge(r.status)));
  }
  async function renderReqs() {
    $("panel").replaceChildren(skeleton());
    S.reqs = await DD.api(`/api/admin/dorms/${S.dormId}/requests`);
    setOpenCount(S.reqs.filter((r) => OPEN.includes(r.status)).length);
    const counts = { open: 0, all: S.reqs.length };
    for (const r of S.reqs) { counts[r.status] = (counts[r.status] || 0) + 1; if (OPEN.includes(r.status)) counts.open++; }
    const segs = [["open", "ยังไม่เสร็จ"], ["received", "รับเรื่องแล้ว"], ["in_progress", "กำลังดำเนินการ"], ["done", "เสร็จสิ้น"], ["rejected", "ปฏิเสธ"], ["all", "ทั้งหมด"]];
    const search = el("input", { class: "input", type: "search", placeholder: "ค้นหาเลขห้องหรือหัวข้อ", value: S.q, "aria-label": "ค้นหา" });
    const list = el("div", { class: "list", id: "reqList" });
    const draw = () => {
      const q = S.q.trim().toLowerCase();
      const rows = S.reqs.filter((r) => (S.filter === "all" || (S.filter === "open" ? OPEN.includes(r.status) : r.status === S.filter))
        && (!S.urgentOnly || r.priority === "urgent") && (!q || r.room_no.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)));
      list.replaceChildren(...(rows.length ? DD.reveal(rows.map(reqRow))
        : [DD.empty(q ? "search" : "inbox", q ? "ไม่พบคำขอที่ตรงกับคำค้น" : "ไม่มีคำขอในกลุ่มนี้",
          q ? "ลองค้นด้วยเลขห้องหรือคำอื่น" : "เมื่อผู้เช่าแจ้งเรื่อง รายการจะแสดงที่นี่",
          q ? el("button", { class: "btn ghost sm", type: "button", onclick: () => { S.q = ""; search.value = ""; draw(); } }, "ล้างคำค้น") : null)]));
    };
    search.addEventListener("input", () => { S.q = search.value; draw(); });
    const seg = el("div", { class: "seg", role: "group", "aria-label": "กรองตามสถานะ" }, segs.map(([k, l]) =>
      el("button", { type: "button", "aria-pressed": String(S.filter === k), onclick: (ev) => {
        S.filter = k; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false"));
        ev.currentTarget.setAttribute("aria-pressed", "true"); draw(); } }, t("{label} {n}", { label: t(l), n: counts[k] || 0 }))));
    const urgent = el("label", { class: "check" }, el("input", { type: "checkbox", checked: S.urgentOnly, onchange: (e) => { S.urgentOnly = e.target.checked; draw(); } }), "เฉพาะเรื่องด่วน");
    $("panel").replaceChildren(el("section", { class: "card" },
      el("div", { class: "toolbar" }, el("div", { class: "input-icon" }, DD.icon("search"), search), urgent), seg, el("div", { class: "mt-2" }, list)));
    draw();
  }

  // ---------------------------------------------------------------- request drawer
  async function openRequest(id) {
    const prev = document.activeElement;
    const ov = el("div", { class: "overlay" });
    const dr = el("aside", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "รายละเอียดคำขอ" },
      el("div", { class: "drawer-body" }, DD.skeletonLines(3), el("div", { class: "skel block" }), DD.skeletonLines(5)));
    const close = () => { ov.remove(); dr.remove(); document.removeEventListener("keydown", onKey); prev && prev.focus && prev.focus(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    ov.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.append(ov, dr);
    let r;
    try { r = await DD.api(`/api/admin/requests/${id}`); } catch (e) { close(); return fail(e); }

    const note = el("textarea", { class: "textarea", id: "note", maxlength: 500, placeholder: "เช่น ช่างจะเข้าห้องวันนี้ 17:00 น. (ผู้เช่าเห็นข้อความนี้ในหน้าติดตาม)" });
    const update = async (body, okMsg) => {
      dr.querySelectorAll(".status-actions .btn, #prio").forEach((b) => { b.disabled = true; });
      try {
        await DD.api(`/api/admin/requests/${id}`, { method: "PATCH", json: { ...body, note: note.value.trim() || null } });
        DD.toast(okMsg); close(); render();
      } catch (e) {
        if (e.unsure) { DD.toast(t("การเชื่อมต่อขัดข้อง ระบบอาจบันทึกแล้ว กำลังโหลดสถานะล่าสุด"), "err"); close(); render(); openRequest(id); return; }
        fail(e); dr.querySelectorAll(".status-actions .btn, #prio").forEach((b) => { b.disabled = false; });
      }
    };
    const closeBtn = el("button", { class: "icon-btn", type: "button", "aria-label": "ปิด", onclick: close }, DD.icon("x"));
    const initials = (r.reporter_name || "?").trim().slice(0, 1);
    dr.replaceChildren(
      el("div", { class: "drawer-head" },
        el("div", { class: "spacer" }, el("div", { class: "small muted row" }, DD.icon("door"), el("span", { translate: "no", text: t("ห้อง {room} · {cat}", { room: r.room_no, cat: t(r.category) }) })),
          el("h2", { class: "mt-1", text: r.title, translate: "no" }),
          el("div", { class: "row wrap" }, DD.badge(r.status), r.priority === "urgent" ? DD.urgent() : null,
            el("span", { class: "xs muted", text: t("แจ้ง {d} · {ago}", { d: DD.fmt(r.created_at), ago: DD.ago(r.created_at) }) }))),
        closeBtn),
      el("div", { class: "drawer-body stack" },
        r.detail ? el("p", { text: r.detail, translate: "no" }) : null,
        r.photos.length ? el("div", { class: "photos" }, r.photos.map((pid, i) => {
          const src = `/api/admin/requests/${id}/photos/${pid}`;
          return el("a", { href: src, "data-viewer": t("รูปที่แนบ {n}", { n: i + 1 }), "aria-label": t("เปิดรูปที่ {n}", { n: i + 1 }) }, el("img", { src, alt: t("รูปที่แนบ {n}", { n: i + 1 }), loading: "lazy" }));
        })) : null,
        el("div", { class: "card" }, el("div", { class: "contact" }, el("div", { class: "avatar", text: initials }),
          el("div", { class: "spacer" }, el("div", { class: "row-title", text: r.reporter_name, translate: "no" }),
            el("div", { class: "xs muted", text: r.reporter_email || "ไม่ได้ให้อีเมล" })),
          el("a", { class: "btn sm", href: "tel:" + r.reporter_phone.replace(/[^0-9+]/g, "") }, DD.icon("phone"), r.reporter_phone))),
        el("div", {}, el("div", { class: "field-label" }, "เปลี่ยนสถานะ"),
          el("div", { class: "field mt-0" }, el("label", { for: "note", class: "small muted" }, "ข้อความถึงผู้เช่า (ไม่บังคับ)"), note),
          el("div", { class: "status-actions mt-1" }, Object.keys(DD.STATUS).map((s) => el("button", {
            type: "button", class: "btn ghost", "aria-current": s === r.status ? "true" : null, disabled: s === r.status,
            onclick: () => update({ status: s }, t("เปลี่ยนเป็น \"{s}\" แล้ว", { s: t(DD.STATUS[s]) })) }, DD.icon(DD.STATUS_ICON[s]), DD.STATUS[s]))),
          el("div", { class: "cat-row mt-1" }, DD.icon("flame"), el("span", { class: "spacer", text: "เรื่องด่วน" }),
            el("label", { class: "switch" }, el("input", { type: "checkbox", id: "prio", checked: r.priority === "urgent", "aria-label": "ตั้งเป็นเรื่องด่วน",
              onchange: (e) => update({ priority: e.target.checked ? "urgent" : "normal" }, e.target.checked ? "ตั้งเป็นเรื่องด่วนแล้ว" : "ตั้งเป็นเรื่องปกติแล้ว") }), el("span")))),
        el("div", {}, el("h3", { text: "ประวัติ" }),
          el("ul", { class: "timeline mt-1" }, r.events.slice().reverse().map((e) => el("li", {},
            el("div", { class: "t-title", text: DD.STATUS[e.to_status] || e.to_status }),
            el("div", { class: "xs muted", text: t(e.actor === "tenant" ? "{d} · ผู้เช่า" : "{d} · เจ้าของหอ", { d: DD.fmt(e.created_at) }) }),
            e.note ? el("div", { class: "t-note", text: e.note, translate: "no" }) : null))))));
    closeBtn.focus();
  }

  // ---------------------------------------------------------------- rooms
  async function renderRooms() {
    $("panel").replaceChildren(skeleton());
    const rooms = await DD.api(`/api/admin/dorms/${S.dormId}/rooms`);
    const input = el("input", { class: "input", id: "newRoom", placeholder: "เลขห้อง เช่น 405", maxlength: 20, required: true, "aria-label": "เลขห้องใหม่" });
    const form = el("form", { class: "toolbar", onsubmit: async (ev) => {
      ev.preventDefault();
      if (!input.value.trim()) { input.focus(); return; }
      try { const r = await DD.api(`/api/admin/dorms/${S.dormId}/rooms`, { method: "POST", json: { room_no: input.value.trim() } });
        DD.toast(t("เพิ่มห้อง {room} แล้ว", { room: r.room_no })); renderRooms(); } catch (e) { fail(e); }
    } }, el("div", { class: "input-icon" }, DD.icon("door"), input), el("button", { class: "btn", type: "submit" }, DD.icon("plus"), "เพิ่มห้อง"));
    const filter = el("input", { class: "input", type: "search", placeholder: "ค้นหาห้อง", "aria-label": "ค้นหาห้อง" });
    const grid = el("div", { class: "room-grid mt-2" });
    const draw = () => {
      const q = filter.value.trim();
      const list = rooms.filter((r) => !q || r.room_no.includes(q));
      grid.replaceChildren(...(list.length ? list.map((r) => {
        const link = location.origin + "/r/" + r.room_code;
        return el("div", { class: "room-card" },
          el("div", { class: "row" }, el("span", { class: "room-no", text: t("ห้อง {room}", { room: r.room_no }), translate: "no" }), el("span", { class: "spacer" }),
            r.open ? el("span", { class: "badge in_progress", text: t("{n} เรื่องค้าง", { n: r.open }) }) : el("span", { class: "badge done", text: "ไม่มีเรื่องค้าง" })),
          el("div", { class: "code", text: link }),
          el("div", { class: "row" },
            el("button", { class: "btn sm", type: "button", onclick: () => navigator.clipboard.writeText(link).then(() => DD.toast(t("คัดลอกลิงก์ห้อง {room} แล้ว", { room: r.room_no })), () => DD.toast("คัดลอกไม่ได้", "err")) }, DD.icon("copy"), "คัดลอกลิงก์"),
            el("span", { class: "spacer" }),
            el("a", { class: "icon-btn", href: link, target: "_blank", rel: "noopener", title: "เปิดหน้าแจ้งซ่อมของห้องนี้", "aria-label": t("เปิดหน้าแจ้งซ่อมห้อง {room}", { room: r.room_no }) }, DD.icon("eye")),
            el("button", { class: "icon-btn", type: "button", title: "เปลี่ยนผู้เช่า (เริ่มข้อมูลใหม่ทั้งหมด)", "aria-label": t("เปลี่ยนผู้เช่าห้อง {room}", { room: r.room_no }),
              onclick: () => window.DD_ADMIN_EXT.changeTenant(r, { dormId: S.dormId, fail, rerender: renderRooms }) }, DD.icon("users")),
            el("button", { class: "icon-btn", type: "button", title: "เปลี่ยนลิงก์ (ลิงก์เก่าใช้ไม่ได้ทันที)", "aria-label": t("เปลี่ยนลิงก์ห้อง {room}", { room: r.room_no }), onclick: async () => {
              const ok = await DD.confirm({ title: t("เปลี่ยนลิงก์ห้อง {room}?", { room: r.room_no }), text: "ลิงก์เก่าจะใช้ไม่ได้ทันที ใช้เมื่อลิงก์หลุด (ผู้เช่าคนเดิม ข้อมูลเดิมอยู่ครบ) ถ้ามีผู้เช่าใหม่ ให้ใช้ปุ่ม \"เปลี่ยนผู้เช่า\"", ok: "เปลี่ยนลิงก์", danger: true });
              if (!ok) return;
              try { await DD.api(`/api/admin/rooms/${r.id}/rotate-code`, { method: "POST" }); DD.toast(t("ออกลิงก์ใหม่ให้ห้อง {room} แล้ว", { room: r.room_no })); renderRooms(); } catch (e) { fail(e); }
            } }, DD.icon("keyRotate"))));
      }) : [DD.empty("door", q ? "ไม่พบห้องนี้" : "ยังไม่มีห้อง", q ? null : "เพิ่มห้องด้านบน แล้วส่งลิงก์ให้ผู้เช่าทาง LINE")]));
    };
    filter.addEventListener("input", draw);
    $("panel").replaceChildren(el("section", { class: "card" },
      el("div", { class: "card-title" }, DD.icon("link"), el("h2", { class: "mt-0", text: t("ห้องทั้งหมด {n} ห้อง", { n: rooms.length }) })),
      el("p", { class: "small muted", text: "ส่งลิงก์ประจำห้องให้ผู้เช่าตอนย้ายเข้า ผู้เช่าเปิดลิงก์แล้วแจ้งซ่อมได้ทันทีโดยไม่ต้องสมัคร" }),
      form, el("div", { class: "input-icon" }, DD.icon("search"), filter), grid));
    draw();
  }

  // ---------------------------------------------------------------- AI Insight
  const CHAT = {};   // per dorm, in memory only
  async function renderAI() {
    const lang = DD_I18N.lang;
    const st = await DD.api(`/api/admin/ai/status?lang=${lang}`).catch(() => ({ llm: "down", suggestions: [] }));
    const log = el("div", { class: "chat", "aria-live": "polite" });
    const input = el("input", { class: "input", maxlength: 300, placeholder: "พิมพ์คำถาม เช่น ตอนนี้ค้างกี่เรื่อง", "aria-label": "คำถาม" });
    const send = el("button", { class: "btn", type: "submit" }, DD.icon("send"), "ถาม");
    const history = (CHAT[S.dormId] = CHAT[S.dormId] || []);
    const bubbleQ = (q) => el("div", { class: "bubble q", translate: "no", text: q });
    const bubbleA = (r) => el("div", { class: "bubble a" },
      el("div", { class: "row small muted" }, DD.icon(r.source === "ai" ? "sparkles" : "chart"),
        el("span", { text: r.source === "ai" ? "ตอบโดย AI ในระบบ (ai-01)" : "สรุปอัตโนมัติจากตัวเลข" })),
      el("div", { class: "answer mt-1", translate: "no", text: r.answer }),
      el("details", {}, el("summary", {}, "ตัวเลขที่ใช้ตอบ (คำนวณจากฐานข้อมูล ไม่ใช่ AI เดา)"),
        el("pre", { translate: "no", text: JSON.stringify(r.facts, null, 2) })));
    const redraw = () => log.replaceChildren(...history.flatMap((h) => [bubbleQ(h.q), h.r ? bubbleA(h.r) : el("div", { class: "thinking" },
      el("span", { class: "skel" }), el("span", { text: st.llm === "up" ? "กำลังคิด… โมเดลในเครื่อง ai-01 อาจใช้ 10–30 วินาที" : "กำลังสรุป…" }))]));
    const ask = async (q) => {
      q = (q || "").trim();
      if (q.length < 2) { input.focus(); return; }
      input.value = ""; send.disabled = true;
      const item = { q, r: null }; history.push(item); redraw();
      try { item.r = await DD.api(`/api/admin/dorms/${S.dormId}/ask`, { method: "POST", json: { question: q, lang } }); }
      catch (e) { history.pop(); fail(e); }
      finally { send.disabled = false; redraw(); input.focus(); }
    };
    const form = el("form", { class: "ai-form", onsubmit: (ev) => { ev.preventDefault(); ask(input.value); } }, input, send);
    $("panel").replaceChildren(el("section", { class: "card" },
      el("div", { class: "ai-head" }, el("div", { class: "ai-orb" }, DD.icon("sparkles")),
        el("div", { class: "spacer" }, el("h2", { class: "mt-0", text: "ถาม AI เกี่ยวกับหอของคุณ" }),
          el("p", { class: "small muted", text: "ระบบคำนวณตัวเลขจากฐานข้อมูลของหอนี้ก่อน แล้วให้ AI เรียบเรียงเป็นคำตอบ AI เห็นเฉพาะตัวเลขสรุป ไม่เห็นชื่อ เบอร์ หรือข้อความของผู้เช่า" }),
          el("span", { class: "badge " + (st.llm === "up" ? "done" : "rejected") }, DD.icon("cpu"),
            st.llm === "up" ? "โมเดล AI ออนไลน์ · Qwen3 0.6B บน ai-01" : "โมเดล AI ออฟไลน์ · ใช้สรุปอัตโนมัติแทน"))),
      el("div", { class: "chips mt-2" }, st.suggestions.map((q) => el("button", { type: "button", class: "chip", translate: "no", onclick: () => ask(q) }, q))),
      form, log));
    redraw();
    if (!history.length) input.focus();
  }

  // ---------------------------------------------------------------- categories
  async function renderCats() {
    $("panel").replaceChildren(skeleton());
    const cats = await DD.api(`/api/admin/dorms/${S.dormId}/categories`);
    $("panel").replaceChildren(el("section", { class: "card" },
      el("div", { class: "card-title" }, DD.icon("tag"), el("h2", { class: "mt-0", text: "หมวดที่ผู้เช่าเลือกได้" })),
      el("p", { class: "small muted", text: "ปิดหมวดที่หอไม่มี เช่น หอที่ไม่มีลานจอดรถ ผู้เช่าจะไม่เห็นหมวดนั้นในฟอร์ม" }),
      el("div", {}, DD.reveal(cats.map((c) => el("div", { class: "cat-row" }, DD.icon(DD_CAT_ICON[c.id] || "dots"),
        el("label", { class: "spacer", for: "cat-" + c.id, text: c.name_th }),
        el("label", { class: "switch" }, el("input", { type: "checkbox", id: "cat-" + c.id, checked: c.enabled, onchange: async (ev) => {
          const on = ev.target.checked;
          try { await DD.api(`/api/admin/dorms/${S.dormId}/categories`, { method: "PATCH", json: { category_id: c.id, enabled: on } });
            DD.toast(t(on ? "เปิดหมวด {c} แล้ว" : "ปิดหมวด {c} แล้ว", { c: t(c.name_th) })); }
          catch (e) { ev.target.checked = !on; fail(e); }
        } }), el("span"))))))));
  }

  boot().catch(fail);
})();
