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
  auto: null,
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
    const language = body.language || 'auto';
    const tone = body.tone || 'auto';
    const angle = body.angle || 'auto';
    const tier = body.tier || 'standard';

    const model = resolveScriptModel(tier);

    // Step 1: Generate storyboard outline
    const outlinePrompt = buildOutlinePrompt(topic, { durationMinutes, language, tone, angle });

    const outlineResult = await runModel(env, model, {
      messages: [
        { role: 'system', content: 'You are a helpful assistant that outputs only valid JSON arrays.' },
        { role: 'user', content: outlinePrompt }
      ],
    });

    const outlineContent = getAiResponse(outlineResult);
    let outline = [];
    try {
      if (Array.isArray(outlineContent)) {
        outline = outlineContent;
      } else {
        const startIdx = outlineContent.indexOf('[');
        const endIdx = outlineContent.lastIndexOf(']') + 1;
        if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
          throw new Error('AI output is not a JSON Array');
        }
        let jsonStr = outlineContent.substring(startIdx, endIdx);
        jsonStr = jsonStr.replace(/'/g, '"');
        outline = JSON.parse(jsonStr);
      }
    } catch (err) {
      console.error('Failed to parse outline JSON:', outlineContent);
      throw new Error('Failed to parse outline JSON: ' + err.message);
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
