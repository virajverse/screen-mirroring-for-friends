// Host / Broadcaster - Canvas Frame Streaming via Socket.IO
(function () {
  const socket = io(window.location.origin, { transports: ['websocket', 'polling'] });
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('room') || 'default';

  // DOM Elements
  const toggleStreamBtn = document.getElementById('toggleStreamBtn');
  const toggleBtnText   = document.getElementById('toggleBtnText');
  const playIcon        = toggleStreamBtn.querySelector('.play-icon');
  const stopIcon        = toggleStreamBtn.querySelector('.stop-icon');
  const statusBadge     = document.getElementById('connectionStatusBadge');
  const statusText      = document.getElementById('statusText');
  const previewEmpty    = document.getElementById('previewEmpty');
  const videoWrapper    = document.getElementById('videoWrapper');
  const hostPreviewVideo = document.getElementById('hostPreviewVideo');
  const qrImage         = document.getElementById('qrImage');
  const qrLoading       = document.getElementById('qrLoading');
  const viewerUrlInput  = document.getElementById('viewerUrlInput');
  const copyUrlBtn      = document.getElementById('copyUrlBtn');
  const openViewerTabBtn = document.getElementById('openViewerTabBtn');
  const shareAudioToggle = document.getElementById('shareAudioToggle');
  const networkSelectGroup = document.getElementById('networkSelectGroup');
  const networkIpSelect = document.getElementById('networkIpSelect');
  const viewersList     = document.getElementById('viewersList');
  const viewerCountPill = document.getElementById('viewerCountPill');
  const statResolution  = document.getElementById('statResolution');
  const statFps         = document.getElementById('statFps');
  const toastContainer  = document.getElementById('toastContainer');
  const qualityButtons  = document.querySelectorAll('.quality-card');

  // State
  let localStream       = null;
  let isStreaming       = false;
  let selectedQuality   = '720p';
  let captureInterval   = null;
  let frameCount        = 0;
  let lastFpsTime       = Date.now();
  const connectedViewers = new Map();

  // Hidden video + canvas for frame capture
  const captureVideo  = document.createElement('video');
  const captureCanvas = document.createElement('canvas');
  const captureCtx    = captureCanvas.getContext('2d');
  captureVideo.muted  = true;
  captureVideo.playsInline = true;

  // Quality Profiles
  const qualityProfiles = {
    '1080p60': { width: 1280, height: 720, fps: 20, jpegQ: 0.75, label: '720p / 20fps' },
    '4k'     : { width: 1920, height: 1080, fps: 15, jpegQ: 0.70, label: '1080p / 15fps' },
    '720p60' : { width: 1280, height: 720,  fps: 25, jpegQ: 0.75, label: '720p / 25fps' },
    'low'    : { width: 854,  height: 480,  fps: 15, jpegQ: 0.60, label: '480p / 15fps' }
  };

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    toastContainer.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(10px)'; t.style.transition = 'all .3s'; setTimeout(() => t.remove(), 300); }, 3000);
  }

  // ── Network / QR Info ─────────────────────────────────────────────────────
  async function loadNetworkInfo() {
    try {
      const data = await fetch('/api/info').then(r => r.json());
      let url = data.viewerUrl;
      if (roomId !== 'default') url += `?room=${encodeURIComponent(roomId)}`;
      viewerUrlInput.value = url;
      openViewerTabBtn.href = url;
      qrImage.src = data.qrDataUrl;
      qrLoading.style.display = 'none';
      qrImage.style.display = 'block';
    } catch {
      viewerUrlInput.value = window.location.origin + '/viewer';
    }
  }

  // ── Copy URL ──────────────────────────────────────────────────────────────
  copyUrlBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(viewerUrlInput.value).then(() => showToast('📋 Link copied!')).catch(() => { viewerUrlInput.select(); document.execCommand('copy'); showToast('📋 Link copied!'); });
  });

  // ── Quality Cards ─────────────────────────────────────────────────────────
  qualityButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      qualityButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedQuality = btn.dataset.quality;
      if (isStreaming) showToast('⚙️ Quality changes on next start');
    });
  });

  // ── Start Frame Streaming ─────────────────────────────────────────────────
  async function startScreenMirroring() {
    try {
      const profile = qualityProfiles[selectedQuality] || qualityProfiles['720p60'];
      const captureAudio = shareAudioToggle.checked;

      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: captureAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false
      });

      // Show preview
      hostPreviewVideo.srcObject = localStream;
      previewEmpty.style.display = 'none';
      videoWrapper.style.display = 'block';
      isStreaming = true;

      // UI
      toggleBtnText.textContent = 'Stop Screen Mirroring';
      toggleStreamBtn.classList.add('streaming');
      playIcon.style.display = 'none';
      stopIcon.style.display = 'inline-block';
      statusBadge.className = 'status-badge status-live';
      statusText.textContent = 'Live Streaming';

      // Setup capture
      captureVideo.srcObject = localStream;
      captureVideo.play();

      socket.emit('stream-state', { isStreaming: true });

      // Start frame capture loop
      startFrameCapture(profile);

      localStream.getVideoTracks()[0].onended = stopScreenMirroring;
      showToast('🚀 Screen Mirroring Started!');
    } catch (err) {
      console.error('[Host] Start failed:', err);
      if (err.name !== 'NotAllowedError') alert('Could not start screen capture: ' + err.message);
    }
  }

  // ── Frame Capture Loop ────────────────────────────────────────────────────
  function startFrameCapture(profile) {
    if (captureInterval) clearInterval(captureInterval);

    const interval = Math.round(1000 / profile.fps);
    const maxW = profile.width;
    const maxH = profile.height;
    const quality = profile.jpegQ;

    captureInterval = setInterval(() => {
      if (!captureVideo.videoWidth || !isStreaming) return;

      // Scale down to target resolution
      let w = captureVideo.videoWidth;
      let h = captureVideo.videoHeight;
      const ratio = Math.min(maxW / w, maxH / h, 1);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);

      captureCanvas.width  = w;
      captureCanvas.height = h;
      captureCtx.drawImage(captureVideo, 0, 0, w, h);

      captureCanvas.toBlob(blob => {
        if (!blob || !socket.connected || connectedViewers.size === 0) return;
        blob.arrayBuffer().then(buf => socket.emit('video-frame', buf));
      }, 'image/jpeg', quality);

      // FPS counter
      frameCount++;
      const now = Date.now();
      if (now - lastFpsTime >= 1000) {
        statFps.textContent = `${frameCount} FPS`;
        statResolution.textContent = `${w}x${h}`;
        frameCount = 0;
        lastFpsTime = now;
      }
    }, interval);
  }

  // ── Stop ──────────────────────────────────────────────────────────────────
  function stopScreenMirroring() {
    if (captureInterval) { clearInterval(captureInterval); captureInterval = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }

    captureVideo.srcObject = null;
    isStreaming = false;
    toggleBtnText.textContent = 'Start Screen Mirroring';
    toggleStreamBtn.classList.remove('streaming');
    playIcon.style.display = 'inline-block';
    stopIcon.style.display = 'none';
    statusBadge.className = 'status-badge status-idle';
    statusText.textContent = 'Ready to Cast';
    hostPreviewVideo.srcObject = null;
    videoWrapper.style.display = 'none';
    previewEmpty.style.display = 'flex';
    statResolution.textContent = '--';
    statFps.textContent = '-- FPS';
    socket.emit('stream-state', { isStreaming: false });
    showToast('⏹️ Screen Mirroring Stopped');
  }

  toggleStreamBtn.addEventListener('click', () => isStreaming ? stopScreenMirroring() : startScreenMirroring());

  // ── Viewer UI ─────────────────────────────────────────────────────────────
  function updateViewersUI() {
    const count = connectedViewers.size;
    viewerCountPill.textContent = `${count} Active`;
    if (count === 0) {
      viewersList.innerHTML = '<div class="empty-viewers"><p>No phone connected yet. Scan the QR code above!</p></div>';
    } else {
      viewersList.innerHTML = '';
      connectedViewers.forEach((info) => {
        const d = info.deviceInfo || {};
        const card = document.createElement('div');
        card.className = 'viewer-card';
        card.innerHTML = `<div class="viewer-card-info"><span class="viewer-dot"></span><div><div class="viewer-device-name">${d.isMobile ? (d.os || 'Phone') : 'Browser'}</div><div class="viewer-meta">${d.browser || 'Chrome'} · Socket.IO Live</div></div></div><span class="badge badge-success">Live</span>`;
        viewersList.appendChild(card);
      });
    }
  }

  // ── Socket Events ─────────────────────────────────────────────────────────
  socket.on('connect', () => {
    console.log('[Host] Connected:', socket.id);
    socket.emit('host-join', { roomId });
  });

  socket.on('host-ready', (data) => {
    console.log('[Host] Ready:', data);
    if (data.viewers?.length) {
      data.viewers.forEach(v => connectedViewers.set(v.viewerId, { deviceInfo: v.deviceInfo }));
      updateViewersUI();
    }
  });

  socket.on('viewer-connected', ({ viewerId, deviceInfo }) => {
    connectedViewers.set(viewerId, { deviceInfo });
    updateViewersUI();
    showToast('📱 Phone connected! Starting stream...');
    // If already streaming, viewer will auto-receive frames
  });

  socket.on('viewer-disconnected', ({ viewerId }) => {
    connectedViewers.delete(viewerId);
    updateViewersUI();
  });

  loadNetworkInfo();
})();
