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
  Object.assign(DICT.th, {"identifier": "อีเมล หรือ ชื่อผู้ใช้", "manage_profile": "จัดการโปรไฟล์", "please_login": "กรุณาเข้าสู่ระบบก่อน", "verify_needed": "กรุณายืนยันอีเมลก่อนเติมเงินหรือซื้อสินค้า — เช็กกล่องจดหมาย (และสแปม)", "resend_verify": "ส่งลิงก์ยืนยันอีกครั้ง", "balance_left": "ยอดเงินคงเหลือ", "points_left": "แต้มสะสมคงเหลือ", "points_unit": "แต้ม", "change_password": "เปลี่ยนรหัสผ่าน", "current_password": "รหัสผ่านปัจจุบัน", "save": "บันทึก", "history": "ประวัติ", "purchased": "สินค้าที่ซื้อ", "or_with": "หรือเข้าสู่ระบบด้วย", "or_with_signup": "หรือสมัครด้วย", "terms_title": "เงื่อนไขการใช้งาน", "accept_terms": "ฉันได้อ่านและยอมรับเงื่อนไขการใช้งาน", "secret_hint": "ข้อมูลนี้แสดงให้คุณคนเดียว กรุณาเปลี่ยนรหัสผ่านบัญชีเกมทันที", "copy": "คัดลอก", "copied": "คัดลอกแล้ว", "captcha": "รหัสยืนยัน", "captcha_ph": "รหัสในภาพ", "captcha_load_fail": "โหลดระบบยืนยันตัวตนไม่สำเร็จ กรุณารีเฟรชหน้า", "net_fail": "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ ลองใหม่อีกครั้ง", "fill_all": "กรุณากรอกให้ครบ", "login_ok": "เข้าสู่ระบบสำเร็จ", "must_accept": "กรุณาติ๊กยอมรับเงื่อนไขการใช้งานก่อน", "check_fields": "กรุณาตรวจสอบข้อมูลให้ถูกต้อง", "signup_verify_sent": "สมัครสำเร็จ! เราส่งลิงก์ยืนยันไปที่อีเมลของคุณแล้ว (หมดอายุใน 24 ชม.) กรุณายืนยันก่อนเติมเงิน/ซื้อสินค้า", "signup_verify_fail": "สมัครสำเร็จ แต่ส่งอีเมลยืนยันไม่สำเร็จ — กด “ส่งลิงก์ยืนยันอีกครั้ง” ในหน้าจัดการโปรไฟล์", "signup_ok": "สมัครสมาชิกสำเร็จ", "logged_out": "ออกจากระบบแล้ว", "verified": "ยืนยันแล้ว ✓", "unverified": "ยังไม่ยืนยัน", "e_google_off": "ยังไม่ได้เปิดใช้การเข้าสู่ระบบด้วย Google", "e_oauth_cancel": "ยกเลิกการเข้าสู่ระบบแล้ว", "e_oauth_state": "เซสชันหมดอายุ กรุณาลองใหม่", "e_oauth_fail": "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่", "e_oauth_admin": "บัญชีแอดมินต้องเข้าสู่ระบบด้วยรหัสผ่านเท่านั้น", "oauth_ok": "เข้าสู่ระบบสำเร็จ", "r_topup": "เติมเครดิต", "r_purchase": "ซื้อสินค้า", "r_minigame": "มินิเกม", "r_admin": "แอดมินปรับยอด", "r_opening": "ยอดยกมา", "r_refund": "คืนเงิน", "r_other": "รายการ", "bal_after": "คงเหลือ", "no_history": "ยังไม่มีประวัติ", "no_orders": "ยังไม่มีสินค้าที่ซื้อ", "view_account": "ดูข้อมูลบัญชี", "contact_admin_delivery": "แอดมินจะส่งข้อมูลบัญชีให้ทางช่องทางติดต่อ", "buy_confirm": "กดอีกครั้งเพื่อยืนยัน", "buy_ok": "ซื้อสำเร็จ!", "need_login_buy": "กรุณาเข้าสู่ระบบก่อนซื้อ", "need_verify": "กรุณายืนยันอีเมลก่อน", "reset_done": "ตั้งรหัสผ่านใหม่แล้ว เข้าสู่ระบบด้วยรหัสใหม่ได้เลย"});
  Object.assign(DICT.en, Object.assign({}, {}, DICT.en, {"identifier": "Email or username", "manage_profile": "Manage profile", "please_login": "Please log in first", "verify_needed": "Please verify your email before topping up or buying — check your inbox (and spam)", "resend_verify": "Resend verification link", "balance_left": "Balance", "points_left": "Points", "points_unit": "pts", "change_password": "Change password", "current_password": "Current password", "save": "Save", "history": "History", "purchased": "My purchases", "or_with": "or log in with", "or_with_signup": "or sign up with", "terms_title": "Terms of use", "accept_terms": "I have read and accept the terms of use", "secret_hint": "Only you can see this. Change the game account password right away.", "copy": "Copy", "copied": "Copied", "captcha": "Verification code", "captcha_ph": "Code", "captcha_load_fail": "Could not load verification. Please refresh.", "net_fail": "Could not reach the server. Try again.", "fill_all": "Please fill in all fields", "login_ok": "Logged in", "must_accept": "Please accept the terms first", "check_fields": "Please check your details", "signup_verify_sent": "Signed up! We emailed you a verification link (valid 24 h). Verify before topping up or buying.", "signup_verify_fail": "Signed up, but the verification email failed — tap “Resend verification link” in Manage profile.", "signup_ok": "Account created", "logged_out": "Logged out", "verified": "verified ✓", "unverified": "not verified", "e_google_off": "Google login is not enabled", "e_oauth_cancel": "Login cancelled", "e_oauth_state": "Session expired, please try again", "e_oauth_fail": "Login failed, please try again", "e_oauth_admin": "Admin must log in with a password", "oauth_ok": "Logged in", "r_topup": "Top-up", "r_purchase": "Purchase", "r_minigame": "Minigame", "r_admin": "Admin adjustment", "r_opening": "Opening balance", "r_refund": "Refund", "r_other": "Entry", "bal_after": "balance", "no_history": "No history yet", "no_orders": "No purchases yet", "view_account": "View account", "contact_admin_delivery": "The admin will send the account details via the contact channel", "buy_confirm": "Tap again to confirm", "buy_ok": "Purchased!", "need_login_buy": "Please log in to buy", "need_verify": "Please verify your email first", "login": "Log in", "signup": "Sign up", "password": "Password", "password2": "Confirm password", "username": "Username", "email": "Email", "forgot_link": "Forgot password?", "forgot_title": "Forgot password", "forgot_send": "Send reset link", "back_login": "← Back to log in", "reset_title": "Set a new password", "new_password": "New password", "reset_save": "Save new password", "logout": "Log out", "reset_done": "Password updated. Log in with the new password."}));
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
