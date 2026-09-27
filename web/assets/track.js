(function () {
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
      $("where").replaceChildren(DD.icon("building"), `${r.dorm_name} · ห้อง ${r.room_no} · ${r.category}`);
      $("title").textContent = r.title;
      document.title = r.title + " — ติดตามสถานะ";
      $("badges").replaceChildren(...[DD.badge(r.status), r.priority === "urgent" ? DD.urgent() : null,
        el("span", { class: "small muted", text: "แจ้งเมื่อ " + DD.fmt(r.created_at) })].filter(Boolean));
      $("stepper").replaceChildren(...stepper(r.status));
      $("detail").textContent = r.detail || "";
      $("detail").classList.toggle("hidden", !r.detail);
      $("photos").replaceChildren(...r.photos.map((id, i) => {
        const src = "/api/track/" + encodeURIComponent(token) + "/photos/" + id;
        return el("a", { href: src, target: "_blank", rel: "noopener", "aria-label": "เปิดรูปที่ " + (i + 1) },
          el("img", { src, alt: "รูปที่แนบ " + (i + 1), loading: "lazy" }));
      }));
      $("timeline").replaceChildren(...DD.reveal(r.events.slice().reverse().map((e) => el("li", {},
        el("div", { class: "t-title", text: DD.STATUS[e.to_status] || e.to_status }),
        el("div", { class: "xs muted", text: DD.fmt(e.created_at) + (e.to_status === "received" && !e.note ? " · ผู้เช่าแจ้งเรื่อง" : "") }),
        e.note ? el("div", { class: "t-note", text: e.note }) : null))));
      $("updated").textContent = "อัปเดตล่าสุด " + new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
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
