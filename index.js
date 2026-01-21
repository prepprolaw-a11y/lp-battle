const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket"],
  pingTimeout: 5000,
  pingInterval: 2000
});

/* -----------------------------
   MATCHMAKING STATE
------------------------------ */
let queue = []; // [{ socket, timeout }]

function removeFromQueue(socketId) {
  queue = queue.filter(p => p.socket.id !== socketId);
}

io.on("connection", socket => {
  console.log("User connected:", socket.id);

  socket.on("join_search", () => {

    // Prevent duplicate entries
    removeFromQueue(socket.id);

    // If someone already waiting → match
    if (queue.length > 0) {
      const opponent = queue.shift();
      clearTimeout(opponent.timeout);

      const roomId = `room_${opponent.socket.id}_${socket.id}`;

      socket.join(roomId);
      opponent.socket.join(roomId);

      console.log("Room created:", roomId);

      io.to(roomId).emit("match_found", { room: roomId });
      return;
    }

    // Otherwise, push to queue
    console.log("Player waiting:", socket.id);

    const timeout = setTimeout(() => {
      console.log("No match in 30s for:", socket.id);
      socket.emit("no_match");
      removeFromQueue(socket.id);
    }, 30000);

    queue.push({ socket, timeout });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    removeFromQueue(socket.id);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Battle server running");
});
