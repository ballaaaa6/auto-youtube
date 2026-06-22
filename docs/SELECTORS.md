# คลังเก็บตำแหน่งปุ่ม (CSS Selectors) - Auto YouTube

ไฟล์นี้รวบรวม CSS Selectors และพิกัดตำแหน่งปุ่มของหน้าเว็บต่าง ๆ ที่ระบบบอทใช้ในการทำงาน เพื่อความสะดวกในการแก้ไขจุดเดียวเมื่อเว็บเป้าหมายมีการปรับหน้าตาใหม่

---

## 1. เว็บไซต์ Voicertool (TTS เจนเสียงพูด)
*   **URL**: `https://voicertool.com/`

```json
{
  "voicertool": {
    "textarea_input": "textarea[placeholder*=\"Enter your text\"], textarea.form-control",
    "language_dropdown": "div.flex-col:has(label:has-text(\"Language\")) select, select:has(option:has-text(\"English\"))",
    "voice_dropdown": "div.flex-col:has(label:has-text(\"Voice\")) select, select:has(option:has-text(\"Ava\"))",
    "generate_button": "button:has-text(\"Generate speech\"), button.btn-primary:has-text(\"Generate\")",
    "generated_audio_list": "div.border-gray-200.rounded-lg",
    "download_button": "a[download], button:has-text(\"Download\")"
  }
}
```

---

## 2. เว็บไซต์ Google Flow (เจนภาพ AI)
*   **URL**: `https://labs.google/fx/` หรือ `https://flow.google/`
*   *หมายเหตุ*: ปุ่มต่าง ๆ จะถูกอัปเดตและกำหนดเพิ่มเติมหลังจากที่ตกลงขั้นตอนกดปุ่มร่วมกันแล้ว

```json
{
  "google_flow": {
    "prompt_textarea": "textarea[placeholder*=\"Describe\"], textarea#prompt",
    "generate_button": "button:has-text(\"Generate\"), button[type=\"submit\"]",
    "image_result": "img.result-image",
    "download_button": "button.download-btn"
  }
}
```

---

## 3. เว็บไซต์ YouTube Studio (อัปโหลดคลิป)
*   **URL**: `https://studio.youtube.com/`

```json
{
  "youtube_studio": {
    "create_button": "#create-icon, button:has-text(\"Create\")",
    "upload_button": "#upload-button, a:has-text(\"Upload videos\")",
    "file_input": "input[type=\"file\"][name=\"Filedata\"]",
    "title_textarea": "div#title-textarea div#textbox",
    "description_textarea": "div#description-textarea div#textbox",
    "thumbnail_input": "input[type=\"file\"]#file-loader",
    "audience_not_for_kids": "paper-radio-button[name=\"VIDEO_MADE_FOR_KIDS_NOT_MADE_FOR_KIDS\"]",
    "next_button": "#next-button, button:has-text(\"Next\")",
    "visibility_private": "paper-radio-button[name=\"PRIVATE\"]",
    "visibility_public": "paper-radio-button[name=\"PUBLIC\"]",
    "save_button": "#done-button, button:has-text(\"Save\")"
  }
}
```
