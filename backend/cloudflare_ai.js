import dotenv from 'dotenv';
dotenv.config();

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

// ponytail: Use native fetch in Node.js 18+ to save dependencies.
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
 * Step 1: Generate outline (chapters/sections) for the topic.
 * Uses Llama 3.3 70B for maximum storytelling intelligence.
 */
export async function generateOutline(topic) {
  const prompt = `You are a professional documentary scriptwriter.
Generate a structured storyline outline in Thai for the topic: "${topic}".
Create exactly 8 to 10 narrative chapters/sections. Keep them logically connected.

Return ONLY a JSON array of strings containing the chapter names/themes. Do not write any conversational text or formatting outside the JSON array.
Example output format:
[
  "บทนำ: จุดเริ่มต้นของ...",
  "บทที่ 2: ความลึกลับที่ซ่อนอยู่...",
  "บทสรุป: สิ่งที่เราค้นพบ..."
]`;

  const result = await runModel('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [
      { role: 'system', content: 'You are a helpful assistant that outputs only valid JSON arrays.' },
      { role: 'user', content: prompt }
    ],
  });

  const content = result.result.response || result.result.text;
  try {
    const startIdx = content.indexOf('[');
    const endIdx = content.lastIndexOf(']') + 1;
    console.log('DEBUG generateOutline indexes:', { startIdx, endIdx, length: content ? content.length : 0 });
    console.log('DEBUG generateOutline content type:', typeof content);
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      console.log('DEBUG generateOutline raw content:', content);
      throw new Error('AI output is not a JSON Array');
    }
    let jsonStr = content.substring(startIdx, endIdx);
    // Replace single quotes with double quotes for JSON parsing compatibility
    jsonStr = jsonStr.replace(/'/g, '"');
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error('Failed to parse outline JSON:', content);
    throw new Error('Failed to parse outline JSON: ' + err.message);
  }
}

/**
 * Step 2: Expand a specific outline chapter to detailed Thai narration.
 * Uses Llama 3.1 8B for fast, cost-efficient generation.
 */
export async function generateSectionNarration(topic, sectionTitle, index, total) {
  const prompt = `You are writing a detailed video documentary in Thai.
Topic: "${topic}"
Current Section Title: "${sectionTitle}" (Section ${index} of ${total})

Write a detailed, engaging narration spoken in Thai (around 150-250 words) for this section.
Use a professional, dramatic, and intriguing storytelling tone.
Write only the spoken narration text. Do not include section headings, narrator cues, bracketed text, or punctuation marks like asterisks. Return purely the spoken Thai text.`;

  const result = await runModel('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      { role: 'system', content: 'You are a professional documentary narrator writing script text.' },
      { role: 'user', content: prompt }
    ],
  });

  return (result.result.response || result.result.text).trim();
}

/**
 * Step 3: Analyze timestamped narration segments and write descriptive image prompts.
 * Uses Llama 3.1 8B.
 */
export async function generateImagePromptsForSegments(segments) {
  const prompt = `You are a cinematic concept artist.
Given the following spoken segments of a Thai video script, generate a highly descriptive visual image prompt in English for each segment.
The prompt should describe a landscape/cinematic scene matching the spoken text, optimized for an AI image generator (e.g., "A cinematic wide shot of...").

Input segments list:
${JSON.stringify(segments.map((s, idx) => ({ id: idx, text: s.text })))}

Return ONLY a JSON array matching the structure below. Do not include any markdown format outside the JSON array:
[
  {
    "id": 0,
    "imagePrompt": "A highly detailed cinematic image prompt in English..."
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
    let jsonStr = content.substring(startIdx, endIdx);
    // Replace single quotes with double quotes for JSON parsing compatibility
    jsonStr = jsonStr.replace(/'/g, '"');
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error('Failed to parse image prompts JSON:', content);
    throw new Error('Failed to parse image prompts JSON: ' + err.message);
  }
}

/**
 * Whisper transcription helper
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
