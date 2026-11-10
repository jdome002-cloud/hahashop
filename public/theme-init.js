/* Runs in <head> before first paint so the saved theme never flashes. Dark is the default. */
(function () {
  var t = null;
  try { t = localStorage.getItem("hh_theme"); } catch (e) {}
  var light = t === "light";
  document.documentElement.setAttribute("data-theme", light ? "light" : "dark");
  var m = document.getElementById("meta-theme");
  if (m) m.setAttribute("content", light ? "#f4f6fb" : "#05070d");
})();
