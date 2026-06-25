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
 * Resolve which Workers AI model to use for outline/narration generation
 * based on the user-selected quality tier. Image-prompt generation always
 * uses the standard-tier model regardless of tier (see plan notes).
 */
function resolveScriptModel(tier) {
  return tier === 'premium'
    ? '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
    : '@cf/qwen/qwen3-30b-a3b-fp8';
}

const IMAGE_PROMPT_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

/**
 * Derive section count + words-per-section from a target clip duration.
 * ~150 spoken words per minute for Thai narration at normal pace.
 */
function deriveStoryboardShape(durationMinutes) {
  const totalWords = durationMinutes * 150;
  let sectionCount;
  if (durationMinutes <= 5) sectionCount = 5;
  else if (durationMinutes <= 10) sectionCount = 8;
  else if (durationMinutes <= 15) sectionCount = 11;
  else sectionCount = 14;

  const wordsPerSection = Math.round(totalWords / sectionCount);
  return { totalWords, sectionCount, wordsPerSection };
}

const LANGUAGE_LABELS = {
  auto: null, // null = let the model infer from topic; defaults to Thai in the prompt wording
  thai: 'ภาษาไทย',
  english: 'English',
  japanese: '日本語 (Japanese)',
};

const TONE_LABELS = {
  documentary: 'สารคดีหรู (cinematic, polished documentary tone)',
  mystery: 'ลึกลับชวนสงสัย (mysterious, suspenseful)',
  fun: 'ตลกสนุก (lighthearted and entertaining)',
  casual: 'ให้ความรู้เป็นกันเอง (friendly, casual explainer)',
  thriller: 'ระทึกขย้ำ (tense, thriller-style)',
};

const ANGLE_LABELS = {
  mystery: 'ปริศนาลึกลับ (unsolved mystery framing)',
  science: 'ไขความจริงทางวิทยาศาสตร์ (science explainer framing)',
  toplist: 'Top List (countdown/list framing)',
  history: 'ประวัติศาสตร์เล่าเรื่อง (historical storytelling framing)',
};

/**
 * Qwen3 (the standard-tier model) is a reasoning model that emits a
 * <think>...</think> block before its answer. Those reasoning blocks often
 * contain '[' and ']' characters, which wreck naive JSON-array extraction
 * (the first '[' found would be inside the think block, not the real answer).
 * Strip them before attempting any parsing.
 */
function stripReasoning(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * Robustly extract a JSON array out of an LLM response.
 *
 * Why this exists: outline + image-prompt outputs are now rich object arrays
 * (multiple string fields per item) written in Thai, and the old parser did a
 * blanket `jsonStr.replace(/'/g, '"')` which corrupts any apostrophe inside a
 * value (e.g. "don't", "it's", or quotes used decoratively in Thai). That plus
 * unescaped double-quotes in values and trailing commas made JSON.parse throw
 * "Expected ',' or '}' after property value". This helper tries several
 * progressive recovery strategies before giving up.
 *
 * Order of attempts:
 *  1. Strict parse of the raw substring between the first '[' and last ']'.
 *  2. Remove trailing commas before '}' / ']'.
 *  3. Convert single quotes that sit at JSON structural boundaries only
 *     (immediately after { [ : ,  or  immediately before : , } ]) — NOT a
 *     blanket replace, so apostrophes inside string values are preserved.
 */
function parseJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('empty AI output');
  }

  let text = stripReasoning(raw);
  // Drop markdown code fences if present.
  text = text.replace(/```(?:json)?/gi, '').trim();

  const startIdx = text.indexOf('[');
  const endIdx = text.lastIndexOf(']');
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error('no JSON array found in AI output');
  }
  const jsonStr = text.substring(startIdx, endIdx + 1);

  // Attempt 1: strict parse.
  try {
    return JSON.parse(jsonStr);
  } catch (_) { /* fall through */ }

  // Attempt 2: strip trailing commas that precede a closing brace/bracket.
  try {
    return JSON.parse(jsonStr.replace(/,\s*([}\]])/g, '$1'));
  } catch (_) { /* fall through */ }

  // Attempt 3: targeted single-quote -> double-quote at structural boundaries.
  try {
    const fixed = jsonStr
      .replace(/([{[:,]\s*)'/g, '$1"')   // opening quote after structural char
      .replace(/'(\s*[:,}\]])/g, '"$1'); // closing quote before structural char
    return JSON.parse(fixed);
  } catch (_) { /* fall through */ }

  throw new Error('AI output was not valid JSON');
}

/**
 * Step 1: Generate a structured storyboard outline for the topic.
 * Returns an array of objects (not plain strings) so each section carries
 * its own narrative purpose — this is what lets later narration calls stay
 * connected instead of reading like disconnected encyclopedia entries.
 *
 * Each item shape:
 * {
 *   "sectionTitle": string,
 *   "hookOrGoal": string,   // the open question / curiosity gap this section sets up for the next one
 *   "keyPoint": string      // the one core fact/idea this section must deliver
 * }
 */
export async function generateOutline(topic, options = {}) {
  const {
    durationMinutes = 8,
    language = 'auto',
    tone = 'auto',
    angle = 'auto',
    tier = 'standard',
  } = options;

  const model = resolveScriptModel(tier);
  const { sectionCount } = deriveStoryboardShape(durationMinutes);

  const languageInstruction = LANGUAGE_LABELS[language]
    ? `เขียนเป็น${LANGUAGE_LABELS[language]}ทั้งหมด`
    : 'เขียนเป็นภาษาไทยทั้งหมด (เลือกสำนวนที่เป็นธรรมชาติที่สุดสำหรับหัวข้อนี้)';

  const toneInstruction = TONE_LABELS[tone]
    ? `ใช้โทนการเล่าเรื่องแบบ: ${TONE_LABELS[tone]}`
    : 'พิจารณาหัวข้อแล้วเลือกโทนการเล่าเรื่องที่เหมาะสมที่สุดเอง (เช่น สารคดีหรู, ลึกลับชวนสงสัย, เป็นกันเอง) แล้วคงโทนนั้นตลอดทั้งบท';

  const angleInstruction = ANGLE_LABELS[angle]
    ? `จัดโครงเรื่องตามมุมมอง: ${ANGLE_LABELS[angle]}`
    : 'พิจารณาหัวข้อแล้วเลือกมุมมอง/ประเภทเนื้อหาที่เหมาะสมที่สุดเอง (เช่น ปริศนาลึกลับ, วิทยาศาสตร์, Top List, ประวัติศาสตร์)';

  const prompt = `คุณคือนักเขียนสคริปต์ YouTube มือโปร เชี่ยวชาญด้าน documentary/educational storytelling
สไตล์การเล่าเรื่องของคุณมี "hook" ที่ดึงดูดความสนใจ ไม่ใช่การไล่ลำดับเวลาแบบสารานุกรม

หัวข้อ: "${topic}"
${languageInstruction}
${toneInstruction}
${angleInstruction}

สร้าง storyboard ที่มี ${sectionCount} sections พอดี โดยแต่ละ section ต้องมี:
1. "sectionTitle": ชื่อหัวข้อสั้นๆของตอนนั้น
2. "hookOrGoal": คำถามหรือความคาใจที่ตอนนี้ทิ้งไว้ ซึ่งจะถูกคลี่คลายหรือต่อยอดใน section ถัดไป (สำหรับ section สุดท้าย ให้เป็นข้อคิด/จุดสรุปที่กระทบใจ ไม่ใช่คำถามทิ้งไว้)
3. "keyPoint": ประเด็นหลักหนึ่งอย่างที่ section นี้ต้องเล่าให้ชัด

กฎสำคัญ:
- Section แรกต้องเป็น Hook ที่เปิดด้วยคำถามชวนสงสัยหรือข้อเท็จจริงที่ขัดความเข้าใจทั่วไป ห้ามขึ้นต้นด้วย "ในปี" หรือ "เรื่องราวของ..." ตรงๆ
- แต่ละ section ต้องเชื่อมกับ section ก่อนหน้าและถัดไปอย่างมีเหตุผล ไม่ใช่หัวข้อแยกที่บังเอิญอยู่เรื่องเดียวกัน
- ห้ามมี section ที่ซ้ำประเด็นกัน

**STRICT OUTPUT FORMAT:** ตอบเป็น JSON array เท่านั้น ไม่มีคำอธิบาย ไม่มี markdown fence ห้ามมีข้อความใดๆนอก JSON
รูปแบบ:
[
  {"sectionTitle": "...", "hookOrGoal": "...", "keyPoint": "..."}
]`;

  const MAX_ATTEMPTS = 2;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await runModel(model, {
      messages: [
        { role: 'system', content: 'You are a helpful assistant that outputs only valid JSON arrays.' },
        { role: 'user', content: prompt }
      ],
    });

    const content = result.result.response || result.result.text;
    try {
      return parseJsonArray(content);
    } catch (err) {
      lastErr = err;
      console.warn(`[Script Gen] Outline parse attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}`);
      if (attempt < MAX_ATTEMPTS) {
        console.warn('[Script Gen] Retrying outline with a fresh generation...');
      }
    }
  }

  console.error('[Script Gen] Outline JSON could not be parsed after retries. Last raw output was not valid JSON.');
  throw new Error('Failed to parse outline JSON after ' + MAX_ATTEMPTS + ' attempts: ' + (lastErr ? lastErr.message : 'unknown'));
}

/**
 * Step 2: Expand one storyboard section into full narration text.
 *
 * Critical difference from the old version: this now receives the FULL
 * section object (title + hookOrGoal + keyPoint) instead of just a title
 * string, AND a one-sentence summary of what the previous section just
 * said. This is what makes consecutive sections read as one connected
 * story instead of independent mini-essays.
 *
 * @param {string} topic
 * @param {object} section - { sectionTitle, hookOrGoal, keyPoint }
 * @param {number} index - 1-based section number
 * @param {number} total - total section count
 * @param {string|null} previousSummary - one-sentence recap of the prior section's ending, or null for the first section
 * @param {object} options - { language, tone, tier, wordsPerSection }
 */
export async function generateSectionNarration(topic, section, index, total, previousSummary, options = {}) {
  const {
    language = 'auto',
    tone = 'auto',
    tier = 'standard',
    wordsPerSection = 180,
  } = options;

  const model = resolveScriptModel(tier);

  const languageInstruction = LANGUAGE_LABELS[language]
    ? LANGUAGE_LABELS[language]
    : 'ภาษาไทย';

  const toneInstruction = TONE_LABELS[tone]
    ? TONE_LABELS[tone]
    : 'เลือกโทนที่เหมาะกับเนื้อหานี้เอง แต่ให้สอดคล้องกับน้ำเสียงของบททั้งเรื่อง';

  const contextBlock = previousSummary
    ? `เนื้อหาตอนก่อนหน้าจบลงด้วย: "${previousSummary}"\nเขียนตอนนี้ให้ต่อเนื่องจากจุดนั้นโดยตรง ห้ามเล่าซ้ำสิ่งที่พูดไปแล้ว`
    : 'นี่คือ section แรกของคลิป ต้องเป็น Hook ที่ดึงดูดความสนใจทันที';

  const prompt = `คุณคือนักเขียนสคริปต์ YouTube มือโปร กำลังเขียนตอนหนึ่งของสารคดีต่อเนื่อง
หัวข้อรวมของคลิป: "${topic}"
ภาษา: ${languageInstruction}
โทน: ${toneInstruction}

Section ${index} จาก ${total}
ชื่อตอน: "${section.sectionTitle}"
ประเด็นหลักที่ต้องเล่า: ${section.keyPoint}
สิ่งที่ตอนนี้ต้องทิ้งไว้ให้คนอยากดูต่อ: ${section.hookOrGoal}

${contextBlock}

เขียนบทพากย์ยาวประมาณ ${wordsPerSection} คำ ตามกฎนี้:
1. ประโยคสั้น กระชับ จังหวะเหมาะกับการพากย์เสียง ไม่ใช่ภาษาเขียนทางการ
2. ห้ามใช้โครงสร้างประโยคเปิดซ้ำแบบเดิมทุก section (เช่น "X ถูกสร้างขึ้นเพื่อ...")
3. ใส่มุมมองความรู้สึกของบุคคล/สถานการณ์ ไม่ใช่แค่เรียงข้อมูลตามลำดับเวลา
4. จบ section ด้วยประโยคที่โยงไปสู่ "${section.hookOrGoal}" อย่างเป็นธรรมชาติ

**STRICT OUTPUT:** ตอบเป็นข้อความพากย์ดิบๆเท่านั้น ห้ามมี markdown, หัวข้อ, เครื่องหมายวงเล็บอธิบาย, หรือคำอธิบายใดๆนอกเนื้อบท`;

  const result = await runModel(model, {
    messages: [
      { role: 'system', content: 'You are a professional documentary narrator writing script text.' },
      { role: 'user', content: prompt }
    ],
  });

  let narration = (result.result.response || result.result.text).trim();
  if (!narration) {
    console.warn(`[Script Gen] Warning: Received empty or null narration for section ${index}. Using fallback text.`);
    return `(เนื้อหาสำหรับส่วนนี้ยังไม่พร้อมใช้งาน กรุณาตรวจสอบ API หรือลองใหม่อีกครั้ง)`;
  }
  narration = narration.replace(/```[\s\S]*?```/g, '').trim();
  return narration;
}

/**
 * Produce a single-sentence recap of a finished section's narration, used
 * as the "previousSummary" input for the next section's prompt. Keeping
 * this short (one sentence) avoids blowing up token usage while still
 * giving the next call enough to avoid repeating itself.
 *
 * This is a cheap heuristic, NOT an extra AI call — we just take the last
 * sentence of the narration text. This keeps cost at zero extra neurons.
 */
function summarizeForNextSection(narrationText) {
  if (!narrationText) return null;
  const sentences = narrationText
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return narrationText.slice(-150);
  return sentences[sentences.length - 1].slice(-200);
}

export { deriveStoryboardShape, summarizeForNextSection, parseJsonArray, stripReasoning };

/**
 * Step 3: Analyze timestamped narration segments and write descriptive image prompts.
 * Uses Llama 3.1 8B (updated to use IMAGE_PROMPT_MODEL).
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

  const result = await runModel(IMAGE_PROMPT_MODEL, {
    messages: [
      { role: 'system', content: 'You are a helpful assistant that outputs only valid JSON arrays.' },
      { role: 'user', content: prompt }
    ],
  });

  const content = result.result.response || result.result.text;
  try {
    return parseJsonArray(content);
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
