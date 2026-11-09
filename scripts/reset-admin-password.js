#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { db } = require("../lib/db");

const ROOT = path.join(__dirname, "..");
const CRED_FILE = path.join(ROOT, "ADMIN-LOGIN.txt");
const USERNAME = "admin";

const admin = db.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE AND role = 'admin'`).get(USERNAME);
if (!admin) {
  console.error("Admin user not found. Run: npm run admin:ensure");
  process.exit(1);
}
const password = crypto.randomBytes(18).toString("base64url");
db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(bcrypt.hashSync(password, 12), admin.id);
const body =
  `# HAHA SHOP admin credentials — keep secret\n` +
  `# Reset: ${new Date().toISOString()}\n` +
  `username=${USERNAME}\n` +
  `password=${password}\n`;
fs.writeFileSync(CRED_FILE, body, { mode: 0o600 });
try { fs.chmodSync(CRED_FILE, 0o600); } catch (_) {}
console.log(`Admin password reset. New credentials written to ${CRED_FILE}`);
