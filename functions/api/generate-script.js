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
  auto: 'Thai',
  thai: 'Thai',
  english: 'English',
  arabic: 'Arabic',
  chinese_simplified: 'Simplified Chinese',
  chinese_traditional: 'Traditional Chinese',
  french: 'French',
  german: 'German',
  hindi: 'Hindi',
  indonesian: 'Indonesian',
  italian: 'Italian',
  japanese: 'Japanese',
  korean: 'Korean',
  malay: 'Malay',
  portuguese: 'Portuguese',
  russian: 'Russian',
  spanish: 'Spanish',
  turkish: 'Turkish',
  vietnamese: 'Vietnamese',
};

const TONE_LABELS = {
  documentary: 'Premium cinematic documentary tone — polished, authoritative narration',
  mystery: 'Mysterious and suspenseful — withhold information, build curiosity',
  fun: 'Lighthearted and entertaining — playful energy, quick wit',
  casual: 'Friendly casual explainer — like a knowledgeable friend chatting, not a lecturer',
  thriller: 'Tense thriller pacing — short clipped sentences, mounting pressure',
  dramatic: 'Emotionally charged dramatic storytelling — high stakes, vivid human stakes',
  inspirational: 'Uplifting and motivational — focus on triumph and meaning',
  dark: 'Dark, heavy, unsettling atmosphere — weight in every sentence',
  epic: 'Epic, grand-scale cinematic tone — sweeping scope, larger-than-life framing',
  satirical: 'Sharp witty satirical delivery — pointed irony, knowing tone',
  urgent: 'Urgent, high-stakes pacing — clock-is-ticking energy',
  emotional: 'Deeply emotional and immersive — sit inside the feeling, do not rush past it',
  luxury: 'Premium, elegant, luxurious framing — refined vocabulary, unhurried pace',
  analytical: 'Precise, analytical, insight-driven — sharp logic, clear cause-and-effect',
  storytelling: 'Smooth narrative storyteller tone — natural flow, no info-dumping',
  news: 'Authoritative news-style reporting — credible, measured, fact-forward',
  horror: 'Creepy, eerie horror tone — dread that builds quietly before it strikes',
};

const ANGLE_LABELS = {
  mystery: 'Unsolved mystery framing — frame everything around an unanswered question',
  science: 'Science explainer framing — demystify mechanisms step by step',
  toplist: 'Top List / countdown framing',
  history: 'Historical storytelling framing — follow cause and consequence through time',
  conspiracy: 'Conspiracy investigation framing — follow the thread of suspicion',
  mythology: 'Mythology and belief-system framing',
  crime: 'True crime investigative framing — evidence-led, procedural tension',
  survival: 'Survival and extreme-situation framing — visceral, moment-to-moment stakes',
  biography: 'Biographical storytelling framing — a life told through pivotal turns',
  technology: 'Technology and future-trends framing',
  business: 'Business strategy and power-dynamics framing',
  psychology: 'Psychology and human-behavior framing',
  geopolitics: 'Geopolitics and power-balance framing',
  disaster: 'Disaster breakdown framing — sequence of events, human impact',
  war: 'Warfare and strategy framing',
  ancient_civilization: 'Ancient civilization exploration framing',
  paranormal: 'Paranormal investigation framing',
  social_issue: 'Social issue analysis framing — human consequence first, data second',
  finance: 'Finance and macroeconomics framing',
};

/**
 * Deterministically assign each section a structural role based on its
 * position in the video's retention curve.
 */
function deriveArcRole(index, total) {
  if (index === 1) return 'hook';
  if (index === total) return 'resolution';
  if (total >= 4 && index === total - 1) return 'climax';

  if (total >= 5) {
    const midpoint = Math.round(total / 2);
    if (index === midpoint) return 'midpoint_turn';
  }

  return 'rising_stakes';
}

const ARC_ROLE_GUIDANCE = {
  hook: {
    label: 'HOOK (cold open)',
    outline:
      'This section must hook the viewer in the first lines. State the central question, tension, or promise of the entire video. Do not give away the answer yet.',
    narration:
      'This is the cold open. The first 2-3 sentences are the most important sentences in the whole script. Open with impact. Make the central promise of the video clear without revealing the answer.',
  },

  rising_stakes: {
    label: 'RISING STAKES',
    outline:
      'This section must escalate from the previous one with new information, a deeper layer, a bigger consequence, or a sharper contradiction. It must move the story forward.',
    narration:
      'Escalate from where the previous section ended. Add genuinely new information or a deeper layer. Do not restate the same idea in different words.',
  },

  midpoint_turn: {
    label: 'MIDPOINT TURN (retention save point)',
    outline:
      'This is the retention-critical midpoint. It must contain a twist, reveal, contradiction, or escalation strong enough to re-hook a viewer who is about to leave.',
    narration:
      'This is the retention-critical midpoint. Do not ease into it. The first sentence should create a pattern interrupt: a twist, reveal, contradiction, or sharp escalation.',
  },

  climax: {
    label: 'CLIMAX',
    outline:
      'This is the peak of the video. The keyPoint should be the most intense, consequential, surprising, or emotionally loaded point in the whole story.',
    narration:
      'This is the peak moment. Use the tightest pacing and strongest pressure of the whole script. This is the best place for a direct viewer-facing beat.',
  },

  resolution: {
    label: 'RESOLUTION (ending)',
    outline:
      'This is the final section. The hookOrGoal must be a resonant closing payoff, not a dangling question. It should answer, sharpen, or meaningfully reframe the promise made in the hook.',
    narration:
      'This is the ending. Do not finish with a generic summary. Deliver a satisfying payoff or one sharp final thought that lingers after the video ends.',
  },
};

function buildArcRoleMapBlock(sectionCount) {
  const lines = [];
  for (let i = 1; i <= sectionCount; i += 1) {
    const role = deriveArcRole(i, sectionCount);
    const guidance = ARC_ROLE_GUIDANCE[role];
    lines.push(`Section ${i} — ${guidance.label}: ${guidance.outline}`);
  }
  return lines.join('\n');
}

function getFirstNonEmptyLine(text = '') {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || '';
}

function getLastNonEmptyLine(text = '') {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length ? lines[lines.length - 1] : '';
}

function detectOpeningMove(line = '') {
  const trimmed = String(line).trim();

  if (!trimmed) return 'unknown';
  if (/[?？]$/i.test(trimmed) || /(ไหม|หรือเปล่า|หรือไม่|อย่างไร|กันแน่|ใช่ไหม|หรือยัง|ได้อย่างไร|อย่างไรกันแน่)$/.test(trimmed)) return 'direct_question';
  
  if (/^(imagine|picture|suppose|pretend|what\s+if|you\s+are|you\s+wake\s+up|you\s+stand|you\s+walk)\b/i.test(trimmed) ||
      /^(จินตนาการ|ลองนึก|สมมุติ|สมมติ|คิดดูว่า|จะเกิดอะไรขึ้นถ้า|ถ้าหาก|คุณตื่นขึ้นมา|คุณยืนอยู่|คุณเดิน|ลองจินตนาการ)/i.test(trimmed)) {
    return 'viewer_scenario';
  }
  
  if (/[\d๐-๙]|percent|million|billion|trillion|dead|missing|collapsed|vanished|killed|lost|found/i.test(trimmed) ||
      /(เปอร์เซ็นต์|%|ล้าน|พันล้าน|แสนล้าน|ล้านล้าน|ตาย|เสียชีวิต|ศพ|หายสาบสูญ|สูญหาย|พังทลาย|ถล่ม|ยุบ|หายไป|ฆ่า|พบ|เจอ|ค้นพบ)/i.test(trimmed)) {
    return 'jarring_fact';
  }

  return 'statement';
}

function detectEndingMove(line = '') {
  const trimmed = String(line).trim();

  if (!trimmed) return 'unknown';
  if (/[?？]$/i.test(trimmed) || /(ไหม|หรือเปล่า|หรือไม่|อย่างไร|กันแน่|ใช่ไหม|หรือยัง|ได้อย่างไร|อย่างไรกันแน่)$/.test(trimmed)) return 'hanging_question';
  if (/\.\.\.$/.test(trimmed)) return 'unresolved_consequence';
  if (trimmed.length <= 80) return 'blunt_stop';

  return 'consequence_statement';
}

function updateFreshnessMemory(memory, narration) {
  const firstLine = getFirstNonEmptyLine(narration);
  const lastLine = getLastNonEmptyLine(narration);

  const nextMemory = {
    previousOpeningMove: detectOpeningMove(firstLine),
    previousEndingMove: detectEndingMove(lastLine),
    recentOpeningLines: [...(memory?.recentOpeningLines || []), firstLine].filter(Boolean).slice(-4),
    recentEndingLines: [...(memory?.recentEndingLines || []), lastLine].filter(Boolean).slice(-4),
  };

  return nextMemory;
}

function buildFreshnessMemoryBlock(memory = {}) {
  const openingLines = (memory.recentOpeningLines || [])
    .filter(Boolean)
    .map((line) => `- "${line}"`)
    .join('\n');

  const endingLines = (memory.recentEndingLines || [])
    .filter(Boolean)
    .map((line) => `- "${line}"`)
    .join('\n');

  const previousOpeningMove = memory.previousOpeningMove || 'none';
  const previousEndingMove = memory.previousEndingMove || 'none';

  return `CREATIVE FRESHNESS MEMORY:
- Previous opening move: ${previousOpeningMove}
- Previous ending move: ${previousEndingMove}
- Avoid repeating the same opening move back-to-back unless the section role absolutely requires it.
- Avoid repeating the same ending move back-to-back unless the section role absolutely requires it.
- Do not reuse or closely imitate these recent opening lines:
${openingLines || '- None yet'}
- Do not reuse or closely imitate these recent ending lines:
${endingLines || '- None yet'}

FRESHNESS CONTRACT:
- The rules define structure, not wording.
- Do not reuse stock phrases, generic YouTube hook lines, or repeated sentence patterns.
- Invent fresh phrasing, fresh imagery, fresh transitions, and fresh comparisons for this specific topic.
- Never make two sections feel like they came from the same template.
- Do not force direct-address phrases such as "here is the thing" or "think about it" literally. Use natural equivalents in the selected output language.`;
}

function buildOutlinePrompt(topic, { durationMinutes, language, tone, angle }) {
  const { sectionCount } = deriveStoryboardShape(durationMinutes);

  const outputLanguage = LANGUAGE_LABELS[language] || 'Thai';

  const toneInstruction = TONE_LABELS[tone]
    ? TONE_LABELS[tone]
    : 'Choose the storytelling tone that best fits this topic, then hold that tone consistently across the whole outline.';

  const angleInstruction = ANGLE_LABELS[angle]
    ? ANGLE_LABELS[angle]
    : 'Choose the content angle or framing that best fits this topic on your own.';

  const arcRoleMapBlock = buildArcRoleMapBlock(sectionCount);

  return `You are a professional YouTube scriptwriter specializing in documentary and educational storytelling.

Your job is not to write a flat encyclopedia recap.
Your job is to build a story engine that keeps viewers watching.

TOPIC: "${topic}"

OUTPUT LANGUAGE FOR ALL TEXT FIELDS: ${outputLanguage}
Write sectionTitle, hookOrGoal, and keyPoint entirely in this language.
Use natural, idiomatic phrasing.
Never write a stiff literal translation.

TONE: ${toneInstruction}

CONTENT ANGLE: ${angleInstruction}

INTERNAL STORY SPINE:
Before writing the JSON, silently decide:
- the central promise of the video
- the central tension or contradiction
- the emotional or intellectual payoff at the end

Do not output the story spine separately.
Use it to make every section feel connected.

Build a storyboard of exactly ${sectionCount} sections.

This video follows a retention-curve structure.
Each section below has a specific job based on its position:

${arcRoleMapBlock}

Each section must have:
1. "sectionTitle": a short title for that section
2. "hookOrGoal": the open question, reveal, twist, consequence, or payoff this section delivers
3. "keyPoint": the one core point this section must land clearly

STRUCTURAL RULES:
- Section 1 must create immediate curiosity and state the central promise of the video.
- The midpoint_turn section must create a real pattern interrupt, not just another fact.
- The climax section must carry the highest stakes, strongest surprise, or deepest emotional weight.
- The final section must create a real payoff, not a generic summary.
- Each section must connect causally to the section before and after it.
- No two sections may cover the same core point.
- Do not create independent mini-articles.
- Do not list facts in chronological order unless chronology is the actual source of tension.
- Vary how hookOrGoal creates pull across sections.
- Do not use the same hook mechanic for every section.
- Do not rely on stock YouTube phrasing.
- The rules define structure, not wording. Invent fresh phrasing for this specific topic.

STRICT OUTPUT FORMAT:
Return a JSON array only.
No explanation.
No markdown fences.
No text outside the JSON.

Format:
[
  {"sectionTitle": "...", "hookOrGoal": "...", "keyPoint": "..."}
]`;
}

function buildNarrationPrompt(topic, section, index, total, previousSummary, { language, tone, wordsPerSection, freshnessMemory }) {
  const outputLanguage = LANGUAGE_LABELS[language] || 'Thai';

  const toneInstruction = TONE_LABELS[tone]
    ? TONE_LABELS[tone]
    : 'Choose whatever tone best fits this specific section while staying consistent with the whole script.';

  const contextBlock = previousSummary
    ? `The previous section ended on: "${previousSummary}"\nContinue directly from that point. Do not recap or repeat what was already said.`
    : 'This is the first section of the video. It must hook the viewer in the opening seconds.';

  const arcRole = deriveArcRole(index, total);
  const arcGuidance = ARC_ROLE_GUIDANCE[arcRole];
  const freshnessBlock = buildFreshnessMemoryBlock(freshnessMemory);

  return `You are a professional YouTube scriptwriter and documentary narrator.

Write like a sharp storyteller speaking to one real person.
Do not sound like an academic report.
Do not sound like a generic AI summary.
Do not sound like a list of facts.

OVERALL TOPIC: "${topic}"

OUTPUT LANGUAGE: ${outputLanguage}
Write the narration entirely in this language.
Use natural, idiomatic spoken phrasing.
Never write a stiff literal translation.

TONE FOR THIS SCRIPT: ${toneInstruction}

SECTION ${index} of ${total}
STRUCTURAL ROLE: ${arcGuidance.label}

ROLE-SPECIFIC JOB:
${arcGuidance.narration}

SECTION TITLE:
"${section.sectionTitle}"

CORE POINT THIS SECTION MUST LAND:
${section.keyPoint}

WHAT THIS SECTION MUST LEAVE THE VIEWER WANTING:
${section.hookOrGoal}

CONTINUITY:
${contextBlock}

${freshnessBlock}

Write approximately ${wordsPerSection} words.

NARRATIVE ENGINE RULES:
These rules are mandatory for every section.
Tone changes mood and vocabulary.
Structural role changes the job of this section.
Neither one overrides these baseline rules.

1. OPENING
Open with exactly one strong move that fits this section:
- a direct viewer-facing question
- a role-play scenario that puts the viewer inside the moment
- a short, jarring fact or contradiction in one tight sentence
- a sharp continuation from the previous section if the section must flow directly

Do not use the same opening move as the previous section unless the structural role requires it.

2. DIRECT VIEWER CONNECTION
Somewhere in the body, include one natural viewer-facing beat.
Do not force a fixed phrase.
It should feel like a real narrator briefly leaning toward the viewer.

3. CONCRETE IMAGERY
Avoid floating abstractions.
Do not stack abstract nouns.
Turn abstract ideas into visible scenes, human choices, physical details, pressure, cost, risk, or consequence.

4. SECTION ENDING VARIATION
Do not end every section the same way.
Use the ending that best fits the role:
- a hanging question
- an unresolved consequence
- a blunt stop
- a quiet image
- a payoff line

Avoid repeating the previous ending move back-to-back.
For the resolution role, end with a strong final payoff instead of a dangling question.

5. RHYTHM
Write for spoken narration.
Use short sentences.
Use real pauses.
Avoid long essay-style sentences.
Do not over-explain the hook before it lands.

6. STORY MOVEMENT
Every section must move the story forward.
Do not repeat the same point in different words.
Do not fill space with generic background.
Do not write a neutral summary when the section needs tension, surprise, pressure, or payoff.

7. FRESHNESS
The rules define structure, not wording.
Invent fresh language for this topic.
Avoid stock phrases, repeated transitions, and template-like hooks.

STRICT OUTPUT:
Return raw narration text only.
No markdown.
No headers.
No bullet points.
No bracketed stage directions.
No explanation outside the narration.`;
}

function buildScriptDoctorPrompt(topic, outlineWithNarration, { language, tone }) {
  const outputLanguage = LANGUAGE_LABELS[language] || 'Thai';

  const toneInstruction = TONE_LABELS[tone]
    ? TONE_LABELS[tone]
    : 'Keep the tone that best fits the topic and the existing script.';

  return `You are a senior YouTube script editor and retention specialist.

Your job is to polish a complete generated script.
Do not change the topic.
Do not add unsupported factual claims.
Do not remove important section meaning.
Do not change the JSON shape.
Do not translate the script into another language.

OUTPUT LANGUAGE: ${outputLanguage}
Keep all user-facing fields in this language.

TONE: ${toneInstruction}

TOPIC:
"${topic}"

EDITING GOALS:
- Strengthen the opening hook if it feels generic.
- Make the midpoint turn sharper.
- Make the climax more intense or consequential.
- Make the ending more memorable.
- Remove repeated phrases, repeated opening patterns, and repeated endings.
- Improve transitions between sections.
- Cut filler and generic background.
- Keep narration natural, spoken, and human.
- Keep the same number of sections.
- Keep each section's core meaning.
- Keep the existing fields: sectionTitle, hookOrGoal, keyPoint, narration.

IMPORTANT:
The rules define structure, not wording.
Do not replace everything with a formula.
Do not add stock YouTube phrases.
Do not over-polish into stiff corporate language.

SCRIPT TO POLISH:
${JSON.stringify(outlineWithNarration, null, 2)}

STRICT OUTPUT FORMAT:
Return a JSON array only.
No markdown fences.
No explanation.
No text outside the JSON.

Format:
[
  {
    "sectionTitle": "...",
    "hookOrGoal": "...",
    "keyPoint": "...",
    "narration": "..."
  }
]`;
}

function validatePolishedScript(original, polished) {
  if (!Array.isArray(polished)) return false;
  if (polished.length !== original.length) return false;
  
  const requiredKeys = ['sectionTitle', 'hookOrGoal', 'keyPoint', 'narration'];
  for (let i = 0; i < polished.length; i++) {
    const item = polished[i];
    if (!item || typeof item !== 'object') return false;
    for (const key of requiredKeys) {
      if (typeof item[key] !== 'string' || !item[key].trim()) {
        return false;
      }
    }
  }
  return true;
}

async function maybePolishScript(env, model, topic, sections, options = {}) {
  const { durationMinutes = 8, polishScript = true, language = 'thai', tone = 'auto' } = options;
  const shouldPolish =
    polishScript !== false &&
    Number(durationMinutes || 0) >= 3;

  if (!shouldPolish) {
    return sections;
  }

  try {
    const prompt = buildScriptDoctorPrompt(topic, sections, { language, tone });
    const result = await runModel(env, model, {
      messages: [
        { role: 'system', content: 'You are a helpful assistant that outputs only valid JSON arrays.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 4096,
      temperature: 0.4,
    });
    const polishedContent = getAiResponse(result);
    const polished = parseJsonArray(polishedContent);

    if (validatePolishedScript(sections, polished)) {
      return polished;
    }
    
    console.warn('[Script Doctor] Validation failed. Falling back to original script.');
    return sections;
  } catch (error) {
    console.warn('[Script Doctor] Script polish failed. Using unpolished script.', error);
    return sections;
  }
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
    let script = [];
    let previousSummary = null;
    let freshnessMemory = {
      previousOpeningMove: null,
      previousEndingMove: null,
      recentOpeningLines: [],
      recentEndingLines: [],
    };

    for (let i = 0; i < outline.length; i++) {
      const section = outline[i];
      const narrationPrompt = buildNarrationPrompt(
        topic, section, i + 1, outline.length, previousSummary,
        { language, tone, wordsPerSection, freshnessMemory }
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
        hookOrGoal: section.hookOrGoal,
        keyPoint: section.keyPoint,
        narration: narration
      });

      freshnessMemory = updateFreshnessMemory(freshnessMemory, narration);
      previousSummary = summarizeForNextSection(narration);
    }

    script = await maybePolishScript(env, model, topic, script, {
      language,
      tone,
      durationMinutes,
      polishScript: body.polishScript !== false
    });

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
