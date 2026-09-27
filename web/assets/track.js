(function () {
  const t = (k, v) => DD_I18N.t(k, v);
  const $ = (id) => document.getElementById(id);
  const el = DD.el;
  const token = DD.lastPathPart();
  const STEPS = [["received", "รับเรื่อง", "inbox"], ["in_progress", "กำลังซ่อม", "wrench"], ["done", "เสร็จสิ้น", "checkCircle"]];
  let first = true;

  function stepper(status) {
    const idx = { received: 0, in_progress: 1, done: 2 }[status];
    return STEPS.map(([key, label, icon], i) => {
      let cls = "step";
      if (status === "rejected") cls += i === 0 ? " rejected" : "";
      else if (i < idx || (status === "done" && i === idx)) cls += " done";
      else if (i === idx) cls += " current";
      const ic = status === "rejected" && i === 0 ? "xCircle" : (cls.includes("done") ? "check" : icon);
      return el("div", { class: cls, "aria-current": cls.includes("current") ? "step" : null },
        el("div", { class: "dot" }, DD.icon(ic)), status === "rejected" && i === 0 ? "ปฏิเสธ / แจ้งซ้ำ" : label);
    });
  }

  async function load() {
    try {
      const r = await DD.api("/api/track/" + encodeURIComponent(token));
      $("where").replaceChildren(DD.icon("building"), el("span", { translate: "no", text: t("{dorm} · ห้อง {room} · {cat}", { dorm: r.dorm_name, room: r.room_no, cat: t(r.category) }) }));
      $("title").textContent = r.title;
      document.title = t("{title} — ติดตามสถานะ", { title: r.title });
      $("badges").replaceChildren(...[DD.badge(r.status), r.priority === "urgent" ? DD.urgent() : null,
        el("span", { class: "small muted", text: t("แจ้งเมื่อ {d}", { d: DD.fmt(r.created_at) }) })].filter(Boolean));
      $("stepper").replaceChildren(...stepper(r.status));
      $("detail").textContent = r.detail || "";
      $("detail").classList.toggle("hidden", !r.detail);
      $("photos").replaceChildren(...r.photos.map((id, i) => {
        const src = "/api/track/" + encodeURIComponent(token) + "/photos/" + id;
        return el("a", { href: src, target: "_blank", rel: "noopener", "aria-label": t("เปิดรูปที่ {n}", { n: i + 1 }) },
          el("img", { src, alt: t("รูปที่แนบ {n}", { n: i + 1 }), loading: "lazy" }));
      }));
      $("timeline").replaceChildren(...DD.reveal(r.events.slice().reverse().map((e) => el("li", {},
        el("div", { class: "t-title", text: DD.STATUS[e.to_status] || e.to_status }),
        el("div", { class: "xs muted", text: e.to_status === "received" && !e.note ? t("{d} · ผู้เช่าแจ้งเรื่อง", { d: DD.fmt(e.created_at) }) : DD.fmt(e.created_at) }),
        e.note ? el("div", { class: "t-note", text: e.note, translate: "no" }) : null))));
      $("updated").textContent = t("อัปเดตล่าสุด {t}", { t: new Date().toLocaleTimeString(DD_I18N.locale, { hour: "2-digit", minute: "2-digit" }) });
      if (first) { $("loading").remove(); $("view").classList.remove("hidden"); $("hist").classList.remove("hidden");
        $("view").classList.add("reveal"); first = false; }
    } catch (e) {
      if (!first) { DD.toast(e.message, "err"); return; }
      $("loading").remove();
      $("err").replaceChildren(el("div", { class: "card pad-lg" }, e.status === 404
        ? DD.empty("inbox", "ไม่พบเรื่องนี้", "ลิงก์ติดตามอาจพิมพ์ผิด ลองเปิดจากลิงก์ที่ได้ตอนแจ้งเรื่องอีกครั้ง")
        : DD.empty("alert", "โหลดไม่สำเร็จ", e.message, el("button", { class: "btn", type: "button", onclick: () => location.reload() }, DD.icon("refresh"), "ลองใหม่"))));
      $("err").classList.remove("hidden");
    }
  }
  $("refresh").addEventListener("click", () => load().then(() => DD.toast("อัปเดตแล้ว")));
  setInterval(() => { if (!document.hidden && !first) load(); }, 30000);
  load();
})();
