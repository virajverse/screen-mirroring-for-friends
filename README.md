# 🚀 AirCast - Real-Time Screen Mirroring for Friends

Ultra low-latency (<50ms) real-time WebRTC PC screen & audio mirroring to Android / Mobile devices or Web Browsers.

![WebRTC](https://img.shields.io/badge/WebRTC-60FPS-blue)
![Node.js](https://img.shields.io/badge/Node.js-v18+-green)
![Socket.IO](https://img.shields.io/badge/Socket.IO-v4.8-orange)
![License](https://img.shields.io/badge/License-MIT-purple)

---

## 🌟 Key Features

- ⚡ **Zero-Lag 60 FPS WebRTC Stream**: Real-time peer-to-peer screen capture (Full screen, specific window, or browser tab with system sound).
- 📱 **Android & Mobile First**:
  - **Pinch-to-Zoom & Pan**: Multi-touch 2-finger zoom (up to 400%) & drag navigation.
  - **Double-Tap Zoom**: Instant toggle between 100% and 220% zoom.
  - **Screen WakeLock**: Keeps phone display from sleeping while watching.
  - **OLED Dark Mode**: Pitch black UI for battery saving.
- 🔴 **Interactive Laser Pointer**: Tap anywhere on mobile screen to project a red laser point on the PC display.
- 📸 **1-Click Snapshot**: Capture instant high-resolution screenshots directly to mobile.
- 📲 **Instant QR Code & Auto-LAN Discovery**: Automatic Wi-Fi IP detection and scannable QR code.
- 🌐 **Room-Based Sharing**: Share unique room links (e.g. `?room=viraj123`) with multiple friends.

---

## 🚀 Quick Start (Local LAN)

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Server
```bash
npm start
```

### 3. Open in Browser
- **Laptop Host Dashboard**: `http://localhost:3000`
- **Mobile Viewer**: Scan the QR code on your laptop screen or open `http://<your-ip>:3000/viewer`

---

## ☁️ Deploy Free for Worldwide Friends

To share with friends across different Wi-Fi networks / cities:

### Deploy to Render.com (Recommended - 100% Free):
1. Create a free account at [render.com](https://render.com).
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repository `virajverse/screen-mirroring-for-friends`.
4. Set:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Click **Deploy**. Your permanent link will be generated (e.g. `https://my-screen-cast.onrender.com`).

---

## 🛠️ Tech Stack
- **Backend**: Node.js, Express, Socket.IO, QRCode, ip
- **Frontend**: Vanilla HTML5, CSS3 Glassmorphism, WebRTC (PeerConnection), WakeLock API
- **Transport**: WebRTC Data & Media Streams with STUN fallback
