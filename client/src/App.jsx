import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import './App.css';

// --- CONFIGURATION ---
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "localhost:8080";
const PROTOCOL = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const WS_URL = `${PROTOCOL}${BACKEND_URL}/ws`;

const CHUNK_SIZE = 16 * 1024; // 16KB chunks

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<Room />} />
      </Routes>
    </Router>
  );
}

// --- HOME SCREEN ---
function Home() {
  const [room, setRoom] = useState('');
  const navigate = useNavigate();

  const createRoom = () => {
    const id = Math.random().toString(36).substring(7);
    navigate(`/room/${id}`);
  };

  const joinRoom = () => {
    if(room) navigate(`/room/${room}`);
  };

  return (
    <div className="container center-screen">
      <div className="card home-card">
        <h1>⚡ GoShare P2P</h1>
        <p className="subtitle">Secure, Serverless File Transfer</p>
        <button onClick={createRoom} className="btn-primary">Create New Room</button>
        <div className="divider"><span>OR</span></div>
        <div className="join-group">
            <input 
              placeholder="Enter Room ID" 
              value={room} 
              onChange={(e) => setRoom(e.target.value)} 
            />
            <button onClick={joinRoom} className="btn-secondary">Join</button>
        </div>
      </div>
    </div>
  );
}

// --- ROOM SCREEN (Transfer Logic) ---
function Room() {
  const { roomId } = useParams();
  
  // UI State
  const [status, setStatus] = useState("Connecting...");
  const [isConnected, setIsConnected] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState("");
  const [speed, setSpeed] = useState("");
  const [isDragging, setIsDragging] = useState(false); 

  // WebRTC & Socket Refs
  const ws = useRef(null);
  const pc = useRef(null);
  const dc = useRef(null);
  const fileInput = useRef(null);
  
  // Stats Refs
  const lastBytesRef = useRef(0);
  const lastTimeRef = useRef(0);

  // Receiver Data Refs
  const rxInfo = useRef(null);
  const rxBuffer = useRef([]);
  const rxBytes = useRef(0);
  const downloadAnchor = useRef(null);

  useEffect(() => {
    console.log("🔌 Connecting to:", WS_URL);
    ws.current = new WebSocket(WS_URL);

    ws.current.onopen = () => {
      console.log("✅ WebSocket Connected");
      setStatus("Waiting for peer...");
      ws.current.send(JSON.stringify({ type: "join", roomId }));
    };

    ws.current.onmessage = async (e) => {
      const msg = JSON.parse(e.data);

      if (msg.type === "ready") {
        console.log("🚀 System Ready. Starting Call.");
        startCall();
      } 
      else if (msg.type === "offer") {
        handleOffer(msg.data);
      } 
      else if (msg.type === "answer") {
        pc.current.setRemoteDescription(msg.data);
      } 
      else if (msg.type === "candidate") {
        if (pc.current) {
          pc.current.addIceCandidate(msg.data);
        }
      }
    };

    return () => {
        if(ws.current) ws.current.close();
        if(pc.current) pc.current.close();
    };
  }, [roomId]);

  // --- WebRTC Logic ---
  const setupPC = () => {
    const rtc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    
    rtc.onicecandidate = (e) => {
      if (e.candidate) {
        ws.current.send(JSON.stringify({ 
          type: "candidate", 
          roomId, 
          data: e.candidate.toJSON() 
        }));
      }
    };

    rtc.ondatachannel = (e) => {
      setupDataChannel(e.channel);
    };

    pc.current = rtc;
    return rtc;
  };

  const setupDataChannel = (channel) => {
      dc.current = channel;
      channel.onopen = () => {
          setIsConnected(true); 
          setStatus("Peer Connected!"); 
      };
      channel.onmessage = handleReceiveMessage;
  };

  const startCall = async () => {
    const rtc = setupPC();
    const channel = rtc.createDataChannel("fileTransfer");
    setupDataChannel(channel);

    const offer = await rtc.createOffer();
    await rtc.setLocalDescription(offer);
    ws.current.send(JSON.stringify({ type: "offer", roomId, data: offer }));
  };

  const handleOffer = async (offer) => {
    const rtc = setupPC();
    await rtc.setRemoteDescription(offer);
    const answer = await rtc.createAnswer();
    await rtc.setLocalDescription(answer);
    ws.current.send(JSON.stringify({ type: "answer", roomId, data: answer }));
  };

  // --- Drag & Drop Handlers ---
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) processFile(files[0]);
  };

  const handleFileSelect = (e) => {
      if (e.target.files.length > 0) processFile(e.target.files[0]);
  };

  const processFile = (file) => {
      sendFile(file);
  };

  // --- UPDATED SEND FILE LOGIC (Safe for Production) ---
  const sendFile = async (file) => {
    if (!file || !dc.current) return;
    
    setFileName(`Sending: ${file.name}`);
    
    try {
        // Send Metadata
        dc.current.send(JSON.stringify({ type: 'meta', name: file.name, size: file.size }));
    } catch (err) {
        console.error("Error sending meta:", err);
        setStatus("Error: Connection lost");
        return;
    }

    const MAX_BUFFERED_AMOUNT = 64 * 1024; // 64KB Buffer Limit
    let offset = 0;
    
    lastBytesRef.current = 0;
    lastTimeRef.current = Date.now();

    try {
        while (offset < file.size) {
            // 1. Backpressure: Pause if buffer is full
            while (dc.current.bufferedAmount > MAX_BUFFERED_AMOUNT) {
                await new Promise(r => setTimeout(r, 10));
            }

            const slice = file.slice(offset, offset + CHUNK_SIZE);
            const buffer = await slice.arrayBuffer();

            // 2. Attempt Send with Retry
            try {
                dc.current.send(buffer);
                offset += CHUNK_SIZE;

                // Update Stats
                const percent = Math.min(100, (offset / file.size) * 100);
                setProgress(percent);
                updateSpeed(offset);
            } catch (error) {
                // If queue full, wait and retry
                if (error.name === 'OperationError' || error.message.includes('queue is full')) {
                    console.warn("Buffer full. Retrying...");
                    await new Promise(r => setTimeout(r, 200));
                    continue; // Loop again with same offset
                } else {
                    throw error; // Fatal error
                }
            }
        }
        setFileName("File Sent Successfully!");
        setSpeed("");
    } catch (err) {
        console.error("Transfer failed:", err);
        setStatus("Transfer interrupted.");
        setFileName("Error sending file");
    }
  };

  // --- File Receiving Logic ---
  const handleReceiveMessage = (e) => {
    const data = e.data;
    if (typeof data === 'string') {
        const msg = JSON.parse(data);
        if (msg.type === 'meta') {
            rxInfo.current = msg;
            rxBuffer.current = [];
            rxBytes.current = 0;
            setFileName(`Receiving: ${msg.name}`);
            lastBytesRef.current = 0;
            lastTimeRef.current = Date.now();
        }
    } else {
        rxBuffer.current.push(data);
        rxBytes.current += data.byteLength;
        const percent = (rxBytes.current / rxInfo.current.size) * 100;
        setProgress(percent);
        updateSpeed(rxBytes.current);

        if (rxBytes.current >= rxInfo.current.size) {
            const blob = new Blob(rxBuffer.current);
            const url = URL.createObjectURL(blob);
            downloadAnchor.current.href = url;
            downloadAnchor.current.download = rxInfo.current.name;
            downloadAnchor.current.click();
            setFileName("File Received!");
            setSpeed("");
        }
    }
  };

  const updateSpeed = (currentBytes) => {
      const now = Date.now();
      if (now - lastTimeRef.current >= 500) {
          const bytesDiff = currentBytes - lastBytesRef.current;
          const timeDiff = (now - lastTimeRef.current) / 1000;
          setSpeed(`${((bytesDiff / timeDiff) / (1024 * 1024)).toFixed(2)} MB/s`);
          lastTimeRef.current = now;
          lastBytesRef.current = currentBytes;
      }
  };

  return (
    <div className="container center-screen">
        <a ref={downloadAnchor} style={{display:'none'}} />
        <div className="card room-card">
            <h2>Room: <span className="highlight">{roomId}</span></h2>
            <div className={`status-badge ${isConnected ? 'green' : 'orange'}`}>
                {isConnected ? "Connected" : status}
            </div>

            {!isConnected ? (
                <div className="connect-area">
                    <div className="qr-wrapper"><QRCodeCanvas value={window.location.href} size={160} /></div>
                    <p>Scan to connect</p>
                    <button onClick={() => navigator.clipboard.writeText(window.location.href)} className="btn-secondary">Copy Invite Link</button>
                </div>
            ) : (
                <div className="transfer-area">
                    {/* DROP ZONE UI */}
                    {!progress ? (
                        <div 
                            className={`drop-zone ${isDragging ? 'dragging' : ''}`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={() => fileInput.current.click()}
                        >
                            <input 
                                type="file" 
                                ref={fileInput} 
                                style={{display: 'none'}} 
                                onChange={handleFileSelect} 
                            />
                            <div className="icon">☁️</div>
                            <p>Drag & Drop files here</p>
                            <span>or click to browse</span>
                        </div>
                    ) : (
                        <div className="progress-section">
                            <p>{fileName}</p>
                            <div className="progress-track">
                                <div className="progress-fill" style={{width: `${progress}%`}}></div>
                            </div>
                            <p className="speed-text">{Math.round(progress)}% - {speed}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    </div>
  );
}

export default App;
