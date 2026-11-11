/**
 * HAHA SHOP — Express API + SPA static
 */
console.log(`[startup] HAHA SHOP booting: node ${process.version} ${process.platform}-${process.arch} pid=${process.pid}`);
{
  // better-sqlite3 v13 prebuilds require Node >= 22; on Node 20 `new Database()` segfaults (exit 139).
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) {
    console.error(`[startup] FATAL: Node ${process.version} is too old. HAHA SHOP requires Node 22.x.`);
    process.exit(1);
  }
}
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

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
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { db, getSetting, applyBalance } = require("./lib/db");
console.log("[startup] database opened");
const { redeemVoucher, extractHash, THAI_ERRORS } = require("./lib/truemoney");
const { createAdminRouter } = require("./lib/admin-api");
const { serveImage } = require("./lib/images");
const { clientIp, originOk, ensureCsrf, csrfOk } = require("./lib/security");
const { captchaImage, publicConfig: captchaConfig, turnstileOn } = require("./lib/captcha");
const { smtpConfigured } = require("./lib/mailer");
const { mountAccount, isVerified, verificationRequired } = require("./lib/account");
const { ensureAdmin } = require("./scripts/ensure-admin");
const { SqliteStore } = require("./lib/session-store");
ensureAdmin();
console.log("[startup] admin ensured");

const PROD = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 8080);
const SESSION_SECRET = process.env.SESSION_SECRET || (PROD ? null : "haha-shop-dev-secret");
if (!SESSION_SECRET) {
  console.error("[startup] FATAL: SESSION_SECRET is required in production");
  process.exit(1);
}
if (SESSION_SECRET.length < 32) console.warn("[security] SESSION_SECRET should be at least 32 characters");
const TRUEMONEY_MOBILE = process.env.TRUEMONEY_MOBILE || "0624712534";
const ADMIN_IDLE_MS = 30 * 60 * 1000;

const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY || 1));
app.disable("x-powered-by");

const TURNSTILE = "https://challenges.cloudflare.com";
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", ...(turnstileOn() ? [TURNSTILE] : [])],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
        "frame-src": turnstileOn() ? [TURNSTILE] : ["'none'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        "script-src-attr": ["'none'"],
        "worker-src": ["'self'"],
        "manifest-src": ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    strictTransportSecurity: PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  next();
});

app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

app.use(
  session({
    name: "hahashop.sid",
    secret: SESSION_SECRET,
    store: new SqliteStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: "auto", // Secure on https (Render terminates TLS; trust proxy makes req.secure true)
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

const limiter = (windowMs, max, message) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => clientIp(req), validate: { keyGeneratorIpFallback: false },
  message: { ok: false, error: "RATE_LIMIT", message },
});
const topupLimiter = limiter(60 * 1000, 6, "ส่งคำขอเติมเครดิตบ่อยเกินไป");
const buyLimiter = limiter(60 * 1000, 30, "ส่งคำขอบ่อยเกินไป");
app.use("/api/", limiter(60 * 1000, 240, "คำขอบ่อยเกินไป"));

// Origin + CSRF for every mutating API request (no exceptions)
app.use("/api", (req, res, next) => {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (!originOk(req)) return res.status(403).json({ ok: false, error: "ORIGIN", message: "คำขอไม่ถูกต้อง" });
  if (!csrfOk(req)) {
    return res.status(403).json({ ok: false, error: "CSRF", message: "เซสชันหมดอายุหรือโทเคนไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง" });
  }
  next();
});

app.get("/api/csrf", (req, res) => {
  const token = ensureCsrf(req);
  res.set("Cache-Control", "no-store");
  req.session.save(() => res.json({ ok: true, csrfToken: token }));
});
app.get("/api/captcha.svg", captchaImage);

function publicUser(row) {
  if (!row) return null;
  const isAdmin = (row.role || "user") === "admin";
  return {
    id: row.id,
    username: row.username,
    email: row.email || null,
    emailVerified: isVerified(row),
    discord: !!row.discord_id,
    google: !!row.google_id,
    balance: Number(row.balance) || 0,
    points: Number(row.points) || 0,
    role: isAdmin ? "admin" : "user",
    isAdmin,
  };
}
const getUserById = (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id);
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบก่อน" });
  next();
}
function requireVerified(req, res, next) {
  const u = getUserById(req.session.userId);
  if (!u) return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบก่อน" });
  if (!isVerified(u)) return res.status(403).json({ ok: false, error: "EMAIL_UNVERIFIED", message: "กรุณายืนยันอีเมลก่อนเติมเงินหรือซื้อสินค้า" });
  req.user = u;
  next();
}

// Session validity: password changes end other sessions; admin idle timeout
app.use((req, res, next) => {
  if (!req.session || !req.session.userId) return next();
  const now = Date.now();
  const u = db.prepare("SELECT pw_version, role FROM users WHERE id = ?").get(req.session.userId);
  const expired = !u || Number(u.pw_version || 0) !== Number(req.session.pwv || 0) ||
    (u.role === "admin" && now - (req.session.lastActive || now) > ADMIN_IDLE_MS);
  if (expired) {
    return req.session.regenerate(() => {
      if (req.path.startsWith("/api/") && !["/api/me", "/api/csrf", "/api/config"].includes(req.path)) {
        return res.status(401).json({ ok: false, error: "SESSION_EXPIRED", message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" });
      }
      next();
    });
  }
  req.session.lastActive = now;
  next();
});

function startSession(req, res, user, cb) {
  req.session.regenerate((err) => { // new session id on every login (prevents fixation)
    if (err) return cb(err);
    req.session.userId = user.id;
    req.session.isAdmin = (user.role || "user") === "admin";
    req.session.pwv = Number(user.pw_version || 0);
    req.session.lastActive = Date.now();
    ensureCsrf(req);
    req.session.save(cb);
  });
}
const account = mountAccount(app, { startSession, publicUser, requireAuth });

app.get("/healthz", (_req, res) => res.status(200).type("text/plain").send("ok"));
app.get("/api/health", (_req, res) => res.json({ ok: true, shop: "HAHA SHOP" }));

app.get("/api/me", (req, res) => {
  res.set("Cache-Control", "no-store");
  const user = req.session.userId ? getUserById(req.session.userId) : null;
  res.json({ ok: true, user: publicUser(user), verificationRequired: verificationRequired() });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("hahashop.sid");
    res.json({ ok: true });
  });
});

app.get("/api/stats", (_req, res) => {
  const one = (sql) => Number(db.prepare(sql).get().c) || 0;
  res.json({
    ok: true,
    stats: {
      users: one(`SELECT COUNT(*) AS c FROM users WHERE role != 'admin'`),
      products: one(`SELECT COUNT(*) AS c FROM products WHERE deleted = 0`),
      stock: one(`SELECT COALESCE(SUM(stock), 0) AS c FROM products WHERE deleted = 0`),
      completed: one(`SELECT COUNT(*) AS c FROM orders`) + one(`SELECT COUNT(*) AS c FROM transactions WHERE type='topup' AND status='success'`) + one(`SELECT COUNT(*) AS c FROM minigame_plays`),
    },
  });
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
    auth: { ...account.oauthConfigured(), emailReset: smtpConfigured(), verificationRequired: verificationRequired() },
    captcha: captchaConfig(),
  });
});

/* —— Ledger / history (own only) —— */
app.get("/api/ledger", requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT id, delta, balance_after, reason, ref, created_at FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 100`).all(req.session.userId);
  res.json({ ok: true, ledger: rows });
});
app.get("/api/transactions", requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT id, type, amount, status, message, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50`).all(req.session.userId);
  res.json({ ok: true, transactions: rows });
});

/* —— Top-up (TrueMoney angpao) —— */
app.post("/api/topup", requireAuth, requireVerified, topupLimiter, async (req, res) => {
  const userId = req.user.id;
  const link = String(req.body?.link || "").trim().slice(0, 300);
  if (!link) return res.status(400).json({ ok: false, message: THAI_ERRORS.INVALID_LINK });
  const preview = extractHash(link);
  if (preview.error) return res.status(400).json({ ok: false, error: preview.error, message: preview.message });
  // Claim the voucher first: the unique index makes a voucher redeemable once, even under concurrent requests.
  let txId;
  try {
    txId = db.prepare(`INSERT INTO transactions (user_id, type, amount, voucher_hash, status, message) VALUES (?, 'topup', 0, ?, 'pending', 'กำลังตรวจสอบซอง')`)
      .run(userId, preview.hash).lastInsertRowid;
  } catch (_) {
    return res.status(400).json({ ok: false, error: "ALREADY_USED_HERE", message: THAI_ERRORS.ALREADY_USED_HERE });
  }
  const result = await redeemVoucher(link, TRUEMONEY_MOBILE);
  const raw = result.raw ? JSON.stringify(result.raw).slice(0, 4000) : null;
  if (!result.ok) {
    const review = !!(result.indeterminate || result.review);
    db.prepare(`UPDATE transactions SET status = ?, message = ?, raw_json = ? WHERE id = ?`)
      .run(review ? "review" : "failed", result.message, raw, txId);
    return res.status(400).json({ ok: false, error: result.error, message: review ? result.message + " (รายการนี้รอแอดมินตรวจสอบ)" : result.message });
  }
  try {
    const user = db.transaction(() => {
      const u = db.prepare(`UPDATE transactions SET status = 'success', amount = ?, message = ?, raw_json = ? WHERE id = ? AND status = 'pending'`)
        .run(result.amount, `เติมเครดิตสำเร็จ +${result.amount} บาท`, raw, txId);
      if (u.changes !== 1) throw new Error("tx state");
      applyBalance(userId, result.amount, { reason: "topup", ref: `tx:${txId}` }); // amount reported by TrueMoney only
      return getUserById(userId);
    })();
    res.json({ ok: true, amount: result.amount, balance: user.balance, user: publicUser(user), message: `เติมเครดิตสำเร็จ +${result.amount.toLocaleString("th-TH")} บาท` });
  } catch (e) {
    console.error("[topup] credit failed:", e.message);
    db.prepare(`UPDATE transactions SET status = 'review' WHERE id = ?`).run(txId);
    res.status(500).json({ ok: false, message: "บันทึกเครดิตไม่สำเร็จ รายการนี้รอแอดมินตรวจสอบ" });
  }
});

/* —— Products —— */
const PUBLIC_PRODUCT_COLS = "id, sku, title, description, category, price, stock, image, installment, example, created_at";
app.get("/api/products", (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 80);
  const category = String(req.query.category || "").trim().slice(0, 40);
  const sort = String(req.query.sort || "newest");
  const min = req.query.min !== undefined && req.query.min !== "" ? Number(req.query.min) : null;
  const max = req.query.max !== undefined && req.query.max !== "" ? Number(req.query.max) : null;
  let sql = `SELECT ${PUBLIC_PRODUCT_COLS} FROM products WHERE deleted = 0`;
  const params = [];
  if (q) { sql += ` AND (title LIKE ? OR sku LIKE ? OR description LIKE ?)`; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (category) { sql += ` AND category = ?`; params.push(category); }
  if (min !== null && Number.isFinite(min)) { sql += ` AND price >= ?`; params.push(min); }
  if (max !== null && Number.isFinite(max)) { sql += ` AND price <= ?`; params.push(max); }
  sql += sort === "price_asc" ? ` ORDER BY price ASC, id DESC` : sort === "price_desc" ? ` ORDER BY price DESC, id DESC` : ` ORDER BY id DESC`;
  res.json({ ok: true, products: db.prepare(sql + " LIMIT 200").all(...params) });
});

app.get("/api/products/:id", (req, res) => {
  const p = db.prepare(`SELECT ${PUBLIC_PRODUCT_COLS} FROM products WHERE id = ? AND deleted = 0`).get(Number(req.params.id));
  if (!p) return res.status(404).json({ ok: false, message: "ไม่พบสินค้า" });
  res.json({ ok: true, product: p });
});

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

app.post("/api/products/:id/buy", requireAuth, requireVerified, buyLimiter, (req, res) => {
  const productId = Number(req.params.id);
  const b = req.body || {};
  if (!Number.isInteger(productId) || productId <= 0) return res.status(400).json({ ok: false, message: "รหัสสินค้าไม่ถูกต้อง" });
  // Quantity is fixed at 1 per order; any other value is a tampered request.
  if (b.quantity !== undefined && Number(b.quantity) !== 1) return res.status(400).json({ ok: false, error: "BAD_QUANTITY", message: "จำนวนไม่ถูกต้อง" });
  const idem = String(req.get("Idempotency-Key") || b.idempotency_key || "").trim();
  if (idem && !/^[A-Za-z0-9_-]{8,64}$/.test(idem)) return res.status(400).json({ ok: false, message: "Idempotency-Key ไม่ถูกต้อง" });
  const userId = req.user.id;
  try {
    // better-sqlite3 transactions are synchronous: no other request can interleave → race/double-spend safe.
    const out = db.transaction(() => {
      if (idem) {
        const prev = db.prepare("SELECT id FROM orders WHERE user_id = ? AND idem_key = ?").get(userId, idem);
        if (prev) return { orderId: prev.id, replay: true };
      }
      const p = db.prepare("SELECT * FROM products WHERE id = ? AND deleted = 0").get(productId);
      if (!p) throw fail(404, "NOT_FOUND", "ไม่พบสินค้า");
      if (b.expected_price !== undefined && Math.abs(Number(b.expected_price) - p.price) > 0.001) {
        throw fail(409, "PRICE_CHANGED", `ราคาสินค้าเปลี่ยนเป็น ${p.price.toFixed(2)} บาท กรุณาตรวจสอบอีกครั้ง`);
      }
      if (!(p.price >= 0)) throw fail(400, "BAD_PRICE", "สินค้านี้ซื้อไม่ได้");
      const st = db.prepare("UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0 AND deleted = 0").run(p.id);
      if (st.changes !== 1) throw fail(400, "SOLD_OUT", "สินค้าหมดแล้ว");
      const orderId = db.prepare(`INSERT INTO orders (user_id, product_id, product_title, price, status, idem_key) VALUES (?, ?, ?, ?, 'paid', ?)`)
        .run(userId, p.id, p.title, p.price, idem || null).lastInsertRowid;
      applyBalance(userId, -p.price, { reason: "purchase", ref: `order:${orderId}` }); // throws INSUFFICIENT → full rollback
      let delivered = p.delivery_note || null, itemId = null;
      const hasItems = db.prepare("SELECT COUNT(*) AS c FROM product_items WHERE product_id = ?").get(p.id).c > 0;
      if (hasItems) {
        const item = db.prepare("SELECT id, secret FROM product_items WHERE product_id = ? AND order_id IS NULL ORDER BY id LIMIT 1").get(p.id);
        if (!item) throw fail(400, "SOLD_OUT", "สินค้าหมดแล้ว");
        if (db.prepare("UPDATE product_items SET order_id = ? WHERE id = ? AND order_id IS NULL").run(orderId, item.id).changes !== 1) throw fail(409, "SOLD_OUT", "สินค้าหมดแล้ว");
        delivered = item.secret; itemId = item.id;
      }
      db.prepare("UPDATE orders SET item_id = ?, delivered = ? WHERE id = ?").run(itemId, delivered, orderId);
      db.prepare("UPDATE users SET points = points + ? WHERE id = ?").run(Math.floor(p.price / 10), userId);
      db.prepare(`INSERT INTO transactions (user_id, type, amount, status, message) VALUES (?, 'purchase', ?, 'success', ?)`).run(userId, -p.price, `ซื้อสินค้า ${p.title}`);
      return { orderId, replay: false };
    })();
    const order = db.prepare("SELECT id, product_id, product_title, price, status, delivered, created_at FROM orders WHERE id = ? AND user_id = ?").get(out.orderId, userId);
    res.json({ ok: true, replay: out.replay, message: out.replay ? "คำสั่งซื้อนี้ทำรายการไปแล้ว" : "ซื้อสินค้าสำเร็จ", order, user: publicUser(getUserById(userId)) });
  } catch (e) {
    if (e.code === "SQLITE_CONSTRAINT_UNIQUE" && idem) return res.status(409).json({ ok: false, error: "DUPLICATE", message: "คำสั่งซื้อนี้ทำรายการไปแล้ว" });
    if (!e.status) console.error("[buy] failed:", e.message);
    res.status(e.status || 500).json({ ok: false, error: e.code || "BUY_FAILED", message: e.status ? e.message : "ซื้อไม่สำเร็จ" });
  }
});

app.get("/api/orders", requireAuth, (req, res) => {
  const orders = db.prepare(
    `SELECT id, product_id, product_title, price, status, created_at, (delivered IS NOT NULL) AS has_delivery FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50`
  ).all(req.session.userId);
  res.json({ ok: true, orders });
});
// Account credentials are only ever returned to the buyer of that order (IDOR-safe)
app.get("/api/orders/:id", requireAuth, (req, res) => {
  res.set("Cache-Control", "no-store");
  const o = db.prepare(`SELECT id, product_id, product_title, price, status, delivered, created_at FROM orders WHERE id = ? AND user_id = ?`)
    .get(Number(req.params.id), req.session.userId);
  if (!o) return res.status(404).json({ ok: false, message: "ไม่พบคำสั่งซื้อ" });
  res.json({ ok: true, order: o });
});

app.use("/api/admin", createAdminRouter());
app.use("/api", (_req, res) => res.status(404).json({ ok: false, message: "ไม่พบ API" }));

/* —— Images —— */
app.get("/img/u/:id", serveImage);
app.get("/img/cover.jpg", (req, res, next) => {
  const m = String(getSetting("cover_image", "")).match(/^\/img\/u\/([a-f0-9]{32})$/);
  if (!m) return next();
  req.params.id = m[1];
  serveImage(req, res);
});
if (process.env.UPLOAD_DIR) app.use("/uploads", express.static(path.resolve(process.env.UPLOAD_DIR), { index: false, dotfiles: "deny" }));
// PWA: the service worker and manifest must always be revalidated so updates reach installed apps.
app.use(express.static(path.join(__dirname, "public"), {
  dotfiles: "deny",
  index: "index.html",
  setHeaders(res, filePath) {
    const base = path.basename(filePath);
    if (base === "sw.js") {
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Service-Worker-Allowed", "/");
    } else if (base === "manifest.webmanifest") {
      res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
    }
  },
}));
app.get("/{*path}", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Never leak stack traces or internal messages
app.use((err, _req, res, _next) => {
  if (err && err.type === "entity.too.large") return res.status(413).json({ ok: false, message: "ข้อมูลใหญ่เกินไป" });
  if (err && err.type === "entity.parse.failed") return res.status(400).json({ ok: false, message: "รูปแบบข้อมูลไม่ถูกต้อง" });
  if (err && err.expose) return res.status(err.status || 400).json({ ok: false, message: err.message });
  console.error("[error]", err && err.message ? err.message : err);
  res.status(500).json({ ok: false, message: "เกิดข้อผิดพลาดภายในระบบ" });
});

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => console.log(`[startup] HAHA SHOP listening on 0.0.0.0:${PORT}`));
}
module.exports = app;
