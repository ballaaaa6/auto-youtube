import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execPromise = promisify(exec);

// ponytail: ใช้ child_process รันคำสั่ง ffmpeg ตรง ๆ แทนการติดตั้งไลบรารี fluent-ffmpeg เพื่อความกระชับและประหยัดพื้นที่ระบบ

/**
 * รวมไฟล์เสียง MP3 หลาย ๆ ไฟล์เข้าด้วยกันเป็นไฟล์เดียว
 */
export async function mergeAudio(audioPaths, outputPath) {
  if (audioPaths.length === 0) throw new Error('ไม่มีไฟล์เสียงให้รวม');
  if (audioPaths.length === 1) {
    // ถ้ามีไฟล์เดียวให้ก๊อปปี้ไปที่ผลลัพธ์เลย
    const cmd = `ffmpeg -y -i "${audioPaths[0]}" -acodec copy "${outputPath}"`;
    await execPromise(cmd);
    return;
  }

  // สร้างอินพุตคำสั่งและ filter complex
  const inputs = audioPaths.map(p => `-i "${p}"`).join(' ');
  const filterInputs = audioPaths.map((_, idx) => `[${idx}:a]`).join('');
  const filterComplex = `"${filterInputs}concat=n=${audioPaths.length}:v=0:a=1[a]"`;

  const cmd = `ffmpeg -y ${inputs} -filter_complex ${filterComplex} -map "[a]" "${outputPath}"`;
  await execPromise(cmd);
}

/**
 * ตัดช่วงเสียงเงียบ (Dead Air/Silence) ออกเพื่อให้ประโยคพูดไหลลื่นและกระชับขึ้น
 */
export async function trimSilence(inputPath, outputPath) {
  // silenceremove: 
  // start_periods=1: ลบความเงียบช่วงเริ่มต้น
  // stop_periods=-1: ทำงานกับช่วงเงียบทั้งหมดในแทร็กเสียง
  // stop_duration=0.3: ถ้ายาวเกิน 0.3 วินาที ให้ถือว่าเงียบ
  // stop_threshold=-40dB: ระดับความดังที่เป็นเกณฑ์เสียงเงียบ
  const filter = 'silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB:stop_periods=-1:stop_duration=0.3:stop_threshold=-40dB';
  const cmd = `ffmpeg -y -i "${inputPath}" -af "${filter}" "${outputPath}"`;
  await execPromise(cmd);
}
