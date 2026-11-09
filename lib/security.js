const crypto = require("crypto");

const failedLogins = new Map(); // ip -> { count, lockedUntil }

function clientIp(req) {
  return String(req.ip || req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
}

function recordFailedLogin(ip, { limit = 5, lockMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  const row = failedLogins.get(ip) || { count: 0, lockedUntil: 0 };
  if (row.lockedUntil && row.lockedUntil > now) return row;
  row.count += 1;
  if (row.count >= limit) {
    row.lockedUntil = now + lockMs;
    row.count = 0;
  }
  failedLogins.set(ip, row);
  return row;
}

function clearFailedLogin(ip) {
  failedLogins.delete(ip);
}

function isLoginLocked(ip) {
  const row = failedLogins.get(ip);
  if (!row || !row.lockedUntil) return false;
  if (row.lockedUntil <= Date.now()) {
    row.lockedUntil = 0;
    return false;
  }
  return true;
}

function allowedHosts(req) {
  const hosts = new Set();
  const host = String(req.headers.host || "").toLowerCase();
  if (host) hosts.add(host);
  // Optional PUBLIC_URL (single URL or comma-separated) for Render / custom domains
  const pub = String(process.env.PUBLIC_URL || "");
  for (const part of pub.split(",")) {
    const raw = part.trim();
    if (!raw) continue;
    try {
      const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
      if (u.host) hosts.add(u.host.toLowerCase());
    } catch (_) {}
  }
  return hosts;
}

function originOk(req) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  if (!origin && !referer) {
    // allow same-origin navigations without Origin (some browsers on FormData)
    // but require session cookie presence for mutating — still checked elsewhere
    return true;
  }
  const hosts = allowedHosts(req);
  try {
    if (origin) {
      const u = new URL(origin);
      return hosts.has(u.host.toLowerCase());
    }
    if (referer) {
      const u = new URL(referer);
      return hosts.has(u.host.toLowerCase());
    }
  } catch (_) {
    return false;
  }
  return false;
}

function ensureCsrf(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  return req.session.csrfToken;
}

function csrfOk(req) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  // login/signup bootstrap without token yet — handled by skipping below in server
  const token = req.headers["x-csrf-token"] || req.body?._csrf || "";
  const expected = req.session?.csrfToken;
  if (!expected || !token) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(String(token)), Buffer.from(String(expected)));
  } catch (_) {
    return false;
  }
}

module.exports = {
  clientIp,
  recordFailedLogin,
  clearFailedLogin,
  isLoginLocked,
  originOk,
  ensureCsrf,
  csrfOk,
};
