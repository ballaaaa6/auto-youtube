import dotenv from 'dotenv';
dotenv.config();

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

// ponytail: Use native fetch available in Node.js 18+ instead of installing axios to keep dependencies minimal.
async function runModel(model, inputData) {
  if (!ACCOUNT_ID || !API_TOKEN) {
    throw new Error('Please configure CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env file');
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
 * Generate video script in Thai and image prompt descriptions in English.
 */
export async function generateScript(topic) {
  const prompt = `You are a professional YouTube scriptwriter.
Video Topic: "${topic}"
Target format: Long-form landscape video (about 10-12 minutes long).
Write narration script entirely in Thai. Divide the video into short sections/parts (around 100-300 words each to keep TTS downloads clean and fast).

For each section, return a JSON object with:
1. "narration": The Thai narration text for that section (pure Thai, no brackets or special characters).
2. "imagePrompt": An English prompt describing the scene visual to generate an AI image (e.g., "A cinematic wide shot of ancient Rome under golden hour, high detail").

Example output format (Return ONLY the JSON array, no extra conversational text or explanations outside the JSON):
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

  const content = result.result.response || result.result.text;
  try {
    const startIdx = content.indexOf('[');
    const endIdx = content.lastIndexOf(']') + 1;
    if (startIdx === -1 || endIdx === -1) {
      throw new Error('AI output is not a JSON Array');
    }
    return JSON.parse(content.substring(startIdx, endIdx));
  } catch (err) {
    console.error('Failed to parse script JSON:', content);
    throw new Error('Failed to parse the script JSON structure: ' + err.message);
  }
}

/**
 * Send audio binary buffer to Cloudflare Whisper to transcribe and get word/sentence timestamps.
 */
export async function transcribeAudio(audioBuffer) {
  if (!ACCOUNT_ID || !API_TOKEN) {
    throw new Error('Please configure CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env file');
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
  return data.result;
}
