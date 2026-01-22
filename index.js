const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");

const app = express();
const server = http.createServer(app);

/* =========================
    HEALTH CHECKS (For Railway)
========================= */
app.get("/", (req, res) => res.status(200).send("Battle Server is Live and Running!"));
app.get("/health", (req, res) => res.status(200).send("OK"));

/* =========================
    SOCKET.IO CONFIGURATION
========================= */
const io = new Server(server, {
    cors: {
        origin: [
            "https://battle.theroyalfoundation.org.in",
            "https://blog.legitprep.in",
            "https://blog.legitprep.in/quiz-battle/"
        ],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ["websocket", "polling"],
    connectionStateRecovery: {} 
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
        return [{ q: "What is the primary source of law in India?", options: ["Constitution", "Custom", "Precedent", "Statute"], correct: 0 }];
    }
}

function startQuestion(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const question = room.questions[room.currentQuestion];
    room.answers = {};
    room.aiTriggered = false;
    room.questionStartTime = Date.now(); 

    io.to(roomId).emit("question", {
        q: question.q,
        options: question.options,
        correctIndex: question.correct,
        index: room.currentQuestion
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
        if (room.answers[pid] === question.correct) {
            // SPEED BONUS LOGIC: 15 points for fast answers (< 7s), 10 for slow
            const reactionTime = (room.answerTimes && room.answerTimes[pid]) ? (room.answerTimes[pid] - room.questionStartTime) : 30000;
            const points = reactionTime < 7000 ? 15 : 10;
            room.scores[pid] = (room.scores[pid] || 0) + points;
        }
    });

    io.to(roomId).emit("score_update", { scores: room.scores });
    room.currentQuestion++;

    if (room.currentQuestion < room.questions.length) {
        setTimeout(() => startQuestion(roomId), 800);
    } else {
        io.to(roomId).emit("battle_end", { scores: room.scores });
        delete rooms[roomId];
    }
}

/* =========================
    SOCKET LOGIC
========================= */
io.on("connection", (socket) => {
    
    /* --- PUBLIC MATCHMAKING --- */
    socket.on("join_search", async (userData) => {
        queue = queue.filter(item => item.socket.id !== socket.id);

        if (queue.length > 0) {
            const opp = queue.shift();
            const roomId = `room_${opp.socket.id}_${socket.id}`;
            const questions = await fetchWPQuestions();

            rooms[roomId] = {
                players: [socket.id, opp.socket.id],
                playerData: { 
                    [socket.id]: userData, 
                    [opp.socket.id]: opp.userData 
                },
                scores: { [socket.id]: 0, [opp.socket.id]: 0 },
                answerTimes: {},
                questions, 
                currentQuestion: 0, 
                answers: {},
                isBotMatch: false
            };

            socket.join(roomId); 
            opp.socket.join(roomId);

            io.to(roomId).emit("match_found", { 
                room: roomId, 
                players: rooms[roomId].playerData 
            });

            setTimeout(() => startQuestion(roomId), 500);
        } else {
            queue.push({ socket, userData });
        }
    });

    /* --- PRIVATE ROOM LOGIC --- */
    socket.on("create_private_room", async (userData) => {
        const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase(); 
        const roomId = `private_${roomCode}`;
        
        rooms[roomId] = {
            players: [socket.id],
            playerData: { [socket.id]: userData },
            scores: { [socket.id]: 0 },
            answerTimes: {},
            questions: await fetchWPQuestions(),
            currentQuestion: 0,
            answers: {},
            isPrivate: true,
            roomCode: roomCode
        };

        socket.join(roomId);
        socket.emit("room_created", { roomCode });
    });

    socket.on("join_private_room", ({ roomCode, userData }) => {
        const roomId = `private_${roomCode.toUpperCase()}`;
        const room = rooms[roomId];

        if (room && room.players.length === 1) {
            room.players.push(socket.id);
            room.playerData[socket.id] = userData;
            room.scores[socket.id] = 0;

            socket.join(roomId);
            io.to(roomId).emit("match_found", { 
                room: roomId, 
                players: room.playerData 
            });

            setTimeout(() => startQuestion(roomId), 500);
        } else {
            socket.emit("error_msg", "Room not found or full!");
        }
    });

    /* --- BOT MATCH LOGIC --- */
    socket.on("start_bot_match", async (userData) => {
        const roomId = `ai_${socket.id}`;
        const questions = await fetchWPQuestions();
        const botData = { name: "AI Bot", avatar: "titan" };
        
        rooms[roomId] = {
            players: [socket.id, "BOT"],
            playerData: { [socket.id]: userData, "BOT": botData },
            scores: { [socket.id]: 0, BOT: 0 },
            answerTimes: {},
            questions, 
            currentQuestion: 0, 
            answers: {}, 
            isBotMatch: true
        };

        socket.join(roomId);
        io.to(roomId).emit("match_found", { 
            room: roomId, 
            players: rooms[roomId].playerData 
        });
        
        setTimeout(() => startQuestion(roomId), 500);
    });

    /* --- GAMEPLAY LOGIC --- */
    socket.on("answer", ({ roomId, option }) => {
        const room = rooms[roomId];
        if (!room || room.answers[socket.id] !== undefined) return;

        room.answers[socket.id] = option;
        room.answerTimes = room.answerTimes || {};
        room.answerTimes[socket.id] = Date.now();

        if (room.isBotMatch && !room.aiTriggered) {
            room.aiTriggered = true;
            const botDelay = Math.random() * 500 + 200; 
            room.botTimer = setTimeout(() => {
                const q = room.questions[room.currentQuestion];
                room.answers["BOT"] = Math.random() < 0.75 ? q.correct : Math.floor(Math.random() * 4);
                room.answerTimes["BOT"] = Date.now();
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
const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Battle Server running on port ${PORT}`);
});
