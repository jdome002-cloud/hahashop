const express = require("express");
const path = require("path");
const fs = require("fs");
const { db, getSetting, setSetting, writeAudit } = require("./db");
const { upload, publicUploadPath, reencodeUpload } = require("./upload");
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

async function handleUpload(req, opts) {
  if (!req.file) return null;
  return reencodeUpload(req.file, opts);
}

function createAdminRouter() {
  const router = express.Router();
  router.use(requireAdmin);

  router.get("/dashboard", (_req, res) => {
    res.json({
      ok: true,
      stats: {
        users: db.prepare("SELECT COUNT(*) AS c FROM users").get().c,
        products: db.prepare("SELECT COUNT(*) AS c FROM products").get().c,
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

  router.post("/cover", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ ok: false, message: "กรุณาอัปโหลดรูปปก" });
      const url = await reencodeUpload(req.file, { maxW: 1600, maxH: 1200, asJpeg: true });
      const dest = path.join(__dirname, "..", "public", "img", "cover.jpg");
      fs.copyFileSync(req.file.path, dest);
      setSetting("cover_upload", url);
      audit(req, "cover.update", url);
      res.json({ ok: true, message: "อัปเดตรูปปกแล้ว", cover: "/img/cover.jpg?" + Date.now(), upload: url });
    } catch (e) {
      res.status(400).json({ ok: false, message: e.message || "อัปโหลดรูปปกไม่สำเร็จ" });
    }
  });

  // —— Products ——
  router.get("/products", (_req, res) => {
    res.json({ ok: true, products: db.prepare("SELECT * FROM products ORDER BY id DESC").all() });
  });

  router.post("/products", upload.single("image"), async (req, res) => {
    try {
      const b = req.body || {};
      const sku = String(b.sku || "").trim().slice(0, 40);
      const title = String(b.title || "").trim().slice(0, 120);
      const category = String(b.category || "ffid").trim().slice(0, 40);
      const price = Number(b.price);
      const stock = Math.max(0, Math.floor(Number(b.stock ?? 1)));
      if (!sku || !title || !Number.isFinite(price) || price < 0) {
        return res.status(400).json({ ok: false, message: "กรอก sku, ชื่อ และราคาให้ครบ" });
      }
      const image = req.file ? await reencodeUpload(req.file) : null;
      const info = db.prepare(`
        INSERT INTO products (sku, title, description, category, price, stock, image, installment, example)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sku, title, String(b.description || ""), category, price, stock,
        image, b.installment === "1" || b.installment === true || b.installment === "true" ? 1 : 0,
        b.example === "0" || b.example === false ? 0 : 1
      );
      const product = db.prepare("SELECT * FROM products WHERE id = ?").get(info.lastInsertRowid);
      audit(req, "product.create", product.sku);
      res.json({ ok: true, message: "เพิ่มสินค้าแล้ว", product });
    } catch (e) {
      res.status(400).json({ ok: false, message: String(e.message||"").includes("UNIQUE") ? "รหัสสินค้าซ้ำ" : "บันทึกสินค้าไม่สำเร็จ" });
    }
  });

  router.put("/products/:id", upload.single("image"), async (req, res) => {
    try {
    const id = Number(req.params.id);
    const p = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!p) return res.status(404).json({ ok: false, message: "ไม่พบสินค้า" });
    const b = req.body || {};
    const image = req.file ? await reencodeUpload(req.file) : p.image;
    db.prepare(`
      UPDATE products SET sku=?, title=?, description=?, category=?, price=?, stock=?, image=?, installment=?, example=?
      WHERE id=?
    `).run(
      String(b.sku || p.sku).trim(),
      String(b.title || p.title).trim(),
      String(b.description ?? p.description ?? ""),
      String(b.category || p.category),
      Number(b.price ?? p.price),
      Number(b.stock ?? p.stock),
      image,
      b.installment === "1" || b.installment === true || b.installment === "true" || (b.installment === undefined && p.installment) ? 1 : 0,
      b.example === "0" || b.example === false ? 0 : (b.example === undefined ? p.example : 1),
      id
    );
    audit(req, "product.update", String(id));
    res.json({ ok: true, message: "บันทึกสินค้าแล้ว", product: db.prepare("SELECT * FROM products WHERE id=?").get(id) });
    } catch (e) {
      res.status(400).json({ ok: false, message: e.message || "บันทึกสินค้าไม่สำเร็จ" });
    }
  });

  router.delete("/products/:id", (req, res) => {
    db.prepare("DELETE FROM products WHERE id = ?").run(Number(req.params.id));
    audit(req, "product.delete", String(req.params.id));
    res.json({ ok: true, message: "ลบสินค้าแล้ว" });
  });

  // —— Categories ——
  router.get("/categories", (_req, res) => {
    res.json({ ok: true, categories: db.prepare("SELECT * FROM categories ORDER BY sort_order, id").all() });
  });

  router.post("/categories", upload.single("image"), async (req, res) => {
    const b = req.body || {};
    const id = String(b.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!id || !b.title) return res.status(400).json({ ok: false, message: "ต้องมี id และชื่อหมวด" });
    const image = req.file ? await reencodeUpload(req.file) : null;
    try {
      db.prepare(`INSERT INTO categories (id, title, subtitle, tone, image, sort_order) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, String(b.title), String(b.subtitle || ""), String(b.tone || "blue"), image, Number(b.sort_order || 0));
      res.json({ ok: true, category: db.prepare("SELECT * FROM categories WHERE id=?").get(id) });
    } catch (e) {
      res.status(400).json({ ok: false, message: "รหัสหมวดซ้ำหรือไม่ถูกต้อง" });
    }
  });

  router.put("/categories/:id", upload.single("image"), async (req, res) => {
    const id = req.params.id;
    const c = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
    if (!c) return res.status(404).json({ ok: false, message: "ไม่พบหมวดหมู่" });
    const b = req.body || {};
    const image = req.file ? await reencodeUpload(req.file) : c.image;
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
    const games = db.prepare("SELECT * FROM minigames ORDER BY id").all().map((g) => ({
      ...g,
      prizes: db.prepare("SELECT * FROM minigame_prizes WHERE minigame_id=? ORDER BY id").all(g.id),
    }));
    res.json({ ok: true, minigames: games });
  });

  router.post("/minigames", upload.single("image"), async (req, res) => {
    const b = req.body || {};
    const slug = String(b.slug || b.title || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || `mg-${Date.now()}`;
    const image = req.file ? await reencodeUpload(req.file) : null;
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

  router.put("/minigames/:id", upload.single("image"), async (req, res) => {
    const id = Number(req.params.id);
    const g = db.prepare("SELECT * FROM minigames WHERE id=?").get(id);
    if (!g) return res.status(404).json({ ok: false, message: "ไม่พบมินิเกม" });
    const b = req.body || {};
    const image = req.file ? await reencodeUpload(req.file) : g.image;
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
    db.prepare("DELETE FROM minigame_prizes WHERE minigame_id=?").run(id);
    db.prepare("DELETE FROM minigames WHERE id=?").run(id);
    res.json({ ok: true });
  });

  // —— Auctions ——
  router.get("/auctions", (_req, res) => {
    res.json({ ok: true, auctions: db.prepare("SELECT * FROM auctions ORDER BY id DESC").all() });
  });

  router.post("/auctions", upload.single("image"), async (req, res) => {
    const b = req.body || {};
    const start = Number(b.start_price || 0);
    const image = req.file ? await reencodeUpload(req.file) : null;
    const ends = b.ends_at || null;
    const info = db.prepare(`
      INSERT INTO auctions (title, description, image, start_price, current_bid, ends_at, example)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(String(b.title || "").trim(), String(b.description || ""), image, start, start, ends);
    res.json({ ok: true, auction: db.prepare("SELECT * FROM auctions WHERE id=?").get(info.lastInsertRowid) });
  });

  router.put("/auctions/:id", upload.single("image"), async (req, res) => {
    const id = Number(req.params.id);
    const a = db.prepare("SELECT * FROM auctions WHERE id=?").get(id);
    if (!a) return res.status(404).json({ ok: false, message: "ไม่พบประมูล" });
    const b = req.body || {};
    const image = req.file ? await reencodeUpload(req.file) : a.image;
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
    const users = db.prepare(`SELECT id, username, balance, role, created_at FROM users ORDER BY id DESC`).all();
    res.json({ ok: true, users });
  });

  router.post("/users/:id/credit", (req, res) => {
    const id = Number(req.params.id);
    const amount = Number(req.body?.amount);
    const mode = String(req.body?.mode || "set"); // set | add
    if (!Number.isFinite(amount) || !Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "จำนวนไม่ถูกต้อง" });
    }
    if (Math.abs(amount) > 1e9) {
      return res.status(400).json({ ok: false, message: "จำนวนเกินกำหนด" });
    }
    try {
      const out = db.transaction(() => {
        const user = db.prepare("SELECT * FROM users WHERE id=?").get(id);
        if (!user) throw Object.assign(new Error("ไม่พบสมาชิก"), { status: 404 });
        let newBal = mode === "add" ? Number(user.balance) + amount : amount;
        if (!Number.isFinite(newBal) || newBal < 0) newBal = 0;
        newBal = Math.round(newBal * 100) / 100;
        db.prepare("UPDATE users SET balance=? WHERE id=?").run(newBal, id);
        db.prepare(`INSERT INTO transactions (user_id, type, amount, status, message) VALUES (?, 'admin_credit', ?, 'success', ?)`)
          .run(id, mode === "add" ? amount : newBal - user.balance, `แอดมินปรับเครดิต (${mode}) เป็น ${newBal}`);
        return { user, newBal };
      })();
      audit(req, "user.credit", `${out.user.username} -> ${out.newBal} (${mode})`);
      res.json({ ok: true, message: "ปรับเครดิตแล้ว", user: { id: out.user.id, username: out.user.username, balance: out.newBal, role: out.user.role } });
    } catch (e) {
      res.status(e.status || 400).json({ ok: false, message: e.status ? e.message : "ปรับเครดิตไม่สำเร็จ" });
    }
  });

  // —— Orders / topups ——
  router.get("/orders", (_req, res) => {
    const orders = db.prepare(`
      SELECT o.*, u.username FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 100
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
    res.status(400).json({ ok: false, message: err.message || "อัปโหลดไม่สำเร็จ" });
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
