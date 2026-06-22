import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execPromise = promisify(exec);

// ponytail: Render simple video chunks from images, then concatenate using concat demuxer for robust execution.

/**
 * Generate standard SRT subtitle format file from Whisper segments.
 */
export function generateSRT(segments, outputPath) {
  let srtContent = '';
  segments.forEach((seg, idx) => {
    const start = formatSRTTime(seg.start);
    const end = formatSRTTime(seg.end);
    srtContent += `${idx + 1}\n${start} --> ${end}\n${seg.text.trim()}\n\n`;
  });
  fs.writeFileSync(outputPath, srtContent, 'utf-8');
}

function formatSRTTime(seconds) {
  const date = new Date(0);
  date.setSeconds(seconds);
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  const timeStr = date.toISOString().substr(11, 8);
  return `${timeStr},${ms}`;
}

/**
 * Compile images, audio, and subtitle file into a final .mp4 video.
 * @param {Array} scenes List of [{ start, end, imagePath }]
 * @param {string} audioPath Processed narration audio path (.mp3)
 * @param {string} srtPath Subtitle srt file path
 * @param {string} outputPath Final video output path (.mp4)
 * @param {string} tempDir Directory for saving temp files
 */
export async function compileVideo(scenes, audioPath, srtPath, outputPath, tempDir) {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const clipPaths = [];
  
  // 1. Create short video clips from individual images matching section durations
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const duration = scene.end - scene.start;
    const clipPath = path.join(tempDir, `clip_${i}.mp4`);
    
    // Create 1920x1080 slide from single image
    const cmd = `ffmpeg -y -loop 1 -r 25 -i "${scene.imagePath}" -c:v libx264 -t ${duration} -pix_fmt yuv420p -vf "scale=1920:1080,format=yuv420p" "${clipPath}"`;
    await execPromise(cmd);
    clipPaths.push(clipPath);
  }

  // 2. Generate file list for FFmpeg concat demuxer
  const listFilePath = path.join(tempDir, 'clips.txt');
  const listContent = clipPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(listFilePath, listContent, 'utf-8');

  // 3. Concat all video clips and merge with narration audio
  const mergedNoSubPath = path.join(tempDir, 'merged_nosub.mp4');
  const mergeCmd = `ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -i "${audioPath}" -c:v copy -c:a aac -shortest "${mergedNoSubPath}"`;
  await execPromise(mergeCmd);

  // 4. Burn subtitles (SRT) onto the final video clip
  // Escaping paths for Windows compatibility in ffmpeg filter expression
  const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  const renderCmd = `ffmpeg -y -i "${mergedNoSubPath}" -vf "subtitles='${escapedSrtPath}'" -c:a copy "${outputPath}"`;
  await execPromise(renderCmd);

  // 5. Clean up temporary chunks
  try {
    clipPaths.forEach(p => fs.unlinkSync(p));
    fs.unlinkSync(listFilePath);
    fs.unlinkSync(mergedNoSubPath);
  } catch (err) {
    console.warn('Failed to clean up some temporary files:', err.message);
  }
}
