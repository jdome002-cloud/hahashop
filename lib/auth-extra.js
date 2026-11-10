/**
 * HAHA SHOP — extra auth: Discord OAuth2 sign-in and email password reset.
 * Secrets come only from env vars and are never logged.
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { db, writeAudit } = require("./db");
const { clientIp } = require("./security");

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const RESET_TTL_MS = 30 * 60 * 1000;
const OAUTH_COOKIE = "hh_oauth";

function normEmail(v) {
  const e = String(v || "").trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

function publicBase() {
  const raw = String(process.env.PUBLIC_URL || "").split(",")[0].trim().replace(/\/+$/, "");
  if (!raw) return "";
  try { const u = new URL(raw.includes("://") ? raw : `https://${raw}`); return u.origin; } catch (_) { return ""; }
}

function discordConfigured() {
  return !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET && publicBase());
}
function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.MAIL_FROM && publicBase());
}

let transporter = null;
function getTransport() {
  if (transporter) return transporter;
  const nodemailer = require("nodemailer");
  const port = Number(process.env.SMTP_PORT || 587);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return transporter;
}

function sha256(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }
function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Pick a free username derived from a Discord name. */
function uniqueUsername(base) {
  let u = String(base || "").normalize("NFKD").replace(/[^A-Za-z0-9_]/g, "").slice(0, 18);
  if (u.length < 3) u = "user" + u;
  if (u.toLowerCase() === "admin") u = "admin_user";
  const exists = (n) => db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(n);
  if (!exists(u)) return u;
  for (let i = 0; i < 50; i++) {
    const cand = `${u.slice(0, 18)}_${crypto.randomInt(1000, 99999)}`;
    if (!exists(cand)) return cand;
  }
  return `user_${crypto.randomBytes(6).toString("hex")}`;
}

const limiter = (max, windowMs, message) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  validate: { keyGeneratorIpFallback: false },
  message: { ok: false, message },
});

/**
 * @param app express app
 * @param startSession (req, res, user, cb) — regenerates the session for user
 */
function mountAuthExtra(app, { startSession }) {
  const oauthLimiter = limiter(20, 10 * 60 * 1000, "พยายามบ่อยเกินไป กรุณารอสักครู่");
  const forgotLimiter = limiter(3, 15 * 60 * 1000, "ขอรีเซ็ตรหัสผ่านบ่อยเกินไป กรุณารอ 15 นาที");
  const resetLimiter = limiter(10, 15 * 60 * 1000, "พยายามบ่อยเกินไป กรุณารอสักครู่");
  const perEmail = new Map(); // email hash -> last request ms

  const back = (res, code) => res.redirect(302, `/#/auth?e=${encodeURIComponent(code)}`);

  /* —— Discord OAuth2 —— */
  app.get("/auth/discord", oauthLimiter, (req, res) => {
    if (!discordConfigured()) return back(res, "discord_off");
    const state = crypto.randomBytes(24).toString("base64url");
    // Separate Lax cookie: the session cookie is SameSite=Strict and is not sent on the
    // cross-site redirect back from discord.com.
    res.cookie(OAUTH_COOKIE, state, {
      httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 10 * 60 * 1000, path: "/auth/discord",
    });
    const q = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: publicBase() + "/auth/discord/callback",
      response_type: "code",
      scope: "identify email",
      state,
    });
    res.redirect(302, "https://discord.com/oauth2/authorize?" + q.toString());
  });

  app.get("/auth/discord/callback", oauthLimiter, async (req, res) => {
    const cookieState = req.cookies ? req.cookies[OAUTH_COOKIE] : parseCookie(req.headers.cookie, OAUTH_COOKIE);
    res.clearCookie(OAUTH_COOKIE, { path: "/auth/discord" });
    if (!discordConfigured()) return back(res, "discord_off");
    if (req.query.error) return back(res, "discord_cancel");
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    if (!code || !state || !cookieState || !safeEqual(state, cookieState)) return back(res, "discord_state");
    try {
      const tokRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
          redirect_uri: publicBase() + "/auth/discord/callback",
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!tokRes.ok) return back(res, "discord_fail");
      const tok = await tokRes.json();
      if (!tok.access_token) return back(res, "discord_fail");
      const meRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${tok.access_token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!meRes.ok) return back(res, "discord_fail");
      const me = await meRes.json();
      const discordId = String(me.id || "");
      if (!/^\d{5,25}$/.test(discordId)) return back(res, "discord_fail");
      const email = me.verified ? normEmail(me.email) : null;

      let user = db.prepare("SELECT * FROM users WHERE discord_id = ?").get(discordId);
      if (!user && email) {
        const byEmail = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email);
        if (byEmail) {
          if (byEmail.role === "admin") return back(res, "discord_admin");
          db.prepare("UPDATE users SET discord_id = ? WHERE id = ?").run(discordId, byEmail.id);
          user = db.prepare("SELECT * FROM users WHERE id = ?").get(byEmail.id);
          writeAudit(null, "discord.link", byEmail.username, clientIp(req));
        }
      }
      if (!user) {
        const username = uniqueUsername(me.username || me.global_name || "discord");
        const randomPw = bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 10);
        const info = db.prepare(
          "INSERT INTO users (username, password_hash, balance, role, email, discord_id) VALUES (?, ?, 0, 'user', ?, ?)"
        ).run(username, randomPw, email, discordId);
        user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
        writeAudit(null, "discord.signup", username, clientIp(req));
      }
      if (user.role === "admin") return back(res, "discord_admin");
      startSession(req, res, user, (err) => {
        if (err) return back(res, "discord_fail");
        res.redirect(302, "/#/auth?ok=discord");
      });
    } catch (e) {
      console.error("[discord] sign-in failed:", e && e.name);
      back(res, "discord_fail");
    }
  });

  /* —— Forgot / reset password —— */
  app.post("/api/password/forgot", forgotLimiter, async (req, res) => {
    if (!smtpConfigured()) {
      return res.status(503).json({ ok: false, error: "RESET_UNAVAILABLE", message: "ระบบรีเซ็ตรหัสผ่านทางอีเมลยังไม่เปิดใช้งาน กรุณาติดต่อแอดมินเพื่อตั้งรหัสใหม่" });
    }
    const generic = { ok: true, message: "ถ้าอีเมลนี้มีบัญชีอยู่ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปแล้ว (หมดอายุใน 30 นาที)" };
    const email = normEmail(req.body?.email);
    if (!email) return res.status(400).json({ ok: false, message: "กรุณากรอกอีเมลให้ถูกต้อง" });
    const key = sha256(email);
    const last = perEmail.get(key) || 0;
    if (Date.now() - last < 2 * 60 * 1000) return res.json(generic);
    perEmail.set(key, Date.now());
    const user = db.prepare("SELECT id, username, email, role FROM users WHERE email = ? COLLATE NOCASE").get(email);
    res.json(generic); // same answer whether or not the email exists
    if (!user) return;
    try {
      const token = crypto.randomBytes(32).toString("base64url");
      db.prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(Date.now(), user.id);
      db.prepare("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
        .run(user.id, sha256(token), Date.now() + RESET_TTL_MS);
      const link = `${publicBase()}/#/reset?token=${token}`;
      await getTransport().sendMail({
        from: process.env.MAIL_FROM,
        to: user.email,
        subject: "HAHA SHOP — ตั้งรหัสผ่านใหม่ / Reset your password",
        text: `สวัสดี ${user.username}\n\nกดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่ (หมดอายุใน 30 นาที ใช้ได้ครั้งเดียว):\n${link}\n\nถ้าคุณไม่ได้ขอ ไม่ต้องทำอะไร\n\nReset link (expires in 30 minutes, single use):\n${link}\n`,
      });
      writeAudit({ id: user.id, username: user.username }, "password.reset_requested", "", clientIp(req));
    } catch (e) {
      console.error("[mail] reset email failed:", e && (e.code || e.name));
    }
  });

  app.post("/api/password/reset", resetLimiter, (req, res) => {
    const token = String(req.body?.token || "");
    const password = String(req.body?.password || "");
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return res.status(400).json({ ok: false, message: "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว" });
    if (password.length < 6 || password.length > 72) return res.status(400).json({ ok: false, message: "รหัสผ่านต้องยาว 6–72 ตัวอักษร" });
    const ok = db.transaction(() => {
      const row = db.prepare("SELECT * FROM password_resets WHERE token_hash = ?").get(sha256(token));
      if (!row || row.used_at || row.expires_at < Date.now()) return null;
      const user = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(row.user_id);
      if (!user) return null;
      db.prepare("UPDATE users SET password_hash = ?, pw_version = pw_version + 1 WHERE id = ?")
        .run(bcrypt.hashSync(password, 10), user.id);
      db.prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(Date.now(), user.id);
      return user;
    })();
    if (!ok) return res.status(400).json({ ok: false, message: "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว" });
    writeAudit({ id: ok.id, username: ok.username }, "password.reset_done", "", clientIp(req));
    res.json({ ok: true, message: "ตั้งรหัสผ่านใหม่แล้ว เข้าสู่ระบบด้วยรหัสใหม่ได้เลย" });
  });
}

function parseCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { return ""; }
    }
  }
  return "";
}

module.exports = { mountAuthExtra, normEmail, discordConfigured, smtpConfigured };
