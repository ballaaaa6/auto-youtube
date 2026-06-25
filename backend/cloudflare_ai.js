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

/**
 * Qwen3 (the standard-tier model) is a reasoning model that emits a
 * <think>...</think> block before its answer. Those reasoning blocks often
 * contain '[' and ']' characters, which wreck naive JSON-array extraction
 * (the first '[' found would be inside the think block, not the real answer).
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

function buildNarrationPrompt(
  topic,
  section,
  index,
  total,
  previousSummary,
  { language, tone, wordsPerSection, freshnessMemory }
) {
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

async function maybePolishScript(topic, sections, options = {}) {
  const { tier = 'standard', durationMinutes = 8, polishScript = true, language = 'thai', tone = 'auto' } = options;
  const shouldPolish =
    polishScript !== false &&
    Number(durationMinutes || 0) >= 3;

  if (!shouldPolish) {
    return sections;
  }

  const model = resolveScriptModel(tier);

  try {
    const prompt = buildScriptDoctorPrompt(topic, sections, { language, tone });
    const result = await runModel(model, {
      messages: [
        { role: 'system', content: 'You are a helpful assistant that outputs only valid JSON arrays.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 4096,
      temperature: 0.4,
    });
    const polishedContent = result.result.response || result.result.text;
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
    language = 'thai',
    tone = 'auto',
    angle = 'auto',
    tier = 'standard',
  } = options;

  const model = resolveScriptModel(tier);
  const prompt = buildOutlinePrompt(topic, { durationMinutes, language, tone, angle });

  const MAX_ATTEMPTS = 3;
  let lastErr;
  let lastContent;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await runModel(model, {
      messages: [
        { role: 'system', content: 'You are a helpful assistant that outputs only valid JSON arrays.' },
        { role: 'user', content: prompt }
      ],
      // Reasoning models (qwen3) can spend a lot of output budget inside their
      // <think> block; the default cap truncates the JSON mid-stream. Give it
      // room to finish, and lower temperature so the structure stays stable.
      max_tokens: 4096,
      temperature: 0.4,
    });

    const content = result.result.response || result.result.text;
    lastContent = content;
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

  console.error('[Script Gen] Outline JSON could not be parsed after retries. Last raw outline output:\n' + lastContent);
  const err = new Error('Failed to parse outline JSON after ' + MAX_ATTEMPTS + ' attempts: ' + (lastErr ? lastErr.message : 'unknown'));
  // Attach the raw AI output so upstream handlers (server.js) can include a
  // preview in the error message they send back to the frontend dashboard.
  err.rawOutput = lastContent;
  throw err;
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
 * @param {object} options - { language, tone, tier, wordsPerSection, freshnessMemory }
 */
export async function generateSectionNarration(topic, section, index, total, previousSummary, options = {}) {
  const {
    language = 'thai',
    tone = 'auto',
    tier = 'standard',
    wordsPerSection = 180,
    freshnessMemory = {},
  } = options;

  const model = resolveScriptModel(tier);
  const prompt = buildNarrationPrompt(
    topic,
    section,
    index,
    total,
    previousSummary,
    { language, tone, wordsPerSection, freshnessMemory }
  );

  const result = await runModel(model, {
    messages: [
      { role: 'system', content: 'You are a professional documentary narrator writing script text.' },
      { role: 'user', content: prompt }
    ],
  });

  let narration = (result.result.response || result.result.text).trim();
  if (!narration) {
    console.warn(`[Script Gen] Warning: Received empty or null narration for section ${index}. Using fallback text.`);
    return `(Content for this section is not available yet. Please check the API or try again.)`;
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

export {
  deriveStoryboardShape,
  summarizeForNextSection,
  parseJsonArray,
  stripReasoning,
  updateFreshnessMemory,
  maybePolishScript
};

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
