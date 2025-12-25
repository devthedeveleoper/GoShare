package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/gorilla/websocket"
)

// --- Data Structures ---
type SignalMessage struct {
	Type   string          `json:"type"`   // "join", "offer", "answer", "candidate"
	RoomID string          `json:"roomId"` // Which room is this for?
	Data   json.RawMessage `json:"data"`   // WebRTC Payload
}

// --- Global State ---
var (
	// Map stores active connections: RoomID -> List of Connections
	rooms = make(map[string][]*websocket.Conn)
	mutex = &sync.Mutex{}
	// Upgrader configures the WebSocket handshake
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
)

// --- Handler ---
func handleConnections(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade Error:", err)
		return
	}
	defer ws.Close()

	var currentRoomID string

	// Listen for messages
	for {
		var msg SignalMessage
		err := ws.ReadJSON(&msg)
		if err != nil {
			log.Printf("User disconnected: %v", err)
			cleanupUser(ws, currentRoomID) // Remove user from room on disconnect
			break
		}

		if msg.Type == "join" {
			currentRoomID = msg.RoomID
			handleJoin(ws, msg.RoomID)
		} else {
			// Relay "offer", "answer", "candidate" to the other peer
			broadcastToRoom(ws, msg)
		}
	}
}

// --- Logic ---
func handleJoin(ws *websocket.Conn, roomID string) {
	mutex.Lock()
	defer mutex.Unlock()

	// 1. Check if room is full (Max 2 peers)
	if len(rooms[roomID]) >= 2 {
		log.Printf("Room %s is full. Rejecting connection.", roomID)
		return
	}

	// 2. Add user to room
	rooms[roomID] = append(rooms[roomID], ws)
	log.Printf("User joined Room %s. Count: %d", roomID, len(rooms[roomID]))

	// 3. If room has 2 people, tell the NEW person to start the call
	if len(rooms[roomID]) == 2 {
		log.Printf("Room %s ready. Signaling start.", roomID)
		ws.WriteJSON(SignalMessage{Type: "ready"})
	}
}

func broadcastToRoom(sender *websocket.Conn, msg SignalMessage) {
	mutex.Lock()
	defer mutex.Unlock()

	peers := rooms[msg.RoomID]
	for _, client := range peers {
		// Send to the OTHER person, not the sender
		if client != sender {
			err := client.WriteJSON(msg)
			if err != nil {
				log.Printf("Write Error: %v", err)
				client.Close()
			}
		}
	}
}

func cleanupUser(ws *websocket.Conn, roomID string) {
	mutex.Lock()
	defer mutex.Unlock()

	if roomID == "" {
		return
	}

	clients := rooms[roomID]
	for i, client := range clients {
		if client == ws {
			// Remove the client from the slice
			rooms[roomID] = append(clients[:i], clients[i+1:]...)
			log.Printf("Cleaned up user from Room %s. Remaining: %d", roomID, len(rooms[roomID]))

			// Optional: delete room if empty
			if len(rooms[roomID]) == 0 {
				delete(rooms, roomID)
			}
			break
		}
	}
}

// --- Main ---
func main() {
	http.HandleFunc("/ws", handleConnections)

	// Health check for Render
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Go P2P Server Running"))
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Println("Server started on port :" + port)
	// Listen on 0.0.0.0 for Docker/Render compatibility
	err := http.ListenAndServe("0.0.0.0:"+port, nil)
	if err != nil {
		log.Fatal("ListenAndServe Error: ", err)
	}
}
