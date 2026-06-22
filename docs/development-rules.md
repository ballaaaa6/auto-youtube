# Development Rules & AI Instructions

## 📏 1. File Size & Code Bloat Control (STRICT)

- **Max File Length**: Any source code file (e.g., JS, CSS, HTML) MUST NOT exceed 300-400 lines.
- **Max Function Length**: Keep functions under 50 lines. One function = One responsibility.
- **Refactoring Trigger**: If adding a new feature pushes a file over 400 lines, you MUST split the code into smaller parts (e.g., separate components, utils, or services).
- **No Duplication (DRY Principle)**: Reuse existing code. Do not rewrite functions or helpers that already exist in the codebase.

---

## 🤖 2. AI Token Efficiency Rules

- **Concise Code**: Provide only the code blocks that need to be changed or added. Do not output the entire unchanged file.
- **Plan First**: Before writing code that affects multiple files or alters the project structure, list the proposed files and changes first.
- **Language Policy**: All files, code, variables, console logs, errors, and documentation in this repository MUST be written in English. The only exception is the `implementation_plan.md` artifact.

---

## 📂 3. Key Directory Structure

- `docs/` - System architecture blueprints, element selector maps, and guidelines.
- `backend/automations/` - Playwright automation scripts for target platforms (Voicertool, Google Flow, YouTube).
- `backend/` - Node.js Express server APIs and FFmpeg processing modules.
- `frontend/` - Static HTML/CSS/JS dashboard deployed on Cloudflare Pages.
