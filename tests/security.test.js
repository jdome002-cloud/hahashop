/**
 * HAHA SHOP — automated security & money-integrity tests.
 * Spawns the real server (NODE_ENV=test) on throwaway data with a mock TrueMoney API and an SMTP sink.
 * Run: npm test
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-"));
const ADMIN_PW = crypto.randomBytes(12).toString("hex"); // test-only admin password
const SHOP_MOBILE = "0800000123"; // fake shop wallet for tests
let BASE, srv, tmMock, smtp, mails = [];

const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const H = (n) => crypto.randomBytes(40).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, n);

// Mock TrueMoney: hashes registered here redeem successfully with the given amount/mobile
const vouchers = new Map();
function startTrueMoney(port) {
  return new Promise((r) => {
    tmMock = http.createServer((req, res) => {
      const m = req.url.match(/^\/([0-9A-Za-z]+)\/redeem$/);
      const v = m && vouchers.get(m[1]);
      res.setHeader("content-type", "application/json");
      if (!v) return res.end(JSON.stringify({ status: { code: "VOUCHER_NOT_FOUND", message: "not found" } }));
      setTimeout(() => res.end(JSON.stringify({ status: { code: "SUCCESS", message: "success" }, data: { my_ticket: { amount_baht: String(v.amount), mobile: v.mobile || "062-xxx-2534" } } })), 30);
    }).listen(port, r);
  });
}
function startSmtp(port) {
  return new Promise((r) => {
    smtp = net.createServer((s) => {
      let data = false, buf = "";
      s.write("220 sink\r\n");
      s.on("data", (d) => {
        const t = d.toString();
        if (data) { buf += t; if (buf.includes("\r\n.\r\n")) { mails.push(buf.replace(/=\r\n/g, "").replace(/=3D/g, "=")); data = false; buf = ""; s.write("250 ok\r\n"); } return; }
        for (const line of t.split("\r\n").filter(Boolean)) {
          const c = line.slice(0, 4).toUpperCase();
          if (c === "EHLO" || c === "HELO") s.write("250 sink\r\n");
          else if (c === "DATA") { data = true; s.write("354 go\r\n"); }
          else if (c === "QUIT") { s.write("221 bye\r\n"); s.end(); }
          else s.write("250 ok\r\n");
        }
      });
    }).listen(port, "127.0.0.1", r);
  });
}

/** Minimal cookie-keeping API client. Each client gets its own fake IP (CLIENT_IP_HEADER=x-test-ip). */
let ipSeq = 10;
function client() {
  let cookie = "", csrf = "";
  const ip = `10.9.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
  const f = async (p, o = {}) => {
    const headers = { origin: BASE, "x-test-ip": ip, ...(o.headers || {}) };
    if (cookie) headers.cookie = cookie;
    let body = o.body;
    if (body && !(body instanceof FormData) && typeof body !== "string") { body = JSON.stringify(body); headers["content-type"] = "application/json"; }
    if (o.method && o.method !== "GET" && csrf && !o.noCsrf) headers["x-csrf-token"] = csrf;
    const r = await fetch(BASE + p, { method: o.method || "GET", headers, body, redirect: "manual" });
    for (const c of r.headers.getSetCookie()) if (c.startsWith("hahashop.sid=")) cookie = c.split(";")[0];
    const ct = r.headers.get("content-type") || "";
    const d = ct.includes("json") ? await r.json() : await r.text();
    if (d && d.csrfToken) csrf = d.csrfToken;
    return { s: r.status, d, h: r.headers };
  };
  f.init = async () => { await f("/api/csrf"); return f; };
  f.ip = ip;
  return f;
}
const post = (c, p, body, extra = {}) => c(p, { method: "POST", body, ...extra });

async function signup(name) {
  const c = await client().init();
  const r = await post(c, "/api/signup", { username: name, email: `${name}@example.com`, password: "password123", terms: true, captcha: "TEST-PASS" });
  assert.equal(r.s, 200, JSON.stringify(r.d));
  return c;
}
async function adminClient() {
  const c = await client().init();
  const r = await post(c, "/api/login", { identifier: "admin", password: ADMIN_PW, captcha: "TEST-PASS" });
  assert.equal(r.s, 200, JSON.stringify(r.d));
  return c;
}
function lastMailToken(kind) {
  const m = [...mails].reverse().find((x) => x.includes(`#/${kind}?token=`));
  return m && m.match(new RegExp(`#/${kind}\\?token=([A-Za-z0-9_-]+)`))[1];
}
async function verifyByMail(c, name) {
  const t = lastMailToken("verify");
  assert.ok(t, "verification mail sent for " + name);
  const r = await post(c, "/api/email/verify", { token: t });
  assert.equal(r.s, 200);
}
async function credit(admin, username, amount) {
  const u = (await admin("/api/admin/users")).d.users.find((x) => x.username === username);
  const r = await post(admin, `/api/admin/users/${u.id}/credit`, { amount, mode: "add", note: "test" });
  assert.equal(r.s, 200, JSON.stringify(r.d));
  return u.id;
}
async function makeProduct(admin, fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
  const r = await admin("/api/admin/products", { method: "POST", body: fd });
  assert.equal(r.s, 200, JSON.stringify(r.d));
  return r.d.product;
}

before(async () => {
  const [port, tmPort, smtpPort] = await Promise.all([freePort(), freePort(), freePort()]);
  await startTrueMoney(tmPort); await startSmtp(smtpPort);
  BASE = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, NODE_ENV: "test", PORT: String(port), DATA_DIR: DATA,
      SESSION_SECRET: crypto.randomBytes(32).toString("hex"), ADMIN_PASSWORD: ADMIN_PW,
      CAPTCHA_TEST_BYPASS: "1", CLIENT_IP_HEADER: "x-test-ip",
      TRUEMONEY_TEST_ENDPOINT: `http://127.0.0.1:${tmPort}`, TRUEMONEY_MOBILE: SHOP_MOBILE,
      PUBLIC_URL: BASE, SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtpPort), MAIL_FROM: "shop@test.local",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.stderr.on("data", (d) => process.env.DEBUG && process.stderr.write(d));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server start timeout")), 15000);
    srv.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); resolve(); } });
    srv.on("exit", (c) => reject(new Error("server exited " + c)));
  });
});
after(() => { srv && srv.kill(); tmMock && tmMock.close(); smtp && smtp.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

test("headers: no x-powered-by, strict CSP, nosniff", async () => {
  const r = await fetch(BASE + "/");
  assert.equal(r.headers.get("x-powered-by"), null);
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(r.headers.get("content-security-policy"), /object-src 'none'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("admin bootstrap: 500 credit recorded in ledger", async () => {
  const a = await adminClient();
  const me = (await a("/api/me")).d.user;
  assert.equal(me.balance, 500);
  const l = (await a("/api/admin/ledger")).d;
  assert.ok(l.ledger.some((x) => x.reason === "admin_bootstrap" && x.delta === 500));
  assert.equal(l.mismatches.length, 0);
});

test("CSRF and Origin are enforced on mutating requests", async () => {
  const c = await client().init();
  let r = await post(c, "/api/login", { identifier: "x", password: "y", captcha: "TEST-PASS" }, { noCsrf: true });
  assert.equal(r.s, 403);
  r = await post(c, "/api/login", { identifier: "x", password: "y", captcha: "TEST-PASS" }, { headers: { origin: "https://evil.example" } });
  assert.equal(r.s, 403);
});

test("captcha and terms are required for signup; mass assignment ignored", async () => {
  const c = await client().init();
  let r = await post(c, "/api/signup", { username: "nocap", email: "nocap@example.com", password: "password123", terms: true, captcha: "WRONG" });
  assert.equal(r.s, 400); assert.equal(r.d.error, "CAPTCHA");
  r = await post(c, "/api/signup", { username: "noterms", email: "noterms@example.com", password: "password123", captcha: "TEST-PASS" });
  assert.equal(r.s, 400);
  r = await post(c, "/api/signup", { username: "sneaky", email: "sneaky@example.com", password: "password123", terms: true, captcha: "TEST-PASS",
    balance: 99999, role: "admin", email_verified: 1, points: 5000, isAdmin: true });
  assert.equal(r.s, 200);
  assert.equal(r.d.user.balance, 0); assert.equal(r.d.user.role, "user"); assert.equal(r.d.user.isAdmin, false);
  assert.equal(r.d.user.points, 0); assert.equal(r.d.user.emailVerified, false);
  const adm = await c("/api/admin/users"); assert.equal(adm.s, 403);
});

test("builtin captcha is session-bound and single-use", async () => {
  const c = await client().init();
  const img = await c("/api/captcha.svg");
  assert.equal(img.s, 200); assert.match(img.h.get("content-type"), /image\/svg\+xml/);
  assert.doesNotMatch(String(img.d), /<script/i);
  const r = await post(c, "/api/login", { identifier: "admin", password: ADMIN_PW, captcha: "AAAAA" });
  assert.equal(r.d.error, "CAPTCHA");
});

test("login lockout per account+IP; other IPs unaffected; session id rotates", async () => {
  await signup("lockme");
  const attacker = await client().init();
  for (let i = 0; i < 5; i++) await post(attacker, "/api/login", { identifier: "lockme", password: "wrong-pass", captcha: "TEST-PASS" });
  const locked = await post(attacker, "/api/login", { identifier: "lockme", password: "password123", captcha: "TEST-PASS" });
  assert.equal(locked.s, 429);
  const owner = await client().init();
  const pre = (await owner("/api/csrf")).h.get("set-cookie");
  const ok = await post(owner, "/api/login", { identifier: "LOCKME@example.com", password: "password123", captcha: "TEST-PASS" });
  assert.equal(ok.s, 200, "login by email from another IP works");
  assert.ok(ok.h.get("set-cookie") && ok.h.get("set-cookie") !== pre, "new session cookie issued on login");
});

test("unverified users cannot buy or top up; email verification is single-use", async () => {
  const c = await signup("verifyme");
  const admin = await adminClient();
  const p = await makeProduct(admin, { sku: "V-1", title: "V", price: 1, stock: 3 });
  let r = await post(c, `/api/products/${p.id}/buy`, {});
  assert.equal(r.s, 403); assert.equal(r.d.error, "EMAIL_UNVERIFIED");
  r = await post(c, "/api/topup", { link: "https://gift.truemoney.com/campaign/?v=" + H(35) });
  assert.equal(r.d.error, "EMAIL_UNVERIFIED");
  const t = lastMailToken("verify");
  r = await post(c, "/api/email/verify", { token: t }); assert.equal(r.s, 200);
  r = await post(c, "/api/email/verify", { token: t }); assert.equal(r.s, 400, "token single-use");
  assert.equal((await c("/api/me")).d.user.emailVerified, true);
});

test("concurrent double-purchase: balance for one item → exactly one order", async () => {
  const c = await signup("racer"); await verifyByMail(c, "racer");
  const admin = await adminClient();
  await credit(admin, "racer", 100);
  const p = await makeProduct(admin, { sku: "RACE-1", title: "Race", price: 60, stock: 5 });
  const results = await Promise.all(Array.from({ length: 12 }, () => post(c, `/api/products/${p.id}/buy`, {})));
  assert.equal(results.filter((r) => r.s === 200).length, 1);
  const me = (await c("/api/me")).d.user;
  assert.equal(me.balance, 40);
  const prod = (await c(`/api/products/${p.id}`)).d.product;
  assert.equal(prod.stock, 4);
  assert.equal((await c("/api/orders")).d.orders.length, 1);
});

test("concurrent stock race: last unit sold once", async () => {
  const c = await signup("stocker"); await verifyByMail(c, "stocker");
  const admin = await adminClient();
  await credit(admin, "stocker", 100);
  const p = await makeProduct(admin, { sku: "LAST-1", title: "Last", price: 5, stock: 1 });
  const results = await Promise.all(Array.from({ length: 10 }, () => post(c, `/api/products/${p.id}/buy`, {})));
  assert.equal(results.filter((r) => r.s === 200).length, 1);
  assert.equal((await c("/api/me")).d.user.balance, 95);
});

test("idempotency key: replayed purchase is charged once", async () => {
  const c = await signup("idem"); await verifyByMail(c, "idem");
  const admin = await adminClient();
  await credit(admin, "idem", 50);
  const p = await makeProduct(admin, { sku: "IDEM-1", title: "Idem", price: 10, stock: 9 });
  const key = "k_" + crypto.randomBytes(8).toString("hex");
  const rs = await Promise.all([1, 2, 3].map(() => post(c, `/api/products/${p.id}/buy`, {}, { headers: { "Idempotency-Key": key } })));
  const okOrders = new Set(rs.filter((r) => r.s === 200).map((r) => r.d.order.id));
  assert.equal(okOrders.size, 1);
  assert.equal((await c("/api/me")).d.user.balance, 40);
});

test("tampered purchase requests are rejected; client price is never used", async () => {
  const c = await signup("tamper"); await verifyByMail(c, "tamper");
  const admin = await adminClient();
  await credit(admin, "tamper", 100);
  const p = await makeProduct(admin, { sku: "TAMP-1", title: "Tamper", price: 30, stock: 9 });
  let r = await post(c, `/api/products/${p.id}/buy`, { quantity: 5 }); assert.equal(r.s, 400);
  r = await post(c, `/api/products/${p.id}/buy`, { quantity: -1 }); assert.equal(r.s, 400);
  r = await post(c, `/api/products/${p.id}/buy`, { expected_price: 1 }); assert.equal(r.s, 409);
  r = await post(c, `/api/products/${p.id}/buy`, { price: 0.01, amount: -1000, balance: 9999 }); assert.equal(r.s, 200);
  assert.equal((await c("/api/me")).d.user.balance, 70);
  r = await post(c, `/api/products/abc/buy`, {}); assert.equal(r.s, 400);
});

test("insufficient balance → no order, no stock change, no ledger entry", async () => {
  const c = await signup("poor"); await verifyByMail(c, "poor");
  const admin = await adminClient();
  const p = await makeProduct(admin, { sku: "POOR-1", title: "Poor", price: 10, stock: 2 });
  const r = await post(c, `/api/products/${p.id}/buy`, {});
  assert.equal(r.s, 400); assert.equal(r.d.error, "INSUFFICIENT");
  assert.equal((await c(`/api/products/${p.id}`)).d.product.stock, 2);
  assert.equal((await c("/api/ledger")).d.ledger.length, 0);
});

test("credentials: only the buyer sees them, never in product APIs (IDOR)", async () => {
  const buyer = await signup("buyer"); await verifyByMail(buyer, "buyer");
  const other = await signup("snoop"); await verifyByMail(other, "snoop");
  const admin = await adminClient();
  await credit(admin, "buyer", 20);
  const p = await makeProduct(admin, { sku: "ACC-1", title: "Account", price: 15, stock: 0, items: "user1:pass1\nuser2:pass2", delivery_note: "NOTE-SECRET" });
  assert.equal(p.stock, 2, "stock follows inventory lines");
  const pub = JSON.stringify((await other("/api/products")).d) + JSON.stringify((await other(`/api/products/${p.id}`)).d);
  assert.doesNotMatch(pub, /pass1|pass2|NOTE-SECRET/);
  const r = await post(buyer, `/api/products/${p.id}/buy`, {});
  assert.equal(r.s, 200); assert.equal(r.d.order.delivered, "user1:pass1");
  const oid = r.d.order.id;
  assert.equal((await buyer(`/api/orders/${oid}`)).d.order.delivered, "user1:pass1");
  assert.equal((await other(`/api/orders/${oid}`)).s, 404);
  assert.doesNotMatch(JSON.stringify((await buyer("/api/orders")).d), /pass1/);
  assert.doesNotMatch(JSON.stringify((await admin("/api/admin/orders")).d), /pass1/);
});

test("TrueMoney: voucher credited once (also concurrently), API amount only, owner check", async () => {
  const c = await signup("topper"); await verifyByMail(c, "topper");
  const h1 = H(35); vouchers.set(h1, { amount: 50 });
  let r = await post(c, "/api/topup", { link: `https://gift.truemoney.com/campaign/?v=${h1}`, amount: 99999 });
  assert.equal(r.s, 200, JSON.stringify(r.d)); assert.equal(r.d.amount, 50);
  r = await post(c, "/api/topup", { link: `https://gift.truemoney.com/campaign/?v=${h1}` });
  assert.equal(r.s, 400); assert.equal(r.d.error, "ALREADY_USED_HERE");
  const h2 = H(35); vouchers.set(h2, { amount: 20 });
  const other = await signup("topper2"); await verifyByMail(other, "topper2");
  const rs = await Promise.all([c, other, c, other].map((x) => post(x, "/api/topup", { link: `https://gift.truemoney.com/campaign/?v=${h2}` })));
  assert.equal(rs.filter((x) => x.s === 200).length, 1);
  const total = (await c("/api/me")).d.user.balance + (await other("/api/me")).d.user.balance;
  assert.equal(total, 70);
  const h3 = H(35); vouchers.set(h3, { amount: 30, mobile: "089-xxx-0000" });
  r = await post(c, "/api/topup", { link: `https://gift.truemoney.com/campaign/?v=${h3}` });
  assert.equal(r.s, 400);
  assert.equal((await c("/api/me")).d.user.balance, (await c("/api/ledger")).d.ledger.reduce((s, x) => s + x.delta, 0));
});

test("ledger: append-only and consistent; admin adjustments carry admin id", async () => {
  const admin = await adminClient();
  const l = (await admin("/api/admin/ledger")).d;
  assert.equal(l.mismatches.length, 0, JSON.stringify(l.mismatches));
  assert.ok(l.ledger.some((x) => x.reason === "admin_adjust" && x.admin_id && x.admin_name === "admin"));
  const Database = require("better-sqlite3");
  const db = new Database(path.join(DATA, "haha.sqlite"));
  assert.throws(() => db.prepare("UPDATE ledger SET delta = 1000000").run(), /append-only/);
  assert.throws(() => db.prepare("DELETE FROM ledger").run(), /append-only/);
  db.close();
});

test("admin endpoints require admin role server-side", async () => {
  const c = await signup("plainuser");
  for (const [m, p] of [["GET", "/api/admin/users"], ["GET", "/api/admin/ledger"], ["POST", "/api/admin/users/1/credit"], ["DELETE", "/api/admin/products/1"]]) {
    const r = await c(p, { method: m, body: m === "GET" ? undefined : { amount: 1 } });
    assert.equal(r.s, 403, `${m} ${p}`);
  }
});

test("uploads: magic bytes, SVG/HTML rejected, HEIC clear error, served safely, SSRF blocked", async () => {
  const admin = await adminClient();
  const send = async (buf, name, extra = {}) => {
    const fd = new FormData();
    fd.set("sku", "IMG-" + crypto.randomBytes(3).toString("hex")); fd.set("title", "img"); fd.set("price", "1");
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    if (buf) fd.set("image", new Blob([buf]), name);
    return admin("/api/admin/products", { method: "POST", body: fd });
  };
  let r = await send(Buffer.from("<html><script>alert(1)</script></html>".padEnd(64)), "evil.png");
  assert.equal(r.s, 400);
  r = await send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "x.svg");
  assert.equal(r.s, 400);
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(32)]);
  r = await send(heic, "IMG_0001.HEIC"); assert.equal(r.s, 400); assert.match(r.d.message, /HEIC/);
  // 1x1 PNG and GIF
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  r = await send(png, "../../etc/passwd.png"); assert.equal(r.s, 200, JSON.stringify(r.d));
  assert.match(r.d.product.image, /^\/img\/u\/[a-f0-9]{32}$/);
  const img = await fetch(BASE + r.d.product.image);
  assert.equal(img.status, 200); assert.match(img.headers.get("content-type"), /^image\//);
  assert.equal(img.headers.get("x-content-type-options"), "nosniff");
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  r = await send(gif, "a.gif"); assert.equal(r.s, 200, JSON.stringify(r.d));
  assert.equal((await fetch(BASE + "/img/u/..%2F..%2Fetc%2Fpasswd")).status, 404);
  r = await send(null, null, { image_url: "https://127.0.0.1/x.png" }); assert.equal(r.s, 400);
  r = await send(null, null, { image_url: "http://example.com/x.png" }); assert.equal(r.s, 400);
});

test("forgot password end-to-end: generic reply, single-use token, old sessions end", async () => {
  const c = await signup("forgetful");
  const g = await client().init();
  const a = await post(g, "/api/password/forgot", { email: "nobody@example.com", captcha: "TEST-PASS" });
  const b = await post(g, "/api/password/forgot", { email: "forgetful@example.com", captcha: "TEST-PASS" });
  assert.equal(a.d.message, b.d.message);
  await new Promise((r) => setTimeout(r, 800));
  const t = lastMailToken("reset"); assert.ok(t);
  let r = await post(g, "/api/password/reset", { token: t, password: "brandnew123" }); assert.equal(r.s, 200);
  r = await post(g, "/api/password/reset", { token: t, password: "again12345" }); assert.equal(r.s, 400);
  assert.equal((await c("/api/orders")).s, 401, "old session invalidated");
  const n = await client().init();
  r = await post(n, "/api/login", { identifier: "forgetful", password: "brandnew123", captcha: "TEST-PASS" }); assert.equal(r.s, 200);
});

test("body limits and malformed JSON return clean errors (no stack traces)", async () => {
  const c = await client().init();
  let r = await c("/api/login", { method: "POST", body: "{bad json", headers: { "content-type": "application/json" } });
  assert.equal(r.s, 400); assert.doesNotMatch(JSON.stringify(r.d), /at .*\.js|SyntaxError/);
  r = await c("/api/login", { method: "POST", body: JSON.stringify({ x: "a".repeat(40000) }), headers: { "content-type": "application/json" } });
  assert.equal(r.s, 413);
});
