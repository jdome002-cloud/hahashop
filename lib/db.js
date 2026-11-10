const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DATA_DIR, "haha.sqlite");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  voucher_hash TEXT,
  status TEXT NOT NULL,
  message TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_voucher_success
  ON transactions(voucher_hash)
  WHERE voucher_hash IS NOT NULL AND status = 'success';

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  stock INTEGER NOT NULL DEFAULT 1,
  image TEXT,
  installment INTEGER NOT NULL DEFAULT 0,
  example INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_title TEXT NOT NULL,
  price REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS auctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  image TEXT,
  start_price REAL NOT NULL,
  current_bid REAL NOT NULL,
  current_bidder_id INTEGER,
  ends_at TEXT,
  example INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auction_bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (auction_id) REFERENCES auctions(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS minigames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  price REAL NOT NULL,
  image TEXT,
  example INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS minigame_prizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  minigame_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (minigame_id) REFERENCES minigames(id)
);

CREATE TABLE IF NOT EXISTS minigame_plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  minigame_id INTEGER NOT NULL,
  prize_label TEXT NOT NULL,
  price REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (minigame_id) REFERENCES minigames(id)
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  tone TEXT NOT NULL DEFAULT 'blue',
  image TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_name TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Migrations for older DBs
const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userCols.includes("role")) {
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
}
if (!userCols.includes("email")) db.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
if (!userCols.includes("discord_id")) db.exec(`ALTER TABLE users ADD COLUMN discord_id TEXT`);
if (!userCols.includes("pw_version")) db.exec(`ALTER TABLE users ADD COLUMN pw_version INTEGER NOT NULL DEFAULT 0`);
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_discord ON users(discord_id) WHERE discord_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);
const productCols = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);
if (!productCols.includes("deleted")) db.exec(`ALTER TABLE products ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`);
const mgCols = db.prepare("PRAGMA table_info(minigames)").all().map((c) => c.name);
if (!mgCols.includes("deleted")) db.exec(`ALTER TABLE minigames ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`);

// —— v3: verification, OAuth ids, points, images, inventory, ledger, idempotency ——
{
  const uc = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!uc.includes("email_verified")) db.exec(`ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`);
  if (!uc.includes("google_id")) db.exec(`ALTER TABLE users ADD COLUMN google_id TEXT`);
  if (!uc.includes("points")) db.exec(`ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0`);
  if (!uc.includes("terms_at")) db.exec(`ALTER TABLE users ADD COLUMN terms_at TEXT`);
  const pc = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);
  if (!pc.includes("delivery_note")) db.exec(`ALTER TABLE products ADD COLUMN delivery_note TEXT`);
  const oc = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  if (!oc.includes("idem_key")) db.exec(`ALTER TABLE orders ADD COLUMN idem_key TEXT`);
  if (!oc.includes("item_id")) db.exec(`ALTER TABLE orders ADD COLUMN item_id INTEGER`);
  if (!oc.includes("delivered")) db.exec(`ALTER TABLE orders ADD COLUMN delivered TEXT`);
  db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_id) WHERE google_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idem ON orders(user_id, idem_key) WHERE idem_key IS NOT NULL;
  CREATE TABLE IF NOT EXISTS email_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS product_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    secret TEXT NOT NULL,
    order_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
  CREATE INDEX IF NOT EXISTS idx_items_free ON product_items(product_id, order_id);
  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    delta REAL NOT NULL,
    balance_after REAL NOT NULL,
    reason TEXT NOT NULL,
    ref TEXT,
    admin_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, id);
  CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger
    BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger
    BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
  `);
  // One voucher can be claimed once: pending/review/success rows all hold the lock.
  db.exec(`DROP INDEX IF EXISTS idx_tx_voucher_success`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_voucher_lock ON transactions(voucher_hash)
           WHERE voucher_hash IS NOT NULL AND status IN ('pending', 'review', 'success')`);
  // Opening ledger entries for balances that existed before the ledger (one time)
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'ledger_v1'").get()) {
    db.transaction(() => {
      const rows = db.prepare(`SELECT u.id, u.balance, COALESCE((SELECT SUM(delta) FROM ledger l WHERE l.user_id = u.id), 0) AS s FROM users u`).all();
      const ins = db.prepare("INSERT INTO ledger (user_id, delta, balance_after, reason, ref) VALUES (?, ?, ?, 'opening_balance', 'migration')");
      for (const r of rows) {
        const d = Math.round((r.balance - r.s) * 100) / 100;
        if (Math.abs(d) >= 0.005) ins.run(r.id, d, r.balance);
      }
      db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('ledger_v1', '1')").run();
    })();
  }
}

const MAX_DELTA = 10_000_000;
/**
 * The ONLY way balances change. Must be called inside db.transaction().
 * Conditional UPDATE guarantees the balance never goes negative; every change is
 * recorded in the append-only ledger with its reason, reference and admin id.
 */
function applyBalance(userId, delta, { reason, ref = null, adminId = null }) {
  const d = Math.round(Number(delta) * 100) / 100;
  if (!Number.isFinite(d) || Math.abs(d) > MAX_DELTA) throw Object.assign(new Error("จำนวนเงินไม่ถูกต้อง"), { status: 400, code: "BAD_AMOUNT" });
  if (!reason) throw new Error("ledger reason required");
  const r = db.prepare("UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id = ? AND ROUND(balance + ?, 2) >= 0").run(d, userId, d);
  if (r.changes !== 1) throw Object.assign(new Error("เครดิตไม่พอ"), { status: 400, code: "INSUFFICIENT" });
  const after = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId).balance;
  db.prepare("INSERT INTO ledger (user_id, delta, balance_after, reason, ref, admin_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run(userId, d, after, String(reason).slice(0, 40), ref == null ? null : String(ref).slice(0, 120), adminId);
  return after;
}

/** Users whose balance does not equal the sum of their ledger entries. */
function ledgerMismatches() {
  return db.prepare(`
    SELECT u.id, u.username, u.balance, ROUND(COALESCE(SUM(l.delta), 0), 2) AS ledger_sum
    FROM users u LEFT JOIN ledger l ON l.user_id = u.id
    GROUP BY u.id HAVING ABS(u.balance - ledger_sum) >= 0.005
  `).all();
}

/**
 * Delete a product. Products that already have orders are soft-deleted (hidden, stock 0,
 * SKU freed) so order history keeps its foreign key; unsold products are removed outright.
 */
function removeProduct(id) {
  return db.transaction(() => {
    const p = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!p) return { found: false };
    const sold = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE product_id = ?").get(id).c;
    if (sold > 0) {
      db.prepare("UPDATE products SET deleted = 1, stock = 0, sku = sku || '~del' || id WHERE id = ?").run(id);
      return { found: true, soft: true, sku: p.sku };
    }
    db.prepare("DELETE FROM product_items WHERE product_id = ? AND order_id IS NULL").run(id);
    db.prepare("DELETE FROM products WHERE id = ?").run(id);
    return { found: true, soft: false, sku: p.sku };
  })();
}

function seed() {
  // No sample products are seeded: a fresh deploy starts with an empty catalog.
  // One-time cleanup of the sample products older builds used to seed.
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'samples_removed_v1'").get()) {
    const legacy = ["FF-6297", "FF-5102", "FF-3301", "FF-8808", "FF-RNT1", "FF-RNT7", "FF-RND1", "FF-EVT1"];
    for (const sku of legacy) {
      const p = db.prepare("SELECT id FROM products WHERE sku = ? AND example = 1").get(sku);
      if (p) removeProduct(p.id);
    }
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('samples_removed_v1', '1')").run();
  }

  if (db.prepare("SELECT COUNT(*) AS c FROM categories").get().c === 0) {
    const ins = db.prepare(
      `INSERT INTO categories (id, title, subtitle, tone, image, sort_order) VALUES (?, ?, ?, ?, null, ?)`
    );
    [
      ["ffid", "ซื้อไอดี Free Fire", "ไอดีพร้อมเล่น คุณภาพดี", "blue", 1],
      ["random", "โซนสุ่มรางวัล", "สุ่มไอดี / ของรางวัล", "dark", 2],
      ["rent", "เช่าไอดี", "เช่ารายวัน / รายสัปดาห์", "navy", 3],
      ["event", "กิจกรรมพิเศษ", "ของจากอีเวนต์", "purple", 4],
    ].forEach((r) => ins.run(...r));
  }

  const set = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  set.run("announcement", "ยินดีต้อนรับสู่ HAHA SHOP");
  set.run("contact_url", "https://line.me/ti/p/@hahashop");
  set.run("contact_label", "ติดต่อแอดมิน");
}

seed();

function getSetting(key, fallback = "") {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

function writeAudit(actor, action, detail, ip) {
  try {
    db.prepare(
      `INSERT INTO audit_log (actor_id, actor_name, action, detail, ip) VALUES (?, ?, ?, ?, ?)`
    ).run(
      actor && actor.id != null ? actor.id : null,
      actor && actor.username ? String(actor.username) : null,
      String(action || "").slice(0, 80),
      String(detail || "").slice(0, 2000),
      String(ip || "").slice(0, 64)
    );
  } catch (_) {}
}

module.exports = { db, getSetting, setSetting, writeAudit, removeProduct, applyBalance, ledgerMismatches, DATA_DIR, DB_PATH };

