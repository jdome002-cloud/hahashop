/* HAHA SHOP — tiny i18n (ไทย / EN). Stored in localStorage + cookie. */
(function () {
  var DICT = {
    th: {
      brand_sub: "ร้านขายไอดีฟีฟาย", credit: "เครดิต",
      tagline: "ร้านไอดีฟีฟาย ปลอดภัย ได้ไว หัวเราะได้ทุกดีล",
      search_ph: "FF-ID / ชื่อสินค้า", search: "ค้นหา", cta_shop: "เลือกซื้อไอดีเลย",
      helper_home: "เติมเครดิตด้วยซองอั่งเปา TrueMoney · ระบบส่งไอดีอัตโนมัติ",
      st_users: "ผู้ใช้ทั้งหมด", st_products: "สินค้าทั้งหมด", st_stock: "สต็อกพร้อมส่ง", st_done: "ทำรายการสำเร็จ",
      menu: "เมนูแนะนำ", featured: "สินค้าแนะนำ",
      topup: "เติมเครดิต", all_products: "สินค้าทั้งหมด", shop: "ร้านค้า", auction: "ประมูล",
      minigame: "มินิเกมส์", minigame_s: "มินิเกม", account: "บัญชีของฉัน", home: "หน้าแรก", products: "สินค้า",
      login: "เข้าสู่ระบบ", signup: "สมัครสมาชิก", username: "ชื่อผู้ใช้", password: "รหัสผ่าน", password2: "ยืนยันรหัสผ่าน",
      auth_tag: "เข้าสู่ระบบเพื่อซื้อไอดีและเติมเครดิต",
      helper_login: "ยังไม่มีบัญชี? กดแท็บ “สมัครสมาชิก” ด้านบน",
      logout: "ออกจากระบบ", tm_title: "ซองอั่งเปา TrueMoney", topup_now: "เติมเครดิตเลย",
      identifier: "ชื่อผู้ใช้หรืออีเมล", email: "อีเมล", forgot_link: "ลืมรหัสผ่าน?", or: "หรือ",
      discord_login: "เข้าสู่ระบบด้วย Discord", discord_signup: "สมัครด้วย Discord",
      back_login: "← กลับไปหน้าเข้าสู่ระบบ", forgot_title: "ลืมรหัสผ่าน",
      forgot_desc: "กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้ (ลิงก์หมดอายุใน 30 นาที)",
      forgot_off: "ตอนนี้ยังรีเซ็ตรหัสผ่านทางอีเมลไม่ได้ กรุณาติดต่อแอดมินเพื่อให้ตั้งรหัสผ่านใหม่ให้",
      forgot_send: "ส่งลิงก์ตั้งรหัสผ่านใหม่",
      forgot_sent: "ถ้าอีเมลนี้มีบัญชีอยู่ เราได้ส่งลิงก์ไปแล้ว กรุณาเช็กกล่องจดหมาย (และสแปม)",
      reset_title: "ตั้งรหัสผ่านใหม่", new_password: "รหัสผ่านใหม่", reset_save: "บันทึกรหัสผ่านใหม่",
      reset_bad: "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่", reset_done: "ตั้งรหัสผ่านใหม่แล้ว กำลังพาไปหน้าเข้าสู่ระบบ...",
      pw_mismatch: "รหัสผ่านยืนยันไม่ตรงกัน", failed: "ไม่สำเร็จ ลองใหม่อีกครั้ง",
      e_discord_off: "ยังไม่ได้เปิดใช้การเข้าสู่ระบบด้วย Discord", e_discord_cancel: "ยกเลิกการเข้าสู่ระบบด้วย Discord แล้ว",
      e_discord_state: "เซสชัน Discord ไม่ถูกต้อง กรุณาลองใหม่", e_discord_fail: "เข้าสู่ระบบด้วย Discord ไม่สำเร็จ กรุณาลองใหม่",
      e_discord_admin: "บัญชีแอดมินต้องเข้าสู่ระบบด้วยรหัสผ่านเท่านั้น", discord_ok: "เข้าสู่ระบบด้วย Discord สำเร็จ",
      confirm_delete: "กดอีกครั้งเพื่อลบ",
      prod_ph: "ค้นหาชื่อสินค้า / รหัส เช่น FF 6297", lang: "ไทย"
    },
    en: {
      brand_sub: "Free Fire ID Store", credit: "Credit",
      tagline: "Safe, fast Free Fire IDs, with a laugh on every deal",
      search_ph: "FF-ID / product name", search: "Search", cta_shop: "Shop IDs now",
      helper_home: "Top up with TrueMoney angpao · instant ID delivery",
      st_users: "Total users", st_products: "Products", st_stock: "In stock", st_done: "Completed",
      menu: "Quick menu", featured: "Featured",
      topup: "Top up", all_products: "All products", shop: "Shop", auction: "Auction",
      minigame: "Mini-games", minigame_s: "Games", account: "My account", home: "Home", products: "Products",
      login: "Log in", signup: "Sign up", username: "Username", password: "Password", password2: "Confirm password",
      auth_tag: "Log in to buy IDs and top up credit",
      helper_login: "No account yet? Tap the “Sign up” tab above",
      logout: "Log out", tm_title: "TrueMoney angpao", topup_now: "Top up now",
      identifier: "Username or email", email: "Email", forgot_link: "Forgot password?", or: "or",
      discord_login: "Sign in with Discord", discord_signup: "Sign up with Discord",
      back_login: "← Back to log in", forgot_title: "Forgot password",
      forgot_desc: "Enter the email you signed up with and we'll send a reset link (expires in 30 minutes).",
      forgot_off: "Email password reset isn't available yet. Please contact the admin to set a new password.",
      forgot_send: "Send reset link",
      forgot_sent: "If that email has an account, a reset link is on its way. Check your inbox (and spam).",
      reset_title: "Set a new password", new_password: "New password", reset_save: "Save new password",
      reset_bad: "This link is invalid or expired. Please request a new one.", reset_done: "Password updated. Taking you to log in...",
      pw_mismatch: "Passwords don't match", failed: "Something went wrong, please try again",
      e_discord_off: "Discord sign-in isn't enabled yet", e_discord_cancel: "Discord sign-in was cancelled",
      e_discord_state: "Discord session check failed, please try again", e_discord_fail: "Discord sign-in failed, please try again",
      e_discord_admin: "The admin account must log in with its password", discord_ok: "Signed in with Discord",
      confirm_delete: "Tap again to delete",
      prod_ph: "Search name / code e.g. FF 6297", lang: "EN"
    }
  };
  function read() {
    var v = null;
    try { v = localStorage.getItem("hh_lang"); } catch (e) {}
    if (!v) { var m = document.cookie.match(/(?:^|; )hh_lang=(th|en)/); v = m && m[1]; }
    return v === "en" ? "en" : "th";
  }
  var lang = read();
  function t(k) { return (DICT[lang] && DICT[lang][k]) || DICT.th[k] || k; }
  function apply() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (el) { el.placeholder = t(el.getAttribute("data-i18n-ph")); });
    var lbl = document.getElementById("lang-label");
    if (lbl) lbl.textContent = t("lang");
    document.dispatchEvent(new CustomEvent("hh:lang", { detail: lang }));
  }
  function set(l) {
    lang = l === "en" ? "en" : "th";
    try { localStorage.setItem("hh_lang", lang); } catch (e) {}
    document.cookie = "hh_lang=" + lang + "; path=/; max-age=31536000; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
    apply();
  }
  window.HHi18n = { t: t, apply: apply, set: set, get lang() { return lang; } };
  document.addEventListener("DOMContentLoaded", function () {
    apply();
    var btn = document.getElementById("lang-toggle");
    if (btn) btn.addEventListener("click", function () { set(lang === "th" ? "en" : "th"); });
  });
})();
