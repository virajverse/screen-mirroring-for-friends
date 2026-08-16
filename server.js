const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Helper to get all non-internal IPv4 LAN addresses
function getNetworkIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({
          interface: name,
          ip: iface.address
        });
      }
    }
  }
  return ips;
}

// Get preferred primary IP (Wi-Fi or first available LAN IP)
function getPrimaryIP() {
  const ips = getNetworkIPs();
  if (ips.length === 0) return 'localhost';
  
  // Prefer Wi-Fi or WLAN if available
  const wifi = ips.find(item => /wi-?fi|wlan|wireless/i.test(item.interface));
  if (wifi) return wifi.ip;
  
  // Prefer Ethernet
  const ethernet = ips.find(item => /ethernet|eth/i.test(item.interface));
  if (ethernet) return ethernet.ip;
  
  return ips[0].ip;
}

// API endpoint for connection information
app.get('/api/info', async (req, res) => {
  try {
    const hostHeader = req.get('host') || `localhost:${PORT}`;
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const primaryIp = getPrimaryIP();
    const allIps = getNetworkIPs();
    
    // Check if hosted on cloud (e.g. Render, Railway, custom domain)
    const isLocal = hostHeader.includes('localhost') || 
                    hostHeader.includes('127.0.0.1') || 
                    allIps.some(i => hostHeader.includes(i.ip));
    
    const viewerUrl = isLocal 
      ? `http://${primaryIp}:${PORT}/viewer`
      : `${protocol}://${hostHeader}/viewer`;
    
    // Generate QR Code data URL
    const qrDataUrl = await QRCode.toDataURL(viewerUrl, {
      width: 280,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    res.json({
      port: PORT,
      primaryIp,
      viewerUrl,
      qrDataUrl,
      isCloud: !isLocal,
      allIps: allIps.map(item => ({
        ...item,
        url: `http://${item.ip}:${PORT}/viewer`
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate network info' });
  }
});

// Route for viewer
app.get('/viewer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

// Store active rooms and their viewers
const rooms = new Map();

io.on('connection', (socket) => {
  let userRole = null;
  let currentRoom = null;

  // Host registers room
  socket.on('host-join', ({ roomId = 'default' }) => {
    userRole = 'host';
    currentRoom = roomId;
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        hostSocketId: socket.id,
        isStreaming: false,
        viewers: new Map()
      });
    } else {
      const r = rooms.get(roomId);
      r.hostSocketId = socket.id;
    }

    const roomInfo = rooms.get(roomId);
    
    // Convert existing viewers to array for host
    const existingViewers = [];
    roomInfo.viewers.forEach((v, id) => {
      existingViewers.push({ viewerId: id, deviceInfo: v.deviceInfo });
    });

    socket.emit('host-ready', {
      roomId,
      viewerCount: roomInfo.viewers.size,
      viewers: existingViewers
    });

    // Notify all viewers in room that host is online
    socket.to(roomId).emit('host-status', { 
      isHostOnline: true, 
      isStreaming: roomInfo.isStreaming 
    });

    console.log(`[Host Registered] Room: ${roomId}, Host Socket: ${socket.id}, Existing Viewers: ${existingViewers.length}`);
  });

  // Viewer joins room
  socket.on('viewer-join', ({ roomId = 'default', deviceInfo = {} }) => {
    userRole = 'viewer';
    currentRoom = roomId;
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        hostSocketId: null,
        isStreaming: false,
        viewers: new Map()
      });
    }

    const roomInfo = rooms.get(roomId);
    roomInfo.viewers.set(socket.id, {
      joinedAt: Date.now(),
      deviceInfo
    });

    const isHostOnline = !!roomInfo.hostSocketId;

    // Send immediate status to the viewer
    socket.emit('host-status', {
      isHostOnline,
      isStreaming: roomInfo.isStreaming
    });

    // Notify the host that a new viewer has joined
    if (isHostOnline) {
      io.to(roomInfo.hostSocketId).emit('viewer-connected', {
        viewerId: socket.id,
        deviceInfo,
        viewerCount: roomInfo.viewers.size
      });
    }

    console.log(`[Viewer Connected] Room: ${roomId}, Viewer: ${socket.id}, Host Online: ${isHostOnline}`);
  });

  // WebRTC Signaling: Offer from Host to a specific Viewer
  socket.on('webrtc-offer', ({ targetViewerId, sdp }) => {
    io.to(targetViewerId).emit('webrtc-offer', {
      hostId: socket.id,
      sdp
    });
  });

  // WebRTC Signaling: Answer from Viewer back to Host
  socket.on('webrtc-answer', ({ targetHostId, sdp }) => {
    io.to(targetHostId).emit('webrtc-answer', {
      viewerId: socket.id,
      sdp
    });
  });

  // WebRTC Signaling: ICE Candidate exchange
  socket.on('ice-candidate', ({ target, candidate }) => {
    if (target && candidate) {
      io.to(target).emit('ice-candidate', {
        sender: socket.id,
        candidate
      });
    }
  });

  // Laser Pointer event from Viewer to Host
  socket.on('laser-pointer', (data) => {
    if (currentRoom && rooms.has(currentRoom)) {
      const hostId = rooms.get(currentRoom).hostSocketId;
      if (hostId) {
        io.to(hostId).emit('laser-pointer', {
          viewerId: socket.id,
          ...data
        });
      }
    }
  });

  // Stream state update (Host started / stopped stream)
  socket.on('stream-state', (data) => {
    if (currentRoom && rooms.has(currentRoom)) {
      const r = rooms.get(currentRoom);
      r.isStreaming = !!data.isStreaming;
      socket.to(currentRoom).emit('stream-state', data);
      socket.to(currentRoom).emit('host-status', {
        isHostOnline: true,
        isStreaming: r.isStreaming
      });
    }
  });

  // Clean up on disconnect
  socket.on('disconnect', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const roomInfo = rooms.get(currentRoom);

      if (userRole === 'host') {
        roomInfo.hostSocketId = null;
        roomInfo.isStreaming = false;
        io.to(currentRoom).emit('host-status', { isHostOnline: false, isStreaming: false });
        console.log(`[Host Disconnected] Room: ${currentRoom}`);
      } else if (userRole === 'viewer') {
        roomInfo.viewers.delete(socket.id);
        if (roomInfo.hostSocketId) {
          io.to(roomInfo.hostSocketId).emit('viewer-disconnected', {
            viewerId: socket.id,
            viewerCount: roomInfo.viewers.size
          });
        }
        console.log(`[Viewer Disconnected] Room: ${currentRoom}, Remaining: ${roomInfo.viewers.size}`);
      }

      if (!roomInfo.hostSocketId && roomInfo.viewers.size === 0) {
        rooms.delete(currentRoom);
      }
    }
  });
});

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  const primaryIp = getPrimaryIP();
  console.log(`\n======================================================`);
  console.log(`🚀 PC SCREEN MIRRORING SERVER RUNNING`);
  console.log(`💻 Host Dashboard (Laptop): http://localhost:${PORT}`);
  console.log(`📱 Mobile Viewer (Android): http://${primaryIp}:${PORT}/viewer`);
  console.log(`======================================================\n`);
});
