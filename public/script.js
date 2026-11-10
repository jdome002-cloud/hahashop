/* HAHA SHOP SPA */
(function () {
  "use strict";

  const baht = (n) =>
    Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " บาท";
  const bahtShort = (n) =>
    Number(n).toLocaleString("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 });

  let currentUser = null;
  let prodState = { q: "", sort: "newest", min: "", max: "", category: "" };
  let priceToggle = "price_asc";
  let currentMinigame = null;
  let configCats = [];

  let csrfToken = "";

  async function ensureCsrf() {
    if (csrfToken) return csrfToken;
    try {
      const res = await fetch("/api/csrf", {
        credentials: "same-origin",
        headers: { "X-Pinggy-No-Screen": "1", "Accept": "application/json" },
      });
      const data = await res.json();
      if (data && data.csrfToken) csrfToken = data.csrfToken;
    } catch (_) {}
    return csrfToken;
  }

  async function api(path, opts = {}) {
    const method = String((opts.method || "GET")).toUpperCase();
    const headers = {
      "X-Pinggy-No-Screen": "1",
      "Accept": "application/json",
      ...(opts.headers || {}),
    };
    const isForm = (typeof FormData !== "undefined") && opts.body instanceof FormData;
    if (!isForm && !headers["Content-Type"] && method !== "GET" && method !== "HEAD") {
      headers["Content-Type"] = "application/json";
    }
    if (method !== "GET" && method !== "HEAD") {
      const t = await ensureCsrf();
      if (t) headers["X-CSRF-Token"] = t;
    }
    const { headers: _h, ...rest } = opts;
    const res = await fetch(path, {
      credentials: "same-origin",
      ...rest,
      method,
      headers,
    });
    const ct = res.headers.get("content-type") || "";
    let data = {};
    if (ct.includes("application/json")) {
      try { data = await res.json(); } catch (_) {}
    } else {
      const text = await res.text();
      if (/pinggy|Caution|X-Pinggy-No-Screen/i.test(text)) {
        data = { ok: false, message: "ถูกหน้าเตือน Pinggy ขวางไว้ — รีเฟรชแล้วลองใหม่" };
      } else {
        data = { ok: false, message: "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง" };
      }
    }
    if (data && data.csrfToken) csrfToken = data.csrfToken;
    return { res, data };
  }

  async function apiForm(path, { method = "POST", formData } = {}) {
    if (window.HHImage) {
      try { formData = await window.HHImage.prepareFormData(formData); } catch (_) {}
    }
    const t = await ensureCsrf();
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        "X-Pinggy-No-Screen": "1",
        "Accept": "application/json",
        ...(t ? { "X-CSRF-Token": t } : {}),
      },
      body: formData,
    });
    const ct = res.headers.get("content-type") || "";
    let data = {};
    if (ct.includes("application/json")) {
      try { data = await res.json(); } catch (_) {}
    } else {
      data = { ok: false, message: res.status === 413 ? "ไฟล์ใหญ่เกินไป (สูงสุด 12MB)" : `อัปโหลดไม่สำเร็จ (HTTP ${res.status})` };
    }
    if (data && data.csrfToken) csrfToken = data.csrfToken;
    return { res, data };
  }

  const T = (k) => (window.HHi18n ? window.HHi18n.t(k) : k);
  document.addEventListener("hh:lang", () => {
    updateChrome();
    if (!document.getElementById("view-auth").hidden) loadAuth();
    if (!document.getElementById("view-history").hidden) loadHistory();
    if (!document.getElementById("view-orders").hidden) loadOrders();
    modal.querySelectorAll("[data-captcha]").forEach((b) => { if (captchaCfg.type !== "turnstile") { b.innerHTML = ""; } });
    if (!modal.hidden) { const f = modal.querySelector(".mpane:not([hidden]) form"); if (f) renderCaptcha(f); }
  });
  document.getElementById("quick-search")?.addEventListener("submit", (e) => {
    e.preventDefault();
    prodState.q = (document.getElementById("quick-q").value || "").trim().slice(0, 80);
    prodState._fromFilter = true;
    if (location.hash === "#/products") loadProducts(); else location.hash = "#/products";
  });

  function toast(msg, isErr) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.toggle("err", !!isErr);
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2800);
  }

  function updateChrome() {
    const u = currentUser;
    document.body.classList.toggle("logged-in", !!u);
    document.getElementById("avatar-btn").hidden = !u;
    document.getElementById("nav-login").hidden = !!u;
    document.getElementById("nav-wallet").hidden = !u;
    const banner = document.getElementById("verify-banner");
    if (u) {
      document.getElementById("avatar-top").innerHTML = avatarHtml(u);
      document.getElementById("nav-balance").textContent = bahtShort(u.balance);
      document.getElementById("nav-points").textContent = formatInt(u.points || 0) + " " + T("points_unit");
      document.getElementById("balance-value").textContent = bahtShort(u.balance);
      if (banner) banner.hidden = !!u.emailVerified || !authCfg.verificationRequired || !!u.isAdmin;
      if (!menu.hidden) fillMenu();
    } else {
      document.getElementById("nav-auth-label").textContent = T("login");
      if (banner) banner.hidden = true;
      closeMenu();
    }
  }

  async function refreshMe() {
    const { data } = await api("/api/me");
    currentUser = data.user || null;
    updateChrome();
  }

  function route() {
    const raw = (location.hash || "#/").replace(/^#/, "") || "/";
    const [rawPath, rawQuery] = raw.split("?");
    const parts = rawPath.split("/").filter(Boolean);
    const page = parts[0] || "home";
    const hashQuery = new URLSearchParams(rawQuery || "");
    const sub = parts[1] || null;

    if (handleAuthHash(page, hashQuery)) { if (!document.querySelector(".page-view:not([hidden])")) { document.getElementById("view-home").hidden = false; loadHome(); } return; }
    closeMenu();
    document.querySelectorAll(".page-view").forEach((v) => { v.hidden = true; });
    const map = {
      home: "view-home",
      products: "view-products",
      shop: "view-shop",
      topup: "view-topup",
      auction: "view-auction",
      minigame: "view-minigame",
      auth: "view-auth",
      history: "view-history",
      orders: "view-orders",
      admin: "view-admin",
    };
    const id = map[page] || "view-home";
    document.getElementById(id).hidden = false;

    document.querySelectorAll(".nav-item").forEach((a) => {
      a.classList.toggle("active", a.getAttribute("data-tab") === (map[page] ? page : "home") ||
        (page === "" && a.getAttribute("data-tab") === "home"));
    });
    // fix home active
    document.querySelectorAll(".nav-item").forEach((a) => {
      const tab = a.getAttribute("data-tab");
      const active = (page === "home" && tab === "home") || tab === page ||
        (tab === "auth" && (page === "history" || page === "orders"));
      a.classList.toggle("active", active);
    });

    window.scrollTo(0, 0);

    if (page === "home" || !parts.length) loadHome();
    else if (page === "products") {
      const params = new URLSearchParams(raw.split("?")[1] || "");
      if (params.get("category")) prodState.category = params.get("category");
      else if (!prodState._fromFilter) prodState.category = "";
      prodState._fromFilter = false;
      loadProducts();
    } else if (page === "shop") loadShop();
    else if (page === "topup") loadTopup();
    else if (page === "auction") loadAuctions();
    else if (page === "minigame") {
      if (sub) openMinigamePlay(sub);
      else showMinigameList();
    } else if (page === "auth") loadAuth();
    else if (page === "history") loadHistory();
    else if (page === "orders") loadOrders();
    else if (page === "admin") loadAdmin();
  }

  const ICO = {
    flame: `<svg class="thumb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
    key: `<svg class="thumb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>`,
    dice: `<svg class="thumb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="12" height="12" x="2" y="10" rx="2"/><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/><path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/></svg>`,
    gift: `<svg class="thumb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>`,
    game: `<svg class="thumb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 12h4"/><path d="M8 10v4"/><path d="M15 13h.01"/><path d="M18 11h.01"/><rect width="20" height="12" x="2" y="6" rx="2"/></svg>`,
    gavel: `<svg class="thumb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3l8.384-8.381"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/></svg>`,
    package: `<svg class="thumb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:12px;height:12px;vertical-align:-1px"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
    gameBig: `<svg class="thumb-ico big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 12h4"/><path d="M8 10v4"/><path d="M15 13h.01"/><path d="M18 11h.01"/><rect width="20" height="12" x="2" y="6" rx="2"/></svg>`,
  };

  const CAT_STYLE = {
    ffid: { ico: "flame", grad: "linear-gradient(135deg,#1d4ed8,#60a5fa)" },
    rent: { ico: "key", grad: "linear-gradient(135deg,#1e3a8a,#3b82f6)" },
    random: { ico: "dice", grad: "linear-gradient(135deg,#6d28d9,#c084fc)" },
    event: { ico: "gift", grad: "linear-gradient(135deg,#b45309,#fbbf24)" },
  };

  function styleFor(cat) {
    return CAT_STYLE[cat] || { ico: "game", grad: "linear-gradient(135deg,#1d4ed8,#60a5fa)" };
  }

  function productCard(p, opts = {}) {
    const buy = opts.buy !== false;
    const st = styleFor(p.category);
    const code = escapeHtml(p.sku || ("#" + p.id));
    const icon = ICO[st.ico] || ICO.game;
    const thumb = p.image
      ? `<div class="cat-thumb has-photo"><img src="${escapeHtml(p.image)}" alt="" />
        ${p.installment ? '<span class="inst-badge">ผ่อนได้</span>' : ""}
        ${p.example ? '<span class="demo-tag">ตัวอย่าง</span>' : ""}</div>`
      : `<div class="cat-thumb abstract" style="background:${st.grad}">
        ${icon}
        <span class="thumb-code">${code}</span>
        ${p.installment ? '<span class="inst-badge">ผ่อนได้</span>' : ""}
        ${p.example ? '<span class="demo-tag">ตัวอย่าง</span>' : ""}</div>`;
    return `<article class="cat-card" data-pid="${p.id}" data-price="${Number(p.price)}">
      ${thumb}
      <div class="cat-body">
        <h3>${escapeHtml(p.title)}</h3>
        <p class="cat-price">${Number(p.price).toFixed(2)} บาท</p>
        ${buy ? (p.stock > 0 ? `<button type="button" class="btn-buy-full" data-buy="${p.id}">ซื้อสินค้านี้</button>` : `<button type="button" class="btn-buy-full" disabled>สินค้าหมด</button>`) : ""}
        <p class="stock">${ICO.package} คงเหลือ ${p.stock}</p>
      </div>
    </article>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // SQLite CURRENT_TIMESTAMP is UTC ("YYYY-MM-DD HH:MM:SS") → show in the viewer's local time
  function fmtTs(v) {
    if (!v) return "";
    const d = new Date(String(v).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? "" : "Z"));
    if (isNaN(d)) return String(v);
    return d.toLocaleString((window.HHi18n && window.HHi18n.lang === "en") ? "en-GB" : "th-TH", { dateStyle: "medium", timeStyle: "short" });
  }

  function formatInt(n) {
    return Math.round(Number(n) || 0).toLocaleString("en-US");
  }

  function countUp(el, target, ms) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const to = Math.max(0, Number(target) || 0);
    if (reduce || to === 0) { el.textContent = formatInt(to); return; }
    const start = performance.now();
    const from = 0;
    function frame(now) {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = formatInt(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(frame);
      else el.textContent = formatInt(to);
    }
    requestAnimationFrame(frame);
  }

  async function loadStats() {
    const { data } = await api("/api/stats");
    if (!data.ok || !data.stats) return;
    const map = {
      users: data.stats.users,
      products: data.stats.products,
      stock: data.stats.stock,
      completed: data.stats.completed,
    };
    document.querySelectorAll(".stat-card").forEach((card) => {
      const key = card.getAttribute("data-stat");
      const el = card.querySelector(".stat-num");
      if (!el || map[key] == null) return;
      countUp(el, map[key], 1100);
    });
  }

  async function loadHome() {
    loadStats();
    const { data } = await api("/api/products?sort=newest");
    const list = (data.products || []).slice(0, 4);
    document.getElementById("home-products").innerHTML = list.map((p) => productCard(p)).join("") || "<p class='muted'>ยังไม่มีสินค้า</p>";
  }

  async function loadProducts() {
    const qs = new URLSearchParams();
    if (prodState.q) qs.set("q", prodState.q);
    if (prodState.category) qs.set("category", prodState.category);
    if (prodState.min !== "") qs.set("min", prodState.min);
    if (prodState.max !== "") qs.set("max", prodState.max);
    qs.set("sort", prodState.sort);
    const { data } = await api("/api/products?" + qs.toString());
    document.getElementById("catalog-products").innerHTML =
      (data.products || []).map((p) => productCard(p)).join("") || "<p class='muted'>ไม่พบสินค้า</p>";
    document.getElementById("prod-q").value = prodState.q;
    document.getElementById("prod-min").value = prodState.min;
    document.getElementById("prod-max").value = prodState.max;
    document.querySelectorAll(".sort-btn").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-sort") === prodState.sort ||
        (prodState.sort.startsWith("price") && b.id === "sort-price"));
    });
    const sp = document.getElementById("sort-price");
    sp.textContent = prodState.sort === "price_desc" ? "↑ ราคาสูง-ต่ำ" : "↓ ราคาต่ำ-สูง";
    sp.setAttribute("data-sort", prodState.sort.startsWith("price") ? prodState.sort : "price_asc");
  }

  async function loadShop() {
    await loadSiteConfig();
    document.getElementById("cat-list").innerHTML = configCats.map((c) => {
      const bg = c.image
        ? `background-image:linear-gradient(90deg,rgba(10,30,80,.72),rgba(10,30,80,.35)),url('${escapeHtml(c.image)}');background-size:cover;background-position:center`
        : "";
      return `<a class="cat-banner tone-${escapeHtml(c.tone || "blue")}" href="#/products" data-cat="${escapeHtml(c.id)}" style="${bg}">
        <div>
          <h3>${escapeHtml(c.title)}</h3>
          <p>${escapeHtml(c.subtitle || "")}</p>
        </div>
        <span class="click-pill">คลิกเลย!</span>
      </a>`;
    }).join("");
  }

  async function loadTopup() {
    const need = document.getElementById("topup-need-login");
    const form = document.getElementById("topup-form");
    if (!currentUser) {
      need.hidden = false;
      form.hidden = true;
      document.getElementById("topup-history").hidden = true;
      return;
    }
    need.hidden = true;
    form.hidden = false;
    const { data } = await api("/api/transactions");
    const rows = (data.transactions || []).filter((t) => t.type === "topup").slice(0, 8);
    const box = document.getElementById("topup-history");
    if (!rows.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = "<h4 style='margin:8px 0'>ประวัติเติมเครดิต</h4>" + rows.map((t) => `
      <div class="tx-item ${t.status === "success" ? "" : "fail"}">
        <div><div>${escapeHtml(t.message || t.status)}</div><small class="muted">${escapeHtml(fmtTs(t.created_at))}</small></div>
        <div class="amt">${t.status === "success" ? "+" + bahtShort(t.amount) : "ล้มเหลว"}</div>
      </div>`).join("");
  }

  async function loadAuctions() {
    const { data } = await api("/api/auctions");
    document.getElementById("auction-list").innerHTML = (data.auctions || []).map((a) => `
      <div class="auction-card info-card">
        <div class="auction-row">
          ${a.image
            ? `<div class="auction-thumb has-photo"><img src="${escapeHtml(a.image)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px" /></div>`
            : `<div class="auction-thumb abstract" style="background:linear-gradient(135deg,#1d4ed8,#60a5fa)">${ICO.gavel}</div>`}
          <div>
            <h3>${escapeHtml(a.title)}</h3>
            <p class="muted">${escapeHtml(a.description || "")}</p>
            <p class="cat-price">บิดปัจจุบัน: ${Number(a.current_bid).toFixed(2)} บาท</p>
            <p class="muted">ผู้บิดล่าสุด: ${escapeHtml(a.current_bidder || "-")}</p>
            ${a.example ? '<span class="badge-demo">ตัวอย่าง</span>' : ""}
          </div>
        </div>
        <form class="form bid-form" data-aid="${a.id}">
          <label>เสนอราคา (บาท)
            <input name="amount" type="number" min="${Number(a.current_bid) + 1}" step="1" required placeholder="มากกว่า ${a.current_bid}" />
          </label>
          <button class="btn-primary" type="submit">เสนอราคา</button>
        </form>
      </div>`).join("") || "<p class='muted'>ยังไม่มีรายการประมูล</p>";
  }

  async function showMinigameList() {
    document.getElementById("minigame-list").hidden = false;
    document.getElementById("minigame-play").hidden = true;
    const { data } = await api("/api/minigames");
    document.getElementById("minigame-list").innerHTML = (data.minigames || []).map((g) => `
      <a class="mg-card" href="#/minigame/${g.id}">
        ${g.image
          ? `<div class="mg-art has-photo"><img src="${escapeHtml(g.image)}" alt="" style="width:100%;height:100%;object-fit:cover" /></div>`
          : `<div class="mg-art abstract" style="background:linear-gradient(135deg,#059669,#34d399)">${ICO.gameBig}</div>`}
        <div class="mg-body">
          <h3>${escapeHtml(g.title)}</h3>
          <p class="cat-price">${Number(g.price).toFixed(2)} บาท / ครั้ง</p>
          ${g.example ? '<span class="badge-demo">ตัวอย่าง</span>' : ""}
        </div>
      </a>`).join("");
  }

  async function openMinigamePlay(id) {
    document.getElementById("minigame-list").hidden = true;
    const panel = document.getElementById("minigame-play");
    panel.hidden = false;
    document.getElementById("mg-result").hidden = true;
    document.getElementById("mg-error").hidden = true;
    const { data } = await api("/api/minigames/" + id);
    if (!data.ok) { toast(data.message || "ไม่พบมินิเกม", true); location.hash = "#/minigame"; return; }
    currentMinigame = data.minigame;
    document.getElementById("mg-play-title").textContent = data.minigame.title;
    document.getElementById("mg-play-price").textContent = Number(data.minigame.price).toFixed(2) + " บาท / ครั้ง";
    const art = document.getElementById("mg-play-art");
    if (data.minigame.image) {
      art.style.background = "none";
      art.innerHTML = `<img src="${escapeHtml(data.minigame.image)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px" />`;
    } else {
      art.style.background = "linear-gradient(135deg,#059669,#34d399)";
      art.innerHTML = ICO.gameBig;
    }
  }

  // Events
  document.addEventListener("click", async (e) => {
    const cat = e.target.closest("[data-cat]");
    if (cat) {
      e.preventDefault();
      prodState.category = cat.getAttribute("data-cat");
      prodState._fromFilter = true;
      location.hash = "#/products";
      return;
    }

    const buyBtn = e.target.closest("[data-buy]");
    if (buyBtn) {
      const id = buyBtn.getAttribute("data-buy");
      if (!currentUser) { toast(T("need_login_buy"), true); openAuth("login"); return; }
      // two-tap confirm; price shown on the card is sent so the server can refuse if it changed
      if (buyBtn.dataset.armed !== "1") {
        buyBtn.dataset.armed = "1"; buyBtn.dataset.old = buyBtn.textContent;
        buyBtn.textContent = T("buy_confirm"); buyBtn.classList.add("armed");
        setTimeout(() => { if (buyBtn.dataset.armed === "1") { delete buyBtn.dataset.armed; buyBtn.textContent = buyBtn.dataset.old; buyBtn.classList.remove("armed"); } }, 4000);
        return;
      }
      delete buyBtn.dataset.armed; buyBtn.classList.remove("armed"); buyBtn.textContent = buyBtn.dataset.old;
      const card = buyBtn.closest("[data-price]");
      buyBtn.disabled = true;
      const key = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, "");
      let out;
      try {
        out = await api("/api/products/" + id + "/buy", {
          method: "POST", headers: { "Idempotency-Key": key },
          body: JSON.stringify({ quantity: 1, expected_price: card ? Number(card.getAttribute("data-price")) : undefined }),
        });
      } catch (_) { buyBtn.disabled = false; toast(T("net_fail"), true); return; }
      buyBtn.disabled = false;
      const { res, data } = out;
      if (!res.ok || !data.ok) {
        toast(data.message || "ซื้อไม่สำเร็จ", true);
        if (data.error === "EMAIL_UNVERIFIED") location.hash = "#/auth";
        if (data.error === "PRICE_CHANGED") { if (!document.getElementById("view-products").hidden) loadProducts(); else loadHome(); }
        return;
      }
      currentUser = data.user;
      updateChrome();
      toast(T("buy_ok"));
      if (data.order) showSecret(data.order);
      if (!document.getElementById("view-products").hidden) loadProducts();
      if (!document.getElementById("view-home").hidden) loadHome();
      return;
    }

    const sortBtn = e.target.closest(".sort-btn");
    if (sortBtn) {
      let s = sortBtn.getAttribute("data-sort");
      if (sortBtn.id === "sort-price") {
        if (prodState.sort === "price_asc") s = "price_desc";
        else s = "price_asc";
      }
      prodState.sort = s;
      loadProducts();
      return;
    }

  });

  document.getElementById("prod-search").addEventListener("click", () => {
    prodState.q = document.getElementById("prod-q").value.trim();
    prodState.min = document.getElementById("prod-min").value;
    prodState.max = document.getElementById("prod-max").value;
    loadProducts();
  });

  document.getElementById("topup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("topup-error");
    const ok = document.getElementById("topup-success");
    const btn = document.getElementById("topup-submit");
    err.hidden = true; ok.hidden = true;
    btn.disabled = true; btn.textContent = "กำลังตรวจสอบ...";
    try {
      const { res, data } = await api("/api/topup", {
        method: "POST",
        body: JSON.stringify({ link: document.getElementById("topup-link").value.trim() }),
      });
      if (!res.ok || !data.ok) { err.textContent = data.message || "เติมไม่สำเร็จ"; err.hidden = false; if (data.error === "EMAIL_UNVERIFIED") updateChrome(); }
      else {
        ok.textContent = data.message; ok.hidden = false;
        currentUser = data.user; updateChrome();
        document.getElementById("topup-link").value = "";
        loadTopup();
      }
    } catch { err.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ"; err.hidden = false; }
    finally { btn.disabled = false; btn.textContent = "เติมเครดิตเลย"; }
  });

  document.getElementById("auction-list").addEventListener("submit", async (e) => {
    const form = e.target.closest(".bid-form");
    if (!form) return;
    e.preventDefault();
    if (!currentUser) { toast("กรุณาเข้าสู่ระบบก่อนประมูล", true); openAuth("login"); return; }
    const amount = Number(new FormData(form).get("amount"));
    const { res, data } = await api("/api/auctions/" + form.getAttribute("data-aid") + "/bid", {
      method: "POST",
      body: JSON.stringify({ amount }),
    });
    if (!res.ok || !data.ok) { toast(data.message || "ประมูลไม่สำเร็จ", true); return; }
    currentUser = data.user || currentUser;
    updateChrome();
    toast(data.message || "เสนอราคาสำเร็จ");
    loadAuctions();
  });

  document.getElementById("mg-back").addEventListener("click", () => { location.hash = "#/minigame"; });
  document.getElementById("mg-play-btn").addEventListener("click", async () => {
    if (!currentUser) { toast("กรุณาเข้าสู่ระบบก่อนเล่น", true); openAuth("login"); return; }
    if (!currentMinigame) return;
    const err = document.getElementById("mg-error");
    const result = document.getElementById("mg-result");
    err.hidden = true;
    result.hidden = false;
    document.getElementById("mg-spin").classList.add("spinning");
    document.getElementById("mg-prize").textContent = "กำลังสุ่ม...";
    const { res, data } = await api("/api/minigames/" + currentMinigame.id + "/play", { method: "POST", body: "{}" });
    setTimeout(() => {
      document.getElementById("mg-spin").classList.remove("spinning");
      if (!res.ok || !data.ok) {
        result.hidden = true;
        err.textContent = data.message || "เล่นไม่สำเร็จ";
        err.hidden = false;
        return;
      }
      currentUser = data.user;
      updateChrome();
      document.getElementById("mg-prize").textContent = data.prize;
      toast("สุ่มได้: " + data.prize);
    }, 900);
  });

  /* —— Auth modal / captcha / profile menu (v3) —— */
  let authCfg = { discord: false, google: false, emailReset: false, verificationRequired: false };
  let captchaCfg = { type: "builtin" };
  let tsLoading = null;

  function avatarHtml(u) {
    const ch = (u && u.username ? u.username[0] : "?").toUpperCase();
    return escapeHtml(ch);
  }

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    if (tsLoading) return tsLoading;
    tsLoading = new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true; s.onload = () => ok(); s.onerror = () => { tsLoading = null; bad(new Error("turnstile")); };
      document.head.appendChild(s);
    });
    return tsLoading;
  }

  // Render (or refresh) the captcha inside a form. Built-in = server SVG bound to this session, single use.
  async function renderCaptcha(form) {
    const box = form && form.querySelector("[data-captcha]");
    if (!box) return;
    if (captchaCfg.type === "turnstile" && captchaCfg.siteKey) {
      try {
        await loadTurnstile();
        if (box.dataset.wid) { window.turnstile.reset(box.dataset.wid); return; }
        box.innerHTML = '<div class="ts-slot"></div>';
        box.dataset.wid = window.turnstile.render(box.firstChild, {
          sitekey: captchaCfg.siteKey, theme: "dark",
          language: (window.HHi18n && window.HHi18n.lang === "en") ? "en" : "th",
          callback: (t) => { box.dataset.token = t; },
          "expired-callback": () => { box.dataset.token = ""; },
        });
      } catch (_) { box.innerHTML = `<p class="form-error">${escapeHtml(T("captcha_load_fail"))}</p>`; }
      return;
    }
    if (!box.firstChild) {
      box.innerHTML = `<span class="cap-label">${escapeHtml(T("captcha"))}</span>
        <div class="cap-row"><img class="cap-img" alt="captcha" width="150" height="50" />
        <button type="button" class="cap-refresh" aria-label="refresh"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg></button>
        <input class="cap-input" name="captcha" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" required placeholder="${escapeHtml(T("captcha_ph"))}" /></div>`;
      box.querySelector(".cap-refresh").addEventListener("click", () => renderCaptcha(form));
    }
    await ensureCsrf(); // session must exist before the challenge is bound to it
    box.querySelector(".cap-img").src = "/api/captcha.svg?t=" + Date.now() + Math.random().toString(36).slice(2, 6);
    box.querySelector(".cap-input").value = "";
  }
  function captchaValue(form) {
    const box = form.querySelector("[data-captcha]");
    if (!box) return "";
    if (captchaCfg.type === "turnstile") return box.dataset.token || "";
    return (box.querySelector(".cap-input")?.value || "").trim();
  }

  const modal = document.getElementById("auth-modal");
  let lastFocus = null;
  function showPane(name) {
    modal.querySelectorAll(".mpane").forEach((p) => { p.hidden = p.getAttribute("data-pane") !== name; });
    const tabs = modal.querySelector(".modal-tabs");
    tabs.hidden = !(name === "login" || name === "signup");
    modal.querySelectorAll(".modal-tab").forEach((t) => t.classList.toggle("active", t.getAttribute("data-mtab") === name));
    const pane = modal.querySelector(`.mpane[data-pane="${name}"]`);
    pane.querySelectorAll(".form-error,.ok").forEach((el) => { el.hidden = true; });
    if (name === "forgot") {
      const off = !authCfg.emailReset;
      document.getElementById("forgot-off").hidden = !off;
      document.getElementById("forgot-form").hidden = off;
    }
    const form = pane.querySelector("form");
    if (form && !form.hidden) renderCaptcha(form);
    const first = pane.querySelector("input:not([type=checkbox])");
    if (first && window.matchMedia("(pointer:fine)").matches) setTimeout(() => first.focus(), 30);
  }
  function openAuth(pane) {
    closeMenu();
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    showPane(pane || "login");
  }
  function closeModal(m) {
    (m || modal).hidden = true;
    if (document.querySelectorAll(".hh-modal:not([hidden])").length === 0) document.body.classList.remove("modal-open");
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (_) {}
  }
  function showMessage(ok, text) {
    showPane("message");
    document.getElementById("msg-icon").className = "msg-icon " + (ok ? "good" : "bad");
    document.getElementById("msg-icon").textContent = ok ? "✓" : "!";
    document.getElementById("msg-text").textContent = text;
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".hh-modal:not([hidden])").forEach((m) => closeModal(m));
      closeMenu();
    }
  });
  document.querySelectorAll(".hh-modal").forEach((m) => {
    m.addEventListener("click", (e) => {
      if (e.target === m || e.target.closest("[data-close-modal]")) closeModal(m);
    });
  });
  modal.addEventListener("click", (e) => {
    const t = e.target.closest("[data-mtab]");
    if (t) { showPane(t.getAttribute("data-mtab")); return; }
    const g = e.target.closest("[data-goto-pane]");
    if (g) showPane(g.getAttribute("data-goto-pane"));
  });
  document.addEventListener("click", (e) => {
    const o = e.target.closest("[data-open-auth]");
    if (o) { e.preventDefault(); openAuth(o.getAttribute("data-open-auth")); }
  });

  // Profile dropdown
  const menu = document.getElementById("profile-menu");
  function openMenu(anchor) {
    if (!currentUser) { openAuth("login"); return; }
    fillMenu();
    menu.hidden = false;
    menu.classList.toggle("from-bottom", anchor && anchor.id === "nav-wallet");
    refreshMe().then(fillMenu);
  }
  function closeMenu() { if (menu) menu.hidden = true; }
  function fillMenu() {
    if (!currentUser) return;
    document.getElementById("avatar-menu").innerHTML = avatarHtml(currentUser);
    document.getElementById("pm-username").textContent = currentUser.username;
    document.getElementById("pm-email").textContent = currentUser.email || (currentUser.discord ? "Discord" : currentUser.google ? "Google" : "");
    document.getElementById("pm-balance").textContent = baht(currentUser.balance);
    document.getElementById("pm-points").textContent = formatInt(currentUser.points || 0) + " " + T("points_unit");
    document.getElementById("pm-admin").hidden = !currentUser.isAdmin;
  }
  ["avatar-btn", "nav-wallet"].forEach((id) => {
    document.getElementById(id).addEventListener("click", (e) => {
      e.stopPropagation();
      if (!menu.hidden) closeMenu(); else openMenu(e.currentTarget);
    });
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !e.target.closest("#profile-menu")) closeMenu();
    else if (e.target.closest("#profile-menu a")) closeMenu();
  });

  async function submitAuth(form, errId, path, body) {
    const err = document.getElementById(errId);
    err.hidden = true;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const { res, data } = await api(path, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok || !data.ok) {
        err.textContent = data.message || T("failed"); err.hidden = false;
        if (data.error === "RESET_UNAVAILABLE") { authCfg.emailReset = false; showPane("forgot"); }
        else renderCaptcha(form); // every challenge is single use
        return null;
      }
      return data;
    } catch (_) { err.textContent = T("net_fail"); err.hidden = false; renderCaptcha(form); return null; }
    finally { btn.disabled = false; }
  }

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, fd = new FormData(f);
    if (!String(fd.get("identifier") || "").trim() || !fd.get("password")) {
      const err = document.getElementById("login-error"); err.textContent = T("fill_all"); err.hidden = false; return;
    }
    const data = await submitAuth(f, "login-error", "/api/login", {
      identifier: String(fd.get("identifier")).trim(), password: fd.get("password"), captcha: captchaValue(f),
    });
    if (!data) return;
    currentUser = data.user; f.reset(); closeModal(); updateChrome(); toast(T("login_ok"));
    route();
  });

  document.getElementById("signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, fd = new FormData(f);
    const err = document.getElementById("signup-error");
    if (!f.terms.checked) { err.textContent = T("must_accept"); err.hidden = false; return; }
    if (!f.checkValidity()) { err.textContent = T("check_fields"); err.hidden = false; f.reportValidity(); return; }
    const data = await submitAuth(f, "signup-error", "/api/signup", {
      username: String(fd.get("username")).trim(), email: String(fd.get("email")).trim(),
      password: fd.get("password"), terms: true, captcha: captchaValue(f),
    });
    if (!data) return;
    currentUser = data.user; f.reset(); updateChrome();
    if (data.needsVerify) showMessage(true, data.mailSent ? T("signup_verify_sent") : T("signup_verify_fail"));
    else { closeModal(); toast(T("signup_ok")); route(); }
  });

  document.getElementById("forgot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const data = await submitAuth(f, "forgot-error", "/api/password/forgot", {
      email: String(new FormData(f).get("email") || "").trim(), captcha: captchaValue(f),
    });
    if (!data) return;
    const ok = document.getElementById("forgot-ok"); ok.textContent = data.message || T("forgot_sent"); ok.hidden = false;
    renderCaptcha(f);
  });

  let resetToken = "";
  document.getElementById("reset-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, fd = new FormData(f);
    const err = document.getElementById("reset-error");
    if (fd.get("password") !== fd.get("password2")) { err.textContent = T("pw_mismatch"); err.hidden = false; return; }
    if (!resetToken) { err.textContent = T("reset_bad"); err.hidden = false; return; }
    const data = await submitAuth(f, "reset-error", "/api/password/reset", { token: resetToken, password: fd.get("password") });
    if (!data) return;
    resetToken = ""; f.reset();
    currentUser = null; updateChrome();
    showMessage(true, data.message || T("reset_done"));
  });

  document.querySelectorAll("[data-logout]").forEach((b) => b.addEventListener("click", async () => {
    closeMenu();
    await api("/api/logout", { method: "POST", body: "{}" });
    csrfToken = "";
    currentUser = null; updateChrome(); toast(T("logged_out"));
    if (["#/auth", "#/history", "#/orders", "#/admin"].includes(location.hash)) location.hash = "#/"; else route();
  }));
  modal.addEventListener("input", (e) => {
    const f = e.target.closest("form"); if (!f) return;
    f.querySelectorAll(".form-error").forEach((el) => { el.hidden = true; });
  });

  document.getElementById("resend-verify").addEventListener("click", async (e) => {
    e.target.disabled = true;
    const { data } = await api("/api/email/resend", { method: "POST", body: "{}" });
    e.target.disabled = false;
    toast(data.message || T("failed"), !data.ok);
  });

  document.getElementById("change-pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, fd = new FormData(f);
    const err = document.getElementById("change-pw-error"); err.hidden = true;
    const { res, data } = await api("/api/account/password", { method: "POST", body: JSON.stringify({ current: fd.get("current"), password: fd.get("password") }) });
    if (!res.ok || !data.ok) { err.textContent = data.message || T("failed"); err.hidden = false; return; }
    f.reset(); toast(data.message);
  });

  function applyAuthCfg() {
    const any = !!(authCfg.discord || authCfg.google);
    document.querySelectorAll("[data-oauth]").forEach((el) => { el.hidden = !any; });
    document.querySelectorAll("[data-oauth-google]").forEach((el) => { el.hidden = !authCfg.google; });
    document.querySelectorAll("[data-oauth-discord]").forEach((el) => { el.hidden = !authCfg.discord; });
  }

  const AUTH_CODES = {
    discord_off: "e_discord_off", google_off: "e_google_off", oauth_cancel: "e_oauth_cancel",
    oauth_state: "e_oauth_state", oauth_fail: "e_oauth_fail", oauth_admin: "e_oauth_admin",
  };
  // Returns true when the hash was an auth action (handled in the modal).
  function handleAuthHash(page, q) {
    if (page === "auth" && (q.get("e") || q.get("ok"))) {
      const e = q.get("e"), ok = q.get("ok");
      history.replaceState(null, "", ok ? "#/" : "#/");
      if (e) { openAuth("login"); const err = document.getElementById("login-error"); err.textContent = T(AUTH_CODES[e] || "e_oauth_fail"); err.hidden = false; }
      if (ok) refreshMe().then(() => { toast(T("oauth_ok")); route(); });
      return true;
    }
    if (page === "reset" || page === "forgot") {
      if (page === "reset") {
        const tok = q.get("token") || "";
        if (tok) resetToken = tok;
        history.replaceState(null, "", "#/");
        openAuth(resetToken ? "reset" : "forgot");
      } else { history.replaceState(null, "", "#/"); openAuth("forgot"); }
      return true;
    }
    if (page === "verify") {
      const tok = q.get("token") || "";
      history.replaceState(null, "", "#/");
      openAuth("login");
      api("/api/email/verify", { method: "POST", body: JSON.stringify({ token: tok }) }).then(({ data }) => {
        showMessage(!!data.ok, data.message || T("failed"));
        if (data.ok) refreshMe();
        if (data.ok && currentUser) modal.querySelector('.mpane[data-pane="message"] .btn-primary').hidden = true;
      });
      return true;
    }
    return false;
  }

  async function loadAuth() {
    const profile = document.getElementById("auth-profile");
    const note = document.getElementById("auth-guest-note");
    if (!currentUser) { profile.hidden = true; note.hidden = false; openAuth("login"); return; }
    note.hidden = true; profile.hidden = false;
    await refreshMe();
    if (!currentUser) return loadAuth();
    document.getElementById("avatar-profile").innerHTML = avatarHtml(currentUser);
    document.getElementById("profile-username").textContent = currentUser.username;
    const tags = [currentUser.email || ""];
    if (currentUser.email) tags.push(currentUser.emailVerified ? T("verified") : T("unverified"));
    if (currentUser.discord) tags.push("Discord ✓");
    if (currentUser.google) tags.push("Google ✓");
    document.getElementById("profile-email").textContent = tags.filter(Boolean).join(" · ");
    document.getElementById("profile-balance").textContent = baht(currentUser.balance);
    document.getElementById("profile-points").textContent = formatInt(currentUser.points || 0);
    const ae = document.getElementById("admin-entry");
    if (ae) { ae.hidden = !currentUser.isAdmin; ae.style.display = currentUser.isAdmin ? "block" : "none"; }
  }

  const REASON = { topup: "r_topup", purchase: "r_purchase", minigame: "r_minigame", minigame_prize: "r_minigame_prize",
    admin_adjust: "r_admin", admin_bootstrap: "r_admin", opening_balance: "r_opening", refund: "r_refund" };
  async function loadHistory() {
    const box = document.getElementById("history-list");
    if (!currentUser) { box.innerHTML = ""; openAuth("login"); return; }
    const { data } = await api("/api/ledger");
    const rows = data.ledger || [];
    box.innerHTML = rows.length ? rows.map((r) => `<div class="tx-item ${r.delta < 0 ? "neg" : ""}">
        <div><div>${escapeHtml(T(REASON[r.reason] || "r_other"))}</div><small class="muted">${escapeHtml(fmtTs(r.created_at))}</small></div>
        <div class="amt">${r.delta >= 0 ? "+" : "−"}${escapeHtml(baht(Math.abs(r.delta)))}<small class="muted">${escapeHtml(T("bal_after"))} ${escapeHtml(baht(r.balance_after))}</small></div>
      </div>`).join("") : `<p class="muted">${escapeHtml(T("no_history"))}</p>`;
  }
  async function loadOrders() {
    const box = document.getElementById("orders-list");
    if (!currentUser) { box.innerHTML = ""; openAuth("login"); return; }
    const { data } = await api("/api/orders");
    const rows = data.orders || [];
    box.innerHTML = rows.length ? rows.map((o) => `<div class="tx-item">
        <div><div>${escapeHtml(o.product_title)}</div><small class="muted">#${o.id} · ${escapeHtml(fmtTs(o.created_at))}</small></div>
        <div class="amt">−${escapeHtml(baht(o.price))}${o.has_delivery ? `<button type="button" class="inline-btn" data-reveal="${o.id}">${escapeHtml(T("view_account"))}</button>` : ""}</div>
      </div>`).join("") : `<p class="muted">${escapeHtml(T("no_orders"))}</p>`;
  }
  function showSecret(order) {
    document.getElementById("secret-title").textContent = order.product_title + " #" + order.id;
    document.getElementById("secret-body").textContent = order.delivered || T("contact_admin_delivery");
    const m = document.getElementById("secret-modal");
    m.hidden = false; document.body.classList.add("modal-open");
  }
  document.getElementById("secret-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(document.getElementById("secret-body").textContent); toast(T("copied")); }
    catch (_) { const r = document.createRange(); r.selectNodeContents(document.getElementById("secret-body")); getSelection().removeAllRanges(); getSelection().addRange(r); }
  });
  document.getElementById("orders-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-reveal]");
    if (!b) return;
    const { data } = await api("/api/orders/" + b.getAttribute("data-reveal"));
    if (data.ok) showSecret(data.order); else toast(data.message || T("failed"), true);
  });

  async function loadSiteConfig() {
    const { data } = await api("/api/config");
    configCats = data.categories || [];
    if (data.auth) { authCfg = data.auth; applyAuthCfg(); }
    if (data.captcha) captchaCfg = data.captcha;
    const track = document.getElementById("announce-track");
    if (track && data.announcement) {
      const t = escapeHtml(data.announcement) + " · ";
      track.innerHTML = `<span>${t}</span><span>${t}</span>`;
    }
    const btn = document.getElementById("contact-btn");
    if (btn) {
      btn.textContent = data.contact_label || "ติดต่อแอดมิน";
      btn.href = data.contact_url || "#";
    }
  }


  /* Two-tap delete (window.confirm is blocked in some in-app browsers such as LINE/Facebook) */
  function armDelete(btn) {
    if (btn.dataset.armed === "1") { delete btn.dataset.armed; return true; }
    btn.dataset.armed = "1";
    const old = btn.textContent;
    btn.textContent = T("confirm_delete");
    btn.classList.add("armed");
    setTimeout(() => { if (btn.isConnected && btn.dataset.armed === "1") { delete btn.dataset.armed; btn.textContent = old; btn.classList.remove("armed"); } }, 3500);
    return false;
  }

  /* —— Admin panel —— */
  let adminTab = "dash";

  async function loadAdmin() {
    const gate = document.getElementById("admin-gate");
    const panel = document.getElementById("admin-panel");
    if (!currentUser || !currentUser.isAdmin) {
      gate.hidden = false;
      gate.textContent = "ไม่มีสิทธิ์เข้าหลังบ้าน — สำหรับแอดมินเท่านั้น";
      panel.hidden = true;
      return;
    }
    gate.hidden = true;
    panel.hidden = false;
    showAdminTab(adminTab);
  }

  function showAdminTab(name) {
    adminTab = name;
    document.querySelectorAll(".admin-tab").forEach((t) => t.classList.toggle("active", t.getAttribute("data-admin-tab") === name));
    document.querySelectorAll(".admin-section").forEach((s) => { s.hidden = true; });
    const el = document.getElementById("atab-" + name);
    if (el) el.hidden = false;
    if (name === "dash") renderAdminDash();
    if (name === "products") renderAdminProducts();
    if (name === "categories") renderAdminCategories();
    if (name === "minigames") renderAdminMinigames();
    if (name === "auctions") renderAdminAuctions();
    if (name === "settings") renderAdminSettings();
    if (name === "users") renderAdminUsers();
    if (name === "orders") renderAdminOrders();
    if (name === "ledger") renderAdminLedger();
    if (name === "cover") {
      document.getElementById("admin-cover-preview").src = "/img/cover.jpg?" + Date.now();
    }
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-admin-tab]");
    if (t) showAdminTab(t.getAttribute("data-admin-tab"));
  });

  async function renderAdminDash() {
    const { res, data } = await api("/api/admin/dashboard");
    const box = document.getElementById("atab-dash");
    if (!res.ok) { box.innerHTML = `<p class="form-error">${data.message || "403"}</p>`; return; }
    const s = data.stats;
    box.innerHTML = `<h4>ภาพรวมร้าน</h4>
      <div class="admin-stats">
        <div><strong>${s.users}</strong><span>สมาชิก</span></div>
        <div><strong>${s.products}</strong><span>สินค้า</span></div>
        <div><strong>${s.orders}</strong><span>ออเดอร์</span></div>
        <div><strong>${s.topups}</strong><span>เติมเงินสำเร็จ</span></div>
      </div>
      <p class="muted" style="margin-top:10px">แอดมินคนเดียว: ${escapeHtml(currentUser.username)}</p>`;
  }

  document.getElementById("admin-cover-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const hasFile = fd.get("image") && fd.get("image").size;
    if (!hasFile && !String(fd.get("image_url") || "").trim()) { toast("เลือกรูปหรือวางลิงก์รูปก่อน", true); return; }
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    let out; try { out = await apiForm("/api/admin/cover", { method: "POST", formData: fd }); } catch (_) { out = { res: { ok: false }, data: { message: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" } }; }
    btn.disabled = false;
    const { res, data } = out;
    if (!res.ok || !data.ok) { toast(data.message || "อัปโหลดไม่สำเร็จ", true); return; }
    e.target.reset(); e.target.querySelector(".img-preview")?.replaceChildren();
    toast(data.message);
    document.getElementById("admin-cover-preview").src = data.cover;
    document.querySelectorAll("img.hero-cover").forEach((img) => { img.src = data.cover; });
  });

  async function renderAdminProducts() {
    const box = document.getElementById("atab-products");
    const { data } = await api("/api/admin/products");
    const cats = configCats.length ? configCats : (await api("/api/config")).data.categories || [];
    const catOpts = cats.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`).join("");
    box.innerHTML = `
      <div class="info-card">
        <h4>เพิ่ม / แก้ไขสินค้า</h4>
        <form id="admin-product-form" class="form" enctype="multipart/form-data">
          <input type="hidden" name="id" value="" />
          <label>รหัส (SKU)<input name="sku" required placeholder="FF-1001" /></label>
          <label>ชื่อสินค้า<input name="title" required /></label>
          <label>รายละเอียด<textarea name="description" rows="2"></textarea></label>
          <label>หมวด<select name="category">${catOpts}</select></label>
          <label>ราคา<input name="price" type="number" step="0.01" required /></label>
          <label>คงเหลือ<input name="stock" type="number" value="1" required /></label>
          <label class="check"><input name="installment" type="checkbox" value="1" /> สินค้าผ่อนได้</label>
          <div class="img-current" id="admin-product-current" hidden></div>
          <label>รูปสินค้า — jpg / png / webp / gif (รูปจาก iPhone แปลงให้อัตโนมัติ)<input type="file" name="image" accept="image/*" data-image-input /></label>
          <label>หรือวางลิงก์รูป (https://)<input name="image_url" type="url" placeholder="https://..." /></label>
          <label class="check" id="admin-product-rm" hidden><input name="remove_image" type="checkbox" value="1" /> ลบรูปเดิม</label>
          <label>บัญชีที่จะส่งให้ผู้ซื้อ — 1 บรรทัด = 1 บัญชี (ใส่แล้วสต็อกนับตามจำนวนบรรทัด)
            <textarea name="items" rows="3" class="mono" placeholder="user01 | pass01 | email01&#10;user02 | pass02 | email02" autocomplete="off" spellcheck="false"></textarea></label>
          <label>ข้อความส่งมอบ (ใช้เมื่อไม่มีรายการบัญชีด้านบน)<textarea name="delivery_note" rows="2" placeholder="เช่น ทักแอดมินพร้อมเลขออเดอร์เพื่อรับไอดี"></textarea></label>
          <p class="form-error" id="admin-product-error" hidden></p>
          <button class="btn-primary" type="submit">บันทึกสินค้า</button>
          <button class="btn-ghost" type="button" id="admin-product-reset">ล้างฟอร์ม</button>
        </form>
      </div>
      <div class="info-card" style="margin-top:12px">
        <h4>รายการสินค้า</h4>
        <div class="admin-table">${(data.products||[]).map((p)=>`
          <div class="admin-row">
            ${p.image ? `<img class="admin-thumb" src="${escapeHtml(p.image)}" alt="" loading="lazy" />` : '<span class="admin-thumb none"></span>'}
            <div>
              <strong>${escapeHtml(p.sku)}</strong> · ${escapeHtml(p.title)}
              <div class="muted">${Number(p.price).toFixed(2)} บาท · คงเหลือ ${p.stock}${p.items_total ? ` · บัญชีพร้อมส่ง ${p.items_free}/${p.items_total}` : ''}</div>
            </div>
            <div class="admin-actions">
              <button type="button" data-edit-product='${escapeHtml(JSON.stringify(p))}'>แก้ไข</button>
              <button type="button" class="danger" data-del-product="${p.id}">ลบ</button>
            </div>
          </div>`).join("") || "<p class='muted'>ยังไม่มีสินค้า</p>"}
        </div>
      </div>`;
  }

  document.getElementById("atab-products").addEventListener("click", async (e) => {
    const del = e.target.closest("[data-del-product]");
    if (del) {
      if (!armDelete(del)) return;
      const { res, data } = await api("/api/admin/products/" + del.getAttribute("data-del-product"), { method: "DELETE" });
      if (!res.ok || !data.ok) { toast(data.message || "ลบสินค้าไม่สำเร็จ", true); renderAdminProducts(); return; }
      toast(data.message || "ลบแล้ว"); renderAdminProducts(); return;
    }
    const ed = e.target.closest("[data-edit-product]");
    if (ed) {
      const p = JSON.parse(ed.getAttribute("data-edit-product"));
      const f = document.getElementById("admin-product-form");
      f.id.value = p.id; f.sku.value = p.sku; f.title.value = p.title;
      f.description.value = p.description || ""; f.category.value = p.category;
      f.price.value = p.price; f.stock.value = p.stock; f.installment.checked = !!p.installment;
      f.delivery_note.value = p.delivery_note || ""; f.items.value = ""; f.image_url.value = ""; f.remove_image.checked = false;
      const cur = document.getElementById("admin-product-current");
      cur.hidden = !p.image; cur.innerHTML = p.image ? `<img src="${escapeHtml(p.image)}" alt="" /><small class="muted">รูปปัจจุบัน</small>` : "";
      document.getElementById("admin-product-rm").hidden = !p.image;
      f.querySelector(".img-preview")?.replaceChildren();
      document.getElementById("admin-product-error").hidden = true;
      f.scrollIntoView({ behavior: "smooth", block: "start" });
      toast("โหลดข้อมูลเพื่อแก้ไขแล้ว");
    }
  });

  document.getElementById("atab-products").addEventListener("submit", async (e) => {
    if (e.target.getAttribute("id") !== "admin-product-form") return;
    e.preventDefault();
    const f = e.target;
    const fd = new FormData(f);
    if (!f.installment.checked) fd.delete("installment"); else fd.set("installment", "1");
    const id = fd.get("id");
    fd.delete("id");
    if (!f.remove_image.checked) fd.delete("remove_image");
    const url = id ? "/api/admin/products/" + id : "/api/admin/products";
    const method = id ? "PUT" : "POST";
    const errBox = document.getElementById("admin-product-error"); errBox.hidden = true;
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "กำลังบันทึก...";
    let out;
    try { out = await apiForm(url, { method, formData: fd }); }
    catch (_) { out = { res: { ok: false }, data: { message: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" } }; }
    btn.disabled = false; btn.textContent = "บันทึกสินค้า";
    const { res, data } = out;
    if (!res.ok || !data.ok) { errBox.textContent = data.message || "บันทึกไม่สำเร็จ"; errBox.hidden = false; toast(data.message || "บันทึกไม่สำเร็จ", true); return; }
    toast(data.message || "บันทึกแล้ว");
    renderAdminProducts();
  });

  document.getElementById("atab-products").addEventListener("click", (e) => {
    if (e.target.id === "admin-product-reset") {
      const f = document.getElementById("admin-product-form");
      f.reset(); f.id.value = "";
      document.getElementById("admin-product-current").hidden = true;
      document.getElementById("admin-product-rm").hidden = true;
      document.getElementById("admin-product-error").hidden = true;
      f.querySelector(".img-preview")?.replaceChildren();
    }
  });

  async function renderAdminCategories() {
    const { data } = await api("/api/admin/categories");
    const box = document.getElementById("atab-categories");
    box.innerHTML = `<div class="info-card"><h4>หมวดหมู่</h4>
      <form id="admin-cat-form" class="form">
        <input type="hidden" name="edit_id" value="" />
        <label>รหัสหมวด (เช่น ffid)<input name="id" required /></label>
        <label>ชื่อ<input name="title" required /></label>
        <label>คำอธิบาย<input name="subtitle" /></label>
        <label>โทนสี<select name="tone"><option value="blue">blue</option><option value="dark">dark</option><option value="navy">navy</option><option value="purple">purple</option></select></label>
        <label>แบนเนอร์ (ถ้ามี)<input type="file" name="image" accept="image/*" data-image-input /></label>
        <button class="btn-primary" type="submit">บันทึกหมวด</button>
      </form></div>
      <div class="info-card" style="margin-top:12px">${(data.categories||[]).map(c=>`
        <div class="admin-row"><div><strong>${escapeHtml(c.id)}</strong> · ${escapeHtml(c.title)}
          <div class="muted">${escapeHtml(c.subtitle||"")}${c.image?" · มีรูป":""}</div></div>
          <div class="admin-actions">
            <button type="button" data-edit-cat='${escapeHtml(JSON.stringify(c))}'>แก้ไข</button>
            <button type="button" class="danger" data-del-cat="${escapeHtml(c.id)}">ลบ</button>
          </div></div>`).join("")}</div>`;
  }

  document.getElementById("atab-categories").addEventListener("click", async (e) => {
    const del = e.target.closest("[data-del-cat]");
    if (del) { if(!armDelete(del)) return; await api("/api/admin/categories/"+del.getAttribute("data-del-cat"),{method:"DELETE"}); toast("ลบแล้ว"); loadSiteConfig(); renderAdminCategories(); return; }
    const ed = e.target.closest("[data-edit-cat]");
    if (ed) {
      const c = JSON.parse(ed.getAttribute("data-edit-cat"));
      const f = document.getElementById("admin-cat-form");
      f.edit_id.value = c.id; f.id.value = c.id; f.id.readOnly = true;
      f.title.value = c.title; f.subtitle.value = c.subtitle||""; f.tone.value = c.tone||"blue";
    }
  });
  document.getElementById("atab-categories").addEventListener("submit", async (e) => {
    if (e.target.getAttribute("id") !== "admin-cat-form") return;
    e.preventDefault();
    const f = e.target; const fd = new FormData(f);
    const edit = fd.get("edit_id"); fd.delete("edit_id");
    const url = edit ? "/api/admin/categories/"+edit : "/api/admin/categories";
    const { res, data } = await apiForm(url, { method: edit?"PUT":"POST", formData: fd });
    if (!res.ok||!data.ok){ toast(data.message||"ไม่สำเร็จ",true); return; }
    toast("บันทึกหมวดแล้ว"); f.reset(); f.id.readOnly=false; f.edit_id.value="";
    await loadSiteConfig(); renderAdminCategories();
  });

  async function renderAdminMinigames() {
    const { data } = await api("/api/admin/minigames");
    const box = document.getElementById("atab-minigames");
    box.innerHTML = `<div class="info-card"><h4>มินิเกม</h4>
      <form id="admin-mg-form" class="form">
        <input type="hidden" name="id" />
        <label>ชื่อ<input name="title" required /></label>
        <label>slug<input name="slug" placeholder="skin-random" /></label>
        <label>คำอธิบาย<input name="subtitle" /></label>
        <label>ราคา / ครั้ง<input name="price" type="number" step="0.01" required /></label>
        <label>รางวัล (บรรทัดละ ชื่อ|น้ำหนัก)<textarea name="prizes" rows="4" placeholder="เกลือ|40\nรางวัลใหญ่|5"></textarea></label>
        <label>รูป (ถ้ามี)<input type="file" name="image" accept="image/*" data-image-input /></label>
        <button class="btn-primary" type="submit">บันทึกมินิเกม</button>
      </form></div>
      <div class="info-card" style="margin-top:12px">${(data.minigames||[]).map(g=>`
        <div class="admin-row"><div><strong>${escapeHtml(g.title)}</strong> · ${Number(g.price).toFixed(2)} บาท
          <div class="muted">${(g.prizes||[]).map(p=>escapeHtml(p.label)+'('+p.weight+')').join(', ')}</div></div>
          <div class="admin-actions">
            <button type="button" data-edit-mg='${escapeHtml(JSON.stringify(g))}'>แก้ไข</button>
            <button type="button" class="danger" data-del-mg="${g.id}">ลบ</button>
          </div></div>`).join("")}</div>`;
  }
  document.getElementById("atab-minigames").addEventListener("click", async (e) => {
    const del=e.target.closest("[data-del-mg]");
    if(del){ if(!armDelete(del)) return; const {res,data}=await api("/api/admin/minigames/"+del.getAttribute("data-del-mg"),{method:"DELETE"}); toast(data.message||(res.ok?"ลบแล้ว":"ลบไม่สำเร็จ"), !res.ok); renderAdminMinigames(); return; }
    const ed=e.target.closest("[data-edit-mg]");
    if(ed){ const g=JSON.parse(ed.getAttribute("data-edit-mg")); const f=document.getElementById("admin-mg-form");
      f.id.value=g.id; f.title.value=g.title; f.slug.value=g.slug; f.subtitle.value=g.subtitle||""; f.price.value=g.price;
      f.prizes.value=(g.prizes||[]).map(p=>`${p.label}|${p.weight}`).join("\n"); }
  });
  document.getElementById("atab-minigames").addEventListener("submit", async (e) => {
    if (e.target.getAttribute("id")!=="admin-mg-form") return; e.preventDefault();
    const f=e.target; const fd=new FormData(f); const id=fd.get("id"); fd.delete("id");
    const { res, data }=await apiForm(id?("/api/admin/minigames/"+id):"/api/admin/minigames",{method:id?"PUT":"POST",formData:fd}); if(!res.ok||!data.ok){toast(data.message||"ไม่สำเร็จ",true);return;}
    toast("บันทึกแล้ว"); f.reset(); renderAdminMinigames();
  });

  async function renderAdminAuctions() {
    const { data } = await api("/api/admin/auctions");
    const box = document.getElementById("atab-auctions");
    box.innerHTML = `<div class="info-card"><h4>ประมูล</h4>
      <form id="admin-auc-form" class="form">
        <input type="hidden" name="id" />
        <label>ชื่อรายการ<input name="title" required /></label>
        <label>รายละเอียด<textarea name="description" rows="2"></textarea></label>
        <label>ราคาเปิด<input name="start_price" type="number" step="0.01" required /></label>
        <label>หมดเขต (YYYY-MM-DD HH:MM)<input name="ends_at" placeholder="2026-12-31 23:59" /></label>
        <label>รูป (ถ้ามี)<input type="file" name="image" accept="image/*" data-image-input /></label>
        <button class="btn-primary" type="submit">บันทึกประมูล</button>
      </form></div>
      <div class="info-card" style="margin-top:12px">${(data.auctions||[]).map(a=>`
        <div class="admin-row"><div><strong>${escapeHtml(a.title)}</strong>
          <div class="muted">เปิด ${a.start_price} · ปัจจุบัน ${a.current_bid}${a.image?" · มีรูป":""}</div></div>
          <div class="admin-actions">
            <button type="button" data-edit-auc='${escapeHtml(JSON.stringify(a))}'>แก้ไข</button>
            <button type="button" class="danger" data-del-auc="${a.id}">ลบ</button>
          </div></div>`).join("")}</div>`;
  }
  document.getElementById("atab-auctions").addEventListener("click", async (e) => {
    const del=e.target.closest("[data-del-auc]");
    if(del){ if(!armDelete(del)) return; await api("/api/admin/auctions/"+del.getAttribute("data-del-auc"),{method:"DELETE"}); toast("ลบแล้ว"); renderAdminAuctions(); return; }
    const ed=e.target.closest("[data-edit-auc]");
    if(ed){ const a=JSON.parse(ed.getAttribute("data-edit-auc")); const f=document.getElementById("admin-auc-form");
      f.id.value=a.id; f.title.value=a.title; f.description.value=a.description||""; f.start_price.value=a.start_price; f.ends_at.value=a.ends_at||""; }
  });
  document.getElementById("atab-auctions").addEventListener("submit", async (e) => {
    if(e.target.getAttribute("id")!=="admin-auc-form") return; e.preventDefault();
    const f=e.target; const fd=new FormData(f); const id=fd.get("id"); fd.delete("id");
    const { res, data }=await apiForm(id?("/api/admin/auctions/"+id):"/api/admin/auctions",{method:id?"PUT":"POST",formData:fd}); if(!res.ok||!data.ok){toast(data.message||"ไม่สำเร็จ",true);return;}
    toast("บันทึกแล้ว"); f.reset(); renderAdminAuctions();
  });

  async function renderAdminSettings() {
    const { data } = await api("/api/admin/dashboard");
    const f = document.getElementById("admin-settings-form");
    f.announcement.value = data.settings?.announcement || "";
    f.contact_url.value = data.settings?.contact_url || "";
    f.contact_label.value = data.settings?.contact_label || "";
    const { data: dg } = await api("/api/admin/diag");
    const d = dg.diag || {};
    const yn = (v) => (v ? "✅" : "❌");
    document.getElementById("admin-diag").textContent = [
      `อีเมล (SMTP): ${yn(d.smtp)}   ลิงก์เว็บ: ${d.publicBase || "-"}`,
      `Captcha: ${d.turnstile ? "Cloudflare Turnstile" : "ในตัว (SVG)"}   Google: ${yn(d.google)}   Discord: ${yn(d.discord)}`,
      `ย่อรูป (sharp): ${yn(d.sharp)}   HTTPS: ${yn(d.secure)}   IP ของคุณ: ${d.clientIp || "-"}`,
      `บัญชีเงินไม่ตรง: ${d.ledgerMismatches ?? "-"}   Node ${d.node || ""}`,
    ].join("\n");
  }
  document.getElementById("admin-mail-test")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button"); btn.disabled = true;
    const { data } = await api("/api/admin/mail-test", { method: "POST", body: JSON.stringify({ to: new FormData(e.target).get("to") }) });
    btn.disabled = false;
    toast(data.message || "ไม่สำเร็จ", !data.ok);
  });
  document.getElementById("admin-settings-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    const { res, data } = await api("/api/admin/settings", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok || !data.ok) { toast(data.message || "ไม่สำเร็จ", true); return; }
    toast("บันทึกตั้งค่าแล้ว");
    await loadSiteConfig();
  });

  async function renderAdminUsers() {
    const { data } = await api("/api/admin/users");
    document.getElementById("atab-users").innerHTML = `<div class="info-card"><h4>สมาชิก</h4>
      ${(data.users||[]).map(u=>`
        <div class="admin-row">
          <div><strong>${escapeHtml(u.username)}</strong> ${u.role==="admin"?'<span class="badge-demo">admin</span>':''}
            <div class="muted">${u.email?escapeHtml(u.email)+(u.email_verified?" ✓":" (ยังไม่ยืนยัน)")+" · ":""}${u.discord?"Discord · ":""}${u.google?"Google · ":""}เครดิต ${Number(u.balance).toFixed(2)} · แต้ม ${u.points||0} · ${escapeHtml(u.created_at||"")}</div></div>
          ${u.role!=="admin" && u.email && !u.email_verified ? `<button type="button" class="inline-btn" data-verify-user="${u.id}">ยืนยันอีเมลให้</button>` : ""}
          <button type="button" class="inline-btn" data-user-ledger="${u.id}">ดูบัญชีเงิน</button>
          <form class="credit-form" data-uid="${u.id}">
            <input name="amount" type="number" step="0.01" placeholder="จำนวน" required style="width:90px" />
            <select name="mode"><option value="add">บวก/ลบ</option><option value="set">ตั้งค่า</option></select>
            <input name="note" maxlength="120" placeholder="เหตุผล" style="width:110px" />
            <button type="submit">ปรับ</button>
          </form>
          ${u.role==="admin"?"":`<form class="credit-form pw-form" data-uid="${u.id}">
            <input name="password" type="text" minlength="8" maxlength="72" placeholder="รหัสผ่านใหม่ (8+)" autocomplete="off" required />
            <button type="submit">ตั้งรหัสใหม่</button>
          </form>`}
        </div>`).join("")}</div>`;
  }
  document.getElementById("atab-users").addEventListener("submit", async (e) => {
    const pwf = e.target.closest(".pw-form");
    if (pwf) {
      e.preventDefault();
      const { res, data } = await api("/api/admin/users/"+pwf.getAttribute("data-uid")+"/password", {
        method: "POST", body: JSON.stringify({ password: new FormData(pwf).get("password") })
      });
      toast(data.message || (res.ok ? "สำเร็จ" : "ไม่สำเร็จ"), !res.ok || !data.ok);
      if (res.ok && data.ok) pwf.reset();
      return;
    }
    const form = e.target.closest(".credit-form"); if (!form) return;
    e.preventDefault();
    const fd = new FormData(form);
    const { res, data } = await api("/api/admin/users/"+form.getAttribute("data-uid")+"/credit", {
      method: "POST", body: JSON.stringify({ amount: Number(fd.get("amount")), mode: fd.get("mode"), note: fd.get("note") || "" })
    });
    if (!res.ok||!data.ok){ toast(data.message||"ไม่สำเร็จ", true); return; }
    toast("ปรับเครดิตแล้ว"); renderAdminUsers();
  });

  document.getElementById("atab-users").addEventListener("click", async (e) => {
    const v = e.target.closest("[data-verify-user]");
    if (v) {
      const { data } = await api("/api/admin/users/" + v.getAttribute("data-verify-user") + "/verify", { method: "POST", body: "{}" });
      toast(data.message || "ไม่สำเร็จ", !data.ok); renderAdminUsers(); return;
    }
    const l = e.target.closest("[data-user-ledger]");
    if (l) { ledgerUser = l.getAttribute("data-user-ledger"); showAdminTab("ledger"); }
  });

  let ledgerUser = "";
  async function renderAdminLedger() {
    const box = document.getElementById("atab-ledger");
    const { data } = await api("/api/admin/ledger" + (ledgerUser ? "?user=" + encodeURIComponent(ledgerUser) : ""));
    const mm = data.mismatches || [];
    box.innerHTML = `<div class="info-card">
      <h4>บัญชีเงิน (ledger) ${ledgerUser ? `· สมาชิก #${escapeHtml(ledgerUser)} <button type="button" class="inline-btn" data-ledger-all>ดูทั้งหมด</button>` : "· 200 รายการล่าสุด"}</h4>
      <p class="${mm.length ? "form-error" : "ok"}">${mm.length ? `⚠ ยอดเงินไม่ตรงกับบัญชี ${mm.length} บัญชี: ` + mm.map((m) => escapeHtml(m.username || ("#" + m.id))).join(", ") : "✓ ยอดเงินทุกบัญชีตรงกับประวัติการเงิน"}</p>
      <div class="admin-table">${(data.ledger || []).map((r) => `
        <div class="admin-row ledger-row">
          <div><strong>${escapeHtml(r.username)}</strong> · ${escapeHtml(r.reason)}${r.ref ? ` · <span class="mono">${escapeHtml(r.ref)}</span>` : ""}${r.admin_name ? ` · โดย ${escapeHtml(r.admin_name)}` : ""}
            <div class="muted">${escapeHtml(fmtTs(r.created_at))}</div></div>
          <div class="amt ${r.delta < 0 ? "neg" : "pos"}">${r.delta >= 0 ? "+" : ""}${Number(r.delta).toFixed(2)}<small class="muted">คงเหลือ ${Number(r.balance_after).toFixed(2)}</small></div>
        </div>`).join("") || "<p class='muted'>ยังไม่มีรายการ</p>"}</div></div>`;
  }
  document.getElementById("atab-ledger").addEventListener("click", (e) => {
    if (e.target.closest("[data-ledger-all]")) { ledgerUser = ""; renderAdminLedger(); }
  });

  async function renderAdminOrders() {
    const [{ data: o }, { data: t }] = await Promise.all([api("/api/admin/orders"), api("/api/admin/topups")]);
    document.getElementById("atab-orders").innerHTML = `
      <div class="info-card"><h4>ออเดอร์ล่าสุด</h4>
        ${(o.orders||[]).slice(0,30).map(x=>`<div class="tx-item"><div><div>${escapeHtml(x.product_title)}</div><small class="muted">${escapeHtml(x.username)} · ${x.created_at}</small></div><div class="amt">${Number(x.price).toFixed(2)}</div></div>`).join("")||"<p class='muted'>—</p>"}
      </div>
      <div class="info-card" style="margin-top:12px"><h4>เติมเครดิต</h4>
        ${(t.topups||[]).slice(0,30).map(x=>`<div class="tx-item ${x.status==="success"?"":"fail"}"><div><div>${escapeHtml(x.message||x.status)}</div><small class="muted">${escapeHtml(x.username)} · ${x.created_at}</small></div><div class="amt">${x.status==="success"?"+"+Number(x.amount).toFixed(2):x.status}</div></div>`).join("")||"<p class='muted'>—</p>"}
      </div>`;
  }



  /* Lightweight particle field */
  (function initFx() {
    const canvas = document.getElementById("fx-canvas");
    if (!canvas) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) { canvas.style.display = "none"; return; }
    const ctx = canvas.getContext("2d");
    let w = 0, h = 0, particles = [], raf = 0;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(36, Math.floor((w * h) / 28000));
      particles = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.6 + Math.random() * 1.6,
        vx: (Math.random() - 0.5) * 0.25,
        vy: -0.15 - Math.random() * 0.35,
        a: 0.15 + Math.random() * 0.35,
      }));
    }
    function tick() {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.y < -4) { p.y = h + 4; p.x = Math.random() * w; }
        if (p.x < -4) p.x = w + 4;
        if (p.x > w + 4) p.x = -4;
        ctx.beginPath();
        ctx.fillStyle = `rgba(255, 255, 255, ${p.a * 0.7})`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    }
    resize();
    tick();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else tick();
    });
  })();

  window.addEventListener("hashchange", route);
  ensureCsrf().then(() => refreshMe()).then(async () => { await loadSiteConfig(); route(); });
})();
