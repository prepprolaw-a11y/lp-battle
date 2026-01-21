const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios"); // ✅ Added for WP integration

const app = express();
const server = http.createServer(app);

/* =========================
   HEALTH CHECK (RAILWAY)
========================= */
app.get("/", (req, res) => res.send("OK"));
app.get("/health", (req, res) => res.json({ status: "ok" }));

/* =========================
   HELPERS & ENGINE
========================= */
let queue = [];
const rooms = {};

// 1. Fetch Questions from WordPress
async function fetchWPQuestions() {
  try {
    const res = await axios.get(
      "https://blog.legitprep.in/wp-admin/admin-ajax.php?action=get_battle_questions"
    );
    // Transform WP format → Game format
    return res.data.map(q => ({
      q: q.question,
      options: [q.option_a, q.option_b, q.option_c, q.option_d],
      correct: ["A", "B", "C", "D"].indexOf(q.correct_option)
    }));
  } catch (err) {
    console.error("WP Fetch Error:", err);
    // Fallback questions if WP API fails
    return [{ q: "Error loading question?", options: ["A", "B", "C", "D"], correct: 0 }];
  }
}

// 2. Bot Logic
function botAnswer(question) {
  const accuracy = 0.75; // 75% chance to be right
  return Math.random() < accuracy
    ? question.correct
    : Math.floor(Math.random() * question.options.length);
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

  // BOT BEHAVIOR
  if (room.isBotMatch) {
    const botDelay = Math.random() * 8000 + 4000; // Bot answers in 4-12 seconds
    room.botTimer = setTimeout(() => {
      if (rooms[roomId] && !room.answers["BOT"]) {
        room.answers["BOT"] = botAnswer(question);
        if (Object.keys(room.answers).length === 2) finishQuestion(roomId);
      }
    }, botDelay);
  }

  room.timer = setTimeout(() => {
    finishQuestion(roomId);
  }, 30000);
}

function finishQuestion(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  clearTimeout(room.timer);
  if (room.botTimer) clearTimeout(room.botTimer);

  const question = room.questions[room.currentQuestion];

  room.players.forEach(pid => {
    if (room.answers[pid] === question.correct) {
      room.scores[pid] += 10;
    }
  });

  io.to(roomId).emit("score_update", { scores: room.scores });

  room.currentQuestion++;

  if (room.currentQuestion < room.questions.length) {
    setTimeout(() => startQuestion(roomId), 2000);
  } else {
    io.to(roomId).emit("battle_end", { scores: room.scores });
    cleanupRoom(roomId);
  }
}

/* =========================
   SOCKET.IO SETUP
========================= */
const io = new Server(server, {
  cors: {
    origin: ["https://battle.theroyalfoundation.org.in", "https://blog.legitprep.in"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket"],
  allowUpgrades: true
});

io.on("connection", socket => {
  console.log("🔌 Connected:", socket.id);

  socket.on("join_search", async () => {
    removeFromQueue(socket.id);

    if (queue.length > 0) {
      // MATCH FOUND WITH HUMAN
      const opponentData = queue.shift();
      const opponent = opponentData.socket;

      if (!opponent || !opponent.connected) {
        socket.emit("no_match");
        return;
      }

      const roomId = `room_${opponent.id}_${socket.id}`;
      const questions = await fetchWPQuestions();

      rooms[roomId] = {
        players: [socket.id, opponent.id],
        scores: { [socket.id]: 0, [opponent.id]: 0 },
        questions: questions,
        currentQuestion: 0,
        answers: {},
        timer: null,
        isBotMatch: false
      };

      socket.join(roomId);
      opponent.join(roomId);

      io.to(roomId).emit("match_found", { room: roomId, players: rooms[roomId].players });
      startQuestion(roomId);

    } else {
      // NO HUMAN IN QUEUE -> WAIT 5 SECONDS THEN SPAWN BOT
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
          timer: null,
          isBotMatch: true
        };

        socket.join(roomId);
        io.to(roomId).emit("match_found", { room: roomId, players: [socket.id, "BOT"] });
        startQuestion(roomId);
      }, 30000); // 30 seconds wait for human, then bot joins

      queue.push({ socket, timeout });
    }
  });

  socket.on("answer", ({ roomId, option }) => {
    const room = rooms[roomId];
    if (!room || room.answers[socket.id] !== undefined) return;

    room.answers[socket.id] = option;

    // Finish if everyone (including BOT) answered or time out
    const targetLength = room.isBotMatch ? 2 : 2;
    if (Object.keys(room.answers).length === targetLength) {
      finishQuestion(roomId);
    }
  });

  socket.on("rematch", () => {
    socket.emit("join_search");
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
    for (const roomId in rooms) {
      if (rooms[roomId].players.includes(socket.id)) {
        io.to(roomId).emit("battle_end", { reason: "opponent_left" });
        cleanupRoom(roomId);
      }
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Battle server running on port", PORT);
});
