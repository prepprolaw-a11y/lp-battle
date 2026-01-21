const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket"], // Stick to websocket for speed
  pingTimeout: 2000,         // Faster detection of dead clients
  pingInterval: 5000
});

/* =========================
   STABILIZED & OPTIMIZED index.js
========================== */
let queue = []; 

function removeFromQueue(socketId) {
    const index = queue.findIndex(p => p.socket.id === socketId);
    if (index !== -1) {
        clearTimeout(queue[index].timeout);
        queue.splice(index, 1);
        console.log(`🧹 Cleaned up: ${socketId}`);
    }
}

io.on("connection", socket => {
    console.log(`🔌 New connection: ${socket.id}`);

    socket.on("join_search", () => {
        removeFromQueue(socket.id); // Prevent double-queueing

        if (queue.length > 0) {
            const opponentData = queue.shift();
            const opponent = opponentData.socket;

            // Final safety check: Is the waiting player still there?
            if (!opponent || !opponent.connected) {
                console.log("⚠️ Opponent disconnected, searching again...");
                socket.emit("no_match");
removeFromQueue(socket.id);

            }

            clearTimeout(opponentData.timeout);

            const roomId = `room_${opponent.id}_${socket.id}`;
            
            socket.join(roomId);
            opponent.join(roomId);

            // Broadcast to both with extra metadata
            io.to(roomId).emit("match_found", { 
                room: roomId,
                players: [socket.id, opponent.id]
            });

            console.log(`✅ Match Created: ${roomId}`);
        } else {
            const timeout = setTimeout(() => {
                socket.emit("no_match");
                removeFromQueue(socket.id);
            }, 30000); // 30s limit

            queue.push({ socket, timeout });
            console.log(`⏳ ${socket.id} added to queue`);
        }
    });

    socket.on("disconnect", () => {
        removeFromQueue(socket.id);
        console.log(`❌ Disconnected: ${socket.id}`);
    });
});
