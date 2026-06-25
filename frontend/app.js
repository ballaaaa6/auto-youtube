// Fetch DOM elements
const topicInput = document.getElementById('topic-input');
const btnGenerateScript = document.getElementById('btn-generate-script');
const scriptEditor = document.getElementById('script-editor');
const btnRunPipeline = document.getElementById('btn-run-pipeline');
const terminalLogs = document.getElementById('terminal-logs');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const videoPlayer = document.getElementById('video-player');
const ytTitleInput = document.getElementById('yt-title');
const ytDescInput = document.getElementById('yt-desc');
const btnUploadYt = document.getElementById('btn-upload-yt');
const btnDownloadVideo = document.getElementById('btn-download-video');

let generatedVideoPath = ''; // Store absolute path of generated video on local backend
let backendUrl = localStorage.getItem('backend_url') || 'http://localhost:3000';
// Serverless fallback: the Pages Function runs on the same origin as the dashboard,
// so it is always reachable even when the local backend / tunnel is down.
const SERVERLESS_SCRIPT_URL = `${window.location.origin}/api/generate-script`;

// Fetch the synchronized backend URL from Cloud KV on page load
async function initializeBackendUrl() {
  // If there's a backend param in the URL, use it directly (highest priority)
  const urlParams = new URLSearchParams(window.location.search);
  const backendParam = urlParams.get('backend');
  if (backendParam) {
    backendUrl = backendParam.replace(/\/$/, '');
    localStorage.setItem('backend_url', backendUrl);
    logToTerminal(`[System] Connected to URL-specified backend: ${backendUrl}`, 'system');
    return;
  }

  // Otherwise, fetch the latest synced URL from the cloud
  try {
    const response = await fetch('https://keyvalue.immanuel.co/api/KeyVal/GetValue/8d5ycaxi/backend_url');
    if (response.ok) {
      const hex = await response.json();
      if (hex) {
        // Decode Hex to string
        const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const url = new TextDecoder().decode(bytes);
        
        if (url && url.trim().startsWith('http')) {
          backendUrl = url.trim();
          logToTerminal(`[System] Connected to cloud-synced backend: ${backendUrl}`, 'system');
          localStorage.setItem('backend_url', backendUrl);
        }
      }
    }
  } catch (err) {
    console.warn('Failed to load cloud backend URL, using cached/default:', err);
  }
}

// Check whether a backend URL is actually reachable by hitting its health endpoint.
async function isBackendAlive(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${url}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch (err) {
    return false;
  }
}

initializeBackendUrl();

// Get base URL for backend APIs
function getBackendUrl() {
  return backendUrl;
}

// Get the endpoint for script generation
function getScriptGenUrl() {
  return `${getBackendUrl()}/api/generate-script`;
}

// Append new message line in terminal logger
function logToTerminal(message, type = 'normal') {
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.innerText = message;
  terminalLogs.appendChild(line);
  terminalLogs.scrollTop = terminalLogs.scrollHeight; // Auto-scroll to bottom
}

// Step 1: Request script generation
btnGenerateScript.addEventListener('click', async () => {
  const topic = topicInput.value.trim();
  if (!topic) {
    alert('Please enter a topic first.');
    return;
  }

  btnGenerateScript.disabled = true;
  logToTerminal(`[System] Sending topic "${topic}" to Cloudflare AI for script generation...`, 'system');
  try {
    // Try the local backend first. If it is unreachable, transparently fall back
    // to the serverless Pages Function so script generation never hard-fails.
    let response;
    let usedServerless = false;

    if (await isBackendAlive(getBackendUrl())) {
      response = await fetch(getScriptGenUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic })
      });
    } else {
      logToTerminal(`[System] Local backend unreachable. Falling back to serverless AI...`, 'system');
      usedServerless = true;
      response = await fetch(SERVERLESS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic })
      });
    }

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to generate script');
    }

    const data = await response.json();
    scriptEditor.value = JSON.stringify(data.script, null, 2);
    
    logToTerminal(usedServerless
      ? '✅ Script generated via serverless AI! Please verify on the left editor.'
      : '✅ Script and image prompts generated successfully! Please verify on the left editor.', 'success');
    btnRunPipeline.disabled = false;
    
    // Set initial title and description draft
    ytTitleInput.value = topic;
    ytDescInput.value = `This video was generated automatically using Auto YouTube AI on the topic: ${topic}\n\n#AI #AutoYouTube`;

  } catch (err) {
    logToTerminal(`❌ Generation failed: ${err.message}`, 'error');
  } finally {
    btnGenerateScript.disabled = false;
  }
});

// Step 2: Trigger the automation pipeline (via SSE)
btnRunPipeline.addEventListener('click', () => {
  const scriptContent = scriptEditor.value.trim();
  if (!scriptContent) return;

  // Verify JSON format
  try {
    JSON.parse(scriptContent);
  } catch (e) {
    alert('Invalid JSON script format. Please fix the structure first.');
    return;
  }

  // UI State Reset
  btnRunPipeline.disabled = true;
  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  terminalLogs.innerHTML = '';
  logToTerminal('[System] Connecting to local backend pipeline...', 'system');

  const encodedScript = encodeURIComponent(scriptContent);
  const eventSource = new EventSource(`${getBackendUrl()}/api/run-pipeline?script=${encodedScript}`);

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.message) {
      logToTerminal(data.message);
    }
    
    if (data.percent) {
      progressBar.style.width = `${data.percent}%`;
    }

    // Success state
    if (data.status === 'done') {
      eventSource.close();
      progressBar.style.width = '100%';
      logToTerminal('🎉 Pipeline finished. Video render completed!', 'success');
      
      // Update preview video
      const videoSrc = `${getBackendUrl()}${data.videoUrl}`;
      videoPlayer.src = videoSrc;
      videoPlayer.load();
      
      // Setup download button
      btnDownloadVideo.href = videoSrc;
      btnDownloadVideo.style.display = 'inline-flex';
      
      // Save local path for upload
      generatedVideoPath = data.videoPath;
      btnUploadYt.disabled = false;
      btnRunPipeline.disabled = false;
    }

    // Error state
    if (data.status === 'error') {
      eventSource.close();
      logToTerminal(`❌ Pipeline failed: ${data.error}`, 'error');
      btnRunPipeline.disabled = false;
    }
  };

  eventSource.onerror = (err) => {
    eventSource.close();
    logToTerminal('❌ Backend server connection closed or timed out.', 'error');
    btnRunPipeline.disabled = false;
  };
});

// Step 3: Trigger YouTube Studio upload
btnUploadYt.addEventListener('click', async () => {
  const title = ytTitleInput.value.trim();
  const description = ytDescInput.value.trim();

  if (!title) {
    alert('Please enter a video title.');
    return;
  }

  btnUploadYt.disabled = true;
  logToTerminal('[System] Launching browser session for YouTube Studio...', 'system');

  try {
    const response = await fetch(`${getBackendUrl()}/api/upload-youtube`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoPath: generatedVideoPath,
        title,
        description
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Upload request failed');
    }

    const data = await response.json();
    data.logs.forEach(log => logToTerminal(`  [YT] ${log}`));
    logToTerminal('🎉 YouTube Studio upload completed! Draft saved.', 'success');

  } catch (err) {
    logToTerminal(`❌ YouTube upload failed: ${err.message}`, 'error');
  } finally {
    btnUploadYt.disabled = false;
  }
});
