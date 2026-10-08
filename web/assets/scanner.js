// In-page QR scanner for the room link (spec 2.3: QR codes are scanned from inside the room page only).
// 1) camera + the browser's BarcodeDetector (Chrome/Android, Safari 17+)  2) fallback: camera + jsQR (self-hosted,
// Apache-2.0, lazy-loaded from /assets/vendor because the CSP only allows our own scripts)  3) no camera / laptop demo:
// pick a photo of the QR. Needs Permissions-Policy camera=(self) in Nginx.
(function () {
  const el = DD.el;
  let jsqrLoading = null;
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (!jsqrLoading) jsqrLoading = new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = "/assets/vendor/jsQR.js"; s.onload = () => ok(window.jsQR); s.onerror = () => bad(new Error("jsQR"));
      document.head.append(s);
    });
    return jsqrLoading;
  }
  async function decodeCanvas(canvas, detector) {
    if (detector) {
      try { const r = await detector.detect(canvas); if (r && r[0]) return r[0].rawValue; } catch (e) { /* fall through */ }
      return null;
    }
    const jsQR = await loadJsQR();
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const r = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    return r ? r.data : null;
  }
  async function makeDetector() {
    if (!("BarcodeDetector" in window)) return null;
    try {
      const fmts = await window.BarcodeDetector.getSupportedFormats();
      return fmts.includes("qr_code") ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
    } catch (e) { return null; }
  }
  async function decodeFile(file, detector) {
    const bmp = await createImageBitmap(file);
    const c = document.createElement("canvas");
    const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return decodeCanvas(c, detector);
  }

  // DD_SCAN.open({ title, hint }) -> Promise<string|null>  (null = cancelled)
  async function open({ title, hint } = {}) {
    const detector = await makeDetector();
    return new Promise((resolve) => {
      let stream = null, done = false, timer = null;
      const video = el("video", { playsinline: true, muted: true, autoplay: true });
      const status = el("p", { class: "small", text: hint || "เล็งกล้องไปที่ QR" });
      const file = el("input", { type: "file", accept: "image/*", class: "sr-only", id: "scanFile" });
      const finish = (v) => {
        if (done) return; done = true;
        clearTimeout(timer);
        if (stream) stream.getTracks().forEach((t) => t.stop());
        box.remove(); document.removeEventListener("keydown", onKey);
        resolve(v);
      };
      const onKey = (e) => { if (e.key === "Escape") finish(null); };
      file.addEventListener("change", async () => {
        if (!file.files[0]) return;
        status.textContent = "กำลังอ่าน QR จากรูป…";
        try { const v = await decodeFile(file.files[0], detector); if (v) return finish(v); } catch (e) { /* ignore */ }
        status.textContent = "อ่าน QR จากรูปนี้ไม่ได้ ลองรูปที่ชัดขึ้น";
      });
      const box = el("div", { class: "scanner", role: "dialog", "aria-modal": "true", "aria-label": title || "สแกน QR" },
        el("h2", { class: "mt-0", text: title || "สแกน QR" }),
        el("div", { class: "frame" }, video), status,
        el("div", { class: "row wrap" },
          el("label", { class: "btn ghost", for: "scanFile" }, DD.icon("image"), "เลือกรูป QR แทน"), file,
          el("button", { class: "btn", type: "button", onclick: () => finish(null) }, DD.icon("x"), "ปิด")));
      document.body.append(box);
      document.addEventListener("keydown", onKey);
      const canvas = document.createElement("canvas");
      const tick = async () => {
        if (done) return;
        if (video.readyState >= 2 && video.videoWidth) {
          const w = Math.min(640, video.videoWidth), h = Math.round(w * video.videoHeight / video.videoWidth);
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0, w, h);
          try { const v = await decodeCanvas(canvas, detector); if (v) return finish(v); } catch (e) { /* keep trying */ }
        }
        timer = setTimeout(tick, 250);
      };
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        status.textContent = "เบราว์เซอร์นี้เปิดกล้องไม่ได้ เลือกรูป QR แทนได้";
        return;
      }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
        .then((s) => { stream = s; if (done) { s.getTracks().forEach((t) => t.stop()); return; } video.srcObject = s; video.play().catch(() => {}); tick(); })
        .catch(() => { status.textContent = "เปิดกล้องไม่ได้ (ไม่ได้อนุญาต หรือไม่มีกล้อง) เลือกรูป QR แทนได้"; });
    });
  }
  window.DD_SCAN = { open };
})();
