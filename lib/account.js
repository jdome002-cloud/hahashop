/**
 * HAHA SHOP — accounts: signup/login (captcha + per account+IP lockout), email verification,
 * forgot/reset password, change password, and OAuth2 sign-in (Discord, Google).
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { db, writeAudit } = require("./db");
const { clientIp } = require("./security");
const { publicBase, smtpConfigured, sendMail } = require("./mailer");
const { verifyCaptcha } = require("./captcha");

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const RESET_TTL = 30 * 60 * 1000;
const VERIFY_TTL = 24 * 60 * 60 * 1000;
const PW_MIN = 8;
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 10);

const normEmail = (v) => { const e = String(v || "").trim().toLowerCase(); return e.length <= 254 && EMAIL_RE.test(e) ? e : null; };
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const limiter = (max, windowMs, message) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => clientIp(req), validate: { keyGeneratorIpFallback: false },
  message: { ok: false, error: "RATE_LIMIT", message },
});

/** Email verification is enforced only when mail can actually be sent. */
function verificationRequired() { return smtpConfigured(); }
function isVerified(u) { return !!u && (u.role === "admin" || !verificationRequired() || u.email_verified === 1); }

/* —— Login lockout: per (account, IP) and per IP —— */
const fails = new Map(); // key -> { n, first, lockedUntil }
const WINDOW = 15 * 60 * 1000;
function failState(key) {
  const now = Date.now(); let r = fails.get(key);
  if (!r || now - r.first > WINDOW && !(r.lockedUntil > now)) { r = { n: 0, first: now, lockedUntil: 0 }; fails.set(key, r); }
  return r;
}
function isLocked(...keys) { const now = Date.now(); return keys.some((k) => (fails.get(k)?.lockedUntil || 0) > now); }
function noteFail(key, limit) { const r = failState(key); r.n += 1; if (r.n >= limit) { r.lockedUntil = Date.now() + WINDOW; r.n = 0; r.first = Date.now(); } }
setInterval(() => { const now = Date.now(); for (const [k, r] of fails) if (now - r.first > WINDOW && !(r.lockedUntil > now)) fails.delete(k); }, 10 * 60 * 1000).unref();

function uniqueUsername(base) {
  let u = String(base || "").normalize("NFKD").replace(/[^A-Za-z0-9_]/g, "").slice(0, 18);
  if (u.length < 3) u = "user" + u;
  if (u.toLowerCase() === "admin") u = "admin_user";
  const exists = (n) => db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(n);
  if (!exists(u)) return u;
  for (let i = 0; i < 50; i++) { const c = `${u.slice(0, 17)}_${crypto.randomInt(1000, 99999)}`; if (!exists(c)) return c; }
  return `user_${crypto.randomBytes(6).toString("hex")}`;
}

async function sendVerification(user) {
  if (!verificationRequired() || !user.email) return false;
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("UPDATE email_verifications SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(Date.now(), user.id);
  db.prepare("INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES (?, ?, ?)").run(user.id, sha256(token), Date.now() + VERIFY_TTL);
  const link = `${publicBase()}/#/verify?token=${token}`;
  await sendMail({
    to: user.email,
    subject: "HAHA SHOP — ยืนยันอีเมล / Verify your email",
    text: `สวัสดี ${user.username}\n\nกดลิงก์นี้เพื่อยืนยันอีเมล (หมดอายุใน 24 ชั่วโมง ใช้ได้ครั้งเดียว):\n${link}\n\nVerify your email (expires in 24 hours, single use):\n${link}\n`,
  });
  return true;
}

function mountAccount(app, { startSession, publicUser, requireAuth }) {
  const loginLimiter = limiter(20, 5 * 60 * 1000, "พยายามบ่อยเกินไป กรุณารอสักครู่");
  const signupLimiter = limiter(6, 15 * 60 * 1000, "สมัครบ่อยเกินไป กรุณารอสักครู่");
  const forgotLimiter = limiter(5, 15 * 60 * 1000, "ขอรีเซ็ตรหัสผ่านบ่อยเกินไป กรุณารอ 15 นาที");
  const tokenLimiter = limiter(15, 15 * 60 * 1000, "พยายามบ่อยเกินไป กรุณารอสักครู่");
  const resendLimiter = limiter(3, 15 * 60 * 1000, "ส่งอีเมลยืนยันบ่อยเกินไป กรุณารอ 15 นาที");
  const oauthLimiter = limiter(30, 10 * 60 * 1000, "พยายามบ่อยเกินไป กรุณารอสักครู่");
  const perEmail = new Map(); // throttle per address
  const throttled = (k, ms) => { const last = perEmail.get(k) || 0; if (Date.now() - last < ms) return true; perEmail.set(k, Date.now()); return false; };
  const captchaFail = (res) => res.status(400).json({ ok: false, error: "CAPTCHA", message: "รหัสยืนยัน (captcha) ไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่" });

  /* —— Signup —— */
  app.post("/api/signup", signupLimiter, async (req, res) => {
    const b = req.body || {};
    if (!(await verifyCaptcha(req))) return captchaFail(res);
    const username = String(b.username || "").trim();
    const email = normEmail(b.email);
    const password = String(b.password || "");
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return res.status(400).json({ ok: false, message: "ชื่อผู้ใช้ต้องเป็น a-z, 0-9, _ ความยาว 3–24 ตัวอักษร" });
    if (!email) return res.status(400).json({ ok: false, message: "กรุณากรอกอีเมลให้ถูกต้อง" });
    if (password.length < PW_MIN || password.length > 72) return res.status(400).json({ ok: false, message: `รหัสผ่านต้องยาว ${PW_MIN}–72 ตัวอักษร` });
    if (b.terms !== true && b.terms !== "1" && b.terms !== "on") return res.status(400).json({ ok: false, message: "กรุณายอมรับเงื่อนไขการใช้งาน" });
    if (username.toLowerCase() === "admin") return res.status(403).json({ ok: false, message: "ไม่สามารถสมัครชื่อนี้ได้" });
    if (db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(username)) return res.status(409).json({ ok: false, message: "ชื่อผู้ใช้นี้ถูกใช้แล้ว" });
    if (db.prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE").get(email)) return res.status(409).json({ ok: false, message: "อีเมลนี้ถูกใช้แล้ว ลองเข้าสู่ระบบหรือกดลืมรหัสผ่าน" });
    let id;
    try {
      // Explicit columns only: balance/role/verified/points are never taken from the client.
      id = db.prepare("INSERT INTO users (username, password_hash, balance, role, email, email_verified, points, terms_at) VALUES (?, ?, 0, 'user', ?, 0, 0, datetime('now'))")
        .run(username, bcrypt.hashSync(password, 10), email).lastInsertRowid;
    } catch (_) { return res.status(409).json({ ok: false, message: "ชื่อผู้ใช้หรืออีเมลนี้ถูกใช้แล้ว" }); }
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    let mailSent = false;
    if (verificationRequired()) {
      try { mailSent = await sendVerification(user); } catch (e) { console.error("[mail] verification failed:", e && (e.code || e.name)); }
    }
    writeAudit({ id, username }, "user.signup", "", clientIp(req));
    startSession(req, res, user, (err) => {
      if (err) return res.status(500).json({ ok: false, message: "สมัครไม่สำเร็จ" });
      res.json({ ok: true, user: publicUser(user), csrfToken: req.session.csrfToken, needsVerify: !isVerified(user), mailSent,
        message: !isVerified(user) ? "สมัครสำเร็จ! กรุณายืนยันอีเมลก่อนเติมเงิน/ซื้อสินค้า" : "สมัครสมาชิกสำเร็จ" });
    });
  });

  /* —— Login —— */
  app.post("/api/login", loginLimiter, async (req, res) => {
    const ip = clientIp(req);
    const ident = String(req.body?.identifier ?? req.body?.username ?? "").trim().toLowerCase().slice(0, 254);
    const password = String(req.body?.password || "");
    const kAcct = `a:${ident}|${ip}`, kIp = `ip:${ip}`;
    if (isLocked(kAcct, kIp)) return res.status(429).json({ ok: false, error: "LOCKED", message: "ล็อกชั่วคราวเนื่องจากใส่รหัสผิดหลายครั้ง กรุณารอ 15 นาที" });
    if (!(await verifyCaptcha(req))) return captchaFail(res);
    const user = ident.includes("@")
      ? db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(ident)
      : db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(ident);
    // Always run bcrypt so response time doesn't reveal whether the account exists
    const okPw = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !okPw) {
      noteFail(kAcct, 5); noteFail(kIp, 30);
      writeAudit(null, "login.fail", ident.slice(0, 60), ip);
      return res.status(401).json({ ok: false, message: "ชื่อผู้ใช้/อีเมล หรือรหัสผ่านไม่ถูกต้อง" });
    }
    fails.delete(kAcct);
    startSession(req, res, user, (err) => {
      if (err) return res.status(500).json({ ok: false, message: "เข้าสู่ระบบไม่สำเร็จ" });
      res.json({ ok: true, user: publicUser(user), csrfToken: req.session.csrfToken, message: "เข้าสู่ระบบสำเร็จ" });
    });
  });

  /* —— Email verification —— */
  app.post("/api/email/verify", tokenLimiter, (req, res) => {
    const token = String(req.body?.token || "");
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return res.status(400).json({ ok: false, message: "ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุ" });
    const user = db.transaction(() => {
      const row = db.prepare("SELECT * FROM email_verifications WHERE token_hash = ?").get(sha256(token));
      if (!row || row.used_at || row.expires_at < Date.now()) return null;
      db.prepare("UPDATE email_verifications SET used_at = ? WHERE id = ?").run(Date.now(), row.id);
      db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(row.user_id);
      return db.prepare("SELECT id, username FROM users WHERE id = ?").get(row.user_id);
    })();
    if (!user) return res.status(400).json({ ok: false, message: "ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุ กรุณาขอลิงก์ใหม่" });
    writeAudit(user, "email.verified", "", clientIp(req));
    res.json({ ok: true, message: "ยืนยันอีเมลสำเร็จ" });
  });

  app.post("/api/email/resend", requireAuth, resendLimiter, async (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
    if (!user) return res.status(401).json({ ok: false, message: "กรุณาเข้าสู่ระบบก่อน" });
    if (isVerified(user)) return res.json({ ok: true, message: "อีเมลนี้ยืนยันแล้ว" });
    if (throttled("v:" + user.id, 2 * 60 * 1000)) return res.status(429).json({ ok: false, message: "เพิ่งส่งไปแล้ว กรุณารอ 2 นาที" });
    try { await sendVerification(user); res.json({ ok: true, message: "ส่งลิงก์ยืนยันใหม่แล้ว กรุณาเช็กกล่องจดหมาย (และสแปม)" }); }
    catch (e) { console.error("[mail] resend failed:", e && (e.code || e.name)); res.status(502).json({ ok: false, message: "ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่หรือติดต่อแอดมิน" }); }
  });

  /* —— Forgot / reset password —— */
  app.post("/api/password/forgot", forgotLimiter, async (req, res) => {
    if (!smtpConfigured()) return res.status(503).json({ ok: false, error: "RESET_UNAVAILABLE", message: "ระบบรีเซ็ตรหัสผ่านทางอีเมลยังไม่เปิดใช้งาน กรุณาติดต่อแอดมินเพื่อตั้งรหัสใหม่" });
    if (!(await verifyCaptcha(req))) return captchaFail(res);
    const email = normEmail(req.body?.email);
    if (!email) return res.status(400).json({ ok: false, message: "กรุณากรอกอีเมลให้ถูกต้อง" });
    const generic = { ok: true, message: "ถ้าอีเมลนี้มีบัญชีอยู่ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปแล้ว (หมดอายุใน 30 นาที)" };
    res.json(generic); // identical answer whether or not the account exists
    if (throttled("r:" + sha256(email), 2 * 60 * 1000)) return;
    const user = db.prepare("SELECT id, username, email FROM users WHERE email = ? COLLATE NOCASE").get(email);
    if (!user) return;
    try {
      const token = crypto.randomBytes(32).toString("base64url");
      db.prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(Date.now(), user.id);
      db.prepare("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)").run(user.id, sha256(token), Date.now() + RESET_TTL);
      const link = `${publicBase()}/#/reset?token=${token}`;
      await sendMail({
        to: user.email,
        subject: "HAHA SHOP — ตั้งรหัสผ่านใหม่ / Reset your password",
        text: `สวัสดี ${user.username}\n\nกดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่ (หมดอายุใน 30 นาที ใช้ได้ครั้งเดียว):\n${link}\n\nถ้าคุณไม่ได้ขอ ไม่ต้องทำอะไร\n\nReset link (expires in 30 minutes, single use):\n${link}\n`,
      });
      writeAudit(user, "password.reset_requested", "", clientIp(req));
    } catch (e) { console.error("[mail] reset email failed:", e && (e.code || e.name)); }
  });

  app.post("/api/password/reset", tokenLimiter, (req, res) => {
    const token = String(req.body?.token || "");
    const password = String(req.body?.password || "");
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return res.status(400).json({ ok: false, message: "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว" });
    if (password.length < PW_MIN || password.length > 72) return res.status(400).json({ ok: false, message: `รหัสผ่านต้องยาว ${PW_MIN}–72 ตัวอักษร` });
    const user = db.transaction(() => {
      const row = db.prepare("SELECT * FROM password_resets WHERE token_hash = ?").get(sha256(token));
      if (!row || row.used_at || row.expires_at < Date.now()) return null;
      const u = db.prepare("SELECT id, username FROM users WHERE id = ?").get(row.user_id);
      if (!u) return null;
      // A reset proves control of the inbox, so the email also counts as verified.
      db.prepare("UPDATE users SET password_hash = ?, pw_version = pw_version + 1, email_verified = 1 WHERE id = ?").run(bcrypt.hashSync(password, 10), u.id);
      db.prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(Date.now(), u.id);
      return u;
    })();
    if (!user) return res.status(400).json({ ok: false, message: "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่" });
    writeAudit(user, "password.reset_done", "", clientIp(req));
    res.json({ ok: true, message: "ตั้งรหัสผ่านใหม่แล้ว เข้าสู่ระบบด้วยรหัสใหม่ได้เลย" });
  });

  app.post("/api/account/password", requireAuth, tokenLimiter, (req, res) => {
    const cur = String(req.body?.current || ""), pw = String(req.body?.password || "");
    const u = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
    if (!u || !bcrypt.compareSync(cur, u.password_hash)) return res.status(400).json({ ok: false, message: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
    if (pw.length < PW_MIN || pw.length > 72) return res.status(400).json({ ok: false, message: `รหัสผ่านใหม่ต้องยาว ${PW_MIN}–72 ตัวอักษร` });
    db.prepare("UPDATE users SET password_hash = ?, pw_version = pw_version + 1 WHERE id = ?").run(bcrypt.hashSync(pw, 10), u.id);
    writeAudit(u, "password.change", "", clientIp(req));
    const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(u.id);
    startSession(req, res, fresh, () => res.json({ ok: true, message: "เปลี่ยนรหัสผ่านแล้ว", csrfToken: req.session.csrfToken }));
  });

  /* —— OAuth2: Discord + Google —— */
  const PROVIDERS = {
    discord: {
      id: () => process.env.DISCORD_CLIENT_ID, secret: () => process.env.DISCORD_CLIENT_SECRET, column: "discord_id",
      authorize: "https://discord.com/oauth2/authorize", token: "https://discord.com/api/oauth2/token", scope: "identify email", extra: {},
      async profile(at) {
        const r = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${at}` }, signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error("profile");
        const me = await r.json();
        return { sub: String(me.id || ""), email: me.verified ? normEmail(me.email) : null, name: me.username || me.global_name };
      },
    },
    google: {
      id: () => process.env.GOOGLE_CLIENT_ID, secret: () => process.env.GOOGLE_CLIENT_SECRET, column: "google_id",
      authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", scope: "openid email profile",
      extra: { prompt: "select_account" },
      async profile(at) {
        const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${at}` }, signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error("profile");
        const me = await r.json();
        return { sub: String(me.sub || ""), email: me.email_verified ? normEmail(me.email) : null, name: (me.email || "").split("@")[0] || me.name };
      },
    },
  };
  const configured = (p) => !!(PROVIDERS[p] && PROVIDERS[p].id() && PROVIDERS[p].secret() && publicBase());
  const back = (res, code) => res.redirect(302, `/#/auth?e=${encodeURIComponent(code)}`);

  for (const name of Object.keys(PROVIDERS)) {
    const P = PROVIDERS[name];
    const cookieName = `hh_oauth_${name}`;
    const cbPath = `/auth/${name}/callback`;
    app.get(`/auth/${name}`, oauthLimiter, (req, res) => {
      if (!configured(name)) return back(res, `${name}_off`);
      const state = crypto.randomBytes(24).toString("base64url");
      // Lax cookie: the Strict session cookie is not sent on the cross-site return from the provider.
      res.cookie(cookieName, state, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 10 * 60 * 1000, path: `/auth/${name}` });
      const q = new URLSearchParams({ client_id: P.id(), redirect_uri: publicBase() + cbPath, response_type: "code", scope: P.scope, state, ...P.extra });
      res.redirect(302, `${P.authorize}?${q}`);
    });
    app.get(cbPath, oauthLimiter, async (req, res) => {
      const cookieState = parseCookie(req.headers.cookie, cookieName);
      res.clearCookie(cookieName, { path: `/auth/${name}` });
      if (!configured(name)) return back(res, `${name}_off`);
      if (req.query.error) return back(res, "oauth_cancel");
      const code = String(req.query.code || ""), state = String(req.query.state || "");
      if (!code || code.length > 2048 || !state || !cookieState || !safeEqual(state, cookieState)) return back(res, "oauth_state");
      try {
        const tr = await fetch(P.token, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ client_id: P.id(), client_secret: P.secret(), grant_type: "authorization_code", code, redirect_uri: publicBase() + cbPath }),
          signal: AbortSignal.timeout(10000),
        });
        if (!tr.ok) return back(res, "oauth_fail");
        const tok = await tr.json();
        if (!tok.access_token) return back(res, "oauth_fail");
        const prof = await P.profile(tok.access_token);
        if (!/^[A-Za-z0-9_-]{3,64}$/.test(prof.sub)) return back(res, "oauth_fail");
        let user = db.prepare(`SELECT * FROM users WHERE ${P.column} = ?`).get(prof.sub);
        if (!user && prof.email) {
          const byEmail = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(prof.email);
          if (byEmail) {
            if (byEmail.role === "admin") return back(res, "oauth_admin");
            if (byEmail.email_verified) {
              db.prepare(`UPDATE users SET ${P.column} = ? WHERE id = ?`).run(prof.sub, byEmail.id);
            } else {
              // Unverified local account with this email: the provider proves inbox ownership, so take it
              // over safely — rotate the password and end other sessions (prevents pre-registration hijack).
              db.prepare(`UPDATE users SET ${P.column} = ?, email_verified = 1, password_hash = ?, pw_version = pw_version + 1 WHERE id = ?`)
                .run(prof.sub, bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 10), byEmail.id);
            }
            user = db.prepare("SELECT * FROM users WHERE id = ?").get(byEmail.id);
            writeAudit(user, `${name}.link`, "", clientIp(req));
          }
        }
        if (!user) {
          const username = uniqueUsername(prof.name || name);
          const id = db.prepare(`INSERT INTO users (username, password_hash, balance, role, email, email_verified, points, terms_at, ${P.column})
            VALUES (?, ?, 0, 'user', ?, ?, 0, datetime('now'), ?)`)
            .run(username, bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 10), prof.email, prof.email ? 1 : 0, prof.sub).lastInsertRowid;
          user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
          writeAudit(user, `${name}.signup`, "", clientIp(req));
        }
        if (user.role === "admin") return back(res, "oauth_admin");
        startSession(req, res, user, (err) => (err ? back(res, "oauth_fail") : res.redirect(302, `/#/auth?ok=${name}`)));
      } catch (e) {
        console.error(`[${name}] sign-in failed:`, e && e.name);
        back(res, "oauth_fail");
      }
    });
  }

  return { oauthConfigured: () => ({ discord: configured("discord"), google: configured("google") }) };
}

function parseCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { return ""; } }
  }
  return "";
}

module.exports = { mountAccount, isVerified, verificationRequired, normEmail };
