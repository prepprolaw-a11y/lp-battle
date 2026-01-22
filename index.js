const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");

const app = express();

// IMPORTANT: Railway needs to see your app is alive.
// This health check prevents Railway from killing the container.
app.get("/", (req, res) => {
    res.send("Battle Server is Running!");
});

app.get("/health", (req, res) => {
    res.status(200).send("OK");
});

const server = http.createServer(app);

// Socket.io setup with proper CORS for your domains
const io = new Server(server, {
    cors: {
        origin: [
            "https://battle.theroyalfoundation.org.in", 
            "https://blog.legitprep.in"
        ],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ["websocket", "polling"] // Allow fallback for better stability
});

let queue = [];
const rooms = {};

async function fetchWPQuestions() {
    try {
        const res = await axios.get("https://blog.legitprep.in/wp-admin/admin-ajax.php?action=get_battle_questions");
        if (!res.data || !Array.isArray(res.data)) throw new Error("Invalid Data");
        return res.data.map(q => ({
            q: q.question,
            options: [q.option_a, q.option_b, q.option_c, q.option_d],
            correct: ["A", "B", "C", "D"].indexOf(q.correct_option)
        }));
    } catch (err) {
        return [{ q: "What is the capital of India?", options: ["Delhi", "Mumbai", "Kolkata", "Chennai"], correct: 0 }];
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
        correctIndex: question.correct, // Client uses this for instant FX
        index: room.currentQuestion
    });

    // Auto-advance if no one answers in 30s
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
        setTimeout(() => startQuestion(roomId), 2000);
    } else {
        io.to(roomId).emit("battle_end", { scores: room.scores });
        delete rooms[roomId];
    }
}

io.on("connection", (socket) => {
    socket.on("join_search", async (userData) => {
        // Remove existing queue entry if any to avoid duplicates
        queue = queue.filter(item => item.socket.id !== socket.id);

        if (queue.length > 0) {
            const opp = queue.shift();
            const roomId = `room_${opp.socket.id}_${socket.id}`;
            const questions = await fetchWPQuestions();
            
            rooms[roomId] = {
                players: [socket.id, opp.socket.id],
                scores: { [socket.id]: 0, [opp.socket.id]: 0 },
                questions, currentQuestion: 0, answers: {}, isBotMatch: false
            };

            socket.join(roomId); opp.socket.join(roomId);
            io.to(roomId).emit("match_found", { room: roomId });
            setTimeout(() => startQuestion(roomId), 1000);
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
            const delay = Math.random() * 3000 + 2000; // Bot answers in 2-5 seconds
            room.botTimer = setTimeout(() => {
                const q = room.questions[room.currentQuestion];
                room.answers["BOT"] = Math.random() < 0.8 ? q.correct : Math.floor(Math.random() * 4);
                finishQuestion(roomId);
            }, delay);
        } else if (Object.keys(room.answers).length === room.players.length) {
            finishQuestion(roomId);
        }
    });

    socket.on("disconnect", () => {
        queue = queue.filter(q => q.socket.id !== socket.id);
    });
});

// CRITICAL FIX: Ensure the server binds to 0.0.0.0 and uses process.env.PORT
const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server on port ${PORT}`);
});
