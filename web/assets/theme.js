// Loaded in <head> before CSS paints: applies the saved/OS theme to avoid a flash.
(function () {
  var t = null;
  try { t = localStorage.getItem("dd-theme"); } catch (e) { /* storage blocked */ }
  if (t !== "light" && t !== "dark") t = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
})();
