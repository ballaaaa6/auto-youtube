// ดึง Element ต่าง ๆ
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

let generatedVideoPath = ''; // เก็บที่อยู่ไฟล์วิดีโอสัมบูรณ์บนเซิร์ฟเวอร์โลคอล

// ฟังก์ชันดึง URL เซิร์ฟเวอร์หลังบ้าน
function getBackendUrl() {
  return backendUrlInput.value.replace(/\/$/, ''); // ตัด / ตัวสุดท้ายออกหากมี
}

// ฟังก์ชันเพิ่มบรรทัดข้อความลงใน Terminal Log
function logToTerminal(message, type = 'normal') {
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.innerText = message;
  terminalLogs.appendChild(line);
  terminalLogs.scrollTop = terminalLogs.scrollHeight; // สกรอลลงล่างสุดอัตโนมัติ
}

// สเต็ปที่ 1: เจนสคริปต์จากหัวข้อ
btnGenerateScript.addEventListener('click', async () => {
  const topic = topicInput.value.trim();
  if (!topic) {
    alert('กรุณากรอกหัวข้อที่ต้องการครับ');
    return;
  }

  btnGenerateScript.disabled = true;
  logToTerminal(`[ระบบ] กำลังส่งหัวข้อ "${topic}" ให้ Cloudflare AI เขียนบทความ...`, 'system');
  
  try {
    const response = await fetch(`${getBackendUrl()}/api/generate-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'เกิดข้อผิดพลาดในการเจนสคริปต์');
    }

    const data = await response.json();
    scriptEditor.value = JSON.stringify(data.script, null, 2);
    
    logToTerminal('✅ เขียนบทความและ Prompt เจนภาพสำเร็จ! กรุณาตรวจสอบข้อมูลในซีกซ้ายด้านล่าง', 'success');
    btnRunPipeline.disabled = false;
    
    // ตั้งชื่อคลิปเบื้องต้นรอไว้
    ytTitleInput.value = topic;
    ytDescInput.value = `วิดีโอนี้สร้างขึ้นด้วยระบบ Auto YouTube AI ในหัวข้อเรื่อง: ${topic}\n\n#AI #AutoYouTube`;

  } catch (err) {
    logToTerminal(`❌ เจนสคริปต์ล้มเหลว: ${err.message}`, 'error');
  } finally {
    btnGenerateScript.disabled = false;
  }
});

// สเต็ปที่ 2: รัน Pipeline บอทอัตโนมัติทั้งหมด (สตรีมผ่าน SSE)
btnRunPipeline.addEventListener('click', () => {
  const scriptContent = scriptEditor.value.trim();
  if (!scriptContent) return;

  // ตรวจเช็คว่าแก้ไขจนรูปแบบ JSON เจ๊งไหม
  try {
    JSON.parse(scriptContent);
  } catch (e) {
    alert('รูปแบบบทความ JSON ไม่ถูกต้อง กรุณาแก้ไชข้อผิดพลาดก่อนเริ่มรันบอท');
    return;
  }

  // เตรียม UI
  btnRunPipeline.disabled = true;
  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  terminalLogs.innerHTML = '';
  logToTerminal('[ระบบ] เริ่มเชื่อมต่อข้อมูลระบบบอทเบื้องหลัง...', 'system');

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

    // เมื่อรันจบเรียบร้อย
    if (data.status === 'done') {
      eventSource.close();
      progressBar.style.width = '100%';
      logToTerminal('🎉 บอทรันระบบครบวงจรและเรนเดอร์คลิปวิดีโอสำเร็จ!', 'success');
      
      // อัปเดต Video Player พรีวิว
      const videoSrc = `${getBackendUrl()}${data.videoUrl}`;
      videoPlayer.src = videoSrc;
      videoPlayer.load();
      
      // ปุ่มดาวน์โหลด
      btnDownloadVideo.href = videoSrc;
      btnDownloadVideo.style.display = 'inline-flex';
      
      // เก็บข้อมูลพาธไฟล์เพื่อใช้อัปโหลด
      generatedVideoPath = data.videoPath;
      btnUploadYt.disabled = false;
      btnRunPipeline.disabled = false;
    }

    // กรณีบอทค้างหรือเกิดข้อผิดพลาด
    if (data.status === 'error') {
      eventSource.close();
      logToTerminal(`❌ บอททำงานล้มเหลวระหว่างทาง: ${data.error}`, 'error');
      btnRunPipeline.disabled = false;
    }
  };

  eventSource.onerror = (err) => {
    eventSource.close();
    logToTerminal('❌ ขัดข้องการเชื่อมต่อกับเซิร์ฟเวอร์หลังบ้าน (Connection Closed/Error)', 'error');
    btnRunPipeline.disabled = false;
  };
});

// สเต็ปที่ 3: อัปโหลดคลิปขึ้น YouTube
btnUploadYt.addEventListener('click', async () => {
  const title = ytTitleInput.value.trim();
  const description = ytDescInput.value.trim();

  if (!title) {
    alert('กรุณากรอกชื่อคลิปวิดีโอที่จะอัปโหลด');
    return;
  }

  btnUploadYt.disabled = true;
  logToTerminal('[ระบบ] เริ่มการเปิดเบราว์เซอร์เตรียมส่งขึ้น YouTube Studio...', 'system');

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
      throw new Error(err.error || 'เกิดข้อผิดพลาดในการอัปโหลด');
    }

    const data = await response.json();
    data.logs.forEach(log => logToTerminal(`  [YT] ${log}`));
    logToTerminal('🎉 ดำเนินการอัปโหลด YouTube Studio Draft เรียบร้อยเสร็จสิ้น!', 'success');

  } catch (err) {
    logToTerminal(`❌ อัปโหลด YouTube ล้มเหลว: ${err.message}`, 'error');
  } finally {
    btnUploadYt.disabled = false;
  }
});
