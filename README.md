# ระบบสร้างวิดีโอ YouTube อัตโนมัติ (Auto YouTube)

ระบบสร้างคอนเทนต์วิดีโอสำหรับ YouTube อัตโนมัติโดยใช้ AI เขียนบท, ควบคุมเบราว์เซอร์ไปดาวน์โหลดเสียงพูดบน `voicertool.com`, ตัดแต่งเสียงด้วย FFmpeg, เจนรูปภาพ และทำการอัปโหลดวิดีโอขึ้น YouTube Studio พร้อมฝังซับไตเติลภาษาไทย

ระบบนี้ทำงานแบบ **Hybrid** โดยส่วนควบคุม (Dashboard UI) จะทำงานบน Cloudflare ส่วนการรันบอท (Playwright) และเรนเดอร์วิดีโอ (FFmpeg) จะทำงานแบบเบื้องหลังบนคอมพิวเตอร์ของคุณ

---

## 🛠️ ความต้องการของระบบ (Prerequisites)

1.  **Node.js**: เวอร์ชั่น 18 ขึ้นไป
2.  **FFmpeg**: ติดตั้งและตั้งค่าตัวแปร PATH เรียบร้อยแล้ว (ตรวจสอบในเครื่องคุณพบว่าใช้ได้ปกติ)
3.  **Cloudflare Account**: สำหรับใช้งาน Workers AI และ Cloudflare Pages/Tunnel
4.  **Google & YouTube Account**: สำหรับใช้สร้างภาพและอัปโหลดวิดีโอ

---

## 🚀 วิธีติดตั้งและเริ่มต้นใช้งาน (Installation)

### 1. โคลนโปรเจกต์และดาวน์โหลด Submodule
```bash
# อัปเดต Submodule ของ ponytail ที่จำเป็นสำหรับการตั้งค่าระบบ
git submodule update --init --recursive
```

### 2. ตั้งค่าไฟล์ Environment Variables
1. ก๊อปปี้ไฟล์ `.env.example` เป็น `.env`
2. เปิดไฟล์ `.env` และใส่ข้อมูล **Cloudflare Account ID** และ **API Token** ของคุณ
3. ใส่ที่อยู่พาธสำหรับจดจำโปรไฟล์เบราว์เซอร์

---

## 💻 วิธีเปิดใช้งานหลังบ้าน (Running Backend Locally)

เข้าไปที่โฟลเดอร์ `backend/` แล้วทำตามขั้นตอนดังนี้:

```bash
# ติดตั้งไลบรารีที่จำเป็น
npm install

# ติดตั้งบราวเซอร์สำหรับ Playwright
npx playwright install chromium

# รันเซิร์ฟเวอร์หลังบ้าน
npm start
```
*ระบบจะเปิดเซิร์ฟเวอร์ที่ `http://localhost:3000`*

---

## ☁️ วิธีเชื่อมต่อแดชบอร์ดด้วย Cloudflare Tunnel

เพื่อให้เว็บแอพของคุณที่ฝากไฟล์ไว้บน Cloudflare Pages สามารถส่งคำสั่งและควบคุมระบบบอทบนคอมพิวเตอร์ของคุณได้โดยไม่ต้องตั้งค่าเราเตอร์ (Forward Port) ให้ทำดังนี้:

1.  ดาวน์โหลดและติดตั้ง **Cloudflare Tunnel (cloudflared)** บนเครื่องคอมพิวเตอร์ของคุณ
2.  เปิด Terminal/Command Prompt บนเครื่องของคุณแล้วรันคำสั่งเชื่อมต่อ:
    ```bash
    cloudflared tunnel --url http://localhost:3000
    ```
3.  Cloudflare จะให้ลิงก์สาธารณะ (เช่น `https://random-subdomain.trycloudflare.com`)
4.  นำลิงก์ดังกล่าวไปกรอกในช่อง "Backend URL" ของหน้าเว็บแดชบอร์ดบน Cloudflare Pages เพื่อสั่งเริ่มงานได้ทันที

---

## 🔑 วิธีการเข้าใช้งาน (First-time Login Setup)

ในการเปิดรันครั้งแรก **ห้ามเปิดโหมด Headless** (ให้ตั้งค่า `HEADLESS=false` ใน `.env`) เพื่อให้คุณล็อกอินเว็บเหล่านี้ในเบราว์เซอร์ของบอทด้วยตนเองเพียงครั้งเดียว:
1.  **Google Flow** (ลงชื่อเข้าใช้ด้วยบัญชี Google ของคุณเพื่อเข้าใช้เครื่องมือ)
2.  **YouTube Studio** (ลงชื่อเข้าใช้ช่อง YouTube ที่ต้องการอัปโหลด)

*เมื่อเสร็จแล้ว บอทจะจดจำล็อกอินนี้ไว้ตลอดกาลผ่าน Browser Profiles คุณสามารถตั้งเป็น `HEADLESS=true` ในภายหลังเพื่อซ่อนหน้าจอได้*
