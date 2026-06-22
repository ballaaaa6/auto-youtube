import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

import { generateScript, transcribeAudio } from './cloudflare_ai.js';
import { runTTS } from './automations/voicertool_tts.js';
import { mergeAudio, trimSilence } from './audio_processor.js';
import { runGoogleFlow } from './automations/google_flow.js';
import { compileVideo, generateSRT } from './video_compiler.js';
import { uploadToYouTube } from './automations/youtube_upload.js';

dotenv.config();
const execPromise = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// โฟลเดอร์เก็บไฟล์ชั่วคราว
const TEMP_DIR = path.resolve('./temp');
const OUTPUT_DIR = path.resolve('./output');
[TEMP_DIR, OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ฟังก์ชันหาความยาวไฟล์เสียงในหน่วยวินาทีโดยใช้ ffprobe ที่ติดมากับ ffmpeg
async function getAudioDuration(filePath) {
  const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
  const { stdout } = await execPromise(cmd);
  return parseFloat(stdout.trim());
}

/**
 * API: เจนสคริปต์บทความจากหัวข้อ
 */
app.post('/api/generate-script', async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: 'กรุณาระบุหัวข้อเรื่อง' });

  try {
    const script = await generateScript(topic);
    res.json({ script });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API (SSE): รันบอทระบบสเปกครบชุดและรายงานความคืบหน้าแบบ Real-time
 */
app.get('/api/run-pipeline', async (req, res) => {
  // ตั้งค่าหัวข้อตอบกลับแบบ Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // ป้องกัน Proxy บล็อก Buffer

  const sendLog = (message, percent = 0) => {
    res.write(`data: ${JSON.stringify({ message, percent })}\n\n`);
  };

  const scriptParam = req.query.script;
  if (!scriptParam) {
    sendLog('ข้อผิดพลาด: ไม่พบข้อมูลบทพูด');
    res.end();
    return;
  }

  let script = [];
  try {
    script = JSON.parse(decodeURIComponent(scriptParam));
  } catch (e) {
    sendLog('ข้อผิดพลาด: บทพูดไม่อยู่ในฟอร์แมต JSON ที่ถูกต้อง');
    res.end();
    return;
  }

  // ล้างไฟล์งานเก่าในห้องพักงานชั่วคราว
  try {
    fs.readdirSync(TEMP_DIR).forEach(file => {
      fs.unlinkSync(path.join(TEMP_DIR, file));
    });
  } catch (e) {}

  try {
    sendLog('=== 🎬 เริ่มกระบวนการสร้างคลิป YouTube อัตโนมัติ ===', 5);
    
    // --- สเต็ปที่ 1: เจนไฟล์เสียงทีละส่วน ---
    sendLog('สเต็ปที่ 1/6: กำลังจำลองส่งบทพูดเข้า voicertool.com เพื่อเจนเสียงพากย์...', 10);
    const audioParts = [];
    const trimmedParts = [];
    
    for (let i = 0; i < script.length; i++) {
      const part = script[i];
      const origAudioPath = path.join(TEMP_DIR, `part_${i}_orig.mp3`);
      const trimmedAudioPath = path.join(TEMP_DIR, `part_${i}_trimmed.mp3`);
      
      sendLog(`กำลังดาวน์โหลดเสียงพูดช่วงที่ ${i + 1}/${script.length}...`);
      await runTTS(part.narration, origAudioPath, (logMsg) => sendLog(`  [บอท TTS] ${logMsg}`));
      
      // บีบช่วงเงียบทันทีรายท่อน เพื่อไม่ให้ส่งผลเสียต่อการรวมเสียง
      sendLog(`  กำลังตัดช่วงว่างทางเสียงเงียบของช่วงที่ ${i + 1}...`);
      await trimSilence(origAudioPath, trimmedAudioPath);
      
      audioParts.push(origAudioPath);
      trimmedParts.push(trimmedAudioPath);
    }

    // --- สเต็ปที่ 2: รวมเสียงทั้งหมด ---
    sendLog('สเต็ปที่ 2/6: กำลังรวมเสียงพากย์และตัดช่องเงียบเดดแอร์ในตัววิดีโอ...', 35);
    const mergedAudioPath = path.join(TEMP_DIR, 'final_narration.mp3');
    await mergeAudio(trimmedParts, mergedAudioPath);
    sendLog('  รวมเสียงทั้งหมดให้กระชับเรียบร้อยแล้ว');

    // คำนวณช่วงเวลาการแสดงผลของรูปแต่ละรูปตามความยาวของเสียงพาร์ทนั้น ๆ (แม่นยำ 100%)
    const scenes = [];
    let currentStart = 0;
    for (let i = 0; i < script.length; i++) {
      const duration = await getAudioDuration(trimmedParts[i]);
      scenes.push({
        start: currentStart,
        end: currentStart + duration,
        prompt: script[i].imagePrompt
      });
      currentStart += duration;
    }

    // --- สเต็ปที่ 3: ส่งวิเคราะห์ทำซับไตเติลและคีย์เวิร์ดช่วงเวลา ---
    sendLog('สเต็ปที่ 3/6: ส่งไฟล์เสียงให้ Cloudflare Whisper เจนรายละเอียดช่วงคำพูด (Timestamp)...', 50);
    const audioBuffer = fs.readFileSync(mergedAudioPath);
    const whisperResult = await transcribeAudio(audioBuffer);
    
    const srtPath = path.join(TEMP_DIR, 'subtitles.srt');
    generateSRT(whisperResult.segments, srtPath);
    sendLog('  สร้างคำบรรยายซับไตเติลภาษาไทยสำเร็จ');

    // --- สเต็ปที่ 4: เจนรูปภาพ ---
    sendLog('สเต็ปที่ 4/6: กำลังเปิดบอท Google Flow เจนรูปภาพตามบทวิเคราะห์...', 65);
    const imagePrompts = scenes.map(s => s.prompt);
    const imageOutputDir = path.join(TEMP_DIR, 'images');
    const imagePaths = await runGoogleFlow(imagePrompts, imageOutputDir, (logMsg) => sendLog(`  [บอทเจนภาพ] ${logMsg}`));

    // ผูกไฟล์รูปภาพเข้ากับฉาก
    for (let i = 0; i < scenes.length; i++) {
      scenes[i].imagePath = imagePaths[i];
    }

    // --- สเต็ปที่ 5: เรนเดอร์วิดีโอ ---
    sendLog('สเต็ปที่ 5/6: กำลังรวมไฟล์ภาพ เสียง และฝังซับไตเติลเป็นวิดีโอ Long-form...', 80);
    const outputVideoName = `video_${Date.now()}.mp4`;
    const finalVideoPath = path.join(OUTPUT_DIR, outputVideoName);
    
    await compileVideo(scenes, mergedAudioPath, srtPath, finalVideoPath, TEMP_DIR);
    sendLog(`🎉 เรนเดอร์วิดีโอเสร็จสิ้น: ${outputVideoName}`, 95);

    // แจ้งลิ้งไฟล์ผลลัพธ์
    res.write(`data: ${JSON.stringify({ status: 'done', videoUrl: `/output/${outputVideoName}`, videoPath: finalVideoPath })}\n\n`);
    res.end();

  } catch (err) {
    sendLog(`❌ เกิดข้อผิดพลาดในระบบ: ${err.message}`);
    res.write(`data: ${JSON.stringify({ status: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

// ให้บริการไฟล์วิดีโอจากโฟลเดอร์ output เพื่อให้หน้าเว็บควบคุมเปิดเล่นวิดีโอพรีวิวได้
app.use('/output', express.static(OUTPUT_DIR));

/**
 * API: อัปโหลดวิดีโอที่เจนเสร็จขึ้น YouTube
 */
app.post('/api/upload-youtube', async (req, res) => {
  const { videoPath, title, description } = req.body;
  if (!videoPath || !title) {
    return res.status(400).json({ error: 'กรุณาระบุที่อยู่วิดีโอและหัวข้อที่จะอัปโหลด' });
  }

  try {
    let logs = [];
    await uploadToYouTube(videoPath, title, description || '', (msg) => {
      logs.push(msg);
      console.log(`[YouTube Upload] ${msg}`);
    });
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// รันเซิร์ฟเวอร์
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🤖 Auto YouTube Backend Server รันที่พอร์ต ${PORT}`);
  console.log(`🔗 เข้าใช้ผ่านแดชบอร์ดควบคุมหน้าบ้านได้ทันที`);
  console.log(`==================================================`);
});
