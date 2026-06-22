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

    // Step 1: Generate Outline
    const outlinePrompt = `You are a professional documentary scriptwriter.
Generate a structured storyline outline in Thai for the topic: "${topic}".
Create exactly 8 to 10 narrative chapters/sections. Keep them logically connected.

Return ONLY a JSON array of strings containing the chapter names/themes. Do not write any conversational text or formatting outside the JSON array.
Example output format:
[
  "บทนำ: จุดเริ่มต้นของ...",
  "บทที่ 2: ความลึกลับที่ซ่อนอยู่...",
  "บทสรุป: สิ่งที่เราค้นพบ..."
]`;

    const outlineResult = await runModel(env, '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
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

    // Step 2: Expand each section to narration
    const script = [];
    for (let i = 0; i < outline.length; i++) {
      const narrationPrompt = `You are writing a detailed video documentary in Thai.
Topic: "${topic}"
Current Section Title: "${outline[i]}" (Section ${i + 1} of ${outline.length})

Write a detailed, engaging narration spoken in Thai (around 150-250 words) for this section.
Use a professional, dramatic, and intriguing storytelling tone.
Write only the spoken narration text. Do not include section headings, narrator cues, bracketed text, or punctuation marks like asterisks. Return purely the spoken Thai text.`;

      const narrationResult = await runModel(env, '@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'You are a professional documentary narrator writing script text.' },
          { role: 'user', content: narrationPrompt }
        ],
      });

      const narration = getAiResponse(narrationResult).trim();
      script.push({
        sectionTitle: outline[i],
        narration: narration
      });
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
