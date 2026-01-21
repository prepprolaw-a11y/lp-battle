const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let queue = [];

io.on("connection", socket => {
    console.log("User connected:", socket.id);

    socket.on("join_search", () => {
        if (queue.length > 0) {
            const opponent = queue.shift();
            const room = `room_${socket.id}_${opponent.id}`;

            socket.join(room);
            opponent.join(room);

            io.to(room).emit("match_found", { room });
        } else {
            queue.push(socket);
        }
    });

    socket.on("disconnect", () => {
        queue = queue.filter(s => s.id !== socket.id);
    });
});

server.listen(process.env.PORT || 3000, () => {
    console.log("Battle server running");
});
