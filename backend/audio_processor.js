import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execPromise = promisify(exec);

// ponytail: Use child_process to execute native ffmpeg commands directly instead of using fluent-ffmpeg wrapper.

/**
 * Merge multiple MP3 audio files into a single audio file.
 */
export async function mergeAudio(audioPaths, outputPath) {
  if (audioPaths.length === 0) throw new Error('No audio files to merge');
  if (audioPaths.length === 1) {
    const cmd = `ffmpeg -y -i "${audioPaths[0]}" -acodec copy "${outputPath}"`;
    await execPromise(cmd);
    return;
  }

  const inputs = audioPaths.map(p => `-i "${p}"`).join(' ');
  const filterInputs = audioPaths.map((_, idx) => `[${idx}:a]`).join('');
  const filterComplex = `"${filterInputs}concat=n=${audioPaths.length}:v=0:a=1[a]"`;

  const cmd = `ffmpeg -y ${inputs} -filter_complex ${filterComplex} -map "[a]" "${outputPath}"`;
  await execPromise(cmd);
}

/**
 * Trim silent gaps (Dead Air) within an audio file to make the voice narration compact.
 */
export async function trimSilence(inputPath, outputPath) {
  // silenceremove config:
  // start_periods=1: remove silence at the start
  // stop_periods=-1: apply to all silences in the file
  // stop_duration=0.3: consider silence if it exceeds 0.3s
  // stop_threshold=-40dB: threshold amplitude for silent detection
  const filter = 'silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB:stop_periods=-1:stop_duration=0.3:stop_threshold=-40dB';
  const cmd = `ffmpeg -y -i "${inputPath}" -af "${filter}" "${outputPath}"`;
  await execPromise(cmd);
}
