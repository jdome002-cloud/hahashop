/* HAHA SHOP — header (theme / drawer), hero badge typing, about modal. External file for CSP. */
(function () {
  "use strict";
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var T = function (k) { return window.HHi18n ? window.HHi18n.t(k) : k; };

  /* —— Theme toggle (dark default, light optional) —— */
  var themeBtn = document.getElementById("theme-btn");
  function setTheme(t, save) {
    root.setAttribute("data-theme", t);
    var m = document.getElementById("meta-theme");
    if (m) m.setAttribute("content", t === "light" ? "#f4f6fb" : "#05070d");
    if (themeBtn) {
      themeBtn.setAttribute("aria-pressed", t === "light" ? "true" : "false");
      themeBtn.setAttribute("aria-label", T(t === "light" ? "theme_to_dark" : "theme_to_light"));
    }
    if (save) try { localStorage.setItem("hh_theme", t); } catch (e) {}
    document.dispatchEvent(new CustomEvent("hh:theme", { detail: t }));
  }
  setTheme(root.getAttribute("data-theme") === "light" ? "light" : "dark", false);
  if (themeBtn) themeBtn.addEventListener("click", function () {
    root.classList.add("theme-anim");
    setTheme(root.getAttribute("data-theme") === "light" ? "dark" : "light", true);
    setTimeout(function () { root.classList.remove("theme-anim"); }, 450);
  });

  /* —— Side drawer —— */
  var drawer = document.getElementById("side-drawer");
  var backdrop = document.getElementById("drawer-backdrop");
  var menuBtn = document.getElementById("menu-btn");
  var lastFocus = null;
  function openDrawer() {
    lastFocus = document.activeElement;
    backdrop.hidden = false;
    drawer.removeAttribute("inert");
    drawer.setAttribute("aria-hidden", "false");
    requestAnimationFrame(function () { drawer.classList.add("open"); backdrop.classList.add("show"); });
    menuBtn.setAttribute("aria-expanded", "true");
    document.body.classList.add("drawer-open");
    var c = document.getElementById("drawer-close"); if (c) setTimeout(function () { c.focus({ preventScroll: true }); }, 60);
  }
  function closeDrawer() {
    if (!drawer.classList.contains("open")) return;
    drawer.classList.remove("open"); backdrop.classList.remove("show");
    drawer.setAttribute("aria-hidden", "true"); drawer.setAttribute("inert", "");
    menuBtn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("drawer-open");
    setTimeout(function () { if (!drawer.classList.contains("open")) backdrop.hidden = true; }, reduce ? 0 : 320);
    if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
  }
  window.HHDrawer = { open: openDrawer, close: closeDrawer };
  if (menuBtn) menuBtn.addEventListener("click", function () { drawer.classList.contains("open") ? closeDrawer() : openDrawer(); });
  backdrop.addEventListener("click", closeDrawer);
  document.getElementById("drawer-close").addEventListener("click", closeDrawer);
  drawer.addEventListener("click", function (e) {
    if (e.target.closest("a[href], [data-open-auth], [data-logout]") && !e.target.closest("#contact-btn, #lang-toggle")) closeDrawer();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });
  window.addEventListener("hashchange", closeDrawer);
  function markActive() {
    var h = location.hash || "#/";
    if (h === "#") h = "#/";
    drawer.querySelectorAll(".drawer-nav a").forEach(function (a) { a.classList.toggle("active", a.getAttribute("href") === h.split("?")[0]); });
  }
  window.addEventListener("hashchange", markActive); markActive();

  /* —— About / how-to-buy modal —— */
  var about = document.getElementById("about-modal");
  var aboutBtn = document.getElementById("about-btn");
  if (aboutBtn && about) aboutBtn.addEventListener("click", function () {
    about.classList.remove("fx-closing");
    about.hidden = false;
    document.body.classList.add("modal-open");
  });

  /* —— Hero badge: types the phrases one after another (shop status + admin announcement) —— */
  var badge = document.getElementById("hero-badge-text");
  var extra = "";
  function phrases() {
    var list = [T("hero_badge")];
    if (extra) list.push(extra);
    list.push(T("hero_badge2"));
    return list;
  }
  window.HHHero = { setAnnouncement: function (txt) { extra = String(txt || "").trim().slice(0, 60); } };
  if (badge && !reduce) {
    var pi = 0, ci = 0, dir = 1, timer = 0;
    badge.classList.add("typing");
    var step = function () {
      var list = phrases(); if (pi >= list.length) pi = 0;
      var chars = Array.from(list[pi]);
      if (dir > 0) {
        ci++;
        badge.textContent = chars.slice(0, ci).join("");
        if (ci >= chars.length) { dir = -1; timer = setTimeout(step, 2600); return; }
        timer = setTimeout(step, 70 + Math.random() * 50);
      } else {
        ci--;
        badge.textContent = chars.slice(0, Math.max(ci, 0)).join("");
        if (ci <= 0) { dir = 1; pi = (pi + 1) % list.length; timer = setTimeout(step, 380); return; }
        timer = setTimeout(step, 28);
      }
    };
    // data-i18n would overwrite the typed text on language switch: restart cleanly instead
    badge.removeAttribute("data-i18n");
    document.addEventListener("hh:lang", function () { clearTimeout(timer); pi = 0; ci = 0; dir = 1; badge.textContent = ""; timer = setTimeout(step, 200); });
    document.addEventListener("visibilitychange", function () { clearTimeout(timer); if (!document.hidden) timer = setTimeout(step, 300); });
    badge.textContent = "";
    timer = setTimeout(step, 500);
  }
})();
