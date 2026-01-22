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

async function fetchWPQuestions() {
  try {
    const res = await axios.get("https://blog.legitprep.in/wp-admin/admin-ajax.php?action=get_battle_questions");
    return res.data.map(q => ({
      q: q.question,
      options: [q.option_a, q.option_b, q.option_c, q.option_d],
      correct: ["A", "B", "C", "D"].indexOf(q.correct_option)
    }));
  } catch (err) {
    console.error("❌ WP API Error:", err.message); // This catches the 400 errors
    return [{ q: "Fallback: Article 21 is related to?", options: ["Education", "Life & Liberty", "Religion", "Equality"], correct: 1 }];
  }
}

function botAnswer(question) {
  return Math.random() < 0.75 ? question.correct : Math.floor(Math.random() * 4);
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
  const question = room.questions[room.currentQuestion];

  io.to(roomId).emit("question", {
    q: question.q,
    options: question.options,
    index: room.currentQuestion,
    duration: 30
  });

  if (room.isBotMatch) {
    const delay = Math.random() * 5000 + 3000;
    room.botTimer = setTimeout(() => {
      if (rooms[roomId]) {
        room.answers["BOT"] = botAnswer(question);
        if (Object.keys(room.answers).length === 2) finishQuestion(roomId);
      }
    }, delay);
  }
  room.timer = setTimeout(() => finishQuestion(roomId), 30000);
}

function finishQuestion(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  clearTimeout(room.timer);
  if (room.botTimer) clearTimeout(room.botTimer);

  const question = room.questions[room.currentQuestion];
  room.players.forEach(pid => {
    if (room.answers[pid] === question.correct) room.scores[pid] += 10;
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
   SOCKET LOGIC
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
  socket.on("join_search", async () => {
    removeFromQueue(socket.id);
    if (queue.length > 0) {
      const opponentData = queue.shift();
      const opponent = opponentData.socket;
      const roomId = `room_${opponent.id}_${socket.id}`;
      const questions = await fetchWPQuestions();
      rooms[roomId] = {
        players: [socket.id, opponent.id],
        scores: { [socket.id]: 0, [opponent.id]: 0 },
        questions, currentQuestion: 0, answers: {}, isBotMatch: false
      };
      socket.join(roomId); opponent.join(roomId);
      io.to(roomId).emit("match_found", { room: roomId, players: [socket.id, opponent.id] });
      startQuestion(roomId);
    } else {
      queue.push({ socket }); 
    }
  });

  socket.on("start_bot_match", async () => {
    removeFromQueue(socket.id);
    const roomId = `ai_room_${socket.id}`;
    const questions = await fetchWPQuestions();
    rooms[roomId] = {
      players: [socket.id, "BOT"],
      scores: { [socket.id]: 0, BOT: 0 },
      questions, currentQuestion: 0, answers: {}, isBotMatch: true
    };
    socket.join(roomId);
    io.to(roomId).emit("match_found", { room: roomId, players: [socket.id, "BOT"] });
    startQuestion(roomId);
  });

  socket.on("answer", ({ roomId, option }) => {
    const room = rooms[roomId];
    if (!room || room.answers[socket.id] !== undefined) return;
    room.answers[socket.id] = option;
    if (Object.keys(room.answers).length === 2) finishQuestion(roomId);
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

const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server on ${PORT}`));
