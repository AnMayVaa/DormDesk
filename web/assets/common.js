const t = (k, v) => DD_I18N.t(k, v);
// Shared helpers. User data is always inserted with textContent (never innerHTML) to prevent XSS.
const DD = {
  STATUS: { received: "รับเรื่องแล้ว", in_progress: "กำลังดำเนินการ", done: "เสร็จสิ้น", rejected: "ปฏิเสธ / แจ้งซ้ำ" },
  STATUS_ICON: { received: "inbox", in_progress: "wrench", done: "checkCircle", rejected: "xCircle" },
  PRIORITY: { normal: "ปกติ", urgent: "ด่วน" },

  async api(path, opts = {}) {
    const init = { credentials: "same-origin", method: opts.method || "GET", headers: { ...(opts.headers || {}) } };
    if (opts.json !== undefined) { init.body = JSON.stringify(opts.json); init.headers["Content-Type"] = "application/json"; }
    else if (opts.body !== undefined) init.body = opts.body;
    let res;
    try { res = await fetch(path, init); }
    catch (e) { throw { code: "network", message: "เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่" }; }
    const body = (res.headers.get("content-type") || "").includes("json") ? await res.json() : null;
    if (!res.ok) {
      const e = (body && body.error) || { code: String(res.status),
        message: res.status === 429 ? "ส่งคำขอถี่เกินไป กรุณารอสักครู่" : t("เกิดข้อผิดพลาด ({n}) กรุณาลองใหม่", { n: res.status }) };
      e.message = DD_I18N.tMessage(e.message);
      e.status = res.status;
      throw e;
    }
    return body;
  },

  el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "style") n.style.cssText = v;            // CSSOM — allowed by the CSP
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat(3)) if (c !== null && c !== undefined && c !== false)
      n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  },
  icon: (name, cls) => ddIcon(name, cls),

  badge(status) { return DD.el("span", { class: "badge " + status }, DD.icon(DD.STATUS_ICON[status] || "dots"), DD.STATUS[status] || status); },
  urgent() { return DD.el("span", { class: "badge urgent" }, DD.icon("flame"), "ด่วน"); },

  fmt(ts, withYear) {
    if (!ts) return "-";
    return new Date(ts).toLocaleString(DD_I18N.locale, { day: "numeric", month: "short", year: withYear ? "2-digit" : undefined, hour: "2-digit", minute: "2-digit" });
  },
  ago(ts) {
    const m = (Date.now() - new Date(ts).getTime()) / 6e4;
    if (m < 1) return t("เมื่อสักครู่");
    if (m < 60) return t("{n} นาทีที่แล้ว", { n: Math.round(m) });
    if (m < 48 * 60) return t("{n} ชม.ที่แล้ว", { n: Math.round(m / 60) });
    return t("{n} วันที่แล้ว", { n: Math.round(m / 1440) });
  },
  lastPathPart() { return decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || ""); },

  // ---- per-device storage (may be blocked: always try/catch)
  store: {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  },

  // ---- feedback
  toast(msg, kind) {
    let box = document.querySelector(".toasts");
    if (!box) { box = DD.el("div", { class: "toasts", role: "status", "aria-live": "polite" }); document.body.append(box); }
    const t = DD.el("div", { class: "toast" + (kind === "err" ? " err" : "") }, DD.icon(kind === "err" ? "alert" : "checkCircle"), msg);
    box.append(t);
    setTimeout(() => { t.classList.add("leave"); setTimeout(() => t.remove(), 220); }, 3200);
  },
  confirm({ title, text, ok = "ยืนยัน", danger = false }) {
    return new Promise((resolve) => {
      const prev = document.activeElement;
      const close = (v) => { ov.remove(); m.remove(); document.removeEventListener("keydown", onKey); prev && prev.focus && prev.focus(); resolve(v); };
      const onKey = (e) => { if (e.key === "Escape") close(false); };
      const ov = DD.el("div", { class: "overlay", onclick: () => close(false) });
      const okBtn = DD.el("button", { class: "btn" + (danger ? " danger" : ""), type: "button", onclick: () => close(true) }, ok);
      const m = DD.el("div", { class: "modal", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "mdl-t" },
        DD.el("h2", { id: "mdl-t", text: title }), DD.el("p", { class: "muted", text: text }),
        DD.el("div", { class: "row", style: "justify-content:flex-end;margin-top:1rem" },
          DD.el("button", { class: "btn ghost", type: "button", onclick: () => close(false) }, "ยกเลิก"), okBtn));
      document.body.append(ov, m);
      document.addEventListener("keydown", onKey);
      okBtn.focus();
    });
  },
  errorBox(e) { return DD.el("div", { class: "alert err", role: "alert" }, DD.icon("alert"), DD.el("span", { text: e.message || "เกิดข้อผิดพลาด" })); },
  empty(icon, title, text, action) {
    return DD.el("div", { class: "empty" }, DD.el("div", { class: "empty-icon" }, DD.icon(icon)),
      DD.el("h3", { text: title }), text ? DD.el("p", { class: "small", style: "margin:0 auto", text }) : null,
      action ? DD.el("div", { style: "margin-top:1rem" }, action) : null);
  },
  skeletonLines(n) { return Array.from({ length: n }, (_, i) => DD.el("div", { class: "skel line", style: `width:${92 - (i % 3) * 18}%` })); },
  reveal(nodes) { let i = 0; for (const n of nodes) { if (i < 12) { n.classList.add("reveal"); n.style.setProperty("--i", i); } i++; } return nodes; },

  // ---- theme toggle: any [data-theme-toggle] button
  initTheme() {
    const apply = (t) => {
      document.documentElement.setAttribute("data-theme", t);
      document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
        b.replaceChildren(DD.icon(t === "dark" ? "sun" : "moon"));
        b.setAttribute("aria-label", t === "dark" ? "เปลี่ยนเป็นธีมสว่าง" : "เปลี่ยนเป็นธีมมืด");
        b.title = b.getAttribute("aria-label");
      });
    };
    apply(document.documentElement.getAttribute("data-theme") || "light");
    document.querySelectorAll("[data-theme-toggle]").forEach((b) => b.addEventListener("click", () => {
      const t = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      try { localStorage.setItem("dd-theme", t); } catch (e) { /* ignore */ }
      apply(t);
    }));
  },
};
document.addEventListener("DOMContentLoaded", () => {
  ddHydrateIcons(); DD.initTheme();
  // static markup cannot use style="" (CSP style-src 'self'): data-w / data-i are applied through CSSOM
  document.querySelectorAll("[data-w]").forEach((n) => { n.style.width = n.dataset.w + "%"; });
  document.querySelectorAll("[data-i]").forEach((n) => n.style.setProperty("--i", n.dataset.i));
});
