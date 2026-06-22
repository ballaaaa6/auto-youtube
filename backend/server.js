import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

import { generateScript, transcribeAudio } from './cloudflare_ai.js';
import { runTTS } from './automations/voicertool_tts.js';
import { mergeAudio, trimSilence } from './audio_processor.js';
import { runGoogleFlow } from './automations/google_flow.js';
import { compileVideo, generateSRT } from './video_compiler.js';
import { uploadToYouTube } from './automations/youtube_upload.js';

dotenv.config();
const execPromise = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Temp directory setup
const TEMP_DIR = path.resolve('./temp');
const OUTPUT_DIR = path.resolve('./output');
[TEMP_DIR, OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Calculate audio duration in seconds using ffprobe
async function getAudioDuration(filePath) {
  const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
  const { stdout } = await execPromise(cmd);
  return parseFloat(stdout.trim());
}

/**
 * API: Generate script draft from topic
 */
app.post('/api/generate-script', async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: 'Topic query parameter is required' });

  try {
    const script = await generateScript(topic);
    res.json({ script });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API (SSE): Run automation pipeline and stream real-time logs
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

  // Clear previous temp files
  try {
    fs.readdirSync(TEMP_DIR).forEach(file => {
      fs.unlinkSync(path.join(TEMP_DIR, file));
    });
  } catch (e) {}

  try {
    sendLog('=== Starting Auto YouTube Video Generation Pipeline ===', 5);
    
    // Step 1: TTS Generation
    sendLog('Step 1/6: Synthesizing narration audio via voicertool.com...', 10);
    const audioParts = [];
    const trimmedParts = [];
    
    for (let i = 0; i < script.length; i++) {
      const part = script[i];
      const origAudioPath = path.join(TEMP_DIR, `part_${i}_orig.mp3`);
      const trimmedAudioPath = path.join(TEMP_DIR, `part_${i}_trimmed.mp3`);
      
      sendLog(`Downloading audio snippet ${i + 1}/${script.length}...`);
      await runTTS(part.narration, origAudioPath, (logMsg) => sendLog(`  [TTS Bot] ${logMsg}`));
      
      sendLog(`  Trimming silence segments for snippet ${i + 1}...`);
      await trimSilence(origAudioPath, trimmedAudioPath);
      
      audioParts.push(origAudioPath);
      trimmedParts.push(trimmedAudioPath);
    }

    // Step 2: Merge audio snippets
    sendLog('Step 2/6: Merging audio segments and compressing silence gap...', 35);
    const mergedAudioPath = path.join(TEMP_DIR, 'final_narration.mp3');
    await mergeAudio(trimmedParts, mergedAudioPath);
    sendLog('  Audio segments merged successfully.');

    // Calculate timestamps boundaries for images based on duration
    const scenes = [];
    let currentStart = 0;
    for (let i = 0; i < script.length; i++) {
      const duration = await getAudioDuration(trimmedParts[i]);
      scenes.push({
        start: currentStart,
        end: currentStart + duration,
        prompt: script[i].imagePrompt
      });
      currentStart += duration;
    }

    // Step 3: Transcription and SRT generation
    sendLog('Step 3/6: Analyzing voice speech timestamps using Cloudflare Whisper...', 50);
    const audioBuffer = fs.readFileSync(mergedAudioPath);
    const whisperResult = await transcribeAudio(audioBuffer);
    
    const srtPath = path.join(TEMP_DIR, 'subtitles.srt');
    generateSRT(whisperResult.segments, srtPath);
    sendLog('  Subtitles SRT generated successfully.');

    // Step 4: Image generation
    sendLog('Step 4/6: Generating images via Google Flow browser automation...', 65);
    const imagePrompts = scenes.map(s => s.prompt);
    const imageOutputDir = path.join(TEMP_DIR, 'images');
    const imagePaths = await runGoogleFlow(imagePrompts, imageOutputDir, (logMsg) => sendLog(`  [Image Bot] ${logMsg}`));

    for (let i = 0; i < scenes.length; i++) {
      scenes[i].imagePath = imagePaths[i];
    }

    // Step 5: Render video
    sendLog('Step 5/6: Compiling video slides, mixing audio and burning subtitles...', 80);
    const outputVideoName = `video_${Date.now()}.mp4`;
    const finalVideoPath = path.join(OUTPUT_DIR, outputVideoName);
    
    await compileVideo(scenes, mergedAudioPath, srtPath, finalVideoPath, TEMP_DIR);
    sendLog(`🎉 Video compiled successfully: ${outputVideoName}`, 95);

    res.write(`data: ${JSON.stringify({ status: 'done', videoUrl: `/output/${outputVideoName}`, videoPath: finalVideoPath })}\n\n`);
    res.end();

  } catch (err) {
    sendLog(`❌ Pipeline execution failed: ${err.message}`);
    res.write(`data: ${JSON.stringify({ status: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

app.use('/output', express.static(OUTPUT_DIR));

/**
 * API: Upload video to YouTube
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

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🤖 Auto YouTube Backend running on port ${PORT}`);
  console.log(`🔗 Console panel deployed and active`);
  console.log(`==================================================`);
});
