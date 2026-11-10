/**
 * Captcha: Cloudflare Turnstile when TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY are set,
 * otherwise a built-in SVG captcha stored (hashed) in the session, single-use, 5 min TTL.
 */
const crypto = require("crypto");

const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TTL = 5 * 60 * 1000;

function turnstileOn() {
  return !!(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
}
function publicConfig() {
  return turnstileOn() ? { type: "turnstile", siteKey: process.env.TURNSTILE_SITE_KEY } : { type: "builtin" };
}
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const rnd = (a, b) => a + crypto.randomInt(0, 1_000_000) / 1_000_000 * (b - a);

function makeSvg(text) {
  const w = 160, h = 56;
  let parts = [`<rect width="${w}" height="${h}" fill="#0c0c0e"/>`];
  for (let i = 0; i < 7; i++) {
    parts.push(`<path d="M${rnd(0, w).toFixed(1)} ${rnd(0, h).toFixed(1)} Q${rnd(0, w).toFixed(1)} ${rnd(0, h).toFixed(1)} ${rnd(0, w).toFixed(1)} ${rnd(0, h).toFixed(1)}" stroke="rgba(255,255,255,${rnd(0.15, 0.4).toFixed(2)})" stroke-width="${rnd(1, 2.2).toFixed(1)}" fill="none"/>`);
  }
  for (let i = 0; i < 30; i++) parts.push(`<circle cx="${rnd(0, w).toFixed(1)}" cy="${rnd(0, h).toFixed(1)}" r="${rnd(0.6, 1.6).toFixed(1)}" fill="rgba(250,204,21,${rnd(0.2, 0.6).toFixed(2)})"/>`);
  [...text].forEach((ch, i) => {
    const x = 18 + i * 26 + rnd(-3, 3), y = 38 + rnd(-6, 6), r = rnd(-25, 25);
    parts.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(${r.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" font-family="monospace" font-weight="700" font-size="${rnd(24, 30).toFixed(0)}" fill="${i % 2 ? "#ffffff" : "#facc15"}">${ch}</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}

/** GET /api/captcha.svg — new challenge bound to this session. */
function captchaImage(req, res) {
  const text = Array.from({ length: 5 }, () => CHARS[crypto.randomInt(0, CHARS.length)]).join("");
  req.session.captcha = { h: hash(text + "|" + req.sessionID), exp: Date.now() + TTL };
  res.set({
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "X-Content-Type-Options": "nosniff",
  });
  req.session.save(() => res.send(makeSvg(text)));
}

/** Verify (and consume) the captcha answer from req.body.captcha / turnstile token. */
async function verifyCaptcha(req) {
  if (process.env.NODE_ENV === "test" && process.env.CAPTCHA_TEST_BYPASS === "1" && req.body?.captcha === "TEST-PASS") return true;
  if (turnstileOn()) {
    const token = String(req.body?.turnstile || req.body?.captcha || "");
    if (!token || token.length > 2048) return false;
    try {
      const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token, remoteip: req.ip || "" }),
        signal: AbortSignal.timeout(8000),
      });
      const d = await r.json();
      return !!d.success;
    } catch (_) { return false; }
  }
  const c = req.session && req.session.captcha;
  if (req.session) delete req.session.captcha; // single-use, even on failure
  const answer = String(req.body?.captcha || "").trim().toUpperCase().slice(0, 12);
  if (!c || !answer || c.exp < Date.now()) return false;
  const a = Buffer.from(hash(answer + "|" + req.sessionID)), b = Buffer.from(c.h);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { captchaImage, verifyCaptcha, publicConfig, turnstileOn };
