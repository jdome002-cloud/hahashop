/**
 * TrueMoney Wallet campaign gift voucher (ซองอั่งเปา) redeem helper.
 * Endpoint shape used by Thai shop scripts (2025–2026):
 *   POST https://gift.truemoney.com/campaign/vouchers/{hash}/redeem
 *   Body: { "mobile": "0XXXXXXXXX", "voucher_hash": "{hash}" }
 * Optional verify:
 *   GET  .../vouchers/{hash}/verify?mobile=0XXXXXXXXX
 */

// TRUEMONEY_TEST_ENDPOINT is honoured only under NODE_ENV=test (automated tests use a mock server).
const ENDPOINT = process.env.NODE_ENV === "test" && process.env.TRUEMONEY_TEST_ENDPOINT
  ? process.env.TRUEMONEY_TEST_ENDPOINT
  : "https://gift.truemoney.com/campaign/vouchers";
const HASH_LENGTH = 35;
const MOBILE_LENGTH = 10;

const THAI_ERRORS = {
  INVALID_LINK: "ลิงก์ซองอั่งเปาไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
  INVALID_HASH: "รหัสซองไม่ถูกต้อง (ต้องเป็นลิงก์ gift.truemoney.com)",
  ALREADY_REDEEMED: "ซองอั่งเปานี้ถูกใช้ไปแล้ว",
  EXPIRED: "ซองอั่งเปาหมดอายุแล้ว",
  OWN_VOUCHER: "ไม่สามารถใช้ซองอั่งเปาของตัวเองได้",
  NOT_FOUND: "ไม่พบซองอั่งเปา หรือลิงก์ผิดพลาด",
  TARGET_NOT_FOUND: "ไม่พบวอลเล็ตปลายทางของร้าน กรุณาติดต่อแอดมิน",
  BLOCKED: "ระบบ TrueMoney บล็อกคำขอชั่วคราว กรุณาลองใหม่ภายหลัง",
  NETWORK: "เชื่อมต่อ TrueMoney ไม่สำเร็จ กรุณาลองใหม่",
  UNKNOWN: "เติมเครดิตไม่สำเร็จ กรุณาลองใหม่หรือติดต่อแอดมิน",
  ALREADY_USED_HERE: "ซองนี้เคยถูกเติมเข้าในร้านนี้แล้ว",
};

function extractHash(input) {
  if (!input || typeof input !== "string") {
    return { error: "INVALID_LINK", message: THAI_ERRORS.INVALID_LINK };
  }
  const trimmed = input.trim();
  const parts = trimmed.split("v=");
  const match = (parts[1] ?? parts[0]).match(/[0-9A-Za-z]+/);
  if (!match) {
    return { error: "INVALID_LINK", message: THAI_ERRORS.INVALID_LINK };
  }
  const hash = match[0];
  if (hash.length !== HASH_LENGTH) {
    return { error: "INVALID_HASH", message: THAI_ERRORS.INVALID_HASH };
  }
  // If it looks like a URL, require gift.truemoney.com
  if (/^https?:\/\//i.test(trimmed) && !/gift\.truemoney\.com/i.test(trimmed)) {
    return { error: "INVALID_LINK", message: THAI_ERRORS.INVALID_LINK };
  }
  return { hash };
}

function mapApiCode(code, message) {
  const c = String(code || "").toUpperCase();
  const m = String(message || "").toLowerCase();
  if (c === "VOUCHER_OUT_OF_STOCK" || c === "TARGET_USER_REDEEMED") {
    return { error: c, message: THAI_ERRORS.ALREADY_REDEEMED };
  }
  if (c === "VOUCHER_EXPIRED" || m.includes("expired")) {
    return { error: c || "VOUCHER_EXPIRED", message: THAI_ERRORS.EXPIRED };
  }
  if (c === "CANNOT_GET_OWN_VOUCHER" || m.includes("own voucher")) {
    return { error: c || "CANNOT_GET_OWN_VOUCHER", message: THAI_ERRORS.OWN_VOUCHER };
  }
  if (c === "VOUCHER_NOT_FOUND" || c === "INTERNAL_ERROR") {
    return { error: c || "VOUCHER_NOT_FOUND", message: THAI_ERRORS.NOT_FOUND };
  }
  if (c === "TARGET_USER_NOT_FOUND") {
    return { error: c, message: THAI_ERRORS.TARGET_NOT_FOUND };
  }
  return { error: c || "UNKNOWN", message: THAI_ERRORS.UNKNOWN + (message ? ` (${message})` : "") };
}

/**
 * Redeem a campaign voucher into the shop receiving wallet.
 * @param {string} voucherInput full link or bare hash
 * @param {string} mobile shop receiving number (server-side only)
 */
async function redeemVoucher(voucherInput, mobile) {
  if (!mobile || mobile.length !== MOBILE_LENGTH || /\D/.test(mobile)) {
    return { ok: false, error: "INVALID_MOBILE", message: THAI_ERRORS.TARGET_NOT_FOUND };
  }

  const extracted = extractHash(voucherInput);
  if (extracted.error) {
    return { ok: false, error: extracted.error, message: extracted.message, hash: null };
  }
  const { hash } = extracted;

  let response;
  let bodyText;
  try {
    response = await fetch(`${ENDPOINT}/${hash}/redeem`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 (compatible; HahaShop/1.0)",
      },
      body: JSON.stringify({ mobile, voucher_hash: hash }),
      signal: AbortSignal.timeout(15000),
    });
    bodyText = await response.text();
  } catch (err) {
    return {
      ok: false,
      error: "NETWORK",
      message: THAI_ERRORS.NETWORK,
      hash,
      indeterminate: true,
    };
  }

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    return {
      ok: false,
      error: response.status === 403 ? "REQUEST_BLOCKED" : "BAD_RESPONSE",
      message: response.status === 403 ? THAI_ERRORS.BLOCKED : THAI_ERRORS.UNKNOWN,
      hash,
      httpStatus: response.status,
      raw: bodyText.slice(0, 500),
    };
  }

  const statusMsg = data?.status?.message;
  const statusCode = data?.status?.code;
  if (String(statusMsg).toLowerCase() === "success" || String(statusCode).toUpperCase() === "SUCCESS") {
    const amountRaw = data?.data?.my_ticket?.amount_baht;
    const amount = Number(String(amountRaw).replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        ok: false,
        error: "BAD_AMOUNT",
        message: THAI_ERRORS.UNKNOWN,
        hash,
        raw: data,
      };
    }
    if (amount > 100000) {
      return { ok: false, error: "BAD_AMOUNT", message: THAI_ERRORS.UNKNOWN, hash, raw: data, review: true };
    }
    // Owner check: the wallet that received the money must be the shop's number.
    const shown = String(data?.data?.my_ticket?.mobile || "").replace(/\D/g, "");
    if (shown && shown.slice(-4) !== mobile.slice(-4)) {
      return { ok: false, error: "OWNER_MISMATCH", message: THAI_ERRORS.UNKNOWN, hash, raw: data, review: true };
    }
    return { ok: true, amount: Math.round(amount * 100) / 100, hash, raw: data };
  }

  const mapped = mapApiCode(statusCode, statusMsg);
  return { ok: false, ...mapped, hash, raw: data };
}

module.exports = {
  extractHash,
  redeemVoucher,
  THAI_ERRORS,
  ENDPOINT,
};
