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
   STABILIZED index.js
========================== */
let queue = []; 

function removeFromQueue(socketId) {
    const index = queue.findIndex(p => p.socket.id === socketId);
    if (index !== -1) {
        clearTimeout(queue[index].timeout); // Stop the 30s timer
        queue.splice(index, 1);
        console.log(`Removed ${socketId} from queue.`);
    }
}

io.on("connection", socket => {
    socket.on("join_search", () => {
        // 1. Clean up any existing presence for this user
        removeFromQueue(socket.id);

        // 2. Try to match
        if (queue.length > 0) {
            const opponent = queue.shift();
            clearTimeout(opponent.timeout);

            const roomId = `room_${opponent.socket.id}_${socket.id}`;
            
            socket.join(roomId);
            opponent.socket.join(roomId);

            io.to(roomId).emit("match_found", { room: roomId });
            console.log(`Match Created: ${roomId}`);
        } else {
            // 3. Add to queue with a safe timeout
            const timeout = setTimeout(() => {
                socket.emit("no_match");
                removeFromQueue(socket.id);
            }, 30000);

            queue.push({ socket, timeout });
        }
    });

    socket.on("disconnect", () => {
        removeFromQueue(socket.id);
    });
});
