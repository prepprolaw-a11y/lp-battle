document.addEventListener("DOMContentLoaded", () => {
    const BATTLE_SERVER = "https://battle.theroyalfoundation.org.in";
    const socket = io(BATTLE_SERVER, { transports: ["websocket"] });
    let currentRoom = null, qTimer = null, sTimer = null, isMuted = false, correctIndex = null;
    let myData = { name: "Warrior", avatar: "lion" };
    
    const sounds = {
        bg: new Audio('https://assets.mixkit.co/music/preview/mixkit-tech-house-vibes-130.mp3'),
        correct: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-winning-chime-2221.mp3'),
        wrong: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-incorrect-proximity-signal-1606.mp3')
    };
    sounds.bg.loop = true;

    window.toggleMute = () => {
        isMuted = !isMuted;
        sounds.bg.muted = isMuted;
        document.getElementById("mute-icon").innerText = isMuted ? "🔇" : "🔊";
    };

    function showOnboarding() {
        const avatars = ['lion', 'tiger', 'eagle', 'wolf', 'king', 'queen', 'advocate', 'titan'];
        document.getElementById("battle-root").innerHTML = `
            <div class="glass-card slide-up">
                <h2 style="color:var(--neon-blue)">PLAYER PROFILE</h2>
                <input type="text" id="p-name" placeholder="Enter Nickname" class="btn-secondary" style="margin-bottom:20px; width:100%; padding:15px; background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); color:white; border-radius:12px; box-sizing:border-box; text-align:center;">
                <div class="avatar-grid">${avatars.map(a => `<img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${a}" class="avatar-option" data-id="${a}">`).join('')}</div>
                <button onclick="saveProfile()" class="btn-primary" style="width:100%; padding:15px; border-radius:12px; background:#4f46e5; border:none; color:white; font-weight:bold; cursor:pointer;">ENTER ARENA</button>
            </div>`;
        
        document.querySelectorAll(".avatar-option").forEach(img => {
            img.onclick = () => {
                document.querySelectorAll(".avatar-option").forEach(i => i.classList.remove("selected"));
                img.classList.add("selected");
                myData.avatar = img.dataset.id;
            };
        });
    }

    function saveProfile() {
        myData.name = document.getElementById("p-name").value || "Warrior";
        if(!isMuted) sounds.bg.play().catch(() => {});
        startSearching();
    }

    function startSearching() {
        document.getElementById("battle-root").innerHTML = `
            <div class="glass-card">
                <div style="width:70px; height:70px; border:4px solid var(--neon-blue); border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite; margin: 0 auto 1.5rem;"></div>
                <h2 style="color:var(--neon-blue)">SCANNING ARENA</h2>
                <div style="font-size:2.5rem; margin:1.5rem 0;" id="search-timer">30</div>
            </div>`;
        let t = 30;
        socket.emit("join_search", myData);
        sTimer = setInterval(() => {
            t--; document.getElementById("search-timer").innerText = t;
            if (t <= 0) { clearInterval(sTimer); showDecision(); }
        }, 1000);
    }

    function showDecision() {
        document.getElementById("battle-root").innerHTML = `
            <div class="glass-card">
                <h2 style="color:var(--neon-red)">ARENA EMPTY</h2>
                <button class="btn-primary" onclick="startSearching()" style="width:100%; margin-bottom:10px;">🔄 RETRY SEARCH</button>
                <button class="btn-secondary" onclick="socket.emit('start_bot_match', myData)">🤖 CHALLENGE AI</button>
            </div>`;
    }

    socket.on("match_found", data => {
        clearInterval(sTimer); currentRoom = data.room;
        document.getElementById("battle-root").innerHTML = `
            <div style="width:100%; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center;">
                <div class="hud-header">
                    <div style="width:40%"><div style="font-size:0.8rem">YOU <span id="y-sc">0</span></div><div class="hp-bar"><div id="y-bar" class="hp-fill you-fill"></div></div></div>
                    <div class="timer-orb" id="q-timer">30</div>
                    <div style="width:40%; text-align:right;"><div style="font-size:0.8rem">OPPONENT <span id="o-sc">0</span></div><div class="hp-bar"><div id="o-bar" class="hp-fill opp-fill"></div></div></div>
                </div>
                <div class="glass-card" style="max-width:800px; width:95%;"><h3 id="q-txt">Waiting...</h3><div id="options-grid"></div></div>
            </div>`;
    });

    socket.on("question", data => {
        correctIndex = data.correctIndex; 
        document.getElementById("q-txt").innerText = data.q;
        const grid = document.getElementById("options-grid"); grid.innerHTML = "";
        
        data.options.forEach((opt, i) => {
            const b = document.createElement("button"); b.className="option-btn";
            b.innerHTML = `<span class="opt-label">${String.fromCharCode(65+i)}</span> ${opt}`;
            b.onclick = () => {
                socket.emit("answer", { roomId: currentRoom, option: i });
                document.querySelectorAll(".option-btn").forEach(btn => btn.disabled = true);
                
                // Red/Green Feedback & Sound
                if (i === correctIndex) {
                    b.classList.add("correct");
                    if(!isMuted) sounds.correct.play();
                } else {
                    b.classList.add("wrong");
                    if(!isMuted) sounds.wrong.play();
                }
            };
            grid.appendChild(b);
        });
        
        let t = 30; clearInterval(qTimer);
        qTimer = setInterval(() => { 
            t--; document.getElementById("q-timer").innerText = t; 
            if(t<=0) clearInterval(qTimer); 
        }, 1000);
    });

    socket.on("score_update", d => {
        const mySc = d.scores[socket.id] || 0;
        const oppSc = Object.values(d.scores).find(s => s !== mySc) || 0;
        document.getElementById("y-sc").innerText = mySc;
        document.getElementById("o-sc").innerText = oppSc;
        document.getElementById("y-bar").style.width = Math.min(mySc, 100) + "%";
        document.getElementById("o-bar").style.width = Math.min(oppSc, 100) + "%";
    });

    socket.on("battle_end", d => {
        const mySc = d.scores[socket.id] || 0;
        const oppSc = Object.values(d.scores).find(s => s !== mySc) || 0;
        const win = mySc > oppSc;
        document.getElementById("battle-root").innerHTML = `
            <div class="glass-card victory-card slide-up" style="border-color:${win?'var(--neon-green)':'var(--neon-red)'}">
                <h1 style="color:${win?'var(--neon-green)':'var(--neon-red)'}">${win?'VICTORY':'DEFEAT'}</h1>
                <p>Final Score: ${mySc} — ${oppSc}</p>
                <button class="btn-primary" onclick="location.reload()">PLAY AGAIN</button>
            </div>`;
    });

    showOnboarding();
});
