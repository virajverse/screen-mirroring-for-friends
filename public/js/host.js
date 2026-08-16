// Host / Broadcaster WebRTC and UI Controller
(function () {
  const socket = io();
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('room') || 'default';

  // DOM Elements
  const toggleStreamBtn = document.getElementById('toggleStreamBtn');
  const toggleBtnText = document.getElementById('toggleBtnText');
  const playIcon = toggleStreamBtn.querySelector('.play-icon');
  const stopIcon = toggleStreamBtn.querySelector('.stop-icon');
  const statusBadge = document.getElementById('connectionStatusBadge');
  const statusText = document.getElementById('statusText');
  const previewContainer = document.getElementById('previewContainer');
  const previewEmpty = document.getElementById('previewEmpty');
  const videoWrapper = document.getElementById('videoWrapper');
  const hostPreviewVideo = document.getElementById('hostPreviewVideo');
  const laserCanvas = document.getElementById('laserCanvas');
  const qrImage = document.getElementById('qrImage');
  const qrLoading = document.getElementById('qrLoading');
  const viewerUrlInput = document.getElementById('viewerUrlInput');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const openViewerTabBtn = document.getElementById('openViewerTabBtn');
  const shareAudioToggle = document.getElementById('shareAudioToggle');
  const networkSelectGroup = document.getElementById('networkSelectGroup');
  const networkIpSelect = document.getElementById('networkIpSelect');
  const viewersList = document.getElementById('viewersList');
  const viewerCountPill = document.getElementById('viewerCountPill');
  const emptyViewersMsg = document.getElementById('emptyViewersMsg');
  const statResolution = document.getElementById('statResolution');
  const statFps = document.getElementById('statFps');
  const toastContainer = document.getElementById('toastContainer');
  const qualityButtons = document.querySelectorAll('.quality-card');

  // State
  let localStream = null;
  let isStreaming = false;
  let selectedQuality = '1080p60';
  const peerConnections = new Map(); // viewerId -> RTCPeerConnection
  const iceCandidateQueues = new Map(); // viewerId -> [candidate]
  const connectedViewers = new Map(); // viewerId -> info

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

  // Quality Profiles
  const qualityProfiles = {
    '1080p60': { width: 1920, height: 1080, frameRate: 60 },
    '4k': { width: 3840, height: 2160, frameRate: 30 },
    '720p60': { width: 1280, height: 720, frameRate: 60 },
    'low': { width: 1280, height: 720, frameRate: 30 }
  };

  // Show Toast
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Load Network & QR Info
  async function loadNetworkInfo() {
    try {
      const res = await fetch('/api/info');
      const data = await res.json();

      let targetViewerUrl = data.viewerUrl;
      if (roomId && roomId !== 'default') {
        targetViewerUrl += (targetViewerUrl.includes('?') ? '&' : '?') + `room=${encodeURIComponent(roomId)}`;
      }

      viewerUrlInput.value = targetViewerUrl;
      openViewerTabBtn.href = targetViewerUrl;
      qrImage.src = data.qrDataUrl;
      qrLoading.style.display = 'none';
      qrImage.style.display = 'block';

      if (data.allIps && data.allIps.length > 1) {
        networkSelectGroup.style.display = 'block';
        networkIpSelect.innerHTML = data.allIps.map(item => {
          let u = item.url;
          if (roomId && roomId !== 'default') u += `?room=${encodeURIComponent(roomId)}`;
          return `<option value="${u}">${item.interface} (${item.ip})</option>`;
        }).join('');

        networkIpSelect.addEventListener('change', (e) => {
          viewerUrlInput.value = e.target.value;
          openViewerTabBtn.href = e.target.value;
        });
      }
    } catch (err) {
      console.error('Failed to load network info', err);
      viewerUrlInput.value = window.location.origin + '/viewer' + (roomId !== 'default' ? `?room=${encodeURIComponent(roomId)}` : '');
    }
  }

  // Copy Viewer URL
  copyUrlBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(viewerUrlInput.value).then(() => {
      showToast('📋 Link copied to clipboard!');
    }).catch(() => {
      viewerUrlInput.select();
      document.execCommand('copy');
      showToast('📋 Link copied!');
    });
  });

  // Quality Selection
  qualityButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      qualityButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedQuality = btn.dataset.quality;

      if (isStreaming) {
        showToast('⚙️ Quality will apply to next screen capture');
      }
    });
  });

  // Start Screen Capture
  async function startScreenMirroring() {
    try {
      const profile = qualityProfiles[selectedQuality] || qualityProfiles['1080p60'];
      const captureAudio = shareAudioToggle.checked;

      const constraints = {
        video: {
          cursor: 'always',
          displaySurface: 'monitor',
          width: { ideal: profile.width, max: profile.width },
          height: { ideal: profile.height, max: profile.height },
          frameRate: { ideal: profile.frameRate, max: 60 }
        },
        audio: captureAudio ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000
        } : false
      };

      localStream = await navigator.mediaDevices.getDisplayMedia(constraints);
      
      // Update UI
      isStreaming = true;
      toggleBtnText.textContent = 'Stop Screen Mirroring';
      toggleStreamBtn.classList.add('streaming');
      playIcon.style.display = 'none';
      stopIcon.style.display = 'inline-block';
      statusBadge.className = 'status-badge status-live';
      statusText.textContent = 'Live Streaming 60 FPS';

      previewEmpty.style.display = 'none';
      videoWrapper.style.display = 'block';
      hostPreviewVideo.srcObject = localStream;

      initLaserCanvas();

      // Read stream track info
      const videoTrack = localStream.getVideoTracks()[0];
      const settings = videoTrack.getSettings();
      statResolution.textContent = `${settings.width || profile.width}x${settings.height || profile.height}`;
      statFps.textContent = `${settings.frameRate || profile.frameRate} FPS`;

      // Handle user stopping share via browser native banner
      videoTrack.onended = () => {
        stopScreenMirroring();
      };

      // Notify viewers stream is live
      socket.emit('stream-state', { isStreaming: true });

      // Connect any waiting viewers
      connectedViewers.forEach((_, viewerId) => {
        createPeerConnectionForViewer(viewerId);
      });

      showToast('🚀 Screen Mirroring Started!');
    } catch (err) {
      console.error('Error starting screen capture:', err);
      if (err.name !== 'NotAllowedError') {
        alert('Could not start screen capture: ' + err.message);
      }
    }
  }

  // Stop Screen Capture
  function stopScreenMirroring() {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }

    // Close all viewer peer connections
    peerConnections.forEach((pc) => pc.close());
    peerConnections.clear();

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

  // Toggle Stream Button
  toggleStreamBtn.addEventListener('click', () => {
    if (isStreaming) {
      stopScreenMirroring();
    } else {
      startScreenMirroring();
    }
  });

  // WebRTC: Create Peer Connection for a Viewer
  async function createPeerConnectionForViewer(viewerId) {
    if (!localStream) return;

    if (peerConnections.has(viewerId)) {
      try {
        peerConnections.get(viewerId).close();
      } catch (e) {}
      peerConnections.delete(viewerId);
    }
    iceCandidateQueues.set(viewerId, []);

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections.set(viewerId, pc);

    // Add all local audio & video tracks to PeerConnection
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });

    // Send ICE candidates to viewer
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          target: viewerId,
          candidate: event.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[Viewer ${viewerId}] Connection state:`, pc.connectionState);
      if (pc.connectionState === 'failed') {
        console.log(`[Viewer ${viewerId}] Retrying connection via ICE restart`);
        pc.restartIce && pc.restartIce();
      } else if (pc.connectionState === 'disconnected') {
        setTimeout(() => {
          if (pc.connectionState === 'disconnected') {
            pc.close();
            peerConnections.delete(viewerId);
          }
        }, 3000);
      }
    };

    try {
      // Create Offer with low-latency constraints
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      });
      await pc.setLocalDescription(offer);

      socket.emit('webrtc-offer', {
        targetViewerId: viewerId,
        sdp: pc.localDescription
      });
      console.log(`[Host] Sent WebRTC offer to ${viewerId}`);
    } catch (err) {
      console.error(`Error creating WebRTC offer for ${viewerId}:`, err);
    }
  }

  // Render Connected Viewers
  function updateViewersUI() {
    const count = connectedViewers.size;
    viewerCountPill.textContent = `${count} Active`;

    if (count === 0) {
      viewersList.innerHTML = `
        <div class="empty-viewers" id="emptyViewersMsg">
          <p>No phone connected yet. Scan the QR code above to start mirroring!</p>
        </div>
      `;
    } else {
      viewersList.innerHTML = '';
      connectedViewers.forEach((info, viewerId) => {
        const card = document.createElement('div');
        card.className = 'viewer-card';
        const device = info.deviceInfo || {};
        const deviceName = device.isMobile ? (device.os || 'Android Phone') : 'Browser Client';
        
        card.innerHTML = `
          <div class="viewer-card-info">
            <span class="viewer-dot"></span>
            <div>
              <div class="viewer-device-name">${deviceName}</div>
              <div class="viewer-meta">${device.browser || 'Chrome'} • Live WebRTC</div>
            </div>
          </div>
          <span class="badge badge-success">Live</span>
        `;
        viewersList.appendChild(card);
      });
    }
  }

  // Socket.IO Events
  socket.on('connect', () => {
    console.log('[Host] Connected to signaling server');
    socket.emit('host-join', { roomId });
  });

  socket.on('host-ready', (data) => {
    console.log('[Host Ready] Room registered:', data);
    if (data.viewers && data.viewers.length > 0) {
      data.viewers.forEach(v => {
        connectedViewers.set(v.viewerId, { deviceInfo: v.deviceInfo, joinedAt: Date.now() });
        if (isStreaming && localStream) {
          createPeerConnectionForViewer(v.viewerId);
        }
      });
      updateViewersUI();
    }
  });

  // When a new mobile viewer connects
  socket.on('viewer-connected', ({ viewerId, deviceInfo }) => {
    console.log(`[Viewer Connected] ID: ${viewerId}`, deviceInfo);
    connectedViewers.set(viewerId, { deviceInfo, joinedAt: Date.now() });
    updateViewersUI();
    showToast(`📱 Phone connected!`);

    if (isStreaming && localStream) {
      createPeerConnectionForViewer(viewerId);
    }
  });

  // When a viewer disconnects
  socket.on('viewer-disconnected', ({ viewerId }) => {
    console.log(`[Viewer Disconnected] ID: ${viewerId}`);
    connectedViewers.delete(viewerId);
    iceCandidateQueues.delete(viewerId);
    if (peerConnections.has(viewerId)) {
      try {
        peerConnections.get(viewerId).close();
      } catch (e) {}
      peerConnections.delete(viewerId);
    }
    updateViewersUI();
  });

  // Handle WebRTC Answer from Viewer
  socket.on('webrtc-answer', async ({ viewerId, sdp }) => {
    const pc = peerConnections.get(viewerId);
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        console.log(`[Host] Set remote description for viewer ${viewerId}`);

        // Drain queued ICE candidates from viewer
        const queue = iceCandidateQueues.get(viewerId) || [];
        for (const candidate of queue) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error('[Host] Error draining queued ICE candidate:', e);
          }
        }
        iceCandidateQueues.set(viewerId, []);
      } catch (err) {
        console.error(`Error setting remote description for ${viewerId}:`, err);
      }
    }
  });

  // Handle ICE Candidate from Viewer
  socket.on('ice-candidate', async ({ sender, candidate }) => {
    if (!candidate) return;
    const pc = peerConnections.get(sender);
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Error adding received ICE candidate on host:', err);
      }
    } else {
      if (!iceCandidateQueues.has(sender)) {
        iceCandidateQueues.set(sender, []);
      }
      iceCandidateQueues.get(sender).push(candidate);
    }
  });

  // Handle Laser Pointer from Viewer
  socket.on('laser-pointer', ({ viewerId, x, y }) => {
    laserPointers.set(viewerId, {
      x,
      y,
      timestamp: Date.now()
    });
  });

  // Initial setup
  loadNetworkInfo();
})();
