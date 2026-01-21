/* index.js - Optimized Matchmaking */
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

let queue = []; 

function removeFromQueue(socketId) {
  const index = queue.findIndex(p => p.socket.id === socketId);
  if (index !== -1) {
    clearTimeout(queue[index].timeout); // Clear server-side timeout
    queue.splice(index, 1);
  }
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("join_search", () => {
    removeFromQueue(socket.id);

    if (queue.length > 0) {
      // Logic: Match found
      const opponent = queue.shift();
      clearTimeout(opponent.timeout);

      const roomId = `room_${opponent.socket.id}_${socket.id}`;
      
      // Force both to join
      opponent.socket.join(roomId);
      socket.join(roomId);

      console.log(`Battle started in ${roomId}`);
      io.to(roomId).emit("match_found", { 
        room: roomId,
        opponentId: opponent.socket.id 
      });
    } else {
      // Logic: Start waiting
      const timeout = setTimeout(() => {
        removeFromQueue(socket.id);
        socket.emit("no_match");
      }, 30000);

      queue.push({ socket, timeout });
      socket.emit("search_confirmed"); // Tell client we are officially in queue
    }
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
  });
});

server.listen(process.env.PORT || 3000);
