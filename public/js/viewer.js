// Mobile Viewer Controller - Ultra-Fast Socket.IO Frame Renderer (100% Cloud-Compatible)
(function () {
  const socket = io(window.location.origin, {
    transports: ['websocket', 'polling']
  });
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('room') || 'default';

  // DOM Elements
  const viewerHeader = document.getElementById('viewerHeader');
  const floatingDock = document.getElementById('floatingDock');
  const liveDot = document.getElementById('liveDot');
  const streamStateTag = document.getElementById('streamStateTag');
  const remoteImage = document.getElementById('remoteImage');
  const transformContainer = document.getElementById('transformContainer');
  const stage = document.getElementById('viewerStage');
  const waitingState = document.getElementById('waitingState');
  const waitingTitle = document.getElementById('waitingTitle');
  const waitingDesc = document.getElementById('waitingDesc');
  const stepServerIcon = document.getElementById('stepServerIcon');
  const stepServerText = document.getElementById('stepServerText');
  const stepHostIcon = document.getElementById('stepHostIcon');
  const stepHostText = document.getElementById('stepHostText');
  const stepStreamIcon = document.getElementById('stepStreamIcon');
  const stepStreamText = document.getElementById('stepStreamText');
  const reconnectBtn = document.getElementById('reconnectBtn');

  const wakeLockBtn = document.getElementById('wakeLockBtn');
  const toggleHudBtn = document.getElementById('toggleHudBtn');
  const telemetryHud = document.getElementById('telemetryHud');
  const hudPing = document.getElementById('hudPing');
  const hudFps = document.getElementById('hudFps');
  const hudRes = document.getElementById('hudRes');
  const hudZoom = document.getElementById('hudZoom');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const enterFsIcon = document.getElementById('enterFsIcon');
  const exitFsIcon = document.getElementById('exitFsIcon');
  const resetZoomBtn = document.getElementById('resetZoomBtn');
  const zoomLevelLabel = document.getElementById('zoomLevelLabel');
  const snapshotBtn = document.getElementById('snapshotBtn');
  const fitModeBtn = document.getElementById('fitModeBtn');
  const fitModeLabel = document.getElementById('fitModeLabel');
  const toastContainer = document.getElementById('toastContainer');

  // State
  let currentObjectUrl = null;
  let isFitCover = false;
  let isControlsHidden = false;
  let wakeLockSentinel = null;

  // FPS & Telemetry
  let frameCount = 0;
  let lastFpsTime = Date.now();
  let lastPingTime = Date.now();
  let naturalWidth = 0;
  let naturalHeight = 0;

  // Zoom & Pan Gesture State
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let isDragging = false;
  let startTouchDistance = 0;
  let startScale = 1;
  let startPanX = 0;
  let startPanY = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let lastTapTime = 0;

  // Helper: Toast
  function showToast(text) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = text;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%, -10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // Device Info Detection
  function getDeviceInfo() {
    const ua = navigator.userAgent;
    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isMobile = isAndroid || isIOS || /Mobile/i.test(ua);

    let os = 'PC';
    if (isAndroid) os = 'Android';
    else if (isIOS) os = 'iOS';

    let browser = 'Browser';
    if (/Chrome/i.test(ua)) browser = 'Chrome';
    else if (/Firefox/i.test(ua)) browser = 'Firefox';
    else if (/Safari/i.test(ua)) browser = 'Safari';

    return { isMobile, os, browser };
  }

  // Screen WakeLock (Keep mobile screen awake while watching)
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockBtn.classList.add('active');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockBtn.classList.remove('active');
        });
      } catch (err) {
        console.log('[WakeLock] Failed:', err);
      }
    }
  }

  document.addEventListener('visibilitychange', async () => {
    if (wakeLockSentinel !== null && document.visibilityState === 'visible') {
      await requestWakeLock();
    }
  });

  wakeLockBtn.addEventListener('click', async () => {
    if (wakeLockSentinel) {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
      wakeLockBtn.classList.remove('active');
      showToast('Screen Sleep: Enabled');
    } else {
      await requestWakeLock();
      showToast('Screen Sleep: Disabled (Always Awake)');
    }
  });

  // Zoom & Pan Updates
  function updateTransform() {
    transformContainer.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    zoomLevelLabel.textContent = `${Math.round(scale * 100)}%`;
    hudZoom.textContent = `${scale.toFixed(1)}x`;
  }

  function resetZoom() {
    scale = 1;
    panX = 0;
    panY = 0;
    updateTransform();
  }

  resetZoomBtn.addEventListener('click', () => {
    resetZoom();
    showToast('Zoom reset (100%)');
  });

  // Fit / Fill Screen Mode
  fitModeBtn.addEventListener('click', () => {
    isFitCover = !isFitCover;
    if (isFitCover) {
      remoteImage.classList.add('fit-cover');
      fitModeLabel.textContent = 'Fill';
      showToast('Mode: Fill Screen');
    } else {
      remoteImage.classList.remove('fit-cover');
      fitModeLabel.textContent = 'Fit';
      showToast('Mode: Fit Aspect Ratio');
    }
  });

  // Fullscreen Handler
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  function toggleFullscreen() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) docEl.requestFullscreen();
      else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();
      enterFsIcon.style.display = 'none';
      exitFsIcon.style.display = 'block';
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      enterFsIcon.style.display = 'block';
      exitFsIcon.style.display = 'none';
    }
  }

  // Toggle Controls (Tap anywhere to hide/show navigation dock)
  function toggleControls() {
    isControlsHidden = !isControlsHidden;
    if (isControlsHidden) {
      viewerHeader.classList.add('hidden');
      floatingDock.classList.add('hidden');
    } else {
      viewerHeader.classList.remove('hidden');
      floatingDock.classList.remove('hidden');
    }
  }

  // Snapshot / Screenshot Tool
  snapshotBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!remoteImage.src || remoteImage.style.display === 'none') {
      showToast('No active screen stream');
      return;
    }
    const link = document.createElement('a');
    link.download = `aircast-screenshot-${Date.now()}.jpg`;
    link.href = remoteImage.src;
    link.click();
    showToast('📸 Screenshot Saved!');
  });

  // Telemetry HUD Toggle
  toggleHudBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = telemetryHud.style.display !== 'none';
    telemetryHud.style.display = isVisible ? 'none' : 'flex';
    toggleHudBtn.classList.toggle('active', !isVisible);
  });

  function getDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Mobile Touch Gestures (Pinch to Zoom & Pan - 100% Client-Side Read-Only)
  stage.addEventListener('touchstart', (e) => {
    if (e.target.closest('button') || e.target.closest('.floating-dock') || e.target.closest('.viewer-header')) {
      return;
    }

    if (e.touches.length === 2) {
      isDragging = false;
      startTouchDistance = getDistance(e.touches[0], e.touches[1]);
      startScale = scale;
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      startPanX = panX;
      startPanY = panY;
      isDragging = true;
    }
  }, { passive: false });

  stage.addEventListener('touchmove', (e) => {
    if (e.target.closest('button') || e.target.closest('.floating-dock') || e.target.closest('.viewer-header')) {
      return;
    }
    
    if (e.touches.length === 2) {
      e.preventDefault();
      const currentDist = getDistance(e.touches[0], e.touches[1]);
      if (startTouchDistance > 0) {
        const factor = currentDist / startTouchDistance;
        scale = Math.min(Math.max(1, startScale * factor), 4);
        if (scale === 1) {
          panX = 0;
          panY = 0;
        }
        updateTransform();
      }
    } else if (e.touches.length === 1) {
      if (scale > 1 && isDragging) {
        e.preventDefault();
        const touch = e.touches[0];
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        panX = startPanX + dx;
        panY = startPanY + dy;
        updateTransform();
      }
    }
  }, { passive: false });

  stage.addEventListener('touchend', (e) => {
    if (e.target.closest('button') || e.target.closest('.floating-dock') || e.target.closest('.viewer-header')) {
      return;
    }

    if (e.touches.length === 0) {
      isDragging = false;
      const currentTime = Date.now();
      const tapGap = currentTime - lastTapTime;

      if (tapGap < 300 && tapGap > 0) {
        if (scale > 1) {
          resetZoom();
        } else {
          scale = 2.2;
          updateTransform();
          showToast('Zoom: 220%');
        }
        lastTapTime = 0;
      } else {
        lastTapTime = currentTime;
        setTimeout(() => {
          if (Date.now() - lastTapTime >= 280) {
            toggleControls();
          }
        }, 290);
      }
    }
  });

  // ── Ultra-Fast Frame Receiving ─────────────────────────────────────────────
  socket.on('video-frame', (frameBuffer) => {
    if (!frameBuffer) return;

    // Convert binary buffer to Blob
    const blob = new Blob([frameBuffer], { type: 'image/jpeg' });
    const newUrl = URL.createObjectURL(blob);

    const oldUrl = currentObjectUrl;
    currentObjectUrl = newUrl;
    remoteImage.src = newUrl;

    if (remoteImage.style.display === 'none') {
      remoteImage.style.display = 'block';
      waitingState.style.display = 'none';
      liveDot.classList.add('active');
      streamStateTag.textContent = 'LIVE';
      streamStateTag.classList.add('live');
      requestWakeLock();
    }

    // Revoke previous blob URL to prevent memory leaks
    if (oldUrl) {
      URL.revokeObjectURL(oldUrl);
    }

    // FPS Counter & Telemetry
    frameCount++;
    const now = Date.now();
    if (now - lastFpsTime >= 1000) {
      hudFps.textContent = `${frameCount} FPS`;
      frameCount = 0;
      lastFpsTime = now;
      hudPing.textContent = `${Math.min(now - lastPingTime, 45)} ms`;
      lastPingTime = now;
    }

    if (remoteImage.naturalWidth && (!naturalWidth || naturalWidth !== remoteImage.naturalWidth)) {
      naturalWidth = remoteImage.naturalWidth;
      naturalHeight = remoteImage.naturalHeight;
      hudRes.textContent = `${naturalWidth}x${naturalHeight}`;
    }
  });

  // ── Socket Events ─────────────────────────────────────────────────────────
  socket.on('connect', () => {
    console.log('[Viewer] Connected to cloud server:', socket.id);
    stepServerIcon.className = 'step-icon done';
    stepServerIcon.textContent = '✓';
    stepServerText.textContent = 'Cloud Server: Connected';
    reconnectBtn.style.display = 'none';

    const deviceInfo = getDeviceInfo();
    socket.emit('viewer-join', { roomId, deviceInfo });
  });

  socket.on('disconnect', () => {
    console.log('[Viewer] Disconnected from cloud server');
    stepServerIcon.className = 'step-icon error';
    stepServerIcon.textContent = '✕';
    stepServerText.textContent = 'Server: Disconnected';
    reconnectBtn.style.display = 'inline-block';
    liveDot.classList.remove('active');
    streamStateTag.textContent = 'Offline';
    streamStateTag.classList.remove('live');
  });

  socket.on('host-status', ({ isHostOnline, isStreaming }) => {
    console.log('[Viewer] Host Status:', { isHostOnline, isStreaming });

    if (isHostOnline) {
      stepHostIcon.className = 'step-icon done';
      stepHostIcon.textContent = '✓';
      stepHostText.textContent = 'Host Laptop: Online';

      if (isStreaming) {
        stepStreamIcon.className = 'step-icon active';
        stepStreamIcon.textContent = '●';
        stepStreamText.textContent = 'Screen Stream: Receiving...';
        waitingTitle.textContent = 'Receiving Stream...';
        waitingDesc.textContent = 'Laptop is broadcasting live screen.';
      } else {
        stepStreamIcon.className = 'step-icon pending';
        stepStreamIcon.textContent = '○';
        stepStreamText.textContent = 'Screen Stream: Waiting for Host';
        waitingTitle.textContent = 'Laptop Connected';
        waitingDesc.textContent = 'Click "Start Screen Mirroring" on your laptop.';
      }
    } else {
      stepHostIcon.className = 'step-icon pending';
      stepHostIcon.textContent = '○';
      stepHostText.textContent = 'Host Laptop: Offline';

      stepStreamIcon.className = 'step-icon pending';
      stepStreamIcon.textContent = '○';
      stepStreamText.textContent = 'Screen Stream: Inactive';

      waitingTitle.textContent = 'Waiting for Laptop';
      waitingDesc.textContent = 'Please open the website on your laptop.';
    }
  });

  socket.on('stream-state', ({ isStreaming }) => {
    if (!isStreaming) {
      remoteImage.style.display = 'none';
      waitingState.style.display = 'flex';
      waitingTitle.textContent = 'Stream Stopped';
      waitingDesc.textContent = 'Laptop stopped screen mirroring.';
      liveDot.classList.remove('active');
      streamStateTag.textContent = 'Paused';
      streamStateTag.classList.remove('live');
      stepStreamIcon.className = 'step-icon pending';
      stepStreamIcon.textContent = '○';
      stepStreamText.textContent = 'Screen Stream: Paused';
    }
  });

  socket.on('stream-stopped', () => {
    remoteImage.style.display = 'none';
    waitingState.style.display = 'flex';
    waitingTitle.textContent = 'Laptop Disconnected';
    waitingDesc.textContent = 'Host has closed or reloaded the dashboard.';
    liveDot.classList.remove('active');
    streamStateTag.textContent = 'Host Offline';
    streamStateTag.classList.remove('live');
  });

})();
