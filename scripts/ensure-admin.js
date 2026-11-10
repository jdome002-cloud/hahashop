#!/usr/bin/env node
/**
 * Ensure a single admin user exists.
 * - If ADMIN_PASSWORD is set and no admin exists: create admin with that password (never logged).
 * - Local/dev fallback (non-production): create with a random password and write ADMIN-LOGIN.txt.
 * - Production without ADMIN_PASSWORD: warn only (do not invent a password).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { db } = require("../lib/db");

const ROOT = path.join(__dirname, "..");
const CRED_FILE = path.join(ROOT, "ADMIN-LOGIN.txt");
const USERNAME = "admin";
// Starting credit for the admin account. Applied when the admin is created (so it survives
// Render free-tier redeploys, which recreate the DB) and once on existing databases.
const ADMIN_START_BALANCE = process.env.ADMIN_START_BALANCE && Number.isFinite(Number(process.env.ADMIN_START_BALANCE))
  ? Math.max(0, Number(process.env.ADMIN_START_BALANCE)) : 500;
const BALANCE_FLAG = "admin_balance_500_v1";

function applyStartBalanceOnce() {
  if (db.prepare("SELECT 1 FROM settings WHERE key = ?").get(BALANCE_FLAG)) return;
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  if (!admin) return;
  db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(ADMIN_START_BALANCE, admin.id);
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, '1')").run(BALANCE_FLAG);
}

function genPassword() {
  return crypto.randomBytes(18).toString("base64url");
}

function writeCreds(username, password) {
  const body =
    `# HAHA SHOP admin credentials — keep secret\n` +
    `# Generated: ${new Date().toISOString()}\n` +
    `username=${username}\n` +
    `password=${password}\n`;
  fs.writeFileSync(CRED_FILE, body, { mode: 0o600 });
  try { fs.chmodSync(CRED_FILE, 0o600); } catch (_) {}
}

function demoteExtraAdmins(keepId) {
  if (keepId) {
    db.prepare(`UPDATE users SET role = 'user' WHERE role = 'admin' AND id != ?`).run(keepId);
  } else {
    db.prepare(`UPDATE users SET role = 'user' WHERE role = 'admin'`).run();
  }
}

function ensureAdmin() {
  try { return ensureAdminInner(); } finally { applyStartBalanceOnce(); }
}

function ensureAdminInner() {
  const existingAdmins = db.prepare(`SELECT id, username FROM users WHERE role = 'admin'`).all();
  let admin = db.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`).get(USERNAME);

  if (existingAdmins.length > 1) {
    for (const a of existingAdmins) {
      if (a.username.toLowerCase() !== USERNAME) {
        db.prepare(`UPDATE users SET role = 'user' WHERE id = ?`).run(a.id);
      }
    }
  }

  if (admin && admin.role === "admin") {
    demoteExtraAdmins(admin.id);
    return { created: false, existed: true };
  }

  if (admin && admin.role !== "admin") {
    // Promote reserved username only when no other admin exists
    if (existingAdmins.length === 0) {
      db.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).run(admin.id);
      demoteExtraAdmins(admin.id);
      return { created: false, existed: true, promoted: true };
    }
  }

  const anyAdmin = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).get();
  if (anyAdmin) {
    return { created: false, existed: true };
  }

  const envHash = process.env.ADMIN_PASSWORD_HASH ? String(process.env.ADMIN_PASSWORD_HASH).trim() : "";
  if (/^\$2[aby]\$\d{2}\$.{53}$/.test(envHash)) {
    demoteExtraAdmins(null);
    db.prepare(
      `INSERT INTO users (username, password_hash, balance, role) VALUES (?, ?, ?, 'admin')`
    ).run(USERNAME, envHash, ADMIN_START_BALANCE);
    console.log("Admin account created from ADMIN_PASSWORD_HASH");
    return { created: true, fromEnv: true };
  }

  const fromEnv = process.env.ADMIN_PASSWORD != null ? String(process.env.ADMIN_PASSWORD) : "";
  if (fromEnv.length >= 6) {
    const hash = bcrypt.hashSync(fromEnv, 12);
    demoteExtraAdmins(null);
    db.prepare(
      `INSERT INTO users (username, password_hash, balance, role) VALUES (?, ?, ?, 'admin')`
    ).run(USERNAME, hash, ADMIN_START_BALANCE);
    console.log("Admin account created from ADMIN_PASSWORD");
    return { created: true, fromEnv: true };
  }

  if (process.env.NODE_ENV === "production") {
    console.warn("[admin] No admin user found and ADMIN_PASSWORD is not set");
    return { created: false, existed: false };
  }

  // Local / non-production: random password + credentials file
  const password = genPassword();
  const hash = bcrypt.hashSync(password, 12);
  demoteExtraAdmins(null);
  if (admin) {
    db.prepare(`UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?`).run(hash, admin.id);
  } else {
    db.prepare(
      `INSERT INTO users (username, password_hash, balance, role) VALUES (?, ?, ?, 'admin')`
    ).run(USERNAME, hash, ADMIN_START_BALANCE);
  }
  writeCreds(USERNAME, password);
  console.log(`Admin account created. Credentials written to ${CRED_FILE}`);
  return { created: true, fromEnv: false };
}

if (require.main === module) {
  const result = ensureAdmin();
  if (!result.created && result.existed) {
    console.log(`Admin OK (username=${USERNAME}).`);
  }
}

module.exports = { ensureAdmin };
