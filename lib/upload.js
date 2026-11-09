const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");

// sharp is loaded lazily so a broken libvips prebuild can never crash startup.
let _sharp; // undefined = not tried, null = unavailable
function getSharp() {
  if (_sharp !== undefined) return _sharp;
  if (process.env.DISABLE_SHARP === "1") return (_sharp = null);
  try {
    _sharp = require("sharp");
  } catch (err) {
    console.warn("[upload] sharp unavailable, storing validated images as-is:", err && err.message);
    _sharp = null;
  }
  return _sharp;
}

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "..", "public", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAGIC = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47],
  webp: null, // RIFF....WEBP
};

function detectImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // temporary name; will be re-encoded
    const safe = crypto.randomBytes(16).toString("hex");
    cb(null, `tmp-${safe}`);
  },
});

function fileFilter(_req, file, cb) {
  const name = String(file.originalname || "").toLowerCase();
  if (name.endsWith(".svg") || name.endsWith(".svgz") || name.includes("\0")) {
    return cb(new Error("ไม่อนุญาตไฟล์ประเภทนี้"));
  }
  if (!ALLOWED.has(file.mimetype)) {
    return cb(new Error("อนุญาตเฉพาะไฟล์รูป jpg/png/webp"));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

async function reencodeUpload(file, { maxW = 1600, maxH = 1600, asJpeg = false } = {}) {
  if (!file || !file.path) return null;
  const buf = fs.readFileSync(file.path);
  const kind = detectImage(buf);
  if (!kind) {
    try { fs.unlinkSync(file.path); } catch (_) {}
    throw new Error("ไฟล์รูปไม่ถูกต้อง");
  }
  let outName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${asJpeg ? "jpg" : kind === "png" ? "png" : kind === "webp" ? "webp" : "jpg"}`;
  let outPath = path.join(UPLOAD_DIR, outName);
  const sharp = getSharp();
  let outKind = asJpeg ? "jpeg" : kind;
  if (sharp) {
    let pipeline = sharp(buf, { failOn: "error" }).rotate().resize({
      width: maxW, height: maxH, fit: "inside", withoutEnlargement: true,
    });
    if (outKind === "jpeg") pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
    else if (outKind === "png") pipeline = pipeline.png({ compressionLevel: 8 });
    else pipeline = pipeline.webp({ quality: 85 });
    await pipeline.toFile(outPath);
  } else {
    // Fallback: keep the magic-byte-validated original bytes, with an extension matching its real type.
    outKind = kind;
    const fbName = outName.replace(/\.[a-z]+$/, kind === "jpeg" ? ".jpg" : "." + kind);
    outPath = path.join(UPLOAD_DIR, fbName);
    outName = fbName;
    fs.writeFileSync(outPath, buf, { mode: 0o644 });
  }
  try { fs.unlinkSync(file.path); } catch (_) {}
  file.filename = outName;
  file.path = outPath;
  file.mimetype = outKind === "jpeg" ? "image/jpeg" : outKind === "png" ? "image/png" : "image/webp";
  return publicUploadPath(outName);
}

function publicUploadPath(filename) {
  const base = path.basename(String(filename || ""));
  if (!base || base.includes("..") || base.includes("/") || base.includes("\\")) {
    throw new Error("ชื่อไฟล์ไม่ถูกต้อง");
  }
  return `/uploads/${base}`;
}

module.exports = { upload, publicUploadPath, UPLOAD_DIR, reencodeUpload, detectImage };
