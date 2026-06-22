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
).youtube_studio;

const HEADLESS = process.env.HEADLESS === 'true';
const PROFILE_PATH = path.resolve(process.env.BROWSER_PROFILE_PATH || '../profiles/user_data');

/**
 * อัปโหลดวิดีโอขึ้น YouTube Studio โดยควบคุมเบราว์เซอร์อัตโนมัติ
 * @param {string} videoPath พาธไฟล์วิดีโอสำเร็จรูป (.mp4)
 * @param {string} title ชื่อคลิปวิดีโอ
 * @param {string} description รายละเอียดใต้คลิป (Description)
 * @param {Function} logCallback ฟังก์ชันแจ้งเตือนล็อกสถานะกลับไปแดชบอร์ด
 */
export async function uploadToYouTube(videoPath, title, description, logCallback = console.log) {
  logCallback(`กำลังเตรียมอัปโหลดคลิปขึ้น YouTube...`);
  logCallback(`ใช้ไฟล์วิดีโอ: ${path.basename(videoPath)}`);
  logCallback(`ใช้เซสชันโปรไฟล์จาก: ${PROFILE_PATH}`);

  if (!fs.existsSync(videoPath)) {
    throw new Error('ไม่พบไฟล์วิดีโอที่จะอัปโหลด');
  }

  // ใช้ launchPersistentContext เพื่อไม่สับสนเรื่องหน้าต่างล็อกอินและจำสิทธิ์ใช้งาน
  const context = await chromium.launchPersistentContext(PROFILE_PATH, {
    headless: HEADLESS,
    viewport: { width: 1366, height: 768 },
    args: ['--disable-blink-features=AutomationControlled']
  });

  const page = await context.newPage();

  try {
    logCallback('กำลังเปิดหน้าเว็บ YouTube Studio...');
    await page.goto('https://studio.youtube.com/', { waitUntil: 'networkidle', timeout: 60000 });

    // ตรวจสอบว่าล็อกอินค้างไว้แล้วหรือยัง
    const isLoggedIn = await page.locator(selectors.create_button).count();
    if (isLoggedIn === 0) {
      logCallback('⚠️ ไม่พบการล็อกอินเข้าสู่ระบบ! กรุณาตั้งค่า HEADLESS=false แล้วทำการลงชื่อเข้าใช้ช่อง YouTube ของคุณในเบราว์เซอร์ให้เสร็จสิ้นก่อนเริ่มรันใหม่');
      throw new Error('เบราว์เซอร์ยังไม่ได้ลงชื่อเข้าใช้งาน YouTube Studio');
    }

    logCallback('กำลังกดปุ่ม "สร้าง (Create)"...');
    await page.click(selectors.create_button);
    await page.waitForTimeout(1000);

    logCallback('กำลังกดปุ่ม "อัปโหลดวิดีโอ (Upload videos)"...');
    await page.click(selectors.upload_button);
    await page.waitForTimeout(2000);

    logCallback('กำลังลากวางไฟล์วิดีโอขึ้นระบบ...');
    const fileChooserPromise = page.waitForEvent('filechooser');
    // กดปุ่มเลือกไฟล์เพื่อกระตุ้น file chooser
    await page.click('button:has-text("Select files"), #select-files-button');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(videoPath);

    logCallback('กำลังรอการประมวลผลไฟล์และเปิดฟอร์มกรอกข้อมูล...');
    await page.waitForSelector(selectors.title_textarea, { timeout: 60000 });
    
    logCallback('กำลังใส่ชื่อคลิปวิดีโอ...');
    // เคลียร์คำนำหน้าที่ระบบตั้งให้อัตโนมัติแล้วพิมพ์ชื่อใหม่
    await page.click(selectors.title_textarea);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.fill(selectors.title_textarea, title.substring(0, 100)); // ป้องกันอักษรเกิน 100
    await page.waitForTimeout(1000);

    logCallback('กำลังใส่ข้อมูลรายละเอียดคลิป (Description)...');
    await page.fill(selectors.description_textarea, description);
    await page.waitForTimeout(1000);

    // เลือกตัวเลือก "ไม่ วิดีโอนี้ไม่ได้สร้างมาเพื่อเด็ก" (ข้อบังคับของ YouTube)
    logCallback('กำลังยืนยันกลุ่มเป้าหมาย (ไม่ใช่สำหรับเด็ก)...');
    await page.click(selectors.audience_not_for_kids);
    await page.waitForTimeout(1000);

    // กด "ถัดไป (Next)" ไปเรื่อย ๆ (สเต็ปรายละเอียด, การสร้างรายได้, องค์ประกอบ, ตรวจสอบ)
    logCallback('กำลังประมวลผลขั้นตอนตั้งค่าตัวเลือกวิดีโอ...');
    for (let i = 0; i < 3; i++) {
      await page.click(selectors.next_button);
      await page.waitForTimeout(1500);
    }

    // ตั้งค่าเป็นวิดีโอ "ส่วนตัว (Private)" หรือ "แบบร่าง" เพื่อความปลอดภัยก่อนผู้ใช้อัปเผยแพร่เอง
    logCallback('กำลังตั้งค่าความปลอดภัยเป็น "ส่วนตัว (Private)" เพื่อรอตรวจสอบ...');
    await page.click(selectors.visibility_private);
    await page.waitForTimeout(1500);

    logCallback('กำลังกดปุ่ม "บันทึก (Save/Done)" เพื่อสิ้นสุดการอัปโหลด...');
    await page.click(selectors.save_button);
    
    // รอจนปุ่มบันทึกหายไปหรือขึ้นป็อปอัปยืนยันเสร็จสิ้น
    logCallback('กำลังบันทึกข้อมูลคลิปของคุณบนคลาวด์...');
    await page.waitForTimeout(5000);

    logCallback('🎉 อัปโหลดและบันทึกคลิปของคุณเรียบร้อยแล้ว (สามารถเข้าไปกดยืนยันเผยแพร่ใน YouTube Studio ได้เลย)');

  } catch (err) {
    logCallback(`เกิดข้อผิดพลาดขณะอัปโหลด YouTube: ${err.message}`);
    throw err;
  } finally {
    await context.close();
    logCallback('ปิดเบราว์เซอร์ YouTube Studio เรียบร้อย');
  }
}
