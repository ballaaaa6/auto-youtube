import dotenv from 'dotenv';
dotenv.config();

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

// ponytail: ใช้ native fetch ที่มีมาใน Node.js 18+ แทนการลง axios เพื่อประหยัดพื้นที่และไม่ลงไลบรารีซ้ำซ้อน
async function runModel(model, inputData) {
  if (!ACCOUNT_ID || !API_TOKEN) {
    throw new Error('กรุณาตั้งค่า CLOUDFLARE_ACCOUNT_ID และ CLOUDFLARE_API_TOKEN ในไฟล์ .env');
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${model}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(inputData),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Cloudflare AI API Error (${response.status}): ${errText}`);
  }

  return response.json();
}

/**
 * เขียนบทวิดีโอภาษาไทยพร้อมคำสั่ง Prompt สำหรับเจนภาพของแต่ละช่วง
 */
export async function generateScript(topic) {
  const prompt = `คุณคือคนเขียนบทช่อง YouTube มืออาชีพ
หัวข้อคลิปคือ: "${topic}"
ต้องการคลิปแนวนอนแบบ Long-form (ยาวประมาณ 10-12 นาที)
ให้เขียนบทพูดเป็นภาษาไทยทั้งหมด และแบ่งเนื้อหาออกเป็นช่วง ๆ (พาร์ทละประมาณ 100-300 คำพูด เพื่อไม่ให้ยาวเกินและดาวน์โหลดเสียงได้ง่าย)

สำหรับแต่ละช่วง ให้ระบุข้อมูลในรูปแบบ JSON ดังนี้:
1. "narration": บทพูดของช่วงนั้น (ภาษาไทยล้วน ไม่มีวงเล็บหรืออักขระพิเศษ)
2. "imagePrompt": คำสั่งภาษาอังกฤษ (English Prompt) ที่ใช้อธิบายฉากนั้น เพื่อนำไปสั่ง AI เจนภาพต่อ (เช่น "A cinematic wide shot of ancient Rome under golden hour, high detail")

ตัวอย่างผลลัพธ์ที่ต้องการ (ให้ส่งกลับเฉพาะ JSON Array เท่านั้น ห้ามมีคำอธิบายอื่นนอกเหนือจาก JSON):
[
  {
    "narration": "ยินดีต้อนรับทุกท่านเข้าสู่เรื่องราวของ...",
    "imagePrompt": "A high detail cinematic view of..."
  }
]`;

  const result = await runModel('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      { role: 'system', content: 'You are a helpful assistant that outputs only valid JSON arrays.' },
      { role: 'user', content: prompt }
    ],
  });

  // คลีนค่าผลลัพธ์ที่เป็นข้อความแล้วแปลงเป็น JSON
  const content = result.result.response || result.result.text;
  try {
    // หาจุดเริ่มต้นและจุดสิ้นสุดของ JSON array
    const startIdx = content.indexOf('[');
    const endIdx = content.lastIndexOf(']') + 1;
    if (startIdx === -1 || endIdx === -1) {
      throw new Error('AI ส่งผลลัพธ์ไม่ใช่รูปแบบ JSON Array');
    }
    return JSON.parse(content.substring(startIdx, endIdx));
  } catch (err) {
    console.error('Failed to parse script JSON:', content);
    throw new Error('ไม่สามารถแปลงบทความที่ AI เจนเป็นโครงสร้างข้อมูลได้: ' + err.message);
  }
}

/**
 * ส่งไฟล์เสียงไปถอดความภาษาไทยพร้อมช่วงเวลา (Timestamp) รายประโยค/คำ
 */
export async function transcribeAudio(audioBuffer) {
  // Cloudflare Whisper รับ body เป็น binary audio file (เช่น WebM, MP3, WAV)
  if (!ACCOUNT_ID || !API_TOKEN) {
    throw new Error('กรุณาตั้งค่า CLOUDFLARE_ACCOUNT_ID และ CLOUDFLARE_API_TOKEN ในไฟล์ .env');
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/openai/whisper`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/octet-stream',
      },
      body: audioBuffer,
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Cloudflare Whisper API Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  // Whisper บน Workers AI จะคืนค่า JSON ที่มี segments พร้อมจุดเริ่ม-สิ้นสุดเวลา (start, end, text)
  return data.result;
}
