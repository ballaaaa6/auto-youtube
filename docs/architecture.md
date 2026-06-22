# System Architecture - Auto YouTube

Technical blueprint showing the tech stack and data flow for the automated video generation pipeline.

---

## 🚀 Tech Stack
- **Frontend Control Panel**: Vanilla HTML5 / Vanilla CSS3 / Vanilla Javascript (Deployed on Cloudflare Pages)
- **Backend Automation Engine**: Node.js (Express, Playwright) + Local FFmpeg (Runs locally on host machine)
- **AI Models**: Cloudflare Workers AI (Llama 3.1 for script gen / Whisper for audio timestamp analysis)
- **Database**: Local File System (Saves videos, audios, and images directly to local folders, no external database)

---

## 📁 Key Directory Structure
- [backend/automations/](file:///d:/antigravity/auto%20youtube/backend/automations/) - Playwright bots for Voicertool, Google Flow, and YouTube Studio.
- [backend/](file:///d:/antigravity/auto%20youtube/backend/) - Express server APIs, FFmpeg wrapper logic for audio and video assembly.
- [frontend/](file:///d:/antigravity/auto%20youtube/frontend/) - Web dashboard assets deployed on Cloudflare.
- [docs/](file:///d:/antigravity/auto%20youtube/docs/) - System specifications, selectors map, and coding rules.

---

## 🔄 Data Flow Map

```mermaid
graph TD
    A[Frontend Dashboard] -->|1. Submit Topic & Config| B(Backend Express Server)
    B -->|2. Generate Script in Thai| C(Cloudflare Workers AI: Llama-3.1)
    C -->|3. Narration & Image Prompt Array| B
    B -->|4. Input Narration Text < 5000 chars| D[Playwright: voicertool.com]
    D -->|5. Download Audio Parts .mp3| B
    B -->|6. Merge Audio & Remove Silence| E[FFmpeg Audio Engine]
    E -->|7. Processed Audio File| B
    B -->|8. Request Word/Sentence Timestamps| F(Cloudflare Workers AI: Whisper)
    F -->|9. Timeline SRT & Timestamps| B
    B -->|10. Input Scene Prompts & Generate| G[Playwright: Google Flow]
    G -->|11. Download Generated Images| B
    B -->|12. Assemble Video, Audio, and Subtitles| H[FFmpeg Video Compiler]
    H -->|13. Completed Video File .mp4| B
    B -->|14. Select File & Fill metadata| I[Playwright: YouTube Studio]
    I -->|15. Uploaded Video Private Draft| J[YouTube Channel]
```
