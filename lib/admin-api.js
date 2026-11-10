const express = require("express");
const path = require("path");
const fs = require("fs");
const { db, getSetting, setSetting, writeAudit, removeProduct, removeMinigame, applyBalance, ledgerMismatches } = require("./db");
const bcrypt = require("bcryptjs");
const { uploadSingle, imageFromRequest } = require("./images");
const { clientIp } = require("./security");

function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบก่อน" });
  }
  const user = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(req.session.userId);
  if (!user || user.role !== "admin") {
    return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "สำหรับแอดมินเท่านั้น" });
  }
  req.admin = user;
  next();
}

function audit(req, action, detail) {
  writeAudit(req.admin, action, detail, clientIp(req));
}


function createAdminRouter() {
  const router = express.Router();
  router.use(requireAdmin);

  // Health/diagnostics for the admin (no secrets): what the server sees behind the proxy.
  router.get("/diag", (req, res) => {
    const { publicBase, smtpConfigured } = require("./mailer");
    const { getSharp } = require("./images");
    const { turnstileOn } = require("./captcha");
    res.json({ ok: true, diag: {
      clientIp: clientIp(req), reqIp: req.ip, secure: req.secure, protocol: req.protocol,
      publicBase: publicBase(), smtp: smtpConfigured(), sharp: !!getSharp(), turnstile: turnstileOn(),
      discord: !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
      google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      node: process.version, ledgerMismatches: ledgerMismatches().length,
    } });
  });

  router.get("/dashboard", (_req, res) => {
    res.json({
      ok: true,
      stats: {
        users: db.prepare("SELECT COUNT(*) AS c FROM users").get().c,
        products: db.prepare("SELECT COUNT(*) AS c FROM products WHERE deleted = 0").get().c,
        orders: db.prepare("SELECT COUNT(*) AS c FROM orders").get().c,
        topups: db.prepare("SELECT COUNT(*) AS c FROM transactions WHERE type='topup' AND status='success'").get().c,
      },
      settings: {
        announcement: getSetting("announcement"),
        contact_url: getSetting("contact_url"),
        contact_label: getSetting("contact_label"),
      },
    });
  });

  router.post("/settings", (req, res) => {
    const { announcement, contact_url, contact_label } = req.body || {};
    if (announcement !== undefined) setSetting("announcement", String(announcement).slice(0, 500));
    if (contact_url !== undefined) setSetting("contact_url", String(contact_url).slice(0, 300));
    if (contact_label !== undefined) setSetting("contact_label", String(contact_label).slice(0, 80));
    audit(req, "settings.update", "announcement/contact");
    res.json({
      ok: true,
      message: "บันทึกการตั้งค่าแล้ว",
      settings: {
        announcement: getSetting("announcement"),
        contact_url: getSetting("contact_url"),
        contact_label: getSetting("contact_label"),
      },
    });
  });

  router.post("/cover", uploadSingle("image"), async (req, res) => {
    const url = await imageFromRequest(req, { maxW: 1800, maxH: 1400 });
    if (!url) return res.status(400).json({ ok: false, message: "กรุณาเลือกรูปปก หรือใส่ลิงก์รูป" });
    setSetting("cover_image", url);
    audit(req, "cover.update", url);
    res.json({ ok: true, message: "อัปเดตรูปปกแล้ว", cover: "/img/cover.jpg?" + Date.now() });
  });

  // —— Products ——
  router.get("/products", (_req, res) => {
    res.json({ ok: true, products: db.prepare("SELECT id FROM products WHERE deleted = 0 ORDER BY id DESC").all().map((r) => productOut(r.id)) });
  });

  function productFields(b, p = {}) {
    const num = (v, d) => (v === undefined || v === "" ? d : Number(v));
    const sku = String(b.sku ?? p.sku ?? "").trim().slice(0, 40);
    const title = String(b.title ?? p.title ?? "").trim().slice(0, 120);
    const price = Math.round(num(b.price, p.price) * 100) / 100;
    const stock = Math.floor(num(b.stock, p.stock ?? 1));
    if (!sku || !title) throw Object.assign(new Error("กรอกรหัส (SKU) และชื่อสินค้าให้ครบ"), { status: 400, expose: true });
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000) throw Object.assign(new Error("ราคาไม่ถูกต้อง (0 – 1,000,000)"), { status: 400, expose: true });
    if (!Number.isFinite(stock) || stock < 0 || stock > 100000) throw Object.assign(new Error("จำนวนคงเหลือไม่ถูกต้อง"), { status: 400, expose: true });
    const flag = (v, d) => (v === undefined ? d : v === "1" || v === true || v === "true" ? 1 : 0);
    return {
      sku, title, price, stock,
      description: String(b.description ?? p.description ?? "").slice(0, 2000),
      category: String(b.category || p.category || "ffid").trim().slice(0, 40),
      installment: flag(b.installment, b.sku !== undefined ? 0 : p.installment || 0),
      delivery_note: String(b.delivery_note ?? p.delivery_note ?? "").slice(0, 2000),
    };
  }
  /** One account per line → product_items. Returns number added. */
  function addItems(productId, raw) {
    const lines = String(raw || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 500);
    const ins = db.prepare("INSERT INTO product_items (product_id, secret) VALUES (?, ?)");
    lines.forEach((l) => ins.run(productId, l.slice(0, 1000)));
    return lines.length;
  }
  function syncStockWithItems(productId) {
    const total = db.prepare("SELECT COUNT(*) AS c FROM product_items WHERE product_id = ?").get(productId).c;
    if (total > 0) {
      const free = db.prepare("SELECT COUNT(*) AS c FROM product_items WHERE product_id = ? AND order_id IS NULL").get(productId).c;
      db.prepare("UPDATE products SET stock = ? WHERE id = ?").run(free, productId);
    }
  }
  function productOut(id) {
    const p = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!p) return null;
    const it = db.prepare("SELECT COUNT(*) AS total, SUM(order_id IS NULL) AS free FROM product_items WHERE product_id = ?").get(id);
    return { ...p, items_total: it.total || 0, items_free: it.free || 0 };
  }
  function productError(res, e) {
    const msg = e.expose ? e.message : String(e.message || "").includes("UNIQUE") ? "รหัสสินค้า (SKU) ซ้ำ" : "บันทึกสินค้าไม่สำเร็จ";
    if (!e.expose) console.error("[admin] product save:", e.message);
    res.status(e.status || 400).json({ ok: false, message: msg });
  }

  router.post("/products", uploadSingle("image"), async (req, res) => {
    try {
      const f = productFields(req.body || {});
      const image = (await imageFromRequest(req)) || null;
      const id = db.transaction(() => {
        const info = db.prepare(`
          INSERT INTO products (sku, title, description, category, price, stock, image, installment, example, delivery_note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        `).run(f.sku, f.title, f.description, f.category, f.price, f.stock, image, f.installment, f.delivery_note);
        addItems(info.lastInsertRowid, req.body?.items);
        syncStockWithItems(info.lastInsertRowid);
        return info.lastInsertRowid;
      })();
      audit(req, "product.create", f.sku);
      res.json({ ok: true, message: "เพิ่มสินค้าแล้ว", product: productOut(id) });
    } catch (e) { productError(res, e); }
  });

  router.put("/products/:id", uploadSingle("image"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const p = db.prepare("SELECT * FROM products WHERE id = ? AND deleted = 0").get(id);
      if (!p) return res.status(404).json({ ok: false, message: "ไม่พบสินค้า" });
      const b = req.body || {};
      const f = productFields(b, p);
      const newImage = await imageFromRequest(req);
      const image = newImage === undefined ? (b.remove_image === "1" ? null : p.image) : newImage;
      db.transaction(() => {
        db.prepare(`UPDATE products SET sku=?, title=?, description=?, category=?, price=?, stock=?, image=?, installment=?, example=0, delivery_note=? WHERE id=?`)
          .run(f.sku, f.title, f.description, f.category, f.price, f.stock, image, f.installment, f.delivery_note, id);
        addItems(id, b.items);
        syncStockWithItems(id);
      })();
      audit(req, "product.update", String(id));
      res.json({ ok: true, message: "บันทึกสินค้าแล้ว", product: productOut(id) });
    } catch (e) { productError(res, e); }
  });

  router.delete("/products/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: "รหัสสินค้าไม่ถูกต้อง" });
    try {
      const r = removeProduct(id);
      if (!r.found) return res.status(404).json({ ok: false, message: "ไม่พบสินค้า" });
      audit(req, r.soft ? "product.soft_delete" : "product.delete", `${id} ${r.sku}`);
      res.json({ ok: true, soft: r.soft, message: r.soft ? "ลบสินค้าแล้ว (เก็บประวัติออเดอร์ไว้)" : "ลบสินค้าแล้ว" });
    } catch (e) {
      console.error("[admin] product delete failed:", e.message);
      res.status(500).json({ ok: false, message: "ลบสินค้าไม่สำเร็จ" });
    }
  });

  // —— Categories ——
  router.get("/categories", (_req, res) => {
    res.json({ ok: true, categories: db.prepare("SELECT * FROM categories ORDER BY sort_order, id").all() });
  });

  router.post("/categories", uploadSingle("image"), async (req, res) => {
    const b = req.body || {};
    const id = String(b.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!id || !b.title) return res.status(400).json({ ok: false, message: "ต้องมี id และชื่อหมวด" });
    const image = (await imageFromRequest(req)) || null;
    try {
      db.prepare(`INSERT INTO categories (id, title, subtitle, tone, image, sort_order) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, String(b.title), String(b.subtitle || ""), String(b.tone || "blue"), image, Number(b.sort_order || 0));
      res.json({ ok: true, category: db.prepare("SELECT * FROM categories WHERE id=?").get(id) });
    } catch (e) {
      res.status(400).json({ ok: false, message: "รหัสหมวดซ้ำหรือไม่ถูกต้อง" });
    }
  });

  router.put("/categories/:id", uploadSingle("image"), async (req, res) => {
    const id = req.params.id;
    const c = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
    if (!c) return res.status(404).json({ ok: false, message: "ไม่พบหมวดหมู่" });
    const b = req.body || {};
    const newImage = await imageFromRequest(req);
    const image = newImage === undefined ? (b.remove_image === "1" ? null : c.image) : newImage;
    db.prepare(`UPDATE categories SET title=?, subtitle=?, tone=?, image=?, sort_order=? WHERE id=?`)
      .run(String(b.title || c.title), String(b.subtitle ?? c.subtitle ?? ""), String(b.tone || c.tone), image, Number(b.sort_order ?? c.sort_order), id);
    res.json({ ok: true, category: db.prepare("SELECT * FROM categories WHERE id=?").get(id) });
  });

  router.delete("/categories/:id", (req, res) => {
    db.prepare("DELETE FROM categories WHERE id = ?").run(req.params.id);
    res.json({ ok: true, message: "ลบหมวดแล้ว" });
  });

  // —— Minigames ——
  router.get("/minigames", (_req, res) => {
    const games = db.prepare("SELECT * FROM minigames WHERE deleted = 0 ORDER BY id").all().map((g) => ({
      ...g,
      prizes: db.prepare("SELECT * FROM minigame_prizes WHERE minigame_id=? ORDER BY id").all(g.id),
    }));
    res.json({ ok: true, minigames: games });
  });

  router.post("/minigames", uploadSingle("image"), async (req, res) => {
    const b = req.body || {};
    const slug = String(b.slug || b.title || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || `mg-${Date.now()}`;
    const image = (await imageFromRequest(req)) || null;
    try {
      const info = db.prepare(`INSERT INTO minigames (slug, title, subtitle, price, image, example) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(slug, String(b.title || "").trim(), String(b.subtitle || ""), Number(b.price || 0), image, 0);
      const prizes = parsePrizes(b.prizes);
      const pins = db.prepare("INSERT INTO minigame_prizes (minigame_id, label, weight) VALUES (?, ?, ?)");
      prizes.forEach(([label, w]) => pins.run(info.lastInsertRowid, label, w));
      res.json({ ok: true, minigame: db.prepare("SELECT * FROM minigames WHERE id=?").get(info.lastInsertRowid) });
    } catch (e) {
      res.status(400).json({ ok: false, message: e.message });
    }
  });

  router.put("/minigames/:id", uploadSingle("image"), async (req, res) => {
    const id = Number(req.params.id);
    const g = db.prepare("SELECT * FROM minigames WHERE id=?").get(id);
    if (!g) return res.status(404).json({ ok: false, message: "ไม่พบมินิเกม" });
    const b = req.body || {};
    const newImage = await imageFromRequest(req);
    const image = newImage === undefined ? (b.remove_image === "1" ? null : g.image) : newImage;
    db.prepare(`UPDATE minigames SET title=?, subtitle=?, price=?, image=? WHERE id=?`)
      .run(String(b.title || g.title), String(b.subtitle ?? g.subtitle ?? ""), Number(b.price ?? g.price), image, id);
    if (b.prizes !== undefined) {
      db.prepare("DELETE FROM minigame_prizes WHERE minigame_id=?").run(id);
      const pins = db.prepare("INSERT INTO minigame_prizes (minigame_id, label, weight) VALUES (?, ?, ?)");
      parsePrizes(b.prizes).forEach(([label, w]) => pins.run(id, label, w));
    }
    res.json({
      ok: true,
      minigame: db.prepare("SELECT * FROM minigames WHERE id=?").get(id),
      prizes: db.prepare("SELECT * FROM minigame_prizes WHERE minigame_id=?").all(id),
    });
  });

  router.delete("/minigames/:id", (req, res) => {
    const id = Number(req.params.id);
    try {
      const r = removeMinigame(id);
      if (!r.found) return res.status(404).json({ ok: false, message: "ไม่พบมินิเกม" });
      audit(req, "minigame.delete", String(id));
      res.json({ ok: true, message: "ลบแล้ว" });
    } catch (e) {
      res.status(500).json({ ok: false, message: "ลบไม่สำเร็จ" });
    }
  });

  // —— Auctions ——
  router.get("/auctions", (_req, res) => {
    res.json({ ok: true, auctions: db.prepare("SELECT * FROM auctions ORDER BY id DESC").all() });
  });

  router.post("/auctions", uploadSingle("image"), async (req, res) => {
    const b = req.body || {};
    const start = Number(b.start_price || 0);
    const image = (await imageFromRequest(req)) || null;
    const ends = b.ends_at || null;
    const info = db.prepare(`
      INSERT INTO auctions (title, description, image, start_price, current_bid, ends_at, example)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(String(b.title || "").trim(), String(b.description || ""), image, start, start, ends);
    res.json({ ok: true, auction: db.prepare("SELECT * FROM auctions WHERE id=?").get(info.lastInsertRowid) });
  });

  router.put("/auctions/:id", uploadSingle("image"), async (req, res) => {
    const id = Number(req.params.id);
    const a = db.prepare("SELECT * FROM auctions WHERE id=?").get(id);
    if (!a) return res.status(404).json({ ok: false, message: "ไม่พบประมูล" });
    const b = req.body || {};
    const newImage = await imageFromRequest(req);
    const image = newImage === undefined ? (b.remove_image === "1" ? null : a.image) : newImage;
    db.prepare(`UPDATE auctions SET title=?, description=?, image=?, start_price=?, ends_at=? WHERE id=?`)
      .run(String(b.title || a.title), String(b.description ?? a.description ?? ""), image, Number(b.start_price ?? a.start_price), b.ends_at ?? a.ends_at, id);
    res.json({ ok: true, auction: db.prepare("SELECT * FROM auctions WHERE id=?").get(id) });
  });

  router.delete("/auctions/:id", (req, res) => {
    const id = Number(req.params.id);
    db.prepare("DELETE FROM auction_bids WHERE auction_id=?").run(id);
    db.prepare("DELETE FROM auctions WHERE id=?").run(id);
    res.json({ ok: true });
  });

  // —— Members ——
  router.get("/users", (_req, res) => {
    const users = db.prepare(`SELECT id, username, email, email_verified, (discord_id IS NOT NULL) AS discord, (google_id IS NOT NULL) AS google,
      balance, points, role, created_at FROM users ORDER BY id DESC LIMIT 500`).all();
    res.json({ ok: true, users });
  });

  router.post("/users/:id/credit", (req, res) => {
    const id = Number(req.params.id);
    const amount = Number(req.body?.amount);
    const mode = req.body?.mode === "add" ? "add" : "set";
    const note = String(req.body?.note || "").slice(0, 80);
    if (!Number.isInteger(id) || !Number.isFinite(amount) || Math.abs(amount) > 1e7) {
      return res.status(400).json({ ok: false, message: "จำนวนไม่ถูกต้อง" });
    }
    if (mode === "set" && amount < 0) return res.status(400).json({ ok: false, message: "ยอดต้องไม่ติดลบ" });
    try {
      const out = db.transaction(() => {
        const user = db.prepare("SELECT id, username, balance, role FROM users WHERE id=?").get(id);
        if (!user) throw Object.assign(new Error("ไม่พบสมาชิก"), { status: 404 });
        const delta = mode === "add" ? amount : Math.round((amount - user.balance) * 100) / 100;
        if (Math.abs(delta) < 0.005) return { user, newBal: user.balance, delta: 0 };
        const newBal = applyBalance(id, delta, { reason: "admin_adjust", ref: note || mode, adminId: req.admin.id });
        return { user, newBal, delta };
      })();
      audit(req, "user.credit", `${out.user.username} ${out.delta >= 0 ? "+" : ""}${out.delta} -> ${out.newBal} (${mode}) ${note}`);
      res.json({ ok: true, message: "ปรับเครดิตแล้ว", user: { id: out.user.id, username: out.user.username, balance: out.newBal, role: out.user.role } });
    } catch (e) {
      res.status(e.status || 400).json({ ok: false, message: e.status ? e.message : "ปรับเครดิตไม่สำเร็จ" });
    }
  });

  router.post("/users/:id/verify", (req, res) => {
    const id = Number(req.params.id);
    const r = db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(id);
    if (!r.changes) return res.status(404).json({ ok: false, message: "ไม่พบสมาชิก" });
    audit(req, "user.verify", String(id));
    res.json({ ok: true, message: "ยืนยันอีเมลให้แล้ว" });
  });

  // Admin sets a new password for a member (fallback when email reset is unavailable)
  router.post("/users/:id/password", (req, res) => {
    const id = Number(req.params.id);
    const password = String(req.body?.password || "");
    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({ ok: false, message: "รหัสผ่านต้องยาว 8–72 ตัวอักษร" });
    }
    const user = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(id);
    if (!user) return res.status(404).json({ ok: false, message: "ไม่พบสมาชิก" });
    if (user.role === "admin") {
      return res.status(403).json({ ok: false, message: "เปลี่ยนรหัสแอดมินด้วยสคริปต์ reset-admin-password เท่านั้น" });
    }
    db.prepare("UPDATE users SET password_hash = ?, pw_version = pw_version + 1 WHERE id = ?")
      .run(bcrypt.hashSync(password, 10), id);
    db.prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(Date.now(), id);
    audit(req, "user.password_reset", user.username);
    res.json({ ok: true, message: `ตั้งรหัสผ่านใหม่ให้ ${user.username} แล้ว` });
  });

  // —— Ledger ——
  router.get("/ledger", (req, res) => {
    const uid = req.query.user ? Number(req.query.user) : null;
    const rows = db.prepare(`
      SELECT l.*, u.username, a.username AS admin_name FROM ledger l
      JOIN users u ON u.id = l.user_id LEFT JOIN users a ON a.id = l.admin_id
      ${uid ? "WHERE l.user_id = ?" : ""} ORDER BY l.id DESC LIMIT 200`).all(...(uid ? [uid] : []));
    res.json({ ok: true, ledger: rows, mismatches: ledgerMismatches() });
  });

  // —— Mail test (shows the real SMTP error to the admin) ——
  router.post("/mail-test", async (req, res) => {
    const { sendMail, smtpConfigured } = require("./mailer");
    if (!smtpConfigured()) return res.status(400).json({ ok: false, message: "ยังไม่ได้ตั้งค่า SMTP_HOST / MAIL_FROM" });
    const to = String(req.body?.to || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ ok: false, message: "อีเมลไม่ถูกต้อง" });
    try {
      await sendMail({ to, subject: "HAHA SHOP — ทดสอบอีเมล", text: "ส่งอีเมลจาก HAHA SHOP สำเร็จ ✔" });
      res.json({ ok: true, message: "ส่งอีเมลทดสอบแล้ว" });
    } catch (e) {
      res.status(502).json({ ok: false, message: "ส่งไม่สำเร็จ: " + String((e && (e.response || e.code || e.message)) || "").slice(0, 200) });
    }
  });

  // —— Orders / topups ——
  router.get("/orders", (_req, res) => {
    const orders = db.prepare(`
      SELECT o.id, o.user_id, o.product_id, o.product_title, o.price, o.status, o.created_at, (o.delivered IS NOT NULL) AS delivered, u.username FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 100
    `).all();
    res.json({ ok: true, orders });
  });

  router.get("/topups", (_req, res) => {
    const topups = db.prepare(`
      SELECT t.*, u.username FROM transactions t JOIN users u ON u.id=t.user_id
      WHERE t.type='topup' ORDER BY t.id DESC LIMIT 100
    `).all();
    res.json({ ok: true, topups });
  });

  // multer error handler
  router.use((err, _req, res, _next) => {
    if (!err.expose) console.error("[admin] error:", err && err.message);
    res.status(err.status || 400).json({ ok: false, message: err.expose ? err.message : "ทำรายการไม่สำเร็จ" });
  });

  return router;
}

function parsePrizes(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((p) => [String(p.label || p[0]), Number(p.weight || p[1] || 1)]);
  }
  // "label|weight\n..."
  return String(raw)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, w] = line.split("|");
      return [label.trim(), Number(w || 1) || 1];
    });
}

module.exports = { createAdminRouter, requireAdmin };
