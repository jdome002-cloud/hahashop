/**
 * HAHA SHOP — image pipeline.
 * - multer memory storage (no dependency on a writable UPLOAD_DIR / ephemeral disk)
 * - type decided by magic bytes, never by filename or client MIME
 * - re-encoded with sharp when available (strips metadata/EXIF, fixes rotation, resizes);
 *   if sharp is missing or fails, the validated original bytes are kept
 * - stored in SQLite (`images` table) under a random id, served by GET /img/u/:id
 * - optional import from an https URL with SSRF protection
 */
const crypto = require("crypto");
const dns = require("dns");
const net = require("net");
const https = require("https");
const multer = require("multer");
const { db } = require("./db");

const MAX_UPLOAD = 12 * 1024 * 1024; // raw upload limit (client downsizes first)
const MAX_STORED = 4 * 1024 * 1024;
const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

let _sharp;
function getSharp() {
  if (_sharp !== undefined) return _sharp;
  if (process.env.DISABLE_SHARP === "1") return (_sharp = null);
  try { _sharp = require("sharp"); } catch (err) {
    console.warn("[images] sharp unavailable, storing validated originals:", err && err.message);
    _sharp = null;
  }
  return _sharp;
}

function detect(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  const g = buf.toString("ascii", 0, 6);
  if (g === "GIF87a" || g === "GIF89a") return "gif";
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) return "heic";
    if (brand === "avif" || brand === "avis") return "avif";
  }
  return null;
}

class ImageError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true; }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD, files: 1, fields: 40, fieldSize: 64 * 1024, parts: 50 },
  fileFilter: (_req, file, cb) => {
    // Content is verified by magic bytes later; only reject obvious non-images early.
    const name = String(file.originalname || "").toLowerCase();
    if (/\.(svgz?|html?|xml|js|php|exe)$/.test(name)) return cb(new ImageError("ไม่อนุญาตไฟล์ประเภทนี้ (รองรับ jpg / png / webp / gif)"));
    cb(null, true);
  },
});

/** Wrap multer so its errors become clear JSON messages. */
function uploadSingle(field = "image") {
  const mw = upload.single(field);
  return (req, res, next) => mw(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ ok: false, message: `ไฟล์ใหญ่เกินไป (สูงสุด ${MAX_UPLOAD / 1024 / 1024}MB)` });
    if (err instanceof multer.MulterError) return res.status(400).json({ ok: false, message: "อัปโหลดไม่สำเร็จ: " + err.code });
    return res.status(err.status || 400).json({ ok: false, message: err.expose ? err.message : "อัปโหลดไม่สำเร็จ" });
  });
}

async function processImage(buf, { maxW = 1600, maxH = 1600 } = {}) {
  const kind = detect(buf);
  if (kind === "heic") throw new ImageError("ไฟล์ HEIC (รูปจาก iPhone) ระบบแปลงอัตโนมัติไม่ได้ กรุณาเลือกรูปใหม่จากหน้าเว็บนี้ (เว็บจะแปลงเป็น JPG ให้) หรือตั้งค่ากล้องเป็น \"Most Compatible\"");
  if (!kind || kind === "avif") throw new ImageError("ไฟล์นี้ไม่ใช่รูปที่รองรับ (รองรับ jpg / png / webp / gif)");
  const sharp = getSharp();
  if (sharp) {
    try {
      const animated = kind === "gif";
      let pipe = sharp(buf, { failOn: "error", animated, limitInputPixels: 80_000_000 })
        .rotate()
        .resize({ width: maxW, height: maxH, fit: "inside", withoutEnlargement: true });
      let out, mime;
      if (animated) { out = await pipe.gif().toBuffer(); mime = MIME.gif; }
      else if (kind === "png") { out = await pipe.png({ compressionLevel: 9, palette: true }).toBuffer(); mime = MIME.png; }
      else { out = await pipe.webp({ quality: 84 }).toBuffer(); mime = MIME.webp; }
      if (out.length <= MAX_STORED) return { data: out, mime, reencoded: true };
      out = await sharp(buf, { failOn: "error" }).rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
      if (out.length <= MAX_STORED) return { data: out, mime: MIME.webp, reencoded: true };
      throw new ImageError("รูปใหญ่เกินไปหลังย่อขนาด");
    } catch (e) {
      if (e instanceof ImageError) throw e;
      console.warn("[images] sharp failed, using validated original:", e && e.message);
      // fall through to raw storage (still magic-byte validated)
    }
  }
  if (buf.length > MAX_STORED) throw new ImageError("รูปใหญ่เกินไป (สูงสุด 4MB เมื่อเซิร์ฟเวอร์ย่อรูปไม่ได้)");
  return { data: buf, mime: MIME[kind], reencoded: false };
}

function saveImage({ data, mime }) {
  const id = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT INTO images (id, mime, data, bytes) VALUES (?, ?, ?, ?)").run(id, mime, data, data.length);
  return `/img/u/${id}`;
}

/** Store the uploaded file (if any) and return its public URL. */
async function storeUpload(file, opts) {
  if (!file || !file.buffer || !file.buffer.length) return null;
  return saveImage(await processImage(file.buffer, opts));
}

/* —— SSRF-safe https fetch —— */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff");
}

function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.filter((a) => !isPrivateIp(a.address));
    if (!ok.length || ok.length !== addrs.length) return cb(new ImageError("ไม่อนุญาตที่อยู่นี้"));
    if (options && options.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

function fetchHttps(urlStr, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (_) { return reject(new ImageError("ลิงก์รูปไม่ถูกต้อง")); }
    if (u.protocol !== "https:") return reject(new ImageError("รองรับเฉพาะลิงก์ https://"));
    if (u.username || u.password) return reject(new ImageError("ลิงก์รูปไม่ถูกต้อง"));
    if (net.isIP(u.hostname) && isPrivateIp(u.hostname)) return reject(new ImageError("ไม่อนุญาตที่อยู่นี้"));
    const req = https.get(u, { lookup: safeLookup, timeout: 10000, headers: { "user-agent": "HahaShopImageFetcher/1.0", accept: "image/*" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 3) return reject(new ImageError("ลิงก์รูป redirect มากเกินไป"));
        return resolve(fetchHttps(new URL(res.headers.location, u).toString(), redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new ImageError(`โหลดรูปจากลิงก์ไม่สำเร็จ (HTTP ${res.statusCode})`)); }
      const chunks = []; let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_UPLOAD) { req.destroy(); reject(new ImageError("รูปจากลิงก์ใหญ่เกินไป")); } else chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", () => reject(new ImageError("โหลดรูปจากลิงก์ไม่สำเร็จ")));
    });
    req.on("timeout", () => { req.destroy(); reject(new ImageError("โหลดรูปจากลิงก์ช้าเกินไป")); });
    req.on("error", (e) => reject(e instanceof ImageError ? e : new ImageError("โหลดรูปจากลิงก์ไม่สำเร็จ")));
  });
}

async function storeFromUrl(url, opts) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  if (raw.length > 2000) throw new ImageError("ลิงก์รูปยาวเกินไป");
  return saveImage(await processImage(await fetchHttps(raw), opts));
}

/** Resolve the image for a create/update request: file first, then image_url. */
async function imageFromRequest(req, opts) {
  if (req.file) return storeUpload(req.file, opts);
  if (req.body && req.body.image_url) return storeFromUrl(req.body.image_url, opts);
  return undefined; // no change
}

function serveImage(req, res) {
  const id = String(req.params.id || "");
  if (!/^[a-f0-9]{32}$/.test(id)) return res.status(404).end();
  const row = db.prepare("SELECT mime, data FROM images WHERE id = ?").get(id);
  if (!row || !Object.values(MIME).includes(row.mime)) return res.status(404).end();
  res.set({
    "Content-Type": row.mime,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  res.send(row.data);
}

module.exports = { uploadSingle, processImage, saveImage, storeUpload, storeFromUrl, imageFromRequest, serveImage, detect, isPrivateIp, ImageError, getSharp };
