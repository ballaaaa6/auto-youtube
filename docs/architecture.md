# แผนผังโครงสร้างระบบ (System Architecture) - Auto YouTube

เอกสารพิมพ์เขียวแสดงเทคโนโลยีและเส้นทางการไหลของข้อมูลสำหรับการสร้างวิดีโออัตโนมัติ

---

## 🚀 เทคโนโลยีที่ใช้งาน (Tech Stack)
- **Frontend Control Panel**: Vanilla HTML5 / Vanilla CSS3 / Vanilla Javascript (Deploy บน Cloudflare Pages)
- **Backend Automation Engine**: Node.js (Express, Playwright) + Local FFmpeg (รันโลคอลบนเครื่องคอมพิวเตอร์)
- **AI Models**: Cloudflare Workers AI (Llama 3.1 สำหรับสคริปต์ / Whisper สำหรับคีย์เวลาซับไตเติล)
- **Database**: Local File System (บันทึกวิดีโอและไฟล์เสียงลงโฟลเดอร์โดยตรง ไม่ใช้ฐานข้อมูลภายนอก)

---

## 📁 โครงสร้างโฟลเดอร์หลัก (Directory Structure)
- [backend/automations/](file:///d:/antigravity/auto%20youtube/backend/automations/) - สคริปต์บอท Playwright แยกตามเว็บเป้าหมาย (Voicertool, Google Flow, YouTube)
- [backend/](file:///d:/antigravity/auto%20youtube/backend/) - ตัวรับคำสั่ง (API Server), สคริปต์รัน FFmpeg จัดการเสียงและวิดีโอ
- [frontend/](file:///d:/antigravity/auto%20youtube/frontend/) - โฟลเดอร์หน้าแอปควบคุมแดชบอร์ดที่ Deploy บน Cloudflare
- [docs/](file:///d:/antigravity/auto%20youtube/docs/) - แหล่งรวบรวมข้อมูลกฎการเขียนโค้ดและตำแหน่งปุ่มกดบอท

---

## 🔄 แผนผังลำดับการทำงาน (Data Flow)

```mermaid
graph TD
    A[Frontend Dashboard] -->|1. ป้อนหัวข้อ & คำสั่ง| B(Backend Express Server)
    B -->|2. สั่งเขียนบทภาษาไทย| C(Cloudflare Workers AI: Llama-3.1)
    C -->|3. บทพูด + Prompt เจนภาพ| B
    B -->|4. ส่งข้อความบทพูด < 5000 chars| D[Playwright: voicertool.com]
    D -->|5. โหลดไฟล์เสียงพูด .mp3| B
    B -->|6. รวมเสียง + ตัดเดดแอร์| E[FFmpeg Audio Engine]
    E -->|7. ได้ไฟล์เสียงกระชับ| B
    B -->|8. สั่งวิเคราะห์ถอดความเจาะเวลา| F(Cloudflare Workers AI: Whisper)
    F -->|9. สคริปต์เวลา Timestamp รายวินาที| B
    B -->|10. ป้อน Prompt เจนภาพตามเวลา| G[Playwright: Google Flow]
    G -->|11. ดาวน์โหลดรูปภาพทั้งหมด| B
    B -->|12. เจนวิดีโอซ้อนภาพเข้ากับเสียงพร้อมใส่ซับ| H[FFmpeg Video Compiler]
    H -->|13. วิดีโอสำเร็จรูป .mp4| B
    B -->|14. ลากวางไฟล์และพิมพ์ข้อมูลคลิป| I[Playwright: YouTube Studio]
    I -->|15. คลิปพร้อมเผยแพร่| J[YouTube Channel]
```
