import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execPromise = promisify(exec);

// ponytail: ใช้การซอยย่อยวิดีโอเป็นคลิปสั้น ๆ ตามความยาวของแต่ละรูปภาพ แล้วนำมาต่อกันด้วย FFmpeg concat demuxer ซึ่งเขียนง่ายและปลอดภัยกว่าการทำ filter graph ซับซ้อน

/**
 * สร้างไฟล์คำบรรยาย (SRT) จากรายการประโยคพร้อมข้อมูลช่วงเวลา
 */
export function generateSRT(segments, outputPath) {
  let srtContent = '';
  segments.forEach((seg, idx) => {
    const start = formatSRTTime(seg.start);
    const end = formatSRTTime(seg.end);
    srtContent += `${idx + 1}\n${start} --> ${end}\n${seg.text.trim()}\n\n`;
  });
  fs.writeFileSync(outputPath, srtContent, 'utf-8');
}

function formatSRTTime(seconds) {
  const date = new Date(0);
  date.setSeconds(seconds);
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  const timeStr = date.toISOString().substr(11, 8);
  return `${timeStr},${ms}`;
}

/**
 * ประกอบไฟล์ภาพและเสียงพูดพร้อมคำบรรยายออกมาเป็นไฟล์วิดีโอ .mp4
 * @param {Array} scenes รายการออบเจ็กต์ [{ start, end, imagePath }]
 * @param {string} audioPath พาธไฟล์เสียงพูดที่ประมวลผลแล้ว
 * @param {string} srtPath พาธไฟล์คำบรรยาย SRT
 * @param {string} outputPath พาธผลลัพธ์ไฟล์วิดีโอสำเร็จรูป
 * @param {string} tempDir โฟลเดอร์สำหรับเก็บไฟล์งานชั่วคราว
 */
export async function compileVideo(scenes, audioPath, srtPath, outputPath, tempDir) {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const clipPaths = [];
  
  // 1. เจนคลิปวิดีโอสั้นจากรูปภาพแต่ละรูปตามความยาววินาทีที่กำหนด
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const duration = scene.end - scene.start;
    const clipPath = path.join(tempDir, `clip_${i}.mp4`);
    
    // คำสั่งสร้างสไลด์จากภาพเดี่ยว ปรับความละเอียดเป็น 1920x1080 (แนวนอน)
    const cmd = `ffmpeg -y -loop 1 -r 25 -i "${scene.imagePath}" -c:v libx264 -t ${duration} -pix_fmt yuv420p -vf "scale=1920:1080,format=yuv420p" "${clipPath}"`;
    await execPromise(cmd);
    clipPaths.push(clipPath);
  }

  // 2. สร้างไฟล์รายการสำหรับรันคำสั่ง concat
  const listFilePath = path.join(tempDir, 'clips.txt');
  const listContent = clipPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(listFilePath, listContent, 'utf-8');

  // 3. นำคลิปทั้งหมดมาต่อกันและรวมเข้ากับแทร็กเสียงพูด
  const mergedNoSubPath = path.join(tempDir, 'merged_nosub.mp4');
  const mergeCmd = `ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -i "${audioPath}" -c:v copy -c:a aac -shortest "${mergedNoSubPath}"`;
  await execPromise(mergeCmd);

  // 4. ฝังคำบรรยาย (SRT Subtitles) ลงไปในไฟล์วิดีโอตัวสุดท้าย
  // หมายเหตุ: การใช้ filter subtitles บน Windows ต้องปรับพาธแบบพิเศษ
  const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  const renderCmd = `ffmpeg -y -i "${mergedNoSubPath}" -vf "subtitles='${escapedSrtPath}'" -c:a copy "${outputPath}"`;
  await execPromise(renderCmd);

  // 5. เคลียร์ไฟล์คลิปชั่วคราวเพื่อไม่ให้หนักเครื่อง
  try {
    clipPaths.forEach(p => fs.unlinkSync(p));
    fs.unlinkSync(listFilePath);
    fs.unlinkSync(mergedNoSubPath);
  } catch (err) {
    console.warn('ไม่สามารถลบไฟล์ชั่วคราวบางไฟล์ได้:', err.message);
  }
}
