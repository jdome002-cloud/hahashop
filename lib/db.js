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

function seed() {
  if (db.prepare("SELECT COUNT(*) AS c FROM products").get().c === 0) {
    const ins = db.prepare(`
      INSERT INTO products (sku, title, description, category, price, stock, image, installment, example)
      VALUES (?, ?, ?, ?, ?, ?, null, ?, 1)
    `);
    const items = [
      ["FF-6297", "FF 6297 · ฮีโรอิก · สกินครบ (ตัวอย่าง)", "เลเวลสูง สกินเยอะ", "ffid", 3499, 1, 1],
      ["FF-5102", "FF 5102 · แกรนด์มาสเตอร์ (ตัวอย่าง)", "แรงค์ดี ราคาคุ้ม", "ffid", 1890, 2, 1],
      ["FF-3301", "FF 3301 · เริ่มต้นถูกดี (ตัวอย่าง)", "เหมาะมือใหม่", "ffid", 299, 5, 0],
      ["FF-8808", "FF 8808 · สกินปืนครบ (ตัวอย่าง)", "สกินปืนหายาก", "ffid", 4590, 1, 1],
      ["FF-RNT1", "เช่าไอดี 1 วัน · VIP (ตัวอย่าง)", "เช่ารายวัน", "rent", 49, 10, 0],
      ["FF-RNT7", "เช่าไอดี 7 วัน · Heroic (ตัวอย่าง)", "เช่ารายสัปดาห์", "rent", 199, 8, 0],
      ["FF-RND1", "กล่องสุ่มรางวัล · เกรด A (ตัวอย่าง)", "สุ่มไอดี/ไอเทม", "random", 99, 20, 0],
      ["FF-EVT1", "ชุดกิจกรรมพิเศษ (ตัวอย่าง)", "ของจากอีเวนต์", "event", 590, 3, 1],
    ];
    db.transaction((rows) => rows.forEach((r) => ins.run(...r)))(items);
  }

  if (db.prepare("SELECT COUNT(*) AS c FROM auctions").get().c === 0) {
    db.prepare(`
      INSERT INTO auctions (title, description, image, start_price, current_bid, ends_at, example)
      VALUES (?, ?, null, ?, ?, datetime('now', '+2 days'), 1)
    `).run("ประมูลไอดี Heroic (ตัวอย่าง)", "เริ่มประมูลจากราคาเปิด", 500, 500);
    db.prepare(`
      INSERT INTO auctions (title, description, image, start_price, current_bid, ends_at, example)
      VALUES (?, ?, null, ?, ?, datetime('now', '+1 days'), 1)
    `).run("ประมูลไอดีสกินครบ (ตัวอย่าง)", "บิดได้สูงกว่าปัจจุบัน", 1000, 1000);
  }

  if (db.prepare("SELECT COUNT(*) AS c FROM minigames").get().c === 0) {
    const info = db.prepare(`
      INSERT INTO minigames (slug, title, subtitle, price, image, example)
      VALUES (?, ?, ?, ?, null, 1)
    `).run("skin-random", "สุ่มไอดีสกิน", "10.00 บาท / ครั้ง", 10);
    const pins = db.prepare("INSERT INTO minigame_prizes (minigame_id, label, weight) VALUES (?, ?, ?)");
    [
      ["ไม่ได้รางวัล (เกลือ) — ตัวอย่าง", 40],
      ["คูปองส่วนลด 5 บาท — ตัวอย่าง", 25],
      ["ไอดี Gold เล็ก — ตัวอย่าง", 20],
      ["ไอดี Diamond — ตัวอย่าง", 10],
      ["ไอดี Heroic สกินเยอะ — ตัวอย่าง", 5],
    ].forEach(([label, w]) => pins.run(info.lastInsertRowid, label, w));

    const info2 = db.prepare(`
      INSERT INTO minigames (slug, title, subtitle, price, image, example)
      VALUES (?, ?, ?, ?, null, 1)
    `).run("box-99", "กล่องสุ่ม 99 บาท", "99.00 บาท / ครั้ง", 99);
    [
      ["ไม่ได้รางวัล — ตัวอย่าง", 30],
      ["เครดิตคืน 20 บาท — ตัวอย่าง", 30],
      ["ไอดีแรร์ — ตัวอย่าง", 30],
      ["แจ็คพอตไอดีโหด — ตัวอย่าง", 10],
    ].forEach(([label, w]) => pins.run(info2.lastInsertRowid, label, w));
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
  set.run("announcement", "ยินดีต้อนรับสู่ HAHA SHOP — สมัครสมาชิก · เติมเครดิตซองอั่งเปา · สินค้าตัวอย่าง");
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

module.exports = { db, getSetting, setSetting, writeAudit, DATA_DIR, DB_PATH };

