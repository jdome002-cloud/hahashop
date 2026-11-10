/** SMTP mail + public base URL helpers. Secrets come only from env and are never logged. */
function publicBase() {
  // PUBLIC_URL wins; Render sets RENDER_EXTERNAL_URL automatically. Never derived from the request Host header.
  const raw = String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").split(",")[0].trim().replace(/\/+$/, "");
  if (!raw) return "";
  try { return new URL(raw.includes("://") ? raw : `https://${raw}`).origin; } catch (_) { return ""; }
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
    secure: port === 465,           // 465 = implicit TLS, 587 = STARTTLS
    requireTLS: port === 587,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: String(process.env.SMTP_PASS || "").replace(/\s+/g, "") } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    tls: { minVersion: "TLSv1.2" },
  });
  return transporter;
}

async function sendMail({ to, subject, text }) {
  return getTransport().sendMail({ from: process.env.MAIL_FROM, to, subject, text });
}

module.exports = { publicBase, smtpConfigured, sendMail };
