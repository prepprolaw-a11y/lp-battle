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
let waitingPlayer = null;   // single waiting socket
let rooms = {};             // active rooms

io.on("connection", socket => {
  console.log("User connected:", socket.id);

  socket.on("join_search", () => {

    // If nobody waiting → wait
    if (!waitingPlayer) {
      waitingPlayer = socket;
      console.log("Waiting player:", socket.id);
      return;
    }

    // If waiting player is same (edge case)
    if (waitingPlayer.id === socket.id) return;

    // Create a NEW room for exactly 2 players
    const roomId = `room_${waitingPlayer.id}_${socket.id}`;

    rooms[roomId] = {
      players: [waitingPlayer.id, socket.id],
      status: "full"
    };

    // Join sockets to room
    socket.join(roomId);
    waitingPlayer.join(roomId);

    console.log("Room created:", roomId);

    // Notify both players
    io.to(roomId).emit("match_found", { room: roomId });

    // Clear waiting slot
    waitingPlayer = null;
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    // If waiting player disconnects
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }

    // Clean up rooms
    for (const roomId in rooms) {
      if (rooms[roomId].players.includes(socket.id)) {
        io.to(roomId).emit("opponent_left");
        delete rooms[roomId];
        console.log("Room deleted:", roomId);
      }
    }
  });
});

/* -----------------------------
   START SERVER
------------------------------ */
server.listen(process.env.PORT || 3000, () => {
  console.log("Battle server running");
});
