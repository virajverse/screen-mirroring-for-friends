const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 5 * 1024 * 1024 // 5MB max per message (for video frames)
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

function getNetworkIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ interface: name, ip: iface.address });
      }
    }
  }
  return ips;
}

function getPrimaryIP() {
  const ips = getNetworkIPs();
  if (ips.length === 0) return 'localhost';
  const wifi = ips.find(i => /wi-?fi|wlan|wireless/i.test(i.interface));
  if (wifi) return wifi.ip;
  const eth = ips.find(i => /ethernet|eth/i.test(i.interface));
  if (eth) return eth.ip;
  return ips[0].ip;
}

app.get('/api/info', async (req, res) => {
  try {
    const hostHeader = req.get('host') || `localhost:${PORT}`;
    const protocol = req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const allIps = getNetworkIPs();
    const isLocal = hostHeader.includes('localhost') || hostHeader.includes('127.0.0.1') || allIps.some(i => hostHeader.includes(i.ip));
    const viewerUrl = isLocal ? `http://${getPrimaryIP()}:${PORT}/viewer` : `${protocol}://${hostHeader}/viewer`;
    const qrDataUrl = await QRCode.toDataURL(viewerUrl, { width: 280, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } });
    res.json({ port: PORT, primaryIp: getPrimaryIP(), viewerUrl, qrDataUrl, isCloud: !isLocal, allIps: allIps.map(i => ({ ...i, url: `http://${i.ip}:${PORT}/viewer` })) });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/viewer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

// ─── Room State ────────────────────────────────────────────────────────────────
const rooms = new Map();

io.on('connection', (socket) => {
  let userRole = null;
  let currentRoom = null;

  // HOST joins
  socket.on('host-join', ({ roomId = 'default' }) => {
    userRole = 'host';
    currentRoom = roomId;
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, { hostSocketId: socket.id, isStreaming: false, viewers: new Map() });
    } else {
      rooms.get(roomId).hostSocketId = socket.id;
    }

    const room = rooms.get(roomId);
    const existingViewers = [];
    room.viewers.forEach((v, id) => existingViewers.push({ viewerId: id, deviceInfo: v.deviceInfo }));

    socket.emit('host-ready', { roomId, viewerCount: room.viewers.size, viewers: existingViewers });
    socket.to(roomId).emit('host-status', { isHostOnline: true, isStreaming: room.isStreaming });
    console.log(`[Host Joined] Room: ${roomId} | Viewers: ${existingViewers.length}`);
  });

  // VIEWER joins
  socket.on('viewer-join', ({ roomId = 'default', deviceInfo = {} }) => {
    userRole = 'viewer';
    currentRoom = roomId;
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, { hostSocketId: null, isStreaming: false, viewers: new Map() });
    }

    const room = rooms.get(roomId);
    room.viewers.set(socket.id, { joinedAt: Date.now(), deviceInfo });

    socket.emit('host-status', { isHostOnline: !!room.hostSocketId, isStreaming: room.isStreaming });

    if (room.hostSocketId) {
      io.to(room.hostSocketId).emit('viewer-connected', {
        viewerId: socket.id, deviceInfo, viewerCount: room.viewers.size
      });
    }
    console.log(`[Viewer Joined] Room: ${roomId} | Host online: ${!!room.hostSocketId}`);
  });

  // STREAM STATE
  socket.on('stream-state', (data) => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.isStreaming = !!data.isStreaming;
      socket.to(currentRoom).emit('stream-state', data);
      socket.to(currentRoom).emit('host-status', { isHostOnline: true, isStreaming: room.isStreaming });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // VIDEO FRAME RELAY  (Canvas → Socket.IO → Viewer)
  // Host sends compressed JPEG frames; server relays to all viewers in room.
  // ──────────────────────────────────────────────────────────────────────────
  socket.on('video-frame', (frameData) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('video-frame', frameData);
    }
  });

  // VIEWER DISCONNECT / CONNECT notifications
  socket.on('viewer-connected-ack', ({ viewerId }) => {
    // viewer acknowledged – host can start sending frames
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    if (!currentRoom || !rooms.has(currentRoom)) return;
    const room = rooms.get(currentRoom);

    if (userRole === 'host') {
      room.hostSocketId = null;
      room.isStreaming = false;
      io.to(currentRoom).emit('host-status', { isHostOnline: false, isStreaming: false });
      io.to(currentRoom).emit('stream-stopped');
      console.log(`[Host Disconnected] Room: ${currentRoom}`);
    } else {
      room.viewers.delete(socket.id);
      if (room.hostSocketId) {
        io.to(room.hostSocketId).emit('viewer-disconnected', { viewerId: socket.id, viewerCount: room.viewers.size });
      }
      console.log(`[Viewer Disconnected] Room: ${currentRoom} | Remaining: ${room.viewers.size}`);
    }

    if (!room.hostSocketId && room.viewers.size === 0) rooms.delete(currentRoom);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 PC SCREEN MIRRORING SERVER RUNNING`);
  console.log(`💻 Host Dashboard : http://localhost:${PORT}`);
  console.log(`📱 Mobile Viewer  : http://${getPrimaryIP()}:${PORT}/viewer`);
  console.log(`======================================================\n`);
});
