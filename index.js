const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");

const app = express();
const server = http.createServer(app);

/* =========================
   HEALTH CHECK (RAILWAY)
========================= */
app.get("/", (req, res) => res.send("OK"));
app.get("/health", (req, res) => res.json({ status: "ok" }));

/* =========================
   GLOBALS & HELPERS
========================= */
let queue = [];
const rooms = {};

/**
 * Fetches questions from WordPress AJAX endpoint
 */
async function fetchWPQuestions() {
  try {
    const res = await axios.get(
      "https://blog.legitprep.in/wp-admin/admin-ajax.php?action=get_battle_questions"
    );
    // Transform WP format to Game format
    return res.data.map(q => ({
      q: q.question,
      options: [q.option_a, q.option_b, q.option_c, q.option_d],
      correct: ["A", "B", "C", "D"].indexOf(q.correct_option)
    }));
  } catch (err) {
    console.error("❌ WP API Error:", err.message);
    // Fallback static questions if API is down
    return [
      { q: "Which Indian state has the longest coastline?", options: ["Gujarat", "TN", "MH", "AP"], correct: 0 },
      { q: "Article 21 is related to?", options: ["Education", "Life & Liberty", "Religion", "Equality"], correct: 1 }
    ];
  }
}

/**
 * Simulates a Bot answer
 */
function botAnswer(question) {
  const accuracy = 0.75; // 75% chance to get it right
  return Math.random() < accuracy
    ? question.correct
    : Math.floor(Math.random() * 4);
}

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
  if (room.botTimer) clearTimeout(room.botTimer);
  delete rooms[roomId];
}

/* =========================
   GAME ENGINE
========================= */
function startQuestion(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.answers = {};
  const question = room.questions[room.currentQuestion];

  io.to(roomId).emit("question", {
    q: question.q,
    options: question.options,
    index: room.currentQuestion,
    duration: 30
  });

  // Handle Bot simulation
  if (room.isBotMatch) {
    const botResponseTime = Math.random() * 7000 + 3000; // Bot answers between 3-10 seconds
    room.botTimer = setTimeout(() => {
      if (rooms[roomId] && !room.answers["BOT"]) {
        room.answers["BOT"] = botAnswer(question);
        if (Object.keys(room.answers).length === 2) finishQuestion(roomId);
      }
    }, botResponseTime);
  }

  room.timer = setTimeout(() => finishQuestion(roomId), 30000);
}

function finishQuestion(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  clearTimeout(room.timer);
  if (room.botTimer) clearTimeout(room.botTimer);

  const question = room.questions[room.currentQuestion];

  // Score calculation
  room.players.forEach(pid => {
    if (room.answers[pid] === question.correct) {
      room.scores[pid] += 10;
    }
  });

  io.to(roomId).emit("score_update", { scores: room.scores });
  room.currentQuestion++;

  if (room.currentQuestion < room.questions.length) {
    setTimeout(() => startQuestion(roomId), 2000); // 2 sec delay between questions
  } else {
    io.to(roomId).emit("battle_end", { scores: room.scores });
    cleanupRoom(roomId);
  }
}

/* =========================
   SOCKET.IO LOGIC
========================= */
const io = new Server(server, {
  cors: {
    origin: ["https://battle.theroyalfoundation.org.in", "https://blog.legitprep.in"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket"]
});

io.on("connection", (socket) => {
  console.log("🔌 Connected:", socket.id);

  socket.on("join_search", async () => {
    removeFromQueue(socket.id);

    if (queue.length > 0) {
      // MATCH FOUND (Human vs Human)
      const opponentData = queue.shift();
      const opponent = opponentData.socket;
      const roomId = `room_${opponent.id}_${socket.id}`;
      const questions = await fetchWPQuestions();

      rooms[roomId] = {
        players: [socket.id, opponent.id],
        scores: { [socket.id]: 0, [opponent.id]: 0 },
        questions: questions,
        currentQuestion: 0,
        answers: {},
        isBotMatch: false
      };

      socket.join(roomId);
      opponent.join(roomId);
      io.to(roomId).emit("match_found", { room: roomId, players: [socket.id, opponent.id] });
      startQuestion(roomId);

    } else {
      // QUEUE IS EMPTY -> Wait 5s for human, then spawn BOT
      const timeout = setTimeout(async () => {
        removeFromQueue(socket.id);
        const roomId = `bot_room_${socket.id}`;
        const questions = await fetchWPQuestions();

        rooms[roomId] = {
          players: [socket.id, "BOT"],
          scores: { [socket.id]: 0, BOT: 0 },
          questions: questions,
          currentQuestion: 0,
          answers: {},
          isBotMatch: true
        };

        socket.join(roomId);
        io.to(roomId).emit("match_found", { room: roomId, players: [socket.id, "BOT"] });
        startQuestion(roomId);
      }, 5000);

      queue.push({ socket, timeout });
    }
  });

  socket.on("answer", ({ roomId, option }) => {
    const room = rooms[roomId];
    if (!room || room.answers[socket.id] !== undefined) return;

    room.answers[socket.id] = option;

    // Trigger finish early if both players have answered
    if (Object.keys(room.answers).length === 2) {
      finishQuestion(roomId);
    }
  });

  socket.on("rematch", () => {
    socket.emit("join_search");
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
    for (const rid in rooms) {
      if (rooms[rid].players.includes(socket.id)) {
        io.to(rid).emit("battle_end", { reason: "opponent_left" });
        cleanupRoom(rid);
      }
    }
  });
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Battle server running on port", PORT);
});
