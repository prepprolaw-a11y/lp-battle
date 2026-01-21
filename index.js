const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// ✅ HEALTH CHECK (CRITICAL FOR RAILWAY)
app.get("/", (req, res) => res.send("OK"));
app.get("/health", (req, res) => res.json({ status: "ok" }));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let queue = [];

function removeFromQueue(socketId) {
    const index = queue.findIndex(p => p.socket.id === socketId);
    if (index !== -1) {
        clearTimeout(queue[index].timeout);
        queue.splice(index, 1);
    }
}

io.on("connection", socket => {
    console.log("🔌 Connected:", socket.id);

    socket.on("join_search", () => {
        removeFromQueue(socket.id);

        if (queue.length > 0) {
            const opponentData = queue.shift();
            const opponent = opponentData.socket;

            if (!opponent || !opponent.connected) {
                socket.emit("no_match");
                return;
            }

            clearTimeout(opponentData.timeout);

            const roomId = `room_${opponent.id}_${socket.id}`;
            socket.join(roomId);
            opponent.join(roomId);

            io.to(roomId).emit("match_found", {
                room: roomId,
                players: [socket.id, opponent.id]
            });

        } else {
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

// ✅ MUST BIND TO 0.0.0.0
const PORT = process.env.PORT;
server.listen(PORT, "0.0.0.0", () => {
    console.log("🚀 Battle server running on port", PORT);
});
