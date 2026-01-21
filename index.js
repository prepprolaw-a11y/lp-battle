const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

/* =========================
   HEALTH CHECK (RAILWAY)
========================= */
app.get("/", (req, res) => res.send("OK"));
app.get("/health", (req, res) => res.json({ status: "ok" }));

/* =========================
   QUESTIONS (TEMP)
========================= */
const QUESTIONS = [
  {
    q: "Which Indian state has the longest coastline?",
    options: ["Gujarat", "Tamil Nadu", "Maharashtra", "Andhra Pradesh"],
    correct: 0
  },
  {
    q: "Article 21 is related to?",
    options: ["Education", "Life & Liberty", "Religion", "Equality"],
    correct: 1
  }
];

/* =========================
   SOCKET.IO
========================= */
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

/* =========================
   MATCHMAKING + ROOMS
========================= */
let queue = [];
const rooms = {};

/* ---------- HELPERS ---------- */
function removeFromQueue(socketId) {
  const idx = queue.findIndex(q => q.socket.id === socketId);
  if (idx !== -1) {
    clearTimeout(queue[idx].timeout);
    queue.splice(idx, 1);
  }
}

function cleanupRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  clearTimeout(room.timer);
  delete rooms[roomId];
}

/* =========================
   GAME ENGINE
========================= */
function startQuestion(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.answers = {};
  const question = QUESTIONS[room.currentQuestion];

  io.to(roomId).emit("question", {
    q: question.q,
    options: question.options,
    index: room.currentQuestion,
    duration: 30
  });

  room.timer = setTimeout(() => {
    finishQuestion(roomId);
  }, 30000);
}

function finishQuestion(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  clearTimeout(room.timer);
  const question = QUESTIONS[room.currentQuestion];

  room.players.forEach(pid => {
    if (room.answers[pid] === question.correct) {
      room.scores[pid] += 10;
    }
  });

  io.to(roomId).emit("score_update", {
    scores: room.scores
  });

  room.currentQuestion++;

  if (room.currentQuestion < QUESTIONS.length) {
    setTimeout(() => startQuestion(roomId), 2000);
  } else {
    io.to(roomId).emit("battle_end", {
      scores: room.scores
    });
    cleanupRoom(roomId);
  }
}

/* =========================
   SOCKET EVENTS
========================= */
io.on("connection", socket => {
  console.log("🔌 Connected:", socket.id);

  /* ----- JOIN SEARCH ----- */
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

      rooms[roomId] = {
        players: [socket.id, opponent.id],
        scores: {
          [socket.id]: 0,
          [opponent.id]: 0
        },
        currentQuestion: 0,
        answers: {},
        timer: null
      };

      io.to(roomId).emit("match_found", {
        room: roomId,
        players: rooms[roomId].players
      });

      startQuestion(roomId);

    } else {
      const timeout = setTimeout(() => {
        socket.emit("no_match");
        removeFromQueue(socket.id);
      }, 30000);

      queue.push({ socket, timeout });
    }
  });

  /* ----- ANSWER (HIDDEN) ----- */
  socket.on("answer", ({ roomId, option }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!room.players.includes(socket.id)) return;
    if (room.answers[socket.id] !== undefined) return;

    room.answers[socket.id] = option;

    if (Object.keys(room.answers).length === 2) {
      finishQuestion(roomId);
    }
  });

  /* ----- DISCONNECT ----- */
  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);
    removeFromQueue(socket.id);

    for (const roomId in rooms) {
      if (rooms[roomId].players.includes(socket.id)) {
        io.to(roomId).emit("battle_end", {
          reason: "opponent_left"
        });
        cleanupRoom(roomId);
      }
    }
  });
});

/* =========================
   START SERVER (RAILWAY)
========================= */
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Battle server running on port", PORT);
});
