const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");

const app = express();
const server = http.createServer(app);

let queue = [];
const rooms = {};

/* =========================
   HELPERS & ENGINE
========================= */
async function fetchWPQuestions() {
  try {
    const res = await axios.get("https://blog.legitprep.in/wp-admin/admin-ajax.php?action=get_battle_questions");
    return res.data.map(q => ({
      q: q.question,
      options: [q.option_a, q.option_b, q.option_c, q.option_d],
      correct: ["A", "B", "C", "D"].indexOf(q.correct_option)
    }));
  } catch (err) {
    console.error("❌ WP API Error:", err.message);
    return [{ q: "Error loading question?", options: ["A", "B", "C", "D"], correct: 0 }];
  }
}

function botAnswer(question) {
  return Math.random() < 0.75 ? question.correct : Math.floor(Math.random() * 4);
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
    room.answers = {};
    room.aiTriggered = false;

    // ✅ MUST include correct index here for instant client feedback
    io.to(roomId).emit("question", {
        q: question.q,
        options: question.options,
        index: room.currentQuestion,
        duration: 30,
        correctIndex: question.correct // Send this to the client
    });

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

  // ✅ Send live scores so bars/text update
  io.to(roomId).emit("score_update", { scores: room.scores });
  room.currentQuestion++;

  if (room.currentQuestion < room.questions.length) {
    setTimeout(() => startQuestion(roomId), 2500);
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
  socket.on("join_search", async (userData) => {
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
      queue.push({ socket, userData });
    }
  });

  socket.on("start_bot_match", async () => {
    const roomId = `ai_${socket.id}`;
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

    if (room.isBotMatch && !room.aiTriggered) {
      room.aiTriggered = true;
      room.botTimer = setTimeout(() => {
        room.answers["BOT"] = botAnswer(room.questions[room.currentQuestion]);
        finishQuestion(roomId); // ✅ AI Reacts immediately
      }, 1500);
    } else if (Object.keys(room.answers).length === 2) {
      finishQuestion(roomId); // ✅ Humans move immediately
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0");
