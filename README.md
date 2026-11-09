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

- `TRUEMONEY_MOBILE=0624712534` — เบอร์วอลเล็ตที่รับซอง (ฝั่งเซิร์ฟเวอร์เท่านั้น)
- `SESSION_SECRET=...`
- `PORT=8080`

ข้อมูลผู้ใช้เก็บใน SQLite ที่ `data/haha.sqlite`

## Deploy ถาวร (ต้องการบัญชี)

Netlify Functions + Blobs หรือโฮสต์ Node (Railway / Render / Fly.io) ต้องมีบัญชีเจ้าของไซต์ — ตอนนี้รัน local ได้เต็มระบบโดยไม่ต้องล็อกอินบัญชีคลาวด์
