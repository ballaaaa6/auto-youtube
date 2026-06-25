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
const selectors = Object.assign({}, ...jsonBlocks).youtube_studio;

const HEADLESS = process.env.HEADLESS === 'true';
const PROFILE_PATH = path.resolve(process.env.BROWSER_PROFILE_PATH || '../profiles/user_data');

/**
 * Automate YouTube Studio uploading process.
 * @param {string} videoPath Final video file path (.mp4)
 * @param {string} title Video Title
 * @param {string} description Video Description
 * @param {Function} logCallback Log updates sender
 */
export async function uploadToYouTube(videoPath, title, description, logCallback = console.log) {
  logCallback(`Preparing to upload video to YouTube...`);
  logCallback(`Video file: ${path.basename(videoPath)}`);
  logCallback(`Session profile: ${PROFILE_PATH}`);

  if (!fs.existsSync(videoPath)) {
    throw new Error('Video file not found at path');
  }

  const context = await chromium.launchPersistentContext(PROFILE_PATH, {
    headless: HEADLESS,
    viewport: { width: 1366, height: 768 },
    args: ['--disable-blink-features=AutomationControlled']
  });

  const page = await context.newPage();

  try {
    logCallback('Opening YouTube Studio...');
    await page.goto('https://studio.youtube.com/', { waitUntil: 'networkidle', timeout: 60000 });

    const isLoggedIn = await page.locator(selectors.create_button).count();
    if (isLoggedIn === 0) {
      logCallback('⚠️ Authentication failed! Set HEADLESS=false to log in manually first.');
      throw new Error('Not logged into YouTube Studio.');
    }

    logCallback('Clicking "Create" button...');
    await page.click(selectors.create_button);
    await page.waitForTimeout(1000);

    logCallback('Clicking "Upload videos" option...');
    await page.click(selectors.upload_button);
    await page.waitForTimeout(2000);

    logCallback('Uploading video file...');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('button:has-text("Select files"), #select-files-button');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(videoPath);

    logCallback('Waiting for upload form to initialize...');
    await page.waitForSelector(selectors.title_textarea, { timeout: 60000 });
    
    logCallback('Filling video title...');
    await page.click(selectors.title_textarea);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.fill(selectors.title_textarea, title.substring(0, 100));
    await page.waitForTimeout(1000);

    logCallback('Filling video description...');
    await page.fill(selectors.description_textarea, description);
    await page.waitForTimeout(1000);

    logCallback('Setting audience target (Not Made for Kids)...');
    await page.click(selectors.audience_not_for_kids);
    await page.waitForTimeout(1000);

    logCallback('Advancing steps (details, monetization, elements)...');
    for (let i = 0; i < 3; i++) {
      await page.click(selectors.next_button);
      await page.waitForTimeout(1500);
    }

    logCallback('Setting visibility to Private...');
    await page.click(selectors.visibility_private);
    await page.waitForTimeout(1500);

    logCallback('Saving draft...');
    await page.click(selectors.save_button);
    await page.waitForTimeout(5000);

    logCallback('🎉 Video upload draft saved successfully on YouTube Studio.');

  } catch (err) {
    logCallback(`YouTube Upload error: ${err.message}`);
    throw err;
  } finally {
    await context.close();
    logCallback('YouTube browser session closed.');
  }
}
