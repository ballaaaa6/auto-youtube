async function runModel(env, model, inputData) {
  if (env.AI) {
    return await env.AI.run(model, inputData);
  }

  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error('Please configure Workers AI binding or set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(inputData),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Cloudflare AI API Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.result;
}

function getAiResponse(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  return result.response || result.text || '';
}

// --- JSON parsing helpers (must stay in sync with backend/cloudflare_ai.js) ---

/**
 * Qwen3 (the standard-tier model) is a reasoning model that emits a
 * <think>...</think> block before its answer. Those reasoning blocks often
 * contain '[' and ']' characters, which wreck naive JSON-array extraction.
 * Strip them before attempting any parsing.
 */
function stripReasoning(text) {
  // Normal case: a complete <think>...</think> block. Remove it.
  let stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Truncation case: <think> opens but </think> never closes (response got
  // cut off mid-reasoning). Strip everything from the opening <think> to the
  // end of the string, since the whole answer was lost during reasoning.
  stripped = stripped.replace(/<think>[\s\S]*$/gi, '');
  return stripped.trim();
}

/**
 * Robustly extract a JSON array out of an LLM response.
 *
 * The old parser did a blanket `jsonStr.replace(/'/g, '"')` which corrupts
 * any apostrophe inside a value (e.g. "don't"), and it did not handle
 * trailing commas or unescaped quotes in values. This helper tries several
 * progressive recovery strategies before giving up.
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

  // Attempt 4: salvage complete objects individually. The reasoning model
  // sometimes gets cut off mid-array (e.g. the last object is truncated),
  // which invalidates the whole substring above. Pull out every shallow
  // {...} object with a non-greedy match, parse each on its own, and keep
  // only the ones that succeed — this rescues the intact sections instead
  // of discarding the entire result.
  const objectMatches = jsonStr.match(/\{[^{}]*\}/g);
  if (objectMatches && objectMatches.length > 0) {
    const salvaged = [];
    for (const piece of objectMatches) {
      try {
        salvaged.push(JSON.parse(piece));
      } catch (_) { /* skip this broken piece, keep the good ones */ }
    }
    if (salvaged.length > 0) {
      return salvaged;
    }
  }

  throw new Error('AI output was not valid JSON');
}

// --- Model / prompt configuration (must stay in sync with backend/cloudflare_ai.js) ---

function resolveScriptModel(tier) {
  return tier === 'premium'
    ? '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
    : '@cf/qwen/qwen3-30b-a3b-fp8';
}

const IMAGE_PROMPT_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

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
  auto: 'ภาษาไทย',
  thai: 'ภาษาไทย',
  english: 'English',
  arabic: 'Arabic',
  chinese_simplified: 'Simplified Chinese',
  chinese_traditional: 'Traditional Chinese',
  french: 'French',
  german: 'German',
  hindi: 'Hindi',
  indonesian: 'Indonesian',
  italian: 'Italian',
  japanese: '日本語 (Japanese)',
  korean: 'Korean',
  malay: 'Malay',
  portuguese: 'Portuguese',
  russian: 'Russian',
  spanish: 'Spanish',
  turkish: 'Turkish',
  vietnamese: 'Vietnamese',
};

const TONE_LABELS = {
  documentary: 'สารคดีหรู (cinematic, polished documentary tone)',
  mystery: 'ลึกลับชวนสงสัย (mysterious, suspenseful)',
  fun: 'ตลกสนุก (lighthearted and entertaining)',
  casual: 'ให้ความรู้เป็นกันเอง (friendly, casual explainer)',
  thriller: 'ระทึกขย้ำ (tense, thriller-style)',
  dramatic: 'ดราม่าเข้มข้น (emotionally charged dramatic storytelling)',
  inspirational: 'สร้างแรงบันดาลใจ (uplifting and motivational)',
  dark: 'หม่นลึกกดดัน (dark, heavy, and unsettling)',
  epic: 'ยิ่งใหญ่อลังการ (epic, grand-scale cinematic tone)',
  satirical: 'ประชดคมๆ (sharp, witty, satirical delivery)',
  urgent: 'เร่งด่วนตื่นตัว (urgent, high-stakes pacing)',
  emotional: 'อารมณ์จัดเต็ม (deeply emotional and immersive)',
  luxury: 'หรูหราไฮเอนด์ (premium, elegant, luxurious)',
  analytical: 'วิเคราะห์คมชัด (precise, analytical, insight-driven)',
  storytelling: 'เล่าเรื่องลื่นไหล (smooth narrative storyteller tone)',
  news: 'ข่าวจริงจัง (authoritative news-style reporting)',
  horror: 'สยองขวัญชวนหลอน (creepy, eerie horror tone)',
};

const ANGLE_LABELS = {
  mystery: 'ปริศนาลึกลับ (unsolved mystery framing)',
  science: 'ไขความจริงทางวิทยาศาสตร์ (science explainer framing)',
  toplist: 'Top List (countdown/list framing)',
  history: 'ประวัติศาสตร์เล่าเรื่อง (historical storytelling framing)',
  conspiracy: 'ทฤษฎีสมคบคิด (conspiracy investigation framing)',
  mythology: 'ตำนานและความเชื่อ (mythology and belief-system framing)',
  crime: 'คดีจริงและการสืบสวน (true crime investigative framing)',
  survival: 'เอาตัวรอดและสถานการณ์สุดขีด (survival and extreme-situation framing)',
  biography: 'ชีวประวัติบุคคลน่าสนใจ (biographical storytelling framing)',
  technology: 'เทคโนโลยีและอนาคต (technology and future-trends framing)',
  business: 'ธุรกิจ กลยุทธ์ และอำนาจ (business strategy and power dynamics framing)',
  psychology: 'จิตวิทยาและพฤติกรรมมนุษย์ (psychology and human-behavior framing)',
  geopolitics: 'ภูมิรัฐศาสตร์และเกมอำนาจ (geopolitics and power-balance framing)',
  disaster: 'ภัยพิบัติและเหตุการณ์ใหญ่ (disaster breakdown framing)',
  war: 'สงครามและยุทธศาสตร์ (warfare and strategy framing)',
  ancient_civilization: 'อารยธรรมโบราณ (ancient civilization exploration framing)',
  paranormal: 'เหนือธรรมชาติ (paranormal investigation framing)',
  social_issue: 'ประเด็นสังคมชวนคิด (social issue analysis framing)',
  finance: 'การเงินและเศรษฐกิจ (finance and macroeconomics framing)',
};

function summarizeForNextSection(narrationText) {
  if (!narrationText) return null;
  const sentences = narrationText
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return narrationText.slice(-150);
  return sentences[sentences.length - 1].slice(-200);
}

function buildOutlinePrompt(topic, { durationMinutes, language, tone, angle }) {
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

  return `คุณคือนักเขียนสคริปต์ YouTube มือโปร เชี่ยวชาญด้าน documentary/educational storytelling
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
}

function buildNarrationPrompt(topic, section, index, total, previousSummary, { language, tone, wordsPerSection }) {
  const languageInstruction = LANGUAGE_LABELS[language] ? LANGUAGE_LABELS[language] : 'ภาษาไทย';

  const toneInstruction = TONE_LABELS[tone]
    ? TONE_LABELS[tone]
    : 'เลือกโทนที่เหมาะกับเนื้อหานี้เอง แต่ให้สอดคล้องกับน้ำเสียงของบททั้งเรื่อง';

  const contextBlock = previousSummary
    ? `เนื้อหาตอนก่อนหน้าจบลงด้วย: "${previousSummary}"\nเขียนตอนนี้ให้ต่อเนื่องจากจุดนั้นโดยตรง ห้ามเล่าซ้ำสิ่งที่พูดไปแล้ว`
    : 'นี่คือ section แรกของคลิป ต้องเป็น Hook ที่ดึงดูดความสนใจทันที';

  return `คุณคือนักเขียนสคริปต์ YouTube มือโปร กำลังเขียนตอนหนึ่งของสารคดีต่อเนื่อง
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
}

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const topic = body.topic;
    if (!topic) {
      return new Response(JSON.stringify({ error: 'Topic is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const durationMinutes = body.durationMinutes || 8;
    const language = body.language || 'thai';
    const tone = body.tone || 'auto';
    const angle = body.angle || 'auto';
    const tier = body.tier || 'standard';

    const model = resolveScriptModel(tier);

    // Step 1: Generate storyboard outline
    const outlinePrompt = buildOutlinePrompt(topic, { durationMinutes, language, tone, angle });

    const MAX_ATTEMPTS = 3;
    let outline = [];
    let outlineParsed = false;
    let lastErr;
    let lastOutlineContent;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const outlineResult = await runModel(env, model, {
        messages: [
          { role: 'system', content: 'You are a helpful assistant that outputs only valid JSON arrays.' },
          { role: 'user', content: outlinePrompt }
        ],
        // Reasoning models (qwen3) can spend a lot of output budget inside their
        // <think> block; the default cap truncates the JSON mid-stream. Give it
        // room to finish, and lower temperature so the structure stays stable.
        max_tokens: 4096,
        temperature: 0.4,
      });

      const outlineContent = getAiResponse(outlineResult);
      lastOutlineContent = outlineContent;
      try {
        outline = parseJsonArray(outlineContent);
        outlineParsed = true;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`[Pages Function] Outline parse attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}`);
        if (attempt < MAX_ATTEMPTS) {
          console.warn('[Pages Function] Retrying outline with a fresh generation...');
        }
      }
    }

    if (!outlineParsed) {
      console.error('[Pages Function] Outline JSON could not be parsed after retries. Last raw outline output:\n' + lastOutlineContent);
      const preview = (lastOutlineContent || '').slice(0, 300);
      throw new Error('Failed to parse outline JSON after ' + MAX_ATTEMPTS + ' attempts: ' + (lastErr ? lastErr.message : 'unknown') + ' | Raw AI output (first 300 chars): ' + preview);
    }

    // Step 2: Expand each section to narration, chaining context forward
    const { wordsPerSection } = deriveStoryboardShape(durationMinutes);
    const script = [];
    let previousSummary = null;

    for (let i = 0; i < outline.length; i++) {
      const section = outline[i];
      const narrationPrompt = buildNarrationPrompt(
        topic, section, i + 1, outline.length, previousSummary,
        { language, tone, wordsPerSection }
      );

      const narrationResult = await runModel(env, model, {
        messages: [
          { role: 'system', content: 'You are a professional documentary narrator writing script text.' },
          { role: 'user', content: narrationPrompt }
        ],
      });

      const narration = getAiResponse(narrationResult).trim();
      script.push({
        sectionTitle: section.sectionTitle,
        narration: narration
      });

      previousSummary = summarizeForNextSection(narration);
    }

    return new Response(JSON.stringify({ script }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[Pages Function] Error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
