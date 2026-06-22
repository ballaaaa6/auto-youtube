// Fetch DOM elements
const backendUrlInput = document.getElementById('backend-url');
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

// Get base URL for backend APIs
function getBackendUrl() {
  return backendUrlInput.value.replace(/\/$/, ''); // Remove trailing slash
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
    const response = await fetch(`${getBackendUrl()}/api/generate-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to generate script');
    }

    const data = await response.json();
    scriptEditor.value = JSON.stringify(data.script, null, 2);
    
    logToTerminal('✅ Script and image prompts generated successfully! Please verify on the left editor.', 'success');
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
