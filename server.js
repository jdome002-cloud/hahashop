/**
 * HAHA SHOP — Express API + SPA static
 */
console.log(`[startup] HAHA SHOP booting: node ${process.version} ${process.platform}-${process.arch} pid=${process.pid}`);
{
  // better-sqlite3 v13 prebuilds require Node >= 22; on Node 20 `new Database()` segfaults (exit 139).
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) {
    console.error(`[startup] FATAL: Node ${process.version} is too old. HAHA SHOP requires Node 22.x (better-sqlite3 crashes on older Node).`);
    process.exit(1);
  }
}
const path = require("path");
const fs = require("fs");

(function loadEnv() {
  try {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch (_) {}
})();

console.log("[startup] env loaded (NODE_ENV=%s, PORT=%s)", process.env.NODE_ENV || "", process.env.PORT || "");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
console.log("[startup] opening database (better-sqlite3)...");
const { db, getSetting } = require("./lib/db");
console.log("[startup] database opened");
const { redeemVoucher, extractHash, THAI_ERRORS } = require("./lib/truemoney");
const { createAdminRouter } = require("./lib/admin-api");
const { UPLOAD_DIR } = require("./lib/upload");
const {
  clientIp,
  recordFailedLogin,
  clearFailedLogin,
  isLoginLocked,
  originOk,
  ensureCsrf,
  csrfOk,
} = require("./lib/security");
const { ensureAdmin } = require("./scripts/ensure-admin");
console.log("[startup] ensuring admin account...");
ensureAdmin();
console.log("[startup] admin ensured");

const PORT = Number(process.env.PORT || 8080);
const SESSION_SECRET = process.env.SESSION_SECRET || "haha-shop-dev-secret";
const TRUEMONEY_MOBILE = process.env.TRUEMONEY_MOBILE || "0624712534";
const ADMIN_IDLE_MS = 30 * 60 * 1000;

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.warn("[security] SESSION_SECRET should be a strong value in .env");
}

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })
);

app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));

app.use(
  session({
    name: "hahashop.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: "auto",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  validate: { keyGeneratorIpFallback: false },
  message: { ok: false, message: "พยายามบ่อยเกินไป กรุณารอสักครู่" },
});
const topupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  validate: { keyGeneratorIpFallback: false },
  message: { ok: false, message: "ส่งคำขอเติมเครดิตบ่อยเกินไป" },
});
const buyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  validate: { keyGeneratorIpFallback: false },
  message: { ok: false, message: "ส่งคำขอบ่อยเกินไป" },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  validate: { keyGeneratorIpFallback: false },
  message: { ok: false, message: "คำขอบ่อยเกินไป" },
});

app.use("/api/", apiLimiter);

// Origin + CSRF for mutating API requests
const CSRF_SKIP = new Set(["/csrf", "/health", "/healthz", "/api/csrf", "/api/health"]);
app.use("/api", (req, res, next) => {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (!originOk(req)) {
    return res.status(403).json({ ok: false, message: "คำขอไม่ถูกต้อง" });
  }
  const pth = req.path || "";
  if (CSRF_SKIP.has(pth) || CSRF_SKIP.has("/api" + pth)) return next();
  // Allow first login/signup only when session has no csrf yet (bootstrap)
  if ((pth === "/login" || pth === "/signup") && !req.session.csrfToken) {
    return next();
  }
  if (!csrfOk(req)) {
    return res.status(403).json({ ok: false, error: "CSRF", message: "เซสชันหมดอายุหรือโทเคนไม่ถูกต้อง กรุณารีเฟรชหน้า" });
  }
  next();
});

app.get("/api/csrf", (req, res) => {
  const token = ensureCsrf(req);
  res.json({ ok: true, csrfToken: token });
});

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    balance: Number(row.balance) || 0,
    role: row.role || "user",
    isAdmin: (row.role || "user") === "admin",
  };
}
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบก่อน" });
  }
  next();
}
function getUserById(id) {
  return db.prepare("SELECT id, username, balance, password_hash, role FROM users WHERE id = ?").get(id);
}

// Admin idle timeout
app.use((req, res, next) => {
  if (!req.session || !req.session.userId) return next();
  const now = Date.now();
  if (req.session.isAdmin) {
    const last = req.session.lastActive || now;
    if (now - last > ADMIN_IDLE_MS) {
      return req.session.destroy(() => {
        res.clearCookie("hahashop.sid");
        if (req.path.startsWith("/api/")) {
          return res.status(401).json({ ok: false, message: "เซสชันแอดมินหมดอายุ กรุณาเข้าสู่ระบบใหม่" });
        }
        next();
      });
    }
  }
  req.session.lastActive = now;
  next();
});


app.get("/api/stats", (_req, res) => {
  const users = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role != 'admin'`).get().c;
  const products = db.prepare(`SELECT COUNT(*) AS c FROM products`).get().c;
  const stock = db.prepare(`SELECT COALESCE(SUM(stock), 0) AS c FROM products`).get().c;
  const orders = db.prepare(`SELECT COUNT(*) AS c FROM orders`).get().c;
  const topups = db.prepare(`SELECT COUNT(*) AS c FROM transactions WHERE type='topup' AND status='success'`).get().c;
  const plays = db.prepare(`SELECT COUNT(*) AS c FROM minigame_plays`).get().c;
  res.json({
    ok: true,
    stats: {
      users: Number(users) || 0,
      products: Number(products) || 0,
      stock: Number(stock) || 0,
      completed: Number(orders) + Number(topups) + Number(plays),
    },
  });
});

app.get("/healthz", (_req, res) => res.status(200).type("text/plain").send("ok"));
app.get("/api/health", (_req, res) => res.json({ ok: true, shop: "HAHA SHOP" }));

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ ok: true, user: null });
  const user = getUserById(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.json({ ok: true, user: null });
  }
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/signup", authLimiter, (req, res) => {
  const ip = clientIp(req);
  if (isLoginLocked(ip)) {
    return res.status(429).json({ ok: false, message: "ล็อกชั่วคราวเนื่องจากพยายามผิดหลายครั้ง" });
  }
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
    return res.status(400).json({ ok: false, message: "ชื่อผู้ใช้ต้องเป็น a-z, 0-9, _ ความยาว 3–24 ตัวอักษร" });
  }
  if (password.length < 6 || password.length > 72) {
    return res.status(400).json({ ok: false, message: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร" });
  }
  if (db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(username)) {
    return res.status(409).json({ ok: false, message: "ชื่อผู้ใช้นี้ถูกใช้แล้ว" });
  }
  if (username.toLowerCase() === "admin") {
    return res.status(403).json({ ok: false, message: "ไม่สามารถสมัครชื่อนี้ได้" });
  }
  const info = db.prepare("INSERT INTO users (username, password_hash, balance, role) VALUES (?, ?, 0, 'user')")
    .run(username, bcrypt.hashSync(password, 10));
  const oldCsrf = req.session.csrfToken;
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ ok: false, message: "สมัครไม่สำเร็จ" });
    req.session.userId = info.lastInsertRowid;
    req.session.isAdmin = false;
    req.session.lastActive = Date.now();
    req.session.csrfToken = oldCsrf || ensureCsrf(req);
    res.json({ ok: true, user: publicUser(getUserById(info.lastInsertRowid)), csrfToken: req.session.csrfToken, message: "สมัครสมาชิกสำเร็จ" });
  });
});

app.post("/api/login", authLimiter, (req, res) => {
  const ip = clientIp(req);
  if (isLoginLocked(ip)) {
    return res.status(429).json({ ok: false, message: "ล็อกชั่วคราวเนื่องจากพยายามผิดหลายครั้ง กรุณารอ 15 นาที" });
  }
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const user = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordFailedLogin(ip);
    return res.status(401).json({ ok: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
  }
  clearFailedLogin(ip);
  const oldCsrf = req.session.csrfToken;
  const isAdmin = (user.role || "user") === "admin";
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ ok: false, message: "เข้าสู่ระบบไม่สำเร็จ" });
    req.session.userId = user.id;
    req.session.isAdmin = isAdmin;
    req.session.lastActive = Date.now();
    req.session.csrfToken = oldCsrf || ensureCsrf(req);
    res.json({ ok: true, user: publicUser(user), csrfToken: req.session.csrfToken, message: "เข้าสู่ระบบสำเร็จ" });
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("hahashop.sid");
    res.json({ ok: true });
  });
});

app.get("/api/transactions", requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT id, type, amount, voucher_hash, status, message, created_at
     FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50`
  ).all(req.session.userId);
  res.json({ ok: true, transactions: rows });
});

app.post("/api/topup", requireAuth, topupLimiter, async (req, res) => {
  const link = String(req.body?.link || "").trim();
  if (!link) return res.status(400).json({ ok: false, message: THAI_ERRORS.INVALID_LINK });
  const preview = extractHash(link);
  if (preview.error) {
    db.prepare(`INSERT INTO transactions (user_id, type, amount, voucher_hash, status, message) VALUES (?, 'topup', 0, NULL, 'failed', ?)`)
      .run(req.session.userId, preview.message);
    return res.status(400).json({ ok: false, error: preview.error, message: preview.message });
  }
  const prior = db.prepare(`SELECT id FROM transactions WHERE voucher_hash = ? AND status = 'success'`).get(preview.hash);
  if (prior) {
    return res.status(400).json({ ok: false, error: "ALREADY_USED_HERE", message: THAI_ERRORS.ALREADY_USED_HERE });
  }
  const result = await redeemVoucher(link, TRUEMONEY_MOBILE);
  if (!result.ok) {
    db.prepare(`INSERT INTO transactions (user_id, type, amount, voucher_hash, status, message, raw_json) VALUES (?, 'topup', 0, ?, 'failed', ?, ?)`)
      .run(req.session.userId, result.hash || null, result.message, result.raw ? JSON.stringify(result.raw).slice(0, 4000) : null);
    return res.status(400).json({ ok: false, error: result.error, message: result.message });
  }
  try {
    const user = db.transaction(() => {
      db.prepare(`UPDATE users SET balance = balance + ? WHERE id = ?`).run(result.amount, req.session.userId);
      db.prepare(`INSERT INTO transactions (user_id, type, amount, voucher_hash, status, message, raw_json) VALUES (?, 'topup', ?, ?, 'success', ?, ?)`)
        .run(req.session.userId, result.amount, result.hash, `เติมเครดิตสำเร็จ +${result.amount} บาท`, result.raw ? JSON.stringify(result.raw).slice(0, 4000) : null);
      return getUserById(req.session.userId);
    })();
    res.json({ ok: true, amount: result.amount, balance: user.balance, message: `เติมเครดิตสำเร็จ +${result.amount.toLocaleString("th-TH")} บาท`, user: publicUser(user) });
  } catch {
    return res.status(400).json({ ok: false, error: "ALREADY_USED_HERE", message: THAI_ERRORS.ALREADY_USED_HERE });
  }
});

app.get("/api/config", (_req, res) => {
  const categories = db.prepare("SELECT id, title, subtitle, tone, image, sort_order FROM categories ORDER BY sort_order, id").all();
  res.json({
    ok: true,
    shop: "HAHA SHOP",
    categories,
    announcement: getSetting("announcement", "ยินดีต้อนรับสู่ HAHA SHOP"),
    contact_url: getSetting("contact_url", "#"),
    contact_label: getSetting("contact_label", "ติดต่อแอดมิน"),
    topup: { method: "truemoney_gift", hint: "วางลิงก์ซองอั่งเปา TrueMoney เพื่อเติมเครดิต" },
  });
});

/* —— Products —— */
app.get("/api/products", (req, res) => {
  const q = String(req.query.q || "").trim();
  const category = String(req.query.category || "").trim();
  const sort = String(req.query.sort || "newest"); // newest | price_asc | price_desc
  const min = req.query.min !== undefined && req.query.min !== "" ? Number(req.query.min) : null;
  const max = req.query.max !== undefined && req.query.max !== "" ? Number(req.query.max) : null;

  let sql = `SELECT * FROM products WHERE 1=1`;
  const params = [];
  if (q) { sql += ` AND (title LIKE ? OR sku LIKE ? OR description LIKE ?)`; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (category) { sql += ` AND category = ?`; params.push(category); }
  if (min !== null && Number.isFinite(min)) { sql += ` AND price >= ?`; params.push(min); }
  if (max !== null && Number.isFinite(max)) { sql += ` AND price <= ?`; params.push(max); }
  if (sort === "price_asc") sql += ` ORDER BY price ASC, id DESC`;
  else if (sort === "price_desc") sql += ` ORDER BY price DESC, id DESC`;
  else sql += ` ORDER BY id DESC`;

  const products = db.prepare(sql).all(...params);
  res.json({ ok: true, products });
});

app.get("/api/products/:id", (req, res) => {
  const p = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ ok: false, message: "ไม่พบสินค้า" });
  res.json({ ok: true, product: p });
});

app.post("/api/products/:id/buy", requireAuth, buyLimiter, (req, res) => {
  const productId = Number(req.params.id);
  try {
    const result = db.transaction(() => {
      const p = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
      if (!p) throw Object.assign(new Error("ไม่พบสินค้า"), { status: 404 });
      if (p.stock <= 0 || Number(p.price) < 0) throw Object.assign(new Error("สินค้าหมดแล้ว"), { status: 400 });
      const user = getUserById(req.session.userId);
      if (user.balance < p.price) {
        throw Object.assign(new Error(`เครดิตไม่พอ (ต้องการ ${p.price.toFixed(2)} บาท มี ${user.balance.toFixed(2)} บาท)`), { status: 400, code: "INSUFFICIENT" });
      }
      const bal = db.prepare("UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?").run(p.price, user.id, p.price);
      if (bal.changes !== 1) throw Object.assign(new Error("เครดิตไม่พอ"), { status: 400, code: "INSUFFICIENT" });
      const stock = db.prepare("UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0").run(p.id);
      if (stock.changes !== 1) throw Object.assign(new Error("สินค้าหมดแล้ว"), { status: 400 });
      const order = db.prepare(
        `INSERT INTO orders (user_id, product_id, product_title, price, status) VALUES (?, ?, ?, ?, 'paid')`
      ).run(user.id, p.id, p.title, p.price);
      db.prepare(
        `INSERT INTO transactions (user_id, type, amount, status, message) VALUES (?, 'purchase', ?, 'success', ?)`
      ).run(user.id, -p.price, `ซื้อสินค้า ${p.title}`);
      return {
        orderId: order.lastInsertRowid,
        user: publicUser(getUserById(user.id)),
        product: db.prepare("SELECT * FROM products WHERE id = ?").get(p.id),
      };
    })();
    res.json({ ok: true, message: "ซื้อสินค้าสำเร็จ", ...result });
  } catch (e) {
    const msg = e.status ? e.message : "ซื้อไม่สำเร็จ";
    res.status(e.status || 500).json({ ok: false, error: e.code || "BUY_FAILED", message: msg });
  }
});

app.get("/api/orders", requireAuth, (req, res) => {
  const orders = db.prepare(
    `SELECT id, product_id, product_title, price, status, created_at FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50`
  ).all(req.session.userId);
  res.json({ ok: true, orders });
});

/* —— Auctions —— */
app.get("/api/auctions", (_req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.username AS current_bidder
    FROM auctions a LEFT JOIN users u ON u.id = a.current_bidder_id
    ORDER BY a.id DESC
  `).all();
  res.json({ ok: true, auctions: rows });
});

app.post("/api/auctions/:id/bid", requireAuth, (req, res) => {
  const auctionId = Number(req.params.id);
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ ok: false, message: "กรุณาใส่ราคาประมูลที่ถูกต้อง" });
  }
  try {
    const out = db.transaction(() => {
      const a = db.prepare("SELECT * FROM auctions WHERE id = ?").get(auctionId);
      if (!a) throw Object.assign(new Error("ไม่พบรายการประมูล"), { status: 404 });
      if (amount <= a.current_bid) {
        throw Object.assign(new Error(`ราคาประมูลต้องสูงกว่า ${a.current_bid.toFixed(2)} บาท`), { status: 400 });
      }
      const user = getUserById(req.session.userId);
      if (user.balance < amount) {
        throw Object.assign(new Error("เครดิตไม่พอสำหรับราคาประมูลนี้"), { status: 400, code: "INSUFFICIENT" });
      }
      // Hold is soft: we only check balance; full escrow omitted for demo
      db.prepare("UPDATE auctions SET current_bid = ?, current_bidder_id = ? WHERE id = ?")
        .run(amount, user.id, a.id);
      db.prepare("INSERT INTO auction_bids (auction_id, user_id, amount) VALUES (?, ?, ?)")
        .run(a.id, user.id, amount);
      return db.prepare(`
        SELECT a.*, u.username AS current_bidder
        FROM auctions a LEFT JOIN users u ON u.id = a.current_bidder_id WHERE a.id = ?
      `).get(a.id);
    })();
    res.json({ ok: true, message: "เสนอราคาสำเร็จ", auction: out, user: publicUser(getUserById(req.session.userId)) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.code || "BID_FAILED", message: e.message || "ประมูลไม่สำเร็จ" });
  }
});

/* —— Minigames —— */
app.get("/api/minigames", (_req, res) => {
  const games = db.prepare("SELECT * FROM minigames ORDER BY id").all();
  res.json({ ok: true, minigames: games });
});

app.get("/api/minigames/:id", (req, res) => {
  const g = db.prepare("SELECT * FROM minigames WHERE id = ? OR slug = ?").get(req.params.id, req.params.id);
  if (!g) return res.status(404).json({ ok: false, message: "ไม่พบมินิเกม" });
  const prizes = db.prepare("SELECT id, label, weight FROM minigame_prizes WHERE minigame_id = ?").all(g.id);
  res.json({ ok: true, minigame: g, prizes });
});

app.post("/api/minigames/:id/play", requireAuth, (req, res) => {
  const key = req.params.id;
  try {
    const out = db.transaction(() => {
      const g = db.prepare("SELECT * FROM minigames WHERE id = ? OR slug = ?").get(key, key);
      if (!g) throw Object.assign(new Error("ไม่พบมินิเกม"), { status: 404 });
      const user = getUserById(req.session.userId);
      if (user.balance < g.price) {
        throw Object.assign(new Error(`เครดิตไม่พอ (ต้องการ ${g.price.toFixed(2)} บาท)`), { status: 400, code: "INSUFFICIENT" });
      }
      const prizes = db.prepare("SELECT * FROM minigame_prizes WHERE minigame_id = ?").all(g.id);
      if (!prizes.length) throw Object.assign(new Error("ยังไม่มีรางวัลในพูล"), { status: 500 });
      const total = prizes.reduce((s, p) => s + p.weight, 0);
      let r = Math.random() * total;
      let picked = prizes[prizes.length - 1];
      for (const p of prizes) {
        r -= p.weight;
        if (r <= 0) { picked = p; break; }
      }
      const bal = db.prepare("UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?").run(g.price, user.id, g.price);
      if (bal.changes !== 1) throw Object.assign(new Error("เครดิตไม่พอ"), { status: 400, code: "INSUFFICIENT" });
      db.prepare("INSERT INTO minigame_plays (user_id, minigame_id, prize_label, price) VALUES (?, ?, ?, ?)")
        .run(user.id, g.id, picked.label, g.price);
      db.prepare(`INSERT INTO transactions (user_id, type, amount, status, message) VALUES (?, 'minigame', ?, 'success', ?)`)
        .run(user.id, -g.price, `เล่นมินิเกม ${g.title}: ${picked.label}`);
      return {
        prize: picked.label,
        minigame: g,
        user: publicUser(getUserById(user.id)),
      };
    })();
    res.json({ ok: true, message: "สุ่มรางวัลสำเร็จ", ...out });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.code || "PLAY_FAILED", message: e.message || "เล่นไม่สำเร็จ" });
  }
});

app.get("/api/minigame-plays", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.prize_label, p.price, p.created_at, m.title AS minigame_title
    FROM minigame_plays p JOIN minigames m ON m.id = p.minigame_id
    WHERE p.user_id = ? ORDER BY p.id DESC LIMIT 30
  `).all(req.session.userId);
  res.json({ ok: true, plays: rows });
});

app.use("/api/admin", createAdminRouter());

// Uploads may live outside public/ when UPLOAD_DIR is set (e.g. Render disk)
app.use("/uploads", express.static(UPLOAD_DIR, { fallthrough: true, index: false }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/{*path}", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, _req, res, _next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ ok: false, message: "ไฟล์ใหญ่เกินไป (สูงสุด 5MB)" });
  }
  if (err && err.message && /อนุญาตเฉพาะ|ไม่อนุญาต|ไฟล์รูป/.test(err.message)) {
    return res.status(400).json({ ok: false, message: err.message });
  }
  console.error("[error]", err && err.message ? err.message : err);
  res.status(500).json({ ok: false, message: "เกิดข้อผิดพลาดภายในระบบ" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[startup] HAHA SHOP listening on 0.0.0.0:${PORT}`);
});
