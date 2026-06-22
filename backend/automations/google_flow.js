import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

// โหลด Selectors จาก docs/SELECTORS.md
const SELECTORS_PATH = path.join(process.cwd(), '../docs/SELECTORS.md');
const selectors = JSON.parse(
  fs.readFileSync(SELECTORS_PATH, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1')
).google_flow;

const HEADLESS = process.env.HEADLESS === 'true';
const PROFILE_PATH = path.resolve(process.env.BROWSER_PROFILE_PATH || '../profiles/user_data');

/**
 * บอทเจนภาพจาก Google Flow (โครงสร้างหลักรองรับการป้อนคำสั่งและการกดปุ่มของคู่สนทนา)
 * @param {Array} prompts รายการ Prompt ภาษาอังกฤษที่ได้จากการวิเคราะห์บทพูด
 * @param {string} outputDir โฟลเดอร์ที่เก็บรูปภาพ
 * @param {Function} logCallback ฟังก์ชันแจ้งเตือนล็อกสถานะกลับไปหน้าจอแดชบอร์ด
 */
export async function runGoogleFlow(prompts, outputDir, logCallback = console.log) {
  logCallback(`กำลังเปิด Google Flow บราวเซอร์ (headless: ${HEADLESS})...`);
  logCallback(`ใช้โปรไฟล์เบราว์เซอร์จากพาธ: ${PROFILE_PATH}`);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // ใช้ launchPersistentContext เพื่อให้จำประวัติคุกกี้/ล็อกอินบัญชี Google ค้างไว้ได้
  const context = await chromium.launchPersistentContext(PROFILE_PATH, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 720 },
    acceptDownloads: true,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const page = await context.newPage();
  const imagePaths = [];

  try {
    logCallback('กำลังเดินทางไปที่ Google Flow (labs.google/fx)...');
    await page.goto('https://labs.google/fx/', { waitUntil: 'networkidle', timeout: 60000 });
    
    // ponytail: สร้างโค้ดรับพิกัดปุ่มและกรอกคำสั่งรอไว้ล่วงหน้า
    for (let i = 0; i < prompts.length; i++) {
      const promptText = prompts[i];
      const filename = `image_${i}.png`;
      const finalImagePath = path.join(outputDir, filename);

      logCallback(`[รูปที่ ${i + 1}/${prompts.length}] กำลังส่ง Prompt: "${promptText}"`);
      
      // -------------------------------------------------------------
      // ponytail: จุดนี้จะรองรับลำดับคำสั่งกดปุ่มที่ผู้ใช้แจ้งในภายหลัง
      // โค้ดตัวอย่างการกรอก Prompt และกดปุ่ม:
      //
      // await page.waitForSelector(selectors.prompt_textarea);
      // await page.fill(selectors.prompt_textarea, promptText);
      // await page.click(selectors.generate_button);
      // await page.waitForSelector(selectors.image_result);
      // const downloadPromise = page.waitForEvent('download');
      // await page.click(selectors.download_button);
      // const download = await downloadPromise;
      // await download.saveAs(finalImagePath);
      // -------------------------------------------------------------

      // จำลองการสร้างรูปภาพชั่วคราวเพื่อรอใส่โค้ด Playwright เจนรูปของจริง
      // โดยการสร้างภาพสี่เหลี่ยมสีพื้นสีเดียวกันเพื่อเอาไปประกอบวิดีโอเทสระบบไปก่อน
      // (จะอัปเกรดเป็น Playwright ควบคุมเว็บของจริงเมื่อใส่ Selectors)
      const mockCanvasScript = `
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#${Math.floor(Math.random()*16777215).toString(16)}';
        ctx.fillRect(0, 0, 1920, 1080);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 48px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Scene ${i + 1}: ${promptText.substring(0, 40)}...', 960, 540);
        canvas.toDataURL('image/png');
      `;
      
      const base64Data = await page.evaluate(mockCanvasScript);
      const buffer = Buffer.from(base64Data.split(',')[1], 'base64');
      fs.writeFileSync(finalImagePath, buffer);
      
      imagePaths.push(finalImagePath);
      logCallback(`สร้างรูปตัวอย่างเรียบร้อย: ${filename}`);
      
      // หน่วงเวลาสุ่มเสมือนมนุษย์ทำ
      await page.waitForTimeout(2000 + Math.random() * 2000);
    }

  } catch (err) {
    logCallback(`เกิดข้อผิดพลาดในการรัน Google Flow: ${err.message}`);
    throw err;
  } finally {
    await context.close();
    logCallback('ปิดเบราว์เซอร์ Google Flow เรียบร้อย');
  }

  return imagePaths;
}
