import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

// Resolve repo root from this file's location so the server can be started
// from any working directory (cwd), not only from backend/.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load selectors from docs/SELECTORS.md
const SELECTORS_PATH = path.resolve(__dirname, '../../docs/SELECTORS.md');
const content = fs.readFileSync(SELECTORS_PATH, 'utf-8');
const jsonBlocks = [...content.matchAll(/```json\s*([\s\S]*?)\s*```/g)].map(m => JSON.parse(m[1]));
const selectors = Object.assign({}, ...jsonBlocks).voicertool;

const HEADLESS = process.env.HEADLESS === 'true';

/**
 * Automate voicertool.com to convert narration text into speech MP3 files.
 * @param {string} text Text to speak
 * @param {string} outputPath Output file destination
 * @param {Function} logCallback Log updates sender
 */
export async function runTTS(text, outputPath, logCallback = console.log) {
  logCallback(`Launching browser for voicertool.com (headless: ${HEADLESS})...`);
  
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled']
  });
  
  const context = await browser.newContext({
    acceptDownloads: true
  });
  
  const page = await context.newPage();
  
  try {
    logCallback('Navigating to https://voicertool.com/...');
    await page.goto('https://voicertool.com/', { waitUntil: 'networkidle', timeout: 60000 });
    
    logCallback('Entering script in text area...');
    await page.waitForSelector(selectors.textarea_input);
    await page.fill(selectors.textarea_input, text);
    
    try {
      logCallback('Configuring language options...');
      // Optional dropdown adjustments can be done here if selectors are matched.
    } catch (e) {
      logCallback('Falling back to default voicertool voice options...');
    }
    
    logCallback('Clicking "Generate speech" button...');
    await page.click(selectors.generate_button);
    
    logCallback('Synthesizing speech (typically takes 10-30 seconds)...');
    
    const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
    
    await page.waitForSelector(selectors.download_button, { timeout: 90000 });
    await page.click(selectors.download_button);
    
    const download = await downloadPromise;
    logCallback('Download triggered! Saving audio file...');
    
    await download.saveAs(outputPath);
    logCallback(`Audio saved successfully: ${path.basename(outputPath)}`);
    
  } catch (err) {
    logCallback(`TTS automation error: ${err.message}`);
    throw err;
  } finally {
    await browser.close();
    logCallback('Browser closed for TTS.');
  }
}
