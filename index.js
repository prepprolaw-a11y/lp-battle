/* index.js */
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket"] // Standard for fast battle connections
});

let queue = [];

function removeFromQueue(socketId) {
  const index = queue.findIndex(p => p.socket.id === socketId);
  if (index !== -1) {
    // CRITICAL: Clear the server timer before removing
    clearTimeout(queue[index].timeout);
    queue.splice(index, 1);
    console.log(`Cleared from queue: ${socketId}`);
  }
}

io.on("connection", (socket) => {
  socket.on("join_search", () => {
    removeFromQueue(socket.id); // Prevent duplicates

    if (queue.length > 0) {
      const opponent = queue.shift();
      clearTimeout(opponent.timeout);

      const roomId = `room_${opponent.socket.id}_${socket.id}`;
      socket.join(roomId);
      opponent.socket.join(roomId);

      io.to(roomId).emit("match_found", { room: roomId });
    } else {
      // Set server-side safety timeout
      const timeout = setTimeout(() => {
        socket.emit("no_match");
        removeFromQueue(socket.id);
      }, 30000);

      queue.push({ socket, timeout });
      socket.emit("search_started"); // Tell client to start UI timer
    }
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
  });
});

server.listen(process.env.PORT || 3000);
