// Android & Mobile WebRTC Viewer Controller
(function () {
  const socket = io();
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('room') || 'default';

  // DOM Elements
  const viewerHeader = document.getElementById('viewerHeader');
  const floatingDock = document.getElementById('floatingDock');
  const liveDot = document.getElementById('liveDot');
  const streamStateTag = document.getElementById('streamStateTag');
  const remoteVideo = document.getElementById('remoteVideo');
  const transformContainer = document.getElementById('transformContainer');
  const laserTouchLayer = document.getElementById('laserTouchLayer');
  const waitingState = document.getElementById('waitingState');
  const waitingTitle = document.getElementById('waitingTitle');
  const waitingDesc = document.getElementById('waitingDesc');
  const audioUnmuteOverlay = document.getElementById('audioUnmuteOverlay');
  const unmuteAudioBtn = document.getElementById('unmuteAudioBtn');
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
  const laserModeBtn = document.getElementById('laserModeBtn');
  const audioToggleBtn = document.getElementById('audioToggleBtn');
  const audioOnIcon = document.getElementById('audioOnIcon');
  const audioOffIcon = document.getElementById('audioOffIcon');
  const resetZoomBtn = document.getElementById('resetZoomBtn');
  const zoomLevelLabel = document.getElementById('zoomLevelLabel');
  const snapshotBtn = document.getElementById('snapshotBtn');
  const fitModeBtn = document.getElementById('fitModeBtn');
  const fitModeLabel = document.getElementById('fitModeLabel');
  const toastContainer = document.getElementById('toastContainer');

  // WebRTC State
  let peerConnection = null;
  let remoteStream = null;
  let hostSocketId = null;
  let isHostStreaming = false;
  let isRemoteDescriptionSet = false;
  let pendingIceCandidates = [];

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

  // Features State
  let isLaserMode = false;
  let isMuted = true;
  let isControlsHidden = false;
  let wakeLockSentinel = null;
  let isFitCover = false;
  let statsInterval = null;
  let lastDecodedFrames = 0;
  let lastStatsTime = Date.now();

  // Multi-STUN Server configuration for robust Internet & LAN WebRTC
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ],
    iceCandidatePoolSize: 10
  };

  // Helper: Toast Message
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

  // Request Screen WakeLock (Keep phone screen ON)
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockBtn.classList.add('active');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockBtn.classList.remove('active');
        });
        console.log('[WakeLock] Screen wake lock acquired');
      } catch (err) {
        console.log('[WakeLock] Failed:', err);
      }
    }
  }

  // Re-request wake lock when user switches tabs back
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

  // Apply Transform (Pinch Zoom & Pan)
  function updateTransform() {
    transformContainer.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    zoomLevelLabel.textContent = `${Math.round(scale * 100)}%`;
    hudZoom.textContent = `${scale.toFixed(1)}x`;
  }

  // Reset Zoom
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

  // Fit / Cover Mode
  fitModeBtn.addEventListener('click', () => {
    isFitCover = !isFitCover;
    if (isFitCover) {
      remoteVideo.classList.add('fit-cover');
      fitModeLabel.textContent = 'Fill';
      showToast('Mode: Fill Screen');
    } else {
      remoteVideo.classList.remove('fit-cover');
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
      // Attempt lock orientation to landscape on Android
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

  // Toggle Controls Visibility (Tap background)
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

  // Audio Toggle
  audioToggleBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    remoteVideo.muted = isMuted;
    if (isMuted) {
      audioOnIcon.style.display = 'none';
      audioOffIcon.style.display = 'block';
      showToast('Audio Muted');
    } else {
      audioOnIcon.style.display = 'block';
      audioOffIcon.style.display = 'none';
      showToast('Audio Unmuted');
    }
  });

  unmuteAudioBtn.addEventListener('click', () => {
    remoteVideo.muted = false;
    remoteVideo.play().then(() => {
      audioUnmuteOverlay.style.display = 'none';
      audioOnIcon.style.display = 'block';
      audioOffIcon.style.display = 'none';
      showToast('🔊 Audio Enabled');
    }).catch(err => console.log('Audio play error:', err));
  });

  // Laser Pointer Mode Toggle
  laserModeBtn.addEventListener('click', () => {
    isLaserMode = !isLaserMode;
    if (isLaserMode) {
      laserModeBtn.classList.add('laser-active');
      showToast('🔴 Laser Pointer Active (Tap screen to point)');
    } else {
      laserModeBtn.classList.remove('laser-active');
      showToast('Laser Pointer Off');
    }
  });

  // Snapshot / Screenshot Tool
  snapshotBtn.addEventListener('click', () => {
    if (!remoteVideo.videoWidth) {
      showToast('No active video stream');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = remoteVideo.videoWidth;
    canvas.height = remoteVideo.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(remoteVideo, 0, 0, canvas.width, canvas.height);

    const link = document.createElement('a');
    link.download = `aircast-screenshot-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('📸 Screenshot Saved!');
  });

  // Telemetry HUD Toggle
  toggleHudBtn.addEventListener('click', () => {
    const isVisible = telemetryHud.style.display !== 'none';
    telemetryHud.style.display = isVisible ? 'none' : 'flex';
    toggleHudBtn.classList.toggle('active', !isVisible);
  });

  // Gesture Controls: Pinch-to-Zoom & Drag Pan
  const stage = document.getElementById('viewerStage');

  function getDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function emitLaserPoint(clientX, clientY) {
    const rect = remoteVideo.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      const normX = (clientX - rect.left) / rect.width;
      const normY = (clientY - rect.top) / rect.height;
      socket.emit('laser-pointer', { x: normX, y: normY });
      createTouchRipple(clientX, clientY);
    }
  }

  function createTouchRipple(x, y) {
    const ripple = document.createElement('div');
    ripple.style.position = 'fixed';
    ripple.style.left = `${x - 15}px`;
    ripple.style.top = `${y - 15}px`;
    ripple.style.width = '30px';
    ripple.style.height = '30px';
    ripple.style.borderRadius = '50%';
    ripple.style.background = 'rgba(255, 42, 95, 0.6)';
    ripple.style.boxShadow = '0 0 15px #ff2a5f';
    ripple.style.pointerEvents = 'none';
    ripple.style.zIndex = '999';
    ripple.style.transition = 'all 0.4s ease-out';
    document.body.appendChild(ripple);

    requestAnimationFrame(() => {
      ripple.style.transform = 'scale(2.5)';
      ripple.style.opacity = '0';
    });
    setTimeout(() => ripple.remove(), 400);
  }

  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      // 2 Finger Pinch Start
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

      // Laser Pointer trigger
      if (isLaserMode) {
        emitLaserPoint(touch.clientX, touch.clientY);
      }
    }
  }, { passive: false });

  stage.addEventListener('touchmove', (e) => {
    e.preventDefault();

    if (e.touches.length === 2) {
      // 2 Finger Pinch Move
      const currentDist = getDistance(e.touches[0], e.touches[1]);
      if (startTouchDistance > 0) {
        const factor = currentDist / startTouchDistance;
        scale = Math.min(Math.max(1, startScale * factor), 4); // Clamp 1.0x to 4.0x
        if (scale === 1) {
          panX = 0;
          panY = 0;
        }
        updateTransform();
      }
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      if (isLaserMode) {
        emitLaserPoint(touch.clientX, touch.clientY);
      } else if (scale > 1 && isDragging) {
        // Pan when zoomed in
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        panX = startPanX + dx;
        panY = startPanY + dy;
        updateTransform();
      }
    }
  }, { passive: false });

  stage.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      isDragging = false;

      // Double Tap detection for Zoom
      const currentTime = Date.now();
      const tapGap = currentTime - lastTapTime;
      if (tapGap < 300 && tapGap > 0) {
        // Double tap!
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
        // Single tap outside controls toggles UI
        if (!isLaserMode && !e.target.closest('.floating-dock') && !e.target.closest('.viewer-header')) {
          // Delay single tap slightly to not conflict with double tap
          setTimeout(() => {
            if (Date.now() - lastTapTime >= 280) {
              toggleControls();
            }
          }, 290);
        }
      }
    }
  });

  // WebRTC Setup
  function initWebRTC() {
    if (peerConnection) {
      try {
        peerConnection.close();
      } catch (e) {}
    }

    isRemoteDescriptionSet = false;
    pendingIceCandidates = [];
    peerConnection = new RTCPeerConnection(rtcConfig);

    // Explicitly add transceivers for receiving video and audio
    try {
      peerConnection.addTransceiver('video', { direction: 'recvonly' });
      peerConnection.addTransceiver('audio', { direction: 'recvonly' });
    } catch (e) {
      console.log('[Viewer] addTransceiver fallback:', e);
    }

    peerConnection.ontrack = (event) => {
      console.log('[Viewer] Track received:', event.track.kind);
      
      if (event.streams && event.streams[0]) {
        remoteStream = event.streams[0];
        remoteVideo.srcObject = remoteStream;
      } else {
        if (!remoteStream) {
          remoteStream = new MediaStream();
          remoteVideo.srcObject = remoteStream;
        }
        remoteStream.addTrack(event.track);
      }

      // Hide waiting state & activate live indicator
      waitingState.style.display = 'none';
      liveDot.classList.add('active');
      streamStateTag.textContent = 'LIVE';
      streamStateTag.classList.add('live');

      // Play video (always muted initially for 100% Android autoplay compliance)
      remoteVideo.muted = true;
      const playPromise = remoteVideo.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          requestWakeLock();
          startTelemetryStats();
          // Prompt user to tap if they want audio
          audioUnmuteOverlay.style.display = 'block';
        }).catch((err) => {
          console.log('[Autoplay Error]', err);
          remoteVideo.muted = true;
          remoteVideo.play().then(() => {
            audioUnmuteOverlay.style.display = 'block';
          });
        });
      }
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && hostSocketId) {
        socket.emit('ice-candidate', {
          target: hostSocketId,
          candidate: event.candidate
        });
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log('[Viewer] PeerConnection State:', peerConnection.connectionState);
      if (peerConnection.connectionState === 'connected') {
        liveDot.classList.add('active');
        streamStateTag.textContent = 'LIVE';
        streamStateTag.classList.add('live');
        waitingState.style.display = 'none';
      } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
        liveDot.classList.remove('active');
        streamStateTag.textContent = 'Reconnecting';
        streamStateTag.classList.remove('live');
      }
    };
  }

  // Telemetry Monitor
  function startTelemetryStats() {
    if (statsInterval) clearInterval(statsInterval);

    statsInterval = setInterval(async () => {
      if (!peerConnection || !remoteVideo.videoWidth) return;

      hudRes.textContent = `${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`;

      if (peerConnection.getStats) {
        const stats = await peerConnection.getStats();
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            const now = Date.now();
            const timeDiff = (now - lastStatsTime) / 1000;
            const framesDiff = (report.framesDecoded || 0) - lastDecodedFrames;

            if (timeDiff > 0 && framesDiff >= 0) {
              const fps = Math.round(framesDiff / timeDiff);
              hudFps.textContent = `${fps || 60} FPS`;
            }

            lastDecodedFrames = report.framesDecoded || 0;
            lastStatsTime = now;
          }

          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (report.currentRoundTripTime) {
              hudPing.textContent = `${Math.round(report.currentRoundTripTime * 1000)} ms`;
            } else {
              hudPing.textContent = '< 20 ms';
            }
          }
        });
      }
    }, 1000);
  }

  // Socket.IO Handlers
  socket.on('connect', () => {
    console.log('[Viewer] Connected to signaling server, ID:', socket.id);
    const deviceInfo = getDeviceInfo();
    socket.emit('viewer-join', { roomId, deviceInfo });
  });

  socket.on('host-status', ({ isHostOnline, isStreaming }) => {
    console.log('[Viewer] Host status:', { isHostOnline, isStreaming });
    if (isHostOnline) {
      if (isStreaming) {
        waitingTitle.textContent = 'Host is Live';
        waitingDesc.textContent = 'Connecting to 60 FPS stream...';
      } else {
        waitingTitle.textContent = 'Host Connected';
        waitingDesc.textContent = 'Waiting for laptop to click "Start Screen Mirroring"...';
      }
    } else {
      waitingTitle.textContent = 'Host Offline';
      waitingDesc.textContent = 'Please open the AirCast dashboard on your laptop.';
    }
  });

  // Handle WebRTC Offer from Host
  socket.on('webrtc-offer', async ({ hostId, sdp }) => {
    hostSocketId = hostId;
    console.log('[Viewer] Received WebRTC offer from host:', hostId);

    initWebRTC();

    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      isRemoteDescriptionSet = true;
      console.log('[Viewer] Remote description set successfully');

      // Drain all queued ICE candidates
      while (pendingIceCandidates.length > 0) {
        const cand = pendingIceCandidates.shift();
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
          console.log('[Viewer] Drained queued ICE candidate');
        } catch (e) {
          console.error('[Viewer] Error adding queued ICE candidate:', e);
        }
      }

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      socket.emit('webrtc-answer', {
        targetHostId: hostId,
        sdp: peerConnection.localDescription
      });
      console.log('[Viewer] Sent WebRTC answer to host');
    } catch (err) {
      console.error('[Viewer] Error handling WebRTC offer:', err);
    }
  });

  // Handle ICE Candidate from Host
  socket.on('ice-candidate', async ({ sender, candidate }) => {
    if (!candidate) return;
    if (peerConnection && isRemoteDescriptionSet) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[Viewer] Error adding ICE candidate:', err);
      }
    } else {
      pendingIceCandidates.push(candidate);
      console.log('[Viewer] Queued ICE candidate before remote description');
    }
  });

  // Stream State Update
  socket.on('stream-state', ({ isStreaming }) => {
    isHostStreaming = isStreaming;
    if (!isStreaming) {
      waitingState.style.display = 'flex';
      waitingTitle.textContent = 'Stream Paused';
      waitingDesc.textContent = 'Host stopped screen mirroring.';
      liveDot.classList.remove('active');
      streamStateTag.textContent = 'Paused';
      streamStateTag.classList.remove('live');
    }
  });

})();
