import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

import { 
  generateOutline, 
  generateSectionNarration, 
  transcribeAudio, 
  generateImagePromptsForSegments,
  deriveStoryboardShape,
  summarizeForNextSection,
  updateFreshnessMemory,
  maybePolishScript,
} from './cloudflare_ai.js';
import { runTTS } from './automations/voicertool_tts.js';
import { mergeAudio, trimSilence } from './audio_processor.js';
import { runGoogleFlow } from './automations/google_flow.js';
import { compileVideo, generateSRT } from './video_compiler.js';
import { uploadToYouTube } from './automations/youtube_upload.js';

dotenv.config();
const execPromise = promisify(exec);

// Process-level safety nets: log and continue instead of crashing the whole server
// on an unhandled async rejection (e.g. a flaky Cloudflare API call).
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check endpoint so the dashboard can verify the backend is reachable.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

const TEMP_DIR = path.resolve('./temp');
const OUTPUT_DIR = path.resolve('./output');
[TEMP_DIR, OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Calculate audio duration
async function getAudioDuration(filePath) {
  const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
  const { stdout } = await execPromise(cmd);
  return parseFloat(stdout.trim());
}

/**
 * API: Generate full narration script in 2 steps (Outline -> Chunk Expansion)
 */
app.post('/api/generate-script', async (req, res) => {
  const {
    topic,
    durationMinutes = 8,
    language = 'thai',
    tone = 'auto',
    angle = 'auto',
    tier = 'standard',
  } = req.body;
  if (!topic) return res.status(400).json({ error: 'Topic is required' });

  try {
    console.log(`[Script Gen] Generating storyboard outline for topic: "${topic}" (tier=${tier}, duration=${durationMinutes}min)...`);

    const outlineOptions = { durationMinutes, language, tone, angle, tier };
    const outline = await generateOutline(topic, outlineOptions);
    console.log(`[Script Gen] Storyboard created with ${outline.length} sections.`);

    const { wordsPerSection } = deriveStoryboardShape(durationMinutes);
    const narrationOptions = { language, tone, tier, wordsPerSection };

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
      console.log(`[Script Gen] Expanding section ${i + 1}/${outline.length}: "${section.sectionTitle}"...`);

      const narration = await generateSectionNarration(
        topic,
        section,
        i + 1,
        outline.length,
        previousSummary,
        { ...narrationOptions, freshnessMemory }
      );

      script.push({
        sectionTitle: section.sectionTitle,
        hookOrGoal: section.hookOrGoal,
        keyPoint: section.keyPoint,
        narration: narration
      });

      freshnessMemory = updateFreshnessMemory(freshnessMemory, narration);
      previousSummary = summarizeForNextSection(narration);
    }

    console.log(`[Script Gen] Narration generated. Polishing script (polishScript=${req.body.polishScript !== false})...`);
    script = await maybePolishScript(topic, script, {
      language,
      tone,
      durationMinutes,
      tier,
      polishScript: req.body.polishScript !== false
    });

    res.json({ script });
  } catch (err) {
    console.error('[Script Gen] Error:', err.message);
    const preview = (err.rawOutput || '').slice(0, 300);
    const message = preview
      ? err.message + ' | Raw AI output (first 300 chars): ' + preview
      : err.message;
    res.status(500).json({ error: message });
  }
});

/**
 * API (SSE): Runs complete audio-first video generation pipeline
 */
app.get('/api/run-pipeline', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendLog = (message, percent = 0) => {
    res.write(`data: ${JSON.stringify({ message, percent })}\n\n`);
  };

  const scriptParam = req.query.script;
  if (!scriptParam) {
    sendLog('Error: Missing script content');
    res.end();
    return;
  }

  let script = [];
  try {
    script = JSON.parse(decodeURIComponent(scriptParam));
  } catch (e) {
    sendLog('Error: Invalid JSON script payload');
    res.end();
    return;
  }

  // Clear temp files
  try {
    fs.readdirSync(TEMP_DIR).forEach(file => {
      const p = path.join(TEMP_DIR, file);
      if (fs.statSync(p).isFile()) fs.unlinkSync(p);
    });
  } catch (e) {}

  try {
    // ponytail: Disabled downstream video generation steps as requested by the user, keeping the code for future reactivation.
    sendLog('=== Pipeline is currently disabled. Only script generation is active. ===', 100);
    res.write(`data: ${JSON.stringify({ status: 'done', message: 'Pipeline is currently disabled. Only script generation is active.' })}\n\n`);
    res.end();

    /*
    // Step 1: TTS Generation on each narration part
    sendLog('Step 1/6: Synthesizing narration audio via voicertool.com...', 10);
    const trimmedParts = [];
    
    for (let i = 0; i < script.length; i++) {
      const part = script[i];
      const origAudioPath = path.join(TEMP_DIR, `part_${i}_orig.mp3`);
      const trimmedAudioPath = path.join(TEMP_DIR, `part_${i}_trimmed.mp3`);
      
      sendLog(`Downloading audio snippet ${i + 1}/${script.length}...`);
      await runTTS(part.narration, origAudioPath, (logMsg) => sendLog(`  [TTS Bot] ${logMsg}`));
      
      sendLog(`  Trimming silence segments for snippet ${i + 1}...`);
      await trimSilence(origAudioPath, trimmedAudioPath);
      
      trimmedParts.push(trimmedAudioPath);
    }

    // Step 2: Merge audio
    sendLog('Step 2/6: Merging audio segments into a continuous narration track...', 30);
    const mergedAudioPath = path.join(TEMP_DIR, 'final_narration.mp3');
    await mergeAudio(trimmedParts, mergedAudioPath);
    sendLog('  Audio segments merged successfully.');

    // Step 3: Transcription and SRT generation using Cloudflare Whisper
    sendLog('Step 3/6: Analyzing voice speech timestamps using Cloudflare Whisper...', 45);
    const audioBuffer = fs.readFileSync(mergedAudioPath);
    const whisperResult = await transcribeAudio(audioBuffer);
    
    const srtPath = path.join(TEMP_DIR, 'subtitles.srt');
    generateSRT(whisperResult.segments, srtPath);
    sendLog('  Subtitles SRT file generated.');

    // Step 4: Generate Image Prompts for each timestamp segment
    sendLog('Step 4/6: Generating matching image prompts for each spoken segment...', 60);
    const whisperSegments = whisperResult.segments; // array of { start, end, text }
    const promptsResult = await generateImagePromptsForSegments(whisperSegments);
    
    // Map prompts back to segments
    const scenes = whisperSegments.map((seg, idx) => {
      const promptObj = promptsResult.find(p => p.id === idx) || { imagePrompt: `A beautiful concept art matching the text: ${seg.text}` };
      return {
        start: seg.start,
        end: seg.end,
        prompt: promptObj.imagePrompt
      };
    });

    // Step 5: Generate Images using Google Flow Playwright Bot
    sendLog('Step 5/6: Launching Google Flow browser bot to create segment visuals...', 75);
    const imagePrompts = scenes.map(s => s.prompt);
    const imageOutputDir = path.join(TEMP_DIR, 'images');
    const imagePaths = await runGoogleFlow(imagePrompts, imageOutputDir, (logMsg) => sendLog(`  [Image Bot] ${logMsg}`));

    for (let i = 0; i < scenes.length; i++) {
      scenes[i].imagePath = imagePaths[i];
    }

    // Step 6: Render final video with burnt subtitles
    sendLog('Step 6/6: Compiling video slides, mixing audio track, and burning subtitles...', 90);
    const outputVideoName = `video_${Date.now()}.mp4`;
    const finalVideoPath = path.join(OUTPUT_DIR, outputVideoName);
    
    await compileVideo(scenes, mergedAudioPath, srtPath, finalVideoPath, TEMP_DIR);
    sendLog(`🎉 Video compiled successfully: ${outputVideoName}`, 98);

    res.write(`data: ${JSON.stringify({ status: 'done', videoUrl: `/output/${outputVideoName}`, videoPath: finalVideoPath })}\n\n`);
    res.end();
    */

  } catch (err) {
    sendLog(`❌ Pipeline execution failed: ${err.message}`);
    res.write(`data: ${JSON.stringify({ status: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

app.use('/output', express.static(OUTPUT_DIR));
app.use(express.static(path.resolve('../frontend')));

/**
 * API: Upload video to YouTube Studio
 */
app.post('/api/upload-youtube', async (req, res) => {
  const { videoPath, title, description } = req.body;
  if (!videoPath || !title) {
    return res.status(400).json({ error: 'Video path and title are required' });
  }

  try {
    let logs = [];
    await uploadToYouTube(videoPath, title, description || '', (msg) => {
      logs.push(msg);
      console.log(`[YouTube Upload] ${msg}`);
    });
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🤖 Auto YouTube Backend running on port ${PORT}`);
  console.log(`==================================================`);
  
  // ponytail: Spawn cloudflared tunnel automatically on startup to connect to Cloudflare Pages dashboard.
  const tunnelBin = path.resolve('./node_modules/cloudflared/bin/cloudflared.exe');
  const tunnelToken = process.env.CLOUDFLARE_TUNNEL_TOKEN;
  const namedTunnelUrl = process.env.CLOUDFLARE_TUNNEL_URL;

  let cfTunnel;
  if (tunnelToken) {
    console.log(`📡 Starting Named Cloudflare Tunnel using token...`);
    cfTunnel = spawn(tunnelBin, ['tunnel', 'run', '--token', tunnelToken]);
    
    if (namedTunnelUrl) {
      (async () => {
        try {
          const hexVal = Buffer.from(namedTunnelUrl.trim()).toString('hex');
          await fetch(`https://keyvalue.immanuel.co/api/KeyVal/UpdateValue/8d5ycaxi/backend_url/${hexVal}`, {
            method: 'POST'
          });
          console.log(`🚀 Sync complete! Named Tunnel URL (${namedTunnelUrl}) stored on Cloud KV.`);
        } catch (err) {
          console.error(`⚠️ Failed to sync named tunnel URL to KV: ${err.message}`);
        }
      })();
    }
  } else {
    console.log(`📡 Starting Quick Cloudflare Tunnel (trycloudflare.com)...`);
    cfTunnel = spawn(tunnelBin, ['tunnel', '--url', `http://localhost:${PORT}`]);
  }

  cfTunnel.on('error', (err) => {
    console.error(`[cloudflared-error] Failed to start tunnel process: ${err.message}`);
  });

  cfTunnel.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`[cloudflared] ${output.trim()}`);
  });

  cfTunnel.stderr.on('data', async (data) => {
    const output = data.toString();
    console.log(`[cloudflared-err] ${output.trim()}`);
    // Parse the generated trycloudflare.com URL from stderr
    const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match) {
      const tunnelUrl = match[0];
      console.log(`\n==================================================`);
      console.log(`🎉 Cloudflare Tunnel started successfully!`);
      console.log(`📡 Syncing tunnel URL to Cloud...`);
      
      try {
        const hexVal = Buffer.from(tunnelUrl).toString('hex');
        await fetch(`https://keyvalue.immanuel.co/api/KeyVal/UpdateValue/8d5ycaxi/backend_url/${hexVal}`, {
          method: 'POST'
        });
        console.log(`🚀 Sync complete! Backend URL stored on Cloud.`);
      } catch (err) {
        console.error(`⚠️ Failed to sync backend URL to KV: ${err.message}`);
      }

      console.log(`👉 Open dashboard link:`);
      console.log(`https://auto-youtube-baj.pages.dev/`);
      console.log(`==================================================\n`);
    }
  });

  cfTunnel.on('close', (code) => {
    console.log(`[cloudflared] Tunnel process exited with code ${code}`);
    if (code !== 0) {
      console.log(`💡 Tip: Cloudflare trycloudflare.com service might be experiencing temporary downtime or rate-limiting. The local server is still running on port ${PORT}.`);
    }
  });
});
