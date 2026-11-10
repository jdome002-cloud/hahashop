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
      data = { ok: false, message: "อัปโหลดไม่สำเร็จ (ตอบกลับไม่ใช่ JSON)" };
    }
    if (data && data.csrfToken) csrfToken = data.csrfToken;
    return { res, data };
  }

  const T = (k) => (window.HHi18n ? window.HHi18n.t(k) : k);
  document.addEventListener("hh:lang", () => {
    updateChrome();
    if (!document.getElementById("view-auth").hidden) loadAuth();
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
    const pill = document.getElementById("balance-pill");
    const bal = document.getElementById("balance-value");
    const navLabel = document.getElementById("nav-auth-label");
    const adminEntry = document.getElementById("admin-entry");
    document.body.classList.toggle("logged-in", !!currentUser);
    if (currentUser) {
      pill.hidden = false;
      bal.textContent = bahtShort(currentUser.balance);
      navLabel.textContent = currentUser.username;
      if (adminEntry) {
        const show = !!currentUser.isAdmin;
        adminEntry.hidden = !show;
        adminEntry.style.display = show ? "block" : "none";
      }
    } else {
      pill.hidden = true;
      navLabel.textContent = T("login");
      if (adminEntry) { adminEntry.hidden = true; adminEntry.style.display = "none"; }
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

    document.querySelectorAll(".page-view").forEach((v) => { v.hidden = true; });
    const map = {
      home: "view-home",
      products: "view-products",
      shop: "view-shop",
      topup: "view-topup",
      auction: "view-auction",
      minigame: "view-minigame",
      auth: "view-auth",
      forgot: "view-forgot",
      reset: "view-reset",
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
        (tab === "auth" && (page === "forgot" || page === "reset"));
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
    } else if (page === "auth") { loadAuth(); handleAuthQuery(hashQuery); }
    else if (page === "forgot") loadForgot();
    else if (page === "reset") loadReset(hashQuery);
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
    return `<article class="cat-card" data-pid="${p.id}">
      ${thumb}
      <div class="cat-body">
        <h3>${escapeHtml(p.title)}</h3>
        <p class="cat-price">${Number(p.price).toFixed(2)} บาท</p>
        ${buy ? `<button type="button" class="btn-buy-full" data-buy="${p.id}">ซื้อสินค้านี้</button>` : ""}
        <p class="stock">${ICO.package} คงเหลือ ${p.stock}</p>
      </div>
    </article>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
        <div><div>${escapeHtml(t.message || t.status)}</div><small class="muted">${t.created_at || ""}</small></div>
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

  async function loadAuth() {
    const guest = document.getElementById("auth-guest");
    const profile = document.getElementById("auth-profile");
    const title = document.getElementById("auth-page-title");
    if (!currentUser) {
      guest.hidden = false;
      profile.hidden = true;
      title.innerHTML = escapeHtml(T("login")) + ' <span>LOGIN</span>';
      return;
    }
    guest.hidden = true;
    profile.hidden = false;
    title.innerHTML = escapeHtml(T("account")) + ' <span>PROFILE</span>';
    document.getElementById("profile-username").textContent = currentUser.username;
    document.getElementById("profile-email").textContent =
      (currentUser.email || "") + (currentUser.discord ? (currentUser.email ? " · " : "") + "Discord ✓" : "");
    document.getElementById("profile-balance").textContent = bahtShort(currentUser.balance);

    const [{ data: od }, { data: tx }] = await Promise.all([
      api("/api/orders"),
      api("/api/transactions"),
    ]);
    const ph = document.getElementById("purchase-history");
    ph.innerHTML = (od.orders || []).length
      ? od.orders.map((o) => `<div class="tx-item"><div><div>${escapeHtml(o.product_title)}</div><small class="muted">${o.created_at}</small></div><div class="amt">-${bahtShort(o.price)}</div></div>`).join("")
      : "<p class='muted'>ยังไม่มีประวัติการซื้อ</p>";
    const th = document.getElementById("profile-topup-history");
    const tops = (tx.transactions || []).filter((t) => t.type === "topup");
    th.innerHTML = tops.length
      ? tops.map((t) => `<div class="tx-item ${t.status === "success" ? "" : "fail"}"><div><div>${escapeHtml(t.message || "")}</div><small class="muted">${t.created_at}</small></div><div class="amt">${t.status === "success" ? "+" + bahtShort(t.amount) : "ล้มเหลว"}</div></div>`).join("")
      : "<p class='muted'>ยังไม่มีประวัติเติมเครดิต</p>";
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
      if (!currentUser) { toast("กรุณาเข้าสู่ระบบก่อนซื้อ", true); location.hash = "#/auth"; return; }
      buyBtn.disabled = true;
      const { res, data } = await api("/api/products/" + id + "/buy", { method: "POST", body: "{}" });
      buyBtn.disabled = false;
      if (!res.ok || !data.ok) { toast(data.message || "ซื้อไม่สำเร็จ", true); return; }
      currentUser = data.user;
      updateChrome();
      toast(data.message || "ซื้อสำเร็จ");
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

    const tab = e.target.closest("[data-auth-tab]");
    if (tab) {
      const name = tab.getAttribute("data-auth-tab");
      document.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t === tab));
      document.getElementById("auth-login").hidden = name !== "login";
      document.getElementById("auth-signup").hidden = name !== "signup";
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
      if (!res.ok || !data.ok) { err.textContent = data.message || "เติมไม่สำเร็จ"; err.hidden = false; }
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
    if (!currentUser) { toast("กรุณาเข้าสู่ระบบก่อนประมูล", true); location.hash = "#/auth"; return; }
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
    if (!currentUser) { toast("กรุณาเข้าสู่ระบบก่อนเล่น", true); location.hash = "#/auth"; return; }
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

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("login-error");
    err.hidden = true;
    const fd = new FormData(e.target);
    const { res, data } = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ identifier: fd.get("identifier"), password: fd.get("password") }),
    });
    if (!res.ok || !data.ok) { err.textContent = data.message || "เข้าสู่ระบบไม่สำเร็จ"; err.hidden = false; return; }
    currentUser = data.user; updateChrome(); toast("เข้าสู่ระบบสำเร็จ"); loadAuth();
  });

  document.getElementById("signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("signup-error");
    err.hidden = true;
    const fd = new FormData(e.target);
    if (fd.get("password") !== fd.get("password2")) { err.textContent = T("pw_mismatch"); err.hidden = false; return; }
    const { res, data } = await api("/api/signup", {
      method: "POST",
      body: JSON.stringify({ username: fd.get("username"), email: fd.get("email"), password: fd.get("password") }),
    });
    if (!res.ok || !data.ok) { err.textContent = data.message || "สมัครไม่สำเร็จ"; err.hidden = false; return; }
    currentUser = data.user; updateChrome(); toast("สมัครสมาชิกสำเร็จ"); loadAuth();
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    currentUser = null; updateChrome(); toast("ออกจากระบบแล้ว"); loadAuth();
  });


  let authCfg = { discord: false, emailReset: false };
  function applyAuthCfg() {
    document.querySelectorAll("[data-oauth]").forEach((el) => { el.hidden = !authCfg.discord; });
  }

  const AUTH_CODES = {
    discord_off: "e_discord_off", discord_cancel: "e_discord_cancel", discord_state: "e_discord_state",
    discord_fail: "e_discord_fail", discord_admin: "e_discord_admin",
  };
  function handleAuthQuery(q) {
    const e = q.get("e"); const ok = q.get("ok");
    if (e && AUTH_CODES[e]) {
      document.querySelector('[data-auth-tab="login"]')?.click();
      const err = document.getElementById("login-error");
      err.textContent = T(AUTH_CODES[e]); err.hidden = false;
      toast(T(AUTH_CODES[e]), true);
    }
    if (ok === "discord") {
      refreshMe().then(() => { toast(T("discord_ok")); loadAuth(); });
    }
    if (e || ok) history.replaceState(null, "", "#/auth");
  }

  function loadForgot() {
    const off = !authCfg.emailReset;
    document.getElementById("forgot-off").hidden = !off;
    document.getElementById("forgot-form").hidden = off;
    document.getElementById("forgot-ok").hidden = true;
    document.getElementById("forgot-error").hidden = true;
  }
  document.getElementById("forgot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("forgot-error"); const ok = document.getElementById("forgot-ok");
    err.hidden = true; ok.hidden = true;
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    const { res, data } = await api("/api/password/forgot", {
      method: "POST", body: JSON.stringify({ email: new FormData(e.target).get("email") }),
    });
    btn.disabled = false;
    if (data.error === "RESET_UNAVAILABLE") { authCfg.emailReset = false; loadForgot(); return; }
    if (!res.ok || !data.ok) { err.textContent = data.message || T("failed"); err.hidden = false; return; }
    ok.textContent = T("forgot_sent"); ok.hidden = false;
  });

  let resetToken = "";
  function loadReset(q) {
    const tok = q.get("token") || "";
    if (tok) { resetToken = tok; history.replaceState(null, "", "#/reset"); }
    const err = document.getElementById("reset-error");
    document.getElementById("reset-ok").hidden = true;
    err.hidden = !!resetToken;
    if (!resetToken) err.textContent = T("reset_bad");
    document.getElementById("reset-form").hidden = false;
  }
  document.getElementById("reset-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("reset-error"); const ok = document.getElementById("reset-ok");
    err.hidden = true;
    const fd = new FormData(e.target);
    if (fd.get("password") !== fd.get("password2")) { err.textContent = T("pw_mismatch"); err.hidden = false; return; }
    if (!resetToken) { err.textContent = T("reset_bad"); err.hidden = false; return; }
    const { res, data } = await api("/api/password/reset", {
      method: "POST", body: JSON.stringify({ token: resetToken, password: fd.get("password") }),
    });
    if (!res.ok || !data.ok) { err.textContent = data.message || T("reset_bad"); err.hidden = false; return; }
    resetToken = ""; e.target.reset(); e.target.hidden = true;
    ok.textContent = T("reset_done"); ok.hidden = false;
    setTimeout(() => { location.hash = "#/auth"; }, 1800);
  });

  async function loadSiteConfig() {
    const { data } = await api("/api/config");
    configCats = data.categories || [];
    if (data.auth) { authCfg = data.auth; applyAuthCfg(); }
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
    const { res, data } = await apiForm("/api/admin/cover", { method: "POST", formData: fd });
    if (!res.ok || !data.ok) { toast(data.message || "อัปโหลดไม่สำเร็จ", true); return; }
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
          <label><input name="installment" type="checkbox" value="1" /> สินค้าผ่อนได้</label>
          <label>รูปสินค้า (ถ้ามี)<input type="file" name="image" accept="image/jpeg,image/png,image/webp" /></label>
          <button class="btn-primary" type="submit">บันทึกสินค้า</button>
          <button class="btn-ghost" type="button" id="admin-product-reset">ล้างฟอร์ม</button>
        </form>
      </div>
      <div class="info-card" style="margin-top:12px">
        <h4>รายการสินค้า</h4>
        <div class="admin-table">${(data.products||[]).map((p)=>`
          <div class="admin-row">
            <div>
              <strong>${escapeHtml(p.sku)}</strong> · ${escapeHtml(p.title)}
              <div class="muted">${Number(p.price).toFixed(2)} บาท · คงเหลือ ${p.stock}${p.image?' · มีรูป':''}</div>
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
    const url = id ? "/api/admin/products/" + id : "/api/admin/products";
    const method = id ? "PUT" : "POST";
    // fetch FormData — browser sets multipart
    const { res, data } = await apiForm(url, { method, formData: fd });
    if (!res.ok || !data.ok) { toast(data.message || "บันทึกไม่สำเร็จ", true); return; }
    toast(data.message || "บันทึกแล้ว");
    f.reset(); f.id.value = "";
    renderAdminProducts();
  });

  document.getElementById("atab-products").addEventListener("click", (e) => {
    if (e.target.id === "admin-product-reset") {
      const f = document.getElementById("admin-product-form");
      f.reset(); f.id.value = "";
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
        <label>แบนเนอร์ (ถ้ามี)<input type="file" name="image" accept="image/jpeg,image/png,image/webp" /></label>
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
        <label>รูป (ถ้ามี)<input type="file" name="image" accept="image/jpeg,image/png,image/webp" /></label>
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
        <label>รูป (ถ้ามี)<input type="file" name="image" accept="image/jpeg,image/png,image/webp" /></label>
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
  }
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
            <div class="muted">${u.email?escapeHtml(u.email)+" · ":""}${u.discord?"Discord · ":""}เครดิต ${Number(u.balance).toFixed(2)} · ${u.created_at||""}</div></div>
          <form class="credit-form" data-uid="${u.id}">
            <input name="amount" type="number" step="0.01" placeholder="จำนวน" required style="width:90px" />
            <select name="mode"><option value="set">ตั้งค่า</option><option value="add">บวก/ลบ</option></select>
            <button type="submit">ปรับ</button>
          </form>
          ${u.role==="admin"?"":`<form class="credit-form pw-form" data-uid="${u.id}">
            <input name="password" type="text" minlength="6" maxlength="72" placeholder="รหัสผ่านใหม่ (6+)" autocomplete="off" required />
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
      method: "POST", body: JSON.stringify({ amount: Number(fd.get("amount")), mode: fd.get("mode") })
    });
    if (!res.ok||!data.ok){ toast(data.message||"ไม่สำเร็จ", true); return; }
    toast("ปรับเครดิตแล้ว"); renderAdminUsers();
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
