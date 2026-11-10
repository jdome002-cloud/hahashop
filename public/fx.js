/* HAHA SHOP — effects (v5). External file (CSP: script-src 'self'). Honors prefers-reduced-motion. */
(function () {
  "use strict";
  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var reduce = mq.matches;

  /* ---------- Background: particles, twinkling sparkles, drifting angular shapes ---------- */
  (function bg() {
    var canvas = document.getElementById("fx-canvas");
    if (!canvas) return;
    if (reduce) { canvas.style.display = "none"; return; }
    var ctx = canvas.getContext("2d", { alpha: true });
    var w = 0, h = 0, dots = [], sparks = [], shapes = [], raf = 0, last = 0, running = false;
    var FRAME = 1000 / 30; // cap at 30 fps — plenty for slow ambient motion, half the GPU/battery cost
    var SHAPES = [ // normalised polygons (from the original static SVG)
      [[0, .075], [.35, 0], [.55, 0], [0, .21]], [[1, .15], [.65, .325], [1, .41]],
      [[.075, .525], [.425, .41], [.3, .7]], [[1, .65], [.75, .75], [.9, .95], [1, .925]],
      [[0, .875], [.225, .8], [.4, 1], [0, 1]], [[.525, .475], [.725, .55], [.575, .59]],
    ];
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.min(34, Math.floor((w * h) / 26000));
      dots = []; for (var i = 0; i < n; i++) dots.push({ x: rnd(0, w), y: rnd(0, h), r: rnd(.5, 1.6), vx: rnd(-.12, .12), vy: rnd(-.32, -.08), a: rnd(.12, .4) });
      sparks = []; for (var j = 0; j < Math.min(9, Math.ceil(n / 4)); j++) sparks.push({ x: rnd(0, w), y: rnd(0, h), s: rnd(2.5, 5), t: rnd(0, 6.28), sp: rnd(.6, 1.4), gold: Math.random() < .6 });
      shapes = SHAPES.map(function (pts, k) {
        return { pts: pts, a: [.05, .055, .045, .05, .055, .04][k], ph: rnd(0, 6.28), amp: rnd(10, 22), sp: rnd(.00012, .00022), rot: rnd(-.04, .04) };
      });
    }
    function star(x, y, s) {
      ctx.beginPath();
      ctx.moveTo(x, y - s); ctx.quadraticCurveTo(x, y, x + s, y); ctx.quadraticCurveTo(x, y, x, y + s);
      ctx.quadraticCurveTo(x, y, x - s, y); ctx.quadraticCurveTo(x, y, x, y - s); ctx.fill();
    }
    function draw(now) {
      ctx.clearRect(0, 0, w, h);
      // drifting shapes
      for (var i = 0; i < shapes.length; i++) {
        var sh = shapes[i], t = now * sh.sp + sh.ph;
        var dx = Math.sin(t) * sh.amp, dy = Math.cos(t * .8) * sh.amp * .7, r = Math.sin(t * .6) * sh.rot;
        ctx.save(); ctx.translate(w / 2 + dx, h / 2 + dy); ctx.rotate(r); ctx.translate(-w / 2, -h / 2);
        ctx.fillStyle = "rgba(255,255,255," + sh.a + ")";
        ctx.beginPath();
        for (var p = 0; p < sh.pts.length; p++) { var px = sh.pts[p][0] * w, py = sh.pts[p][1] * h; p ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
      // particles
      ctx.fillStyle = "#fff";
      for (var d = 0; d < dots.length; d++) {
        var o = dots[d];
        o.x += o.vx * 2; o.y += o.vy * 2;
        if (o.y < -4) { o.y = h + 4; o.x = rnd(0, w); }
        if (o.x < -4) o.x = w + 4; else if (o.x > w + 4) o.x = -4;
        ctx.globalAlpha = o.a * .7;
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 6.2832); ctx.fill();
      }
      // twinkling sparkles
      for (var k = 0; k < sparks.length; k++) {
        var s = sparks[k]; s.t += .06 * s.sp;
        var a = Math.max(0, Math.sin(s.t));
        if (a < .02 && Math.random() < .02) { s.x = rnd(0, w); s.y = rnd(0, h); }
        ctx.globalAlpha = a * .55;
        ctx.fillStyle = s.gold ? "#facc15" : "#ffffff";
        star(s.x, s.y, s.s * (.6 + a * .4));
      }
      ctx.globalAlpha = 1;
    }
    function loop(now) {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME) return;
      last = now; draw(now);
    }
    function start() { if (running) return; running = true; last = 0; raf = requestAnimationFrame(loop); }
    function stop() { running = false; cancelAnimationFrame(raf); }
    resize(); start();
    var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(resize, 150); }, { passive: true });
    document.addEventListener("visibilitychange", function () { document.hidden ? stop() : start(); });
  })();

  /* ---------- Scroll reveal + in-view flag (price glow only runs for visible cards) ---------- */
  var REVEAL = ".cat-card, .stat-card, .menu-card, .cat-banner, .hero, .section-head, #view-history .info-card, #view-orders .info-card, .profile-card";
  var io = ("IntersectionObserver" in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var el = e.target;
      if (e.isIntersecting) el.classList.add("fx-in");
      if (el.classList.contains("cat-card")) el.classList.toggle("fx-inview", e.isIntersecting);
      else if (e.isIntersecting) io.unobserve(el);
    });
  }, { rootMargin: "0px 0px -6% 0px", threshold: .08 }) : null;

  function prep(root) {
    if (!root || !root.querySelectorAll) return;
    var list = root.matches && root.matches(REVEAL) ? [root] : [];
    list = list.concat(Array.prototype.slice.call(root.querySelectorAll(REVEAL)));
    list.forEach(function (el) {
      if (el.dataset.fx || el.closest(".fx-skel") || el.closest("#view-admin")) return;
      el.dataset.fx = "1";
      var idx = 0, sib = el.previousElementSibling;
      while (sib && idx < 8) { idx++; sib = sib.previousElementSibling; }
      if (el.classList.contains("cat-card") || el.querySelector(".btn-buy-full")) el.style.setProperty("--fx-d", (idx * .9 % 7).toFixed(2) + "s");
      if (reduce || !io) { el.classList.add("fx-in", "fx-inview"); return; }
      el.classList.add("fx-reveal");
      el.style.transitionDelay = Math.min(idx, 6) * 55 + "ms";
      el.addEventListener("transitionend", function clear() { el.style.transitionDelay = ""; el.removeEventListener("transitionend", clear); });
      io.observe(el);
    });
  }
  prep(document.body);
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) for (var j = 0; j < muts[i].addedNodes.length; j++) {
      var n = muts[i].addedNodes[j]; if (n.nodeType === 1) prep(n);
    }
  }).observe(document.body, { childList: true, subtree: true });

  /* ---------- Tap feedback: ripple + press state (touch has no :hover) ---------- */
  var RIPPLE = ".btn-primary, .btn-buy-full, .click-pill, .btn-search, .btn-oauth, .nav-wallet, .inline-btn, .btn-ghost";
  var PRESS = ".cat-card, .menu-card, .cat-banner";
  document.addEventListener("pointerdown", function (e) {
    var b = e.target.closest && e.target.closest(RIPPLE);
    if (b && !b.disabled && !reduce) {
      var r = b.getBoundingClientRect(), s = document.createElement("span");
      s.className = "fx-ripple";
      s.style.left = (e.clientX - r.left) + "px"; s.style.top = (e.clientY - r.top) + "px";
      if (getComputedStyle(b).position === "static") b.style.position = "relative";
      b.appendChild(s);
      setTimeout(function () { s.remove(); }, 700);
    }
    var c = e.pointerType !== "mouse" && e.target.closest && e.target.closest(PRESS);
    if (c) {
      c.classList.add("fx-press");
      var up = function () { setTimeout(function () { c.classList.remove("fx-press"); }, 160); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
      window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    }
  }, { passive: true });

  /* ---------- Bottom-nav sliding indicator ---------- */
  (function navInd() {
    var nav = document.querySelector(".bottom-nav");
    if (!nav) return;
    var ind = document.createElement("span");
    ind.className = "fx-nav-ind off"; ind.setAttribute("aria-hidden", "true");
    nav.appendChild(ind); nav.classList.add("fx-has-ind");
    function place() {
      var a = nav.querySelector(".nav-item.active:not([hidden])");
      if (!a) { ind.classList.add("off"); return; }
      var nr = nav.getBoundingClientRect(), ar = a.getBoundingClientRect();
      var iw = Math.max(16, Math.min(26, ar.width * .4));
      ind.style.width = iw + "px";
      ind.style.transform = "translateX(" + (ar.left - nr.left + (ar.width - iw) / 2) + "px)";
      ind.classList.remove("off");
    }
    var mo = new MutationObserver(function () { requestAnimationFrame(place); });
    nav.querySelectorAll(".nav-item, .nav-wallet").forEach(function (el) { mo.observe(el, { attributes: true, attributeFilter: ["class", "hidden"] }); });
    window.addEventListener("resize", place, { passive: true });
    document.addEventListener("hh:lang", function () { requestAnimationFrame(place); });
    requestAnimationFrame(place);
  })();

  /* ---------- Skeleton helper used by the app while products load ---------- */
  window.HHFx = {
    skeletons: function (n) {
      var one = '<article class="cat-card fx-skel" aria-hidden="true"><div class="sk sk-thumb"></div><div class="sk sk-line"></div><div class="sk sk-line w60"></div><div class="sk sk-btn"></div><div class="sk sk-line w40" style="margin-bottom:12px"></div></article>';
      return new Array(n + 1).join(one);
    },
    reduce: reduce,
  };
})();
