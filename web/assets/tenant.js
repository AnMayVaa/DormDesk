(function () {
  const t = (k, v) => DD_I18N.t(k, v);
  const $ = (id) => document.getElementById(id);
  const el = DD.el;
  const code = DD.lastPathPart();
  const MY_KEY = "dd-my-" + code.slice(0, 12);   // tracking links this device submitted from this room
  const CONTACT_KEY = "dd-contact";
  const MAX_FILES = 3, MAX_BYTES = 5 * 1024 * 1024, TYPES = ["image/jpeg", "image/png", "image/webp"];
  const SUGGEST = {
    1: ["ไฟในห้องดับ", "ปลั๊กไฟไม่มีไฟ", "เบรกเกอร์ตัดบ่อย"], 2: ["ก๊อกน้ำรั่ว", "ชักโครกกดไม่ลง", "น้ำไหลอ่อน"],
    3: ["แอร์ไม่เย็น", "แอร์มีน้ำหยด", "รีโมทแอร์เสีย"], 4: ["ลิฟต์ค้าง", "ปุ่มลิฟต์กดไม่ติด"],
    5: ["ประตูตู้หลุด", "ลูกบิดประตูหลวม", "มุ้งลวดขาด"], 6: ["เครื่องซักผ้าไม่ปั่น", "เครื่องอบผ้ากินเหรียญ"],
    7: ["พัสดุหาย", "ไม่ได้รับแจ้งพัสดุ"], 8: ["มีรถจอดขวาง", "ไฟลานจอดรถดับ"], 9: ["เสียงดังรบกวน", "ขอเพิ่มถังขยะ"],
  };
  let files = [];
  let idemKey = newKey();
  function newKey() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random()).toString(); }

  // ---------------------------------------------------------------- load room
  (async function init() {
    try {
      const room = await DD.api("/api/rooms/" + encodeURIComponent(code));
      $("dormName").textContent = room.dorm_name;
      $("roomNo").textContent = room.room_no;
      document.title = t("ห้อง {n} — DormDesk", { n: room.room_no });
      $("cats").replaceChildren(...room.categories.map((c) => el("div", { class: "tile" },
        el("input", { type: "radio", name: "category_id", value: c.id, id: "cat-" + c.id }),
        el("label", { for: "cat-" + c.id }, DD.icon(DD_CAT_ICON[c.id] || "dots"), c.name_th))));
      const saved = DD.store.get(CONTACT_KEY, null);
      if (saved) { $("name").value = saved.name || ""; $("phone").value = saved.phone || ""; $("remember").checked = true; }
      $("loading").remove();
      $("page").classList.remove("hidden");
      document.dispatchEvent(new CustomEvent("dd:room", { detail: room }));   // tenant-hub.js builds the menu
      loadMine();
    } catch (e) {
      $("loading").remove();
      $("loadErr").replaceChildren(el("div", { class: "card pad-lg" },
        DD.empty("link", e.status === 404 ? "ลิงก์ห้องนี้ใช้ไม่ได้แล้ว" : "เปิดหน้าไม่สำเร็จ",
          e.status === 404 ? "เจ้าของหออาจเปลี่ยนลิงก์ของห้องแล้ว กรุณาขอลิงก์ใหม่จากเจ้าของหอ" : e.message,
          e.status === 404 ? null : el("button", { class: "btn", type: "button", onclick: () => location.reload() }, DD.icon("refresh"), "ลองใหม่"))));
      $("loadErr").classList.remove("hidden");
    }
  })();

  async function loadMine() {
    const mine = DD.store.get(MY_KEY, []).slice(0, 5);
    if (!mine.length) return;
    const rows = await Promise.all(mine.map((m) => DD.api("/api/track/" + encodeURIComponent(m.token)).then((r) => ({ ...m, r })).catch(() => null)));
    const ok = rows.filter(Boolean);
    DD.store.set(MY_KEY, ok.map(({ token, title, at }) => ({ token, title, at })));  // forget links that no longer work
    if (!ok.length) return;
    $("mineList").replaceChildren(...ok.map((m) => el("a", { class: "my-item", href: "/t/" + encodeURIComponent(m.token) },
      DD.badge(m.r.status), el("span", { class: "spacer", text: m.r.title, translate: "no" }), el("span", { class: "xs muted", text: DD.ago(m.r.updated_at) }), DD.icon("chevron"))));
    $("mine").classList.remove("hidden");
  }

  // ---------------------------------------------------------------- category -> suggestions
  $("cats").addEventListener("change", (ev) => {
    $("f-cat").classList.remove("invalid");
    const list = SUGGEST[ev.target.value] || [];
    $("suggest").replaceChildren(...list.map((s0) => el("button", { type: "button", class: "chip", onclick: () => {
      $("title").value = t(s0); $("f-title").classList.remove("invalid"); $("detail").focus(); } }, s0)));
  });

  // ---------------------------------------------------------------- photos
  function renderThumbs() {
    $("thumbs").replaceChildren(...files.map((f, i) => {
      const url = URL.createObjectURL(f);
      return el("div", { class: "thumb" }, el("img", { src: url, alt: t("รูปที่เลือก {n}", { n: i + 1 }), onload: () => URL.revokeObjectURL(url) }),
        el("button", { type: "button", "aria-label": t("ลบรูปที่ {n}", { n: i + 1 }), onclick: () => { files.splice(i, 1); renderThumbs(); } }, DD.icon("x")));
    }));
  }
  function addFiles(list) {
    const pe = $("photo-err"), f = $("f-photos");
    f.classList.remove("invalid");
    for (const file of list) {
      let msg = null;
      if (!TYPES.includes(file.type)) msg = "รับเฉพาะรูป JPG, PNG หรือ WEBP";
      else if (files.length >= MAX_FILES) msg = "แนบได้ไม่เกิน 3 รูป";
      else if (files.reduce((s, x) => s + x.size, 0) + file.size > MAX_BYTES) msg = "รูปรวมกันต้องไม่เกิน 5 MB";
      if (msg) { pe.querySelector("span").textContent = msg; f.classList.add("invalid"); continue; }
      files.push(file);
    }
    renderThumbs();
  }
  $("photos").addEventListener("change", (ev) => { addFiles(ev.target.files); ev.target.value = ""; });
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

  // ---------------------------------------------------------------- validation (inline, below each field)
  const rules = [
    ["f-cat", () => !!document.querySelector('input[name="category_id"]:checked')],
    ["f-title", () => $("title").value.trim().length >= 3],
    ["f-name", () => $("name").value.trim().length > 0],
    ["f-phone", () => /^[0-9+\-\s]{9,20}$/.test($("phone").value.trim())],
    ["f-email", () => !$("email").value.trim() || /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test($("email").value.trim())],
    ["f-consent", () => $("consent").checked],
  ];
  for (const [id] of rules) $(id).addEventListener("input", () => $(id).classList.remove("invalid"));
  $("consent").addEventListener("change", () => $("f-consent").classList.remove("invalid"));

  $("form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("formErr").replaceChildren();
    let first = null;
    for (const [id, ok] of rules) {
      const bad = !ok();
      $(id).classList.toggle("invalid", bad);
      if (bad && !first) first = $(id);
    }
    if (first) { first.scrollIntoView({ behavior: "smooth", block: "center" }); (first.querySelector("input,textarea") || first).focus({ preventScroll: true }); return; }

    const fd = new FormData();
    fd.set("category_id", document.querySelector('input[name="category_id"]:checked').value);
    fd.set("title", $("title").value.trim());
    fd.set("detail", $("detail").value.trim());
    fd.set("reporter_name", $("name").value.trim());
    fd.set("reporter_phone", $("phone").value.trim());
    fd.set("reporter_email", $("email").value.trim());
    fd.set("consent", "true");
    files.forEach((f) => fd.append("photos", f, f.name));

    const btn = $("submit");
    btn.disabled = true;
    btn.replaceChildren(el("span", { class: "bar-loader" }), "กำลังส่ง…");
    try {
      const out = await DD.api("/api/rooms/" + encodeURIComponent(code) + "/requests",
        { method: "POST", body: fd, headers: { "Idempotency-Key": idemKey } });
      if ($("remember").checked) DD.store.set(CONTACT_KEY, { name: $("name").value.trim(), phone: $("phone").value.trim() });
      else DD.store.del(CONTACT_KEY);
      DD.store.set(MY_KEY, [{ token: out.tracking_token, title: $("title").value.trim(), at: Date.now() }, ...DD.store.get(MY_KEY, [])].slice(0, 10));
      showDone(out);
    } catch (e) {
      $("formErr").replaceChildren(DD.errorBox(e));
    } finally {
      btn.disabled = false;
      btn.replaceChildren(DD.icon("send"), "ส่งเรื่องแจ้งซ่อม");
    }
  });

  function showDone(out) {
    const url = location.origin + out.tracking_url;
    $("trackUrl").value = url;
    $("goTrack").href = out.tracking_url;
    if (navigator.share) {
      $("share").classList.remove("hidden");
      $("share").onclick = () => navigator.share({ title: "ติดตามเรื่องแจ้งซ่อม", url }).catch(() => {});
    }
    $("form").classList.add("hidden");
    $("mine").classList.add("hidden");
    $("done").classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
    $("goTrack").focus({ preventScroll: true });
  }
  $("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("trackUrl").value); DD.toast("คัดลอกลิงก์แล้ว"); }
    catch (e) { $("trackUrl").select(); }
  });
  $("again").addEventListener("click", () => {
    idemKey = newKey(); files = []; renderThumbs();
    ["title", "detail"].forEach((i) => { $(i).value = ""; });
    document.querySelectorAll('input[name="category_id"]').forEach((r) => { r.checked = false; });
    $("suggest").replaceChildren();
    $("done").classList.add("hidden"); $("form").classList.remove("hidden");
    loadMine();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();
