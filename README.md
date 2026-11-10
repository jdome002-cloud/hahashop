# HAHA SHOP

ร้านขายไอดีฟีฟาย (เดโม) พร้อมระบบสมาชิก / เครดิต / เติมเงินด้วยซองอั่งเปา TrueMoney

## รันบนเครื่อง

```bash
cd /workspace/ffshop
npm install
npm start
```

เปิด http://127.0.0.1:8080

## ตั้งค่าเซิร์ฟเวอร์ (อย่าใส่ใน frontend)

ไฟล์ `.env`:

- `TRUEMONEY_MOBILE=08xxxxxxxx` — เบอร์วอลเล็ตที่รับซอง (ฝั่งเซิร์ฟเวอร์เท่านั้น)
- `SESSION_SECRET=...`
- `PORT=8080`

ข้อมูลผู้ใช้ รูปสินค้า และเซสชันเก็บใน SQLite ที่ `data/` (ตั้ง `DATA_DIR` ให้ชี้ไป persistent disk บนโฮสต์)

ตัวเลือกเพิ่มเติม:

| ตัวแปร | ใช้ทำอะไร |
|---|---|
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | อีเมลยืนยันสมัคร + ลืมรหัสผ่าน (Gmail: `smtp.gmail.com`, `587`, App Password 16 ตัว) |
| `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` | ปุ่มเข้าสู่ระบบด้วย Google (redirect: `<เว็บ>/auth/google/callback`) |
| `DISCORD_CLIENT_ID` `DISCORD_CLIENT_SECRET` | ปุ่ม Discord (redirect: `<เว็บ>/auth/discord/callback`) |
| `TURNSTILE_SITE_KEY` `TURNSTILE_SECRET_KEY` | ใช้ Cloudflare Turnstile แทน captcha รูปภาพในตัว |
| `PUBLIC_URL` | ลิงก์เว็บในอีเมล (บน Render ใช้ `RENDER_EXTERNAL_URL` อัตโนมัติ) |

ทดสอบความปลอดภัย: `npm test` (ซื้อซ้อนพร้อมกัน, ปลอมราคา, ซองซ้ำ, CSRF, อัปโหลดไฟล์อันตราย ฯลฯ)

## Deploy ถาวร (ต้องการบัญชี)

Netlify Functions + Blobs หรือโฮสต์ Node (Railway / Render / Fly.io) ต้องมีบัญชีเจ้าของไซต์ — ตอนนี้รัน local ได้เต็มระบบโดยไม่ต้องล็อกอินบัญชีคลาวด์
