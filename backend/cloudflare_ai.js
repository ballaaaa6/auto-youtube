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
  // Thai question particles
  if (/[?？]$/i.test(trimmed) || /(\u0e44\u0e2b\u0e21|\u0e2b\u0e23\u0e37\u0e2d\u0e40\u0e1b\u0e25\u0e48\u0e32|\u0e2b\u0e23\u0e37\u0e2d\u0e44\u0e21\u0e48|\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e45\u0e23|\u0e01\u0e31\u0e19\u0e41\u0e19\u0e48|\u0e43\u0e0a\u0e48\u0e44\u0e2b\u0e21|\u0e2b\u0e23\u0e37\u0e2d\u0e22\u0e31\u0e07|\u0e44\u0e14\u0e49\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e45\u0e23|\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e45\u0e23\u0e01\u0e31\u0e19\u0e41\u0e19\u0e48)$/.test(trimmed)) return 'direct_question';
  
  // Thai scenario words
  if (/^(imagine|picture|suppose|pretend|what\s+if|you\s+are|you\s+wake\s+up|you\s+stand|you\s+walk)\b/i.test(trimmed) ||
      /^(\u0e08\u0e34\u0e19\u0e15\u0e19\u0e32\u0e01\u0e32\u0e23|\u0e25\u0e2d\u0e07\u0e19\u0e36\u0e01|\u0e2a\u0e21\u0e21\u0e38\u0e15\u0e34|\u0e2a\u0e21\u0e21\u0e15\u0e34|\u0e04\u0e34\u0e14\u0e14\u0e39\u0e27\u0e48\u0e32|\u0e08\u0e30\u0e40\u0e01\u0e34\u0e14\u0e2d\u0e30\u0e44\u0e23\u0e02\u0e36\u0e49\u0e19\u0e16\u0e49\u0e32|\u0e16\u0e49\u0e32\u0e2b\u0e32\u0e01|\u0e04\u0e38\u0e13\u0e15\u0e37\u0e48\u0e19\u0e02\u0e36\u0e49\u0e19\u0e21\u0e32|\u0e04\u0e38\u0e13\u0e22\u0e37\u0e19\u0e2d\u0e22\u0e39\u0e48|\u0e04\u0e38\u0e13\u0e40\u0e14\u0e34\u0e19|\u0e25\u0e2d\u0e07\u0e08\u0e34\u0e19\u0e15\u0e19\u0e32\u0e01\u0e32\u0e23)/i.test(trimmed)) {
    return 'viewer_scenario';
  }
  
  // Thai numbers and jarring fact words
  if (/[\d\u0e50-\u0e59]|percent|million|billion|trillion|dead|missing|collapsed|vanished|killed|lost|found/i.test(trimmed) ||
      /(\u0e40\u0e1b\u0e2d\u0e23\u0e4c\u0e40\u0e0b\u0e47\u0e19\u0e15\u0e4c|%|\u0e25\u0e49\u0e32\u0e19|\u0e1e\u0e31\u0e19\u0e25\u0e49\u0e32\u0e19|\u0e41\u0e2a\u0e19\u0e25\u0e49\u0e32\u0e19|\u0e25\u0e49\u0e32\u0e19\u0e25\u0e49\u0e32\u0e19|\u0e15\u0e32\u0e22|\u0e40\u0e2a\u0e35\u0e22\u0e0a\u0e35\u0e27\u0e34\u0e15|\u0e28\u0e1e|\u0e2b\u0e32\u0e22\u0e2a\u0e32\u0e1a\u0e2a\u0e39\u0e0d|\u0e2a\u0e39\u0e0d\u0e2b\u0e32\u0e22|\u0e1e\u0e31\u0e07\u0e17\u0e25\u0e32\u0e22|\u0e16\u0e25\u0e48\u0e21|\u0e22\u0e38\u0e1a|\u0e2b\u0e32\u0e22\u0e44\u0e1b|\u0e06\u0e48\u0e32|\u0e1e\u0e1a|\u0e40\u0e08\u0e2d|\u0e04\u0e49\u0e19\u0e1e\u0e1a)/i.test(trimmed)) {
    return 'jarring_fact';
  }

  return 'statement';
}

function detectEndingMove(line = '') {
  const trimmed = String(line).trim();

  if (!trimmed) return 'unknown';
  // Thai question particles
  if (/[?？]$/i.test(trimmed) || /(\u0e44\u0e2b\u0e21|\u0e2b\u0e23\u0e37\u0e2d\u0e40\u0e1b\u0e25\u0e48\u0e32|\u0e2b\u0e23\u0e37\u0e2d\u0e44\u0e21\u0e48|\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e45\u0e23|\u0e01\u0e31\u0e19\u0e41\u0e19\u0e48|\u0e43\u0e0a\u0e48\u0e44\u0e2b\u0e21|\u0e2b\u0e23\u0e37\u0e2d\u0e22\u0e31\u0e07|\u0e44\u0e14\u0e49\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e45\u0e23|\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e45\u0e23\u0e01\u0e31\u0e19\u0e41\u0e19\u0e48)$/.test(trimmed)) return 'hanging_question';
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

function sanitizeScriptShape(script) {
  if (!Array.isArray(script)) return [];
  return script.map(item => ({
    sectionTitle: String(item.sectionTitle || '').trim(),
    hookOrGoal: String(item.hookOrGoal || '').trim(),
    keyPoint: String(item.keyPoint || '').trim(),
    narration: String(item.narration || '').trim(),
  }));
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
      return sanitizeScriptShape(polished);
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
  narration = stripReasoning(narration);
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

// =============================================================================
// YouTube metadata generation (SEO title, description, tags, thumbnail hook...)
// =============================================================================

/**
 * Preferred model for metadata generation: the smartest available Workers AI
 * instruct model. Can be overridden via the METADATA_MODEL env var.
 */
const DEFAULT_METADATA_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const METADATA_MODEL = process.env.METADATA_MODEL || DEFAULT_METADATA_MODEL;

/**
 * Build a compact, faithful summary of the finished script so the metadata
 * prompt can reason about what the video actually covers without dumping the
 * entire (often long) narration into the prompt.
 */
function summarizeScriptForMetadata(script) {
  if (!Array.isArray(script) || script.length === 0) return '(No script content available.)';
  return script.slice(0, 14).map((s, i) => {
    const title = String(s.sectionTitle || '').trim();
    const key = String(s.keyPoint || '').trim();
    const narration = String(s.narration || '').trim();
    const narrationExcerpt = narration ? narration.slice(0, 160) : '';
    return `${i + 1}. ${title}${key ? ` — ${key}` : ''}${narrationExcerpt ? `\n   "${narrationExcerpt}${narration.length > 160 ? '…' : ''}"` : ''}`;
  }).join('\n');
}

/**
 * Optional competitive research: if a YouTube Data API key is configured, pull
 * the top related videos for the topic and distill their public metadata into a
 * compact research signal. Titles/snippets/channels/dates/view counts are used
 * ONLY as signals — never copied. Failures are non-fatal.
 */
async function fetchYouTubeResearch(topic, apiKey) {
  if (!apiKey || !topic) return null;
  try {
    const query = encodeURIComponent(topic);
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q=${query}&relevanceLanguage=en&key=${apiKey}`;
    const searchRes = await fetch(url);
    if (!searchRes.ok) {
      console.warn(`[Metadata] YouTube search failed (${searchRes.status}). Continuing without research.`);
      return null;
    }
    const searchData = await searchRes.json();
    const items = Array.isArray(searchData.items) ? searchData.items : [];
    if (items.length === 0) return null;

    // Fetch statistics (view counts) in a second call for the discovered video ids.
    const videoIds = items
      .map((it) => it && it.id && it.id.videoId)
      .filter(Boolean)
      .slice(0, 12)
      .join(',');

    let statsById = {};
    if (videoIds) {
      try {
        const statsRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${apiKey}`
        );
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          (statsData.items || []).forEach((v) => {
            statsById[v.id] = {
              viewCount: v.statistics && v.statistics.viewCount,
            };
          });
        }
      } catch (_) { /* statistics are a bonus, ignore failures */ }
    }

    const compact = items
      .filter((it) => it && it.id && it.id.videoId)
      .map((it) => {
        const vid = it.id.videoId;
        const stats = statsById[vid] || {};
        const snip = it.snippet || {};
        const views = stats.viewCount ? Number(stats.viewCount).toLocaleString() : 'n/a';
        return `- "${(snip.title || '').trim()}" — ${(snip.channelTitle || '').trim()} (${(snip.publishedAt || '').slice(0, 10)}, ${views} views)`;
      })
      .join('\n');

    return compact || null;
  } catch (err) {
    console.warn(`[Metadata] YouTube research failed: ${err.message}. Continuing without research.`);
    return null;
  }
}

/**
 * Strict JSON object parser for metadata. Mirrors parseJsonArray's resilience
 * (strip reasoning blocks + markdown fences + trailing commas + structural
 * single-quote fixes), but extracts the outermost {...} object instead of [ ].
 */
function parseMetadataJson(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('empty AI output');
  }

  let text = stripReasoning(raw);
  text = text.replace(/```(?:json)?/gi, '').trim();

  const startIdx = text.indexOf('{');
  const endIdx = text.lastIndexOf('}');
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error('no JSON object found in AI output');
  }
  let jsonStr = text.substring(startIdx, endIdx + 1);

  try {
    return JSON.parse(jsonStr);
  } catch (_) { /* fall through */ }

  try {
    jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(jsonStr);
  } catch (_) { /* fall through */ }

  try {
    const fixed = jsonStr
      .replace(/([{[:,]\s*)'/g, '$1"')
      .replace(/'(\s*[:,}\]])/g, '"$1');
    return JSON.parse(fixed);
  } catch (_) { /* fall through */ }

  throw new Error('AI output was not valid JSON');
}

/**
 * Coerce / validate the AI's metadata object into the strict contract required
 * by the frontend. Any missing or malformed field falls back to a safe value so
 * metadata generation never breaks script generation.
 */
function coerceMetadata(raw, topic, language) {
  const safeTopic = String(topic || '').trim() || 'this topic';
  const outputLanguage = LANGUAGE_LABELS[language] || LANGUAGE_LABELS[language] || 'Thai';
  const isThai = /thai|auto/i.test(String(language)) || outputLanguage === 'Thai';

  const ensureString = (v, fallback) =>
    typeof v === 'string' && v.trim() ? v.trim() : fallback;

  const ensureStringArray = (v) => {
    if (Array.isArray(v)) {
      const cleaned = v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
      if (cleaned.length) return cleaned;
    }
    return [];
  };

  const title = ensureString(raw && raw.title, safeTopic).slice(0, 100);
  const description = ensureString(raw && raw.description,
    `${safeTopic}\n\nA documentary-style video exploring the story, context, and key details behind ${safeTopic}.`
  );

  let hashtags = ensureStringArray(raw && raw.hashtags);
  if (hashtags.length === 0) {
    hashtags = isThai ? ['#สารคดี', '#เรื่องเล่า', `#${safeTopic}`] : ['#documentary', '#story', `#${safeTopic.split(/\s+/)[0]}`];
  }
  hashtags = hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).slice(0, 8);

  const tags = ensureStringArray(raw && raw.tags).slice(0, 15);
  const thumbnailText = ensureString(raw && raw.thumbnailText, safeTopic).slice(0, 60);
  const searchKeywords = ensureStringArray(raw && raw.searchKeywords).slice(0, 10);
  const titleOptions = ensureStringArray(raw && raw.titleOptions)
    .map((t) => t.slice(0, 100))
    .slice(0, 5);

  return {
    title,
    description,
    hashtags,
    tags,
    thumbnailText,
    searchKeywords,
    titleOptions,
    modelUsed: raw && raw.modelUsed ? raw.modelUsed : undefined,
  };
}

/**
 * A safe fallback metadata object returned when AI metadata generation fails
 * entirely, so a script-generation response never breaks.
 */
function buildFallbackMetadata(topic, language) {
  const safeTopic = String(topic || '').trim() || 'this topic';
  return coerceMetadata({}, safeTopic, language);
}

function buildMetadataPrompt(topic, script, options) {
  const { language, tone, angle, targetAudience, research } = options;

  const outputLanguage = LANGUAGE_LABELS[language] || 'Thai';
  const toneInstruction = TONE_LABELS[tone] || 'Use the most fitting tone for the topic.';
  const angleInstruction = ANGLE_LABELS[angle] || 'Use the most fitting content angle.';
  const audienceInstruction = targetAudience
    ? `Target audience: ${targetAudience}`
    : 'Target audience: curious general viewers interested in this topic.';

  const scriptSummary = summarizeScriptForMetadata(script);

  const researchBlock = research
    ? `OPTIONAL YOUTUBE COMPETITIVE RESEARCH (use ONLY as directional signal — never copy these titles, descriptions, or phrasings. Find gaps and angles they miss):
${research}`
    : 'No YouTube competitive research is provided for this run. Rely on the topic and script only.';

  // Comparison-topic guardrail: when the topic is an "X vs Y" framing, push the
  // model toward rivalry/narrative titles instead of a flat comparison title.
  const isComparison = /\bvs\.?\b|\bversus\b/i.test(String(topic));
  const comparisonGuidance = isComparison
    ? `COMPARISON TOPIC DETECTED.
The topic reads as a "X vs Y" comparison. Do NOT produce a flat title like "X vs Y".
Write titles that frame the rivalry as a story, for example:
- "Coke vs Pepsi: The Rivalry That Changed Advertising Forever"
- "Why Coke and Pepsi Have Been Fighting for 100 Years"
- "Coke vs Pepsi: The Marketing War Nobody Really Won"
The "title" and every "titleOptions" entry must read as a clickable story, not a label.`
    : '';

  return `You are an elite YouTube strategist, SEO specialist, and retention editor rolled into one.
Your entire output must maximize click-through rate, search discovery, and watch intent.

TOPIC: "${topic}"

OUTPUT LANGUAGE: ${outputLanguage}
Write "title", "description", "thumbnailText", "tags", "searchKeywords", "hashtags", and every "titleOptions" entry in this language.
Use natural, idiomatic, native-sounding phrasing — never a stiff literal translation.
${toneInstruction}
${angleInstruction}
${audienceInstruction}

${comparisonGuidance}

WHAT THIS VIDEO ACTUALLY COVERS (ground your metadata in this, do not invent content that is not here):
${scriptSummary}

${researchBlock}

TITLE RULES (applies to "title" AND every entry in "titleOptions"):
- Must be emotionally clickable and create curiosity.
- Must include the main topic keyword naturally.
- Must NOT be fake, misleading, exaggerated, or spammy clickbait.
- Must be under 100 characters.
- Avoid generic words like "Amazing", "Shocking", "You Won't Believe" unless they are genuinely accurate.

DESCRIPTION RULES:
- The first 1-2 lines must hook the viewer and include the main keyword (this is what shows in search/preview).
- Then summarize what the video covers in 2-4 short paragraphs total.
- Add natural SEO phrases, not a keyword dump.
- Do NOT say the video was AI-generated or auto-generated.
- Do NOT use generic filler like "Welcome to my channel".
- End the description with 3-5 relevant hashtags.

THUMBNAIL TEXT ("thumbnailText"):
- A short 2-5 word punchy hook meant to sit on top of the thumbnail image.

TAGS ("tags") and SEARCH KEYWORDS ("searchKeywords"):
- "tags" are individual lowercase keyword phrases a person might search (comma-style list of 5-15).
- "searchKeywords" are 2-6 fuller search phrases people would actually type into YouTube search.

HASHTAGS ("hashtags"):
- 3-6 hashtags, each starting with "#".

STRICT OUTPUT FORMAT:
Return a single JSON object only.
No markdown fences. No explanation. No text outside the JSON.

Schema:
{
  "title": "string, max 100 characters, clickable but not clickbait",
  "description": "string, SEO-friendly YouTube description, 2-4 short paragraphs",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "tags": ["keyword 1", "keyword 2", "keyword 3"],
  "thumbnailText": "short 2-5 word hook for thumbnail",
  "searchKeywords": ["main search phrase", "secondary search phrase"],
  "titleOptions": ["alternative title 1", "alternative title 2", "alternative title 3"]
}`;
}

/**
 * Generate SEO-optimized YouTube metadata (title, description, tags, thumbnail
 * hook, alternative titles) from a finished script.
 *
 * Strategy:
 *  - Use the smartest model by default (llama-3.3-70b-instruct-fp8-fast),
 *    overridable via METADATA_MODEL.
 *  - On any failure, fall back to the same model used for the script, then to a
 *    deterministic safe fallback object. Never throws.
 */
export async function generateYouTubeMetadata(topic, script, options = {}) {
  const {
    language = 'thai',
    tone = 'auto',
    angle = 'auto',
    targetAudience = '',
    research = null,
    tier = 'standard',
  } = options;

  const safeTopic = String(topic || '').trim();
  const scriptModel = resolveScriptModel(tier);

  // Optional YouTube competitive research (only if caller passes it in).
  let researchSignal = research;
  const ytApiKey = process.env.YOUTUBE_API_KEY;
  if (!researchSignal && ytApiKey) {
    researchSignal = await fetchYouTubeResearch(safeTopic, ytApiKey);
  }

  const prompt = buildMetadataPrompt(safeTopic, script, {
    language, tone, angle, targetAudience, research: researchSignal,
  });

  const systemContent =
    'You are a YouTube SEO and packaging expert that outputs only valid JSON objects.';

  const tryModel = async (model) => {
    const result = await runModel(model, {
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2048,
      temperature: 0.7,
    });
    const content = result.result.response || result.result.text;
    const parsed = parseMetadataJson(content);
    const coerced = coerceMetadata(parsed, safeTopic, language);
    coerced.modelUsed = model;
    return coerced;
  };

  // Attempt 1: preferred (smartest) metadata model.
  try {
    return await tryModel(METADATA_MODEL);
  } catch (err) {
    console.warn(`[Metadata] Preferred model (${METADATA_MODEL}) failed: ${err.message}. Falling back to script model.`);
  }

  // Attempt 2: the same model already used for script generation.
  if (scriptModel && scriptModel !== METADATA_MODEL) {
    try {
      return await tryModel(scriptModel);
    } catch (err) {
      console.warn(`[Metadata] Script model (${scriptModel}) failed: ${err.message}. Using fallback metadata.`);
    }
  }

  // Attempt 3: deterministic safe fallback.
  return buildFallbackMetadata(safeTopic, language);
}

export {
  deriveStoryboardShape,
  summarizeForNextSection,
  parseJsonArray,
  stripReasoning,
  updateFreshnessMemory,
  maybePolishScript,
  buildFallbackMetadata,
  coerceMetadata,
  parseMetadataJson,
  buildMetadataPrompt,
  fetchYouTubeResearch,
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
