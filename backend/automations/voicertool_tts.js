import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

// โหลด Selectors จาก docs/SELECTORS.md ตามกฎเหล็ก
const SELECTORS_PATH = path.join(process.cwd(), '../docs/SELECTORS.md');
const selectors = JSON.parse(
  fs.readFileSync(SELECTORS_PATH, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1') // คลีนคอมเมนต์ในไฟล์ MD/JSON
).voicertool;

const HEADLESS = process.env.HEADLESS === 'true';

/**
 * แปลงข้อความบทพูดภาษาไทยเป็นไฟล์เสียง MP3 โดยการคุมเว็บ voicertool.com
 * @param {string} text ข้อความบทพูด (ไม่ควรเกิน 4000 ตัวอักษร)
 * @param {string} outputPath พาธปลายทางสำหรับบันทึกไฟล์เสียง (.mp3)
 * @param {Function} logCallback ฟังก์ชันแจ้งเตือนล็อกสถานะกลับไปหน้าเว็บควบคุม
 */
export async function runTTS(text, outputPath, logCallback = console.log) {
  logCallback(`กำลังเปิดเบราว์เซอร์เพื่อเข้าเว็บ voicertool.com (headless: ${HEADLESS})...`);
  
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled'] // ช่วยบายพาสตรวจจับบอทขั้นต้น
  });
  
  const context = await browser.newContext({
    acceptDownloads: true
  });
  
  const page = await context.newPage();
  
  try {
    logCallback('กำลังเดินทางไปที่ https://voicertool.com/...');
    await page.goto('https://voicertool.com/', { waitUntil: 'networkidle', timeout: 60000 });
    
    logCallback('กำลังป้อนบทพูดลงในช่องพิมพ์...');
    await page.waitForSelector(selectors.textarea_input);
    await page.fill(selectors.textarea_input, text);
    
    // ตั้งค่าภาษาและเสียงพากย์เริ่มต้น (ภาษาไทย / Ava)
    try {
      logCallback('กำลังค้นหาปุ่มเลือกภาษาและเสียงพากย์...');
      // หากต้องการเปลี่ยนภาษา สามารถสั่งเปลี่ยนค่า dropdown ได้ที่นี่
      // ตัวอย่าง: await page.selectOption(selectors.language_dropdown, 'th-TH');
    } catch (e) {
      logCallback('ใช้ภาษาและเสียงเริ่มต้นของเว็บ (ไม่พบตัวเลือกเพิ่มเติม)...');
    }
    
    logCallback('กำลังกดปุ่ม "Generate speech" และรอเสียงถูกสร้าง...');
    await page.click(selectors.generate_button);
    
    // รอจนกว่าจะมีการตอบกลับหรือขึ้นไฟล์เสียงใหม่ในประวัติ
    logCallback('กำลังประมวลผลเสียงพูด (อาจใช้เวลาประมาณ 10-30 วินาที)...');
    
    // ดักจับเหตุการณ์ดาวน์โหลดไฟล์เมื่อกดปุ่ม Download
    const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
    
    // รอให้ปุ่มดาวน์โหลดโผล่ขึ้นมาแล้วกดดาวน์โหลด
    // ในเว็บ voicertool ปุ่มดาวน์โหลดมักจะเป็นแท็ก a ที่มีแอตทริบิวต์ download
    await page.waitForSelector(selectors.download_button, { timeout: 90000 });
    await page.click(selectors.download_button);
    
    const download = await downloadPromise;
    logCallback('สร้างเสียงเสร็จสิ้น! กำลังดาวน์โหลดไฟล์ลงเครื่อง...');
    
    // บันทึกไฟล์ไปยังพาธที่ต้องการ
    await download.saveAs(outputPath);
    logCallback(`ดาวน์โหลดและเซฟเสียงสำเร็จ: ${path.basename(outputPath)}`);
    
  } catch (err) {
    logCallback(`เกิดข้อผิดพลาดในการรัน TTS: ${err.message}`);
    throw err;
  } finally {
    await browser.close();
    logCallback('ปิดเบราว์เซอร์ TTS เรียบร้อย');
  }
}
