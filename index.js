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

let queue = [];

function removeFromQueue(socketId) {
  const index = queue.findIndex(p => p.socket.id === socketId);
  if (index !== -1) {
    clearTimeout(queue[index].timeout); // Crucial: clear timeout to prevent memory leaks
    queue.splice(index, 1);
  }
}

io.on("connection", (socket) => {
  console.log(`⚡ Connected: ${socket.id}`);

  socket.on("join_search", () => {
    removeFromQueue(socket.id);

    if (queue.length > 0) {
      const opponent = queue.shift();
      clearTimeout(opponent.timeout);

      const roomId = `room_${opponent.socket.id}_${socket.id}`;
      
      // Force both to join the room
      socket.join(roomId);
      opponent.socket.join(roomId);

      // Emit to room (Standard practice)
      io.to(roomId).emit("match_found", { 
        room: roomId,
        opponent: opponent.socket.id // Good to send metadata
      });
      
      console.log(`✅ Match: ${roomId}`);
    } else {
      console.log(`⏳ Queueing: ${socket.id}`);
      
      const timeout = setTimeout(() => {
        socket.emit("no_match");
        removeFromQueue(socket.id);
      }, 30000);

      queue.push({ socket, timeout });
    }
  });

  socket.on("disconnect", () => {
    console.log(`❌ Disconnected: ${socket.id}`);
    removeFromQueue(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
