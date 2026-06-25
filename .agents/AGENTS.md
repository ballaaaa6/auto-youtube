# AI Agent Rules for Auto YouTube Project

This project adheres to the **Lazy Senior Developer** (Ponytail style) coding guidelines alongside project-specific rules.

---

## 1. Ponytail Style Rules (Lazy Senior Dev Mode)

1. **Evaluate the 6-rung ladder before writing any code**:
   - Does this task need to be built at all? (YAGNI - skip if not necessary)
   - Can the standard library or native platform features handle it? (e.g., `<input type="date">` instead of date picker libraries, CSS over JS, native FS over database)
   - Can it be written in a single line?
   - If code is required, write the simplest, shortest code that works (Boring over clever).
2. **Abstractions & Code Cleanliness**:
   - Do not create unrequested abstractions (no single-implementation interfaces, no config files for fixed values).
   - Deletion over addition. Remove unused code rather than writing new code.
   - Document shortcut intentions using comments starting with `// ponytail: [description]`.

---

## 2. Project-Specific Rules (Auto YouTube)

1. **DOM Selector Management**:
   - Never hardcode CSS Selectors or XPath paths in automation scripts (e.g., `voicertool_tts.js`, `google_flow.js`, `youtube_upload.js`).
   - **Mandatory**: Retrieve all selectors from the central selector file `docs/SELECTORS.md`.
2. **Real-time Status Logging**:
   - Long-running backend processes (TTS download, image rendering, FFmpeg compiling) must stream detailed status logs to the dashboard in real-time using **Server-Sent Events (SSE)**.
3. **Headless / Headful Browsing**:
   - Playwright browser scripts must support toggling `headless: true/false` via environment variables or frontend options.
4. **Codebase Language Policy (English-Only)**:
   - All source code, configs, comments, logs, and documentation files (except `implementation_plan.md` artifact) MUST be written in English.

---

## 3. Continuous Integration & Auto Deployment (CI/CD)

1. **Mandatory Git Push & Pages Deployment after Edits**:
   - Every time a file is modified, added, or deleted, the AI Agent **MUST execute Git Add, Commit, and Push to the remote `origin main` immediately**, followed by executing **`npx wrangler pages deploy frontend --project-name=auto-youtube`** to deploy the changes to Cloudflare Pages.
   - Keep commit messages short and clear, summarizing the change in a lazy senior developer style (e.g., `git commit -m "fix: adjust select elements in voicertool tts"`).
2. **Mandatory Self-Testing**:
   - Before delivering any work or summarizing progress, the AI Agent **must verify the syntax and run the system locally** to guarantee there are no bugs or crash errors. Delivering untested code is strictly prohibited.
