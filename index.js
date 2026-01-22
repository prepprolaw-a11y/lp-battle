const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");

const app = express();
const server = http.createServer(app);

/** * CRITICAL: Health Check & Root Route
 * Railway needs to receive a 200 OK from the root to mark the container as 'Healthy'.
 */
app.get("/", (req, res) => {
    res.status(200).send("Battle Server is Live and Running!");
});

app.get("/health", (req, res) => {
    res.status(200).send("OK");
});

// Socket.io with production-ready CORS and stability fallbacks
const io = new Server(server, {
    cors: {
        origin: [
            "https://battle.theroyalfoundation.org.in",
            "https://blog.legitprep.in"
        ],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ["websocket", "polling"], // Polling allows connection even if Websockets are blocked
    connectionStateRecovery: {} // Helps mobile users stay connected during small signal drops
});

let queue = [];
const rooms = {};

/* =========================
   HELPER FUNCTIONS
========================= */
async function fetchWPQuestions() {
    try {
        const res = await axios.get("https://blog.legitprep.in/wp-admin/admin-ajax.php?action=get_battle_questions");
        if (!res.data || !Array.isArray(res.data)) throw new Error("Invalid Format");
        return res.data.map(q => ({
            q: q.question,
            options: [q.option_a, q.option_b, q.option_c, q.option_d],
            correct: ["A", "B", "C", "D"].indexOf(q.correct_option)
        }));
    } catch (err) {
        console.error("❌ WP API Error:", err.message);
        // Fallback question if API fails
        return [{ q: "What is the primary source of law in India?", options: ["Constitution", "Custom", "Precedent", "Statute"], correct: 0 }];
    }
}

function startQuestion(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const question = room.questions[room.currentQuestion];
    room.answers = {};
    room.aiTriggered = false;

    io.to(roomId).emit("question", {
        q: question.q,
        options: question.options,
        correctIndex: question.correct, // Crucial for instant client-side feedback
        index: room.currentQuestion
    });

    // Reset timer for 30 seconds
    room.timer = setTimeout(() => finishQuestion(roomId), 30000);
}

function finishQuestion(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    clearTimeout(room.timer);
    if (room.botTimer) clearTimeout(room.botTimer);

    const question = room.questions[room.currentQuestion];
    room.players.forEach(pid => {
        if (room.answers[pid] === question.correct) {
            room.scores[pid] = (room.scores[pid] || 0) + 10;
        }
    });

    io.to(roomId).emit("score_update", { scores: room.scores });
    room.currentQuestion++;

    if (room.currentQuestion < room.questions.length) {
        setTimeout(() => startQuestion(roomId), 2500); // 2.5s gap between questions
    } else {
        io.to(roomId).emit("battle_end", { scores: room.scores });
        delete rooms[roomId];
    }
}

/* =========================
   SOCKET LOGIC
========================= */
io.on("connection", (socket) => {
    socket.on("join_search", async (userData) => {
        // Prevent duplicate entries in queue
        queue = queue.filter(item => item.socket.id !== socket.id);

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
            io.to(roomId).emit("match_found", { room: roomId });
            setTimeout(() => startQuestion(roomId), 1500);
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
        io.to(roomId).emit("match_found", { room: roomId });
        startQuestion(roomId);
    });

    socket.on("answer", ({ roomId, option }) => {
        const room = rooms[roomId];
        if (!room || room.answers[socket.id] !== undefined) return;
        
        room.answers[socket.id] = option;

        if (room.isBotMatch && !room.aiTriggered) {
            room.aiTriggered = true;
            const botDelay = Math.random() * 3000 + 2000; // Bot takes 2-5 seconds
            room.botTimer = setTimeout(() => {
                const q = room.questions[room.currentQuestion];
                room.answers["BOT"] = Math.random() < 0.75 ? q.correct : Math.floor(Math.random() * 4);
                finishQuestion(roomId);
            }, botDelay);
        } else if (Object.keys(room.answers).length === room.players.length) {
            finishQuestion(roomId);
        }
    });

    socket.on("disconnect", () => {
        queue = queue.filter(q => q.socket.id !== socket.id);
    });
});

/* =========================
   SERVER STARTUP
========================= */
// CRITICAL: Railway uses process.env.PORT. Must bind to 0.0.0.0.
const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Battle Server running on port ${PORT}`);
});
