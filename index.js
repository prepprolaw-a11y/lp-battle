/* index.js */
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.get("/health", (req, res) => res.status(200).send("Alive"));
const server = http.createServer(app);

// Best-practice Socket.io configuration
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket"],
  pingTimeout: 60000, // Increase for better stability on slow networks
});

let queue = [];

function removeFromQueue(socketId) {
  const index = queue.findIndex(p => p.socket.id === socketId);
  if (index !== -1) {
    clearTimeout(queue[index].timeout);
    queue.splice(index, 1);
    console.log(`User ${socketId} removed. Queue size: ${queue.length}`);
  }
}

io.on("connection", (socket) => {
  console.log("New Connection:", socket.id);

  socket.on("join_search", () => {
    // Clear previous entries for this socket
    removeFromQueue(socket.id);

    if (queue.length > 0) {
      const opponent = queue.shift();
      clearTimeout(opponent.timeout);

      const roomId = `room_${opponent.socket.id}_${socket.id}`;
      socket.join(roomId);
      opponent.socket.join(roomId);

      console.log(`Match Found: ${roomId}`);
      io.to(roomId).emit("match_found", { room: roomId });
    } else {
      const timeout = setTimeout(() => {
        socket.emit("no_match");
        removeFromQueue(socket.id);
      }, 30000);

      queue.push({ socket, timeout });
      
      // CRITICAL: Tell the client search is confirmed
      socket.emit("search_started"); 
      console.log(`User ${socket.id} is now waiting.`);
    }
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
  });
});

// Explicit port handling for Railway
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Battle server active on port ${PORT}`);
});
