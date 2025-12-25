# ⚡ GoShare P2P

A secure, high-performance **Peer-to-Peer file sharing application**.  
Transfer files of any size directly between devices without storing them on a server. Built with **Go** for low-latency signaling and **React (Vite)** for a modern, responsive frontend.

![Project Preview](https://via.placeholder.com/800x400?text=GoShare+Preview+Image) 
*(Replace this link with a screenshot of your app once deployed!)*

## 🚀 Features

* **Serverless Transfer:** Files stream directly from Peer A to Peer B using WebRTC. Data never touches the server.
* **Drag & Drop:** Modern UI supports dragging files directly into the browser.
* **Unlimited File Size:** Smart chunking allows sending gigabytes of data without crashing the browser.
* **Cross-Device:** Connect easily via **Room ID** or **QR Code** (Mobile supported).
* **Real-time Stats:** Live progress bars and speed indicators (MB/s).
* **Decoupled Architecture:** Separate backend (Go) and frontend (React) for scalable deployment.

---

## 🛠 Tech Stack

### **Frontend (`/client`)**
* **Framework:** React 19 + Vite
* **Styling:** CSS3 (Flexbox/Grid, Animations)
* **Key Libraries:** `react-router-dom`, `qrcode.react`
* **Protocol:** WebRTC (RTCPeerConnection, RTCDataChannel)

### **Backend (`/server`)**
* **Language:** Go (Golang)
* **WebSockets:** `github.com/gorilla/websocket`
* **Role:** Signaling Server (Matches peers, handles "handshake", then steps back)

---

## 📂 Project Structure

```text
p2p-share/
├── client/              # React Frontend
│   ├── src/             # Source code (App.jsx, CSS)
│   ├── public/          # Static assets
│   └── package.json     # Node dependencies
│
├── server/              # Go Backend
│   ├── main.go          # WebSocket Server Logic
│   └── go.mod           # Go module definitions
│
└── README.md            # You are here