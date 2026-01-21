const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

/* -----------------------------
   MATCHMAKING STATE
------------------------------ */
let waitingPlayer = null;
let waitingTimeout = null;

io.on("connection", socket => {
  console.log("User connected:", socket.id);

  socket.on("join_search", () => {

    // If nobody is waiting → make this user wait
    if (!waitingPlayer) {
      waitingPlayer = socket;
      console.log("Player waiting:", socket.id);

      // ⏳ Start 30s timeout
      waitingTimeout = setTimeout(() => {
        if (waitingPlayer && waitingPlayer.id === socket.id) {
          console.log("No match in 30s for:", socket.id);
          socket.emit("no_match");
          waitingPlayer = null;
        }
      }, 30000);

      return;
    }

    // If another player is already waiting → match instantly
    if (waitingPlayer.id !== socket.id) {

      clearTimeout(waitingTimeout);

      const roomId = `room_${waitingPlayer.id}_${socket.id}`;

      socket.join(roomId);
      waitingPlayer.join(roomId);

      console.log("Room created:", roomId);

      io.to(roomId).emit("match_found", { room: roomId });

      waitingPlayer = null;
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    // If waiting player disconnects
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      clearTimeout(waitingTimeout);
      waitingPlayer = null;
    }
  });
});

/* -----------------------------
   START SERVER
------------------------------ */
server.listen(process.env.PORT || 3000, () => {
  console.log("Battle server running");
});
