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

// New script-settings controls
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const settingsToggleArrow = document.getElementById('settings-toggle-arrow');
const durationSlider = document.getElementById('duration-slider');
const durationValue = document.getElementById('duration-value');
const languageSelect = document.getElementById('language-select');
const toneSelect = document.getElementById('tone-select');
const angleSelect = document.getElementById('angle-select');
const tierToggle = document.getElementById('tier-toggle');
const tierButtons = tierToggle.querySelectorAll('.tier-btn');

let selectedTier = 'standard'; // 'standard' | 'premium'
let activeCustomSelect = null;
const DEFAULT_LANGUAGE = 'thai';

function setFloatingUiState(selectRoot, isOpen) {
  const formGroup = selectRoot.closest('.form-group');
  const card = selectRoot.closest('.card');
  const editorColumn = selectRoot.closest('.editor-container');

  if (formGroup) formGroup.classList.toggle('has-floating-ui', isOpen);
  if (card) card.classList.toggle('has-floating-ui', isOpen);
  if (editorColumn) editorColumn.classList.toggle('has-floating-ui', isOpen);
}

function closeCustomSelect(selectRoot) {
  if (!selectRoot) return;
  selectRoot.classList.remove('open');
  const button = selectRoot.querySelector('.custom-select-button');
  const menu = selectRoot.querySelector('.custom-select-menu');
  if (button) button.setAttribute('aria-expanded', 'false');
  if (menu) menu.hidden = true;
  setFloatingUiState(selectRoot, false);
  if (activeCustomSelect === selectRoot) activeCustomSelect = null;
}

function updateCustomSelectLabel(nativeSelect) {
  const wrapper = nativeSelect.closest('.custom-select');
  if (!wrapper) return;

  const selectedOption = nativeSelect.options[nativeSelect.selectedIndex];
  const label = selectedOption ? selectedOption.textContent.trim() : '';
  const valueNode = wrapper.querySelector('.custom-select-value');
  if (valueNode) valueNode.textContent = label;

  wrapper.querySelectorAll('.custom-select-option').forEach(optionButton => {
    const isSelected = optionButton.dataset.value === nativeSelect.value;
    optionButton.classList.toggle('is-selected', isSelected);
    optionButton.setAttribute('aria-selected', String(isSelected));
  });
}

function buildCustomSelect(nativeSelect) {
  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select';

  nativeSelect.parentNode.insertBefore(wrapper, nativeSelect);
  wrapper.appendChild(nativeSelect);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'custom-select-button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `
    <span class="custom-select-value"></span>
    <span class="custom-select-arrow">▾</span>
  `;

  const menu = document.createElement('div');
  menu.className = 'custom-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  Array.from(nativeSelect.options).forEach((option, index) => {
    const optionButton = document.createElement('button');
    optionButton.type = 'button';
    optionButton.className = 'custom-select-option';
    optionButton.dataset.value = option.value;
    optionButton.setAttribute('role', 'option');
    optionButton.setAttribute('aria-selected', String(option.selected));
    optionButton.textContent = option.textContent.trim();

    if (index === 0) {
      optionButton.classList.add('is-placeholder');
    }

    optionButton.addEventListener('click', () => {
      nativeSelect.value = option.value;
      nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      updateCustomSelectLabel(nativeSelect);
      closeCustomSelect(wrapper);
      button.focus();
    });

    menu.appendChild(optionButton);
  });

  button.addEventListener('click', () => {
    const willOpen = !wrapper.classList.contains('open');
    if (activeCustomSelect && activeCustomSelect !== wrapper) {
      closeCustomSelect(activeCustomSelect);
    }
    wrapper.classList.toggle('open', willOpen);
    button.setAttribute('aria-expanded', String(willOpen));
    menu.hidden = !willOpen;
    setFloatingUiState(wrapper, willOpen);
    activeCustomSelect = willOpen ? wrapper : null;
  });

  nativeSelect.addEventListener('change', () => updateCustomSelectLabel(nativeSelect));

  wrapper.appendChild(button);
  wrapper.appendChild(menu);
  updateCustomSelectLabel(nativeSelect);
}

[languageSelect, toneSelect, angleSelect].forEach(buildCustomSelect);

document.addEventListener('click', (event) => {
  if (!activeCustomSelect) return;
  if (!activeCustomSelect.contains(event.target)) {
    closeCustomSelect(activeCustomSelect);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activeCustomSelect) {
    closeCustomSelect(activeCustomSelect);
  }
});

// --- Accordion open/close + persisted settings ---
const SETTINGS_KEY = 'script_settings_v1';

function loadSavedSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.duration) {
      durationSlider.value = saved.duration;
      durationValue.textContent = `${saved.duration} นาที`;
    }
    if (saved.language && saved.language !== 'auto') {
      languageSelect.value = saved.language;
    } else {
      languageSelect.value = DEFAULT_LANGUAGE;
    }
    if (saved.tone) toneSelect.value = saved.tone;
    if (saved.angle) angleSelect.value = saved.angle;
    if (saved.tier) {
      selectedTier = saved.tier;
      tierButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tier === selectedTier);
      });
    }
    if (saved.panelOpen) {
      settingsPanel.hidden = false;
      settingsPanel.classList.add('is-open');
      settingsToggleArrow.classList.add('open');
      settingsToggle.setAttribute('aria-expanded', 'true');
    }
  } catch (err) {
    console.warn('Failed to load saved script settings:', err);
  }
}

function saveSettings() {
  const data = {
    duration: durationSlider.value,
    language: languageSelect.value,
    tone: toneSelect.value,
    angle: angleSelect.value,
    tier: selectedTier,
    panelOpen: !settingsPanel.hidden,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
}

settingsToggle.addEventListener('click', () => {
  const isOpen = !settingsPanel.hidden;
  if (isOpen) {
    settingsPanel.classList.remove('is-open');
    settingsPanel.hidden = true;
  } else {
    settingsPanel.hidden = false;
    settingsPanel.classList.add('is-open');
  }
  settingsToggleArrow.classList.toggle('open', !isOpen);
  settingsToggle.setAttribute('aria-expanded', String(!isOpen));
  saveSettings();
});

durationSlider.addEventListener('input', () => {
  durationValue.textContent = `${durationSlider.value} นาที`;
  saveSettings();
});

[languageSelect, toneSelect, angleSelect].forEach(el => {
  el.addEventListener('change', saveSettings);
});

tierButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    selectedTier = btn.dataset.tier;
    tierButtons.forEach(b => b.classList.toggle('active', b === btn));
    saveSettings();
  });
});

loadSavedSettings();

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

  // If loaded from localhost or local file system, connect directly to local backend port
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:') {
    const defaultLocal = window.location.protocol === 'file:' ? 'http://localhost:3000' : window.location.origin;
    backendUrl = defaultLocal;
    localStorage.setItem('backend_url', backendUrl);
    logToTerminal(`[System] Connected to local backend: ${backendUrl}`, 'system');
    return;
  }

  // Otherwise, fetch the latest synced URL from the cloud
  try {
    const response = await fetch(`https://keyvalue.immanuel.co/api/KeyVal/GetValue/8d5ycaxi/backend_url?_t=${Date.now()}`);
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
    if (!res.ok) return false;
    
    // Ensure the response is JSON, not HTML (which is served by Cloudflare warning pages)
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return false;
    }
    
    const data = await res.json();
    return data && data.status === 'ok';
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

  const requestPayload = {
    topic,
    durationMinutes: parseInt(durationSlider.value, 10),
    language: languageSelect.value,
    tone: toneSelect.value,
    angle: angleSelect.value,
    tier: selectedTier                // 'standard' | 'premium'
  };

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
        body: JSON.stringify(requestPayload)
      });
    } else {
      logToTerminal(`[System] Local backend unreachable. Falling back to serverless AI...`, 'system');
      usedServerless = true;
      response = await fetch(SERVERLESS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
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
