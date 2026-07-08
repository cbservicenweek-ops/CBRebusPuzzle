const firebaseConfig = {
  apiKey: "AIzaSyACUjgoLEGh0RsiKS4B1MUyrwUbJUmLeSc",
  authDomain: "cbrebuspuzzle.firebaseapp.com",
  databaseURL: "https://cbrebuspuzzle-default-rtdb.firebaseio.com/",
  projectId: "cbrebuspuzzle",
  storageBucket: "cbrebuspuzzle.firebasestorage.app",
  messagingSenderId: "599192549189",
  appId: "1:599192549189:web:5f47874eaae9e1c948b02c"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let isHost = false;
let currentRoom = "";
let myPlayerId = "";
let myTeam = "";

function showView(viewId) {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

// NEW: Advanced Auto-Compressor for Large Images
function compressImageAndGetBase64(file) {
    return new Promise((resolve, reject) => {
        if (!file) { resolve(""); return; }
        
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800; // Resize to max 800px width
                
                let width = img.width;
                let height = img.height;
                
                if (width > MAX_WIDTH) {
                    height = Math.round((height * MAX_WIDTH) / width);
                    width = MAX_WIDTH;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Compress as JPEG at 80% quality (massively reduces file size)
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
    });
}

function generateCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// --- HOST BATCH SETUP FUNCTIONS ---
function verifyHost() {
    const pw = document.getElementById('host-password').value;
    if (pw === "Bryan") {
        isHost = true;
        showView('view-host-setup');
    } else { alert("Incorrect password"); }
}

function addRoundSetup() {
    const container = document.getElementById('rounds-container');
    const roundCount = container.children.length + 1;
    const div = document.createElement('div');
    div.className = 'round-setup-block';
    div.innerHTML = `
        <h3>Round ${roundCount}</h3>
        <input type="file" class="host-image" accept="image/*">
        <input type="text" class="host-hint1" placeholder="Hint 1 (Free Hint)">
        <input type="text" class="host-hint2" placeholder="Hint 2 (Hidden)">
        <input type="text" class="host-answer" placeholder="Correct Answer">
    `;
    container.appendChild(div);
}

async function createRoom() {
    const teamsRaw = document.getElementById('host-teams').value;
    if (!teamsRaw) { alert("Please enter team names."); return; }

    const roundBlocks = document.querySelectorAll('.round-setup-block');
    let roundsData = [];

    // Change button text to show it's working (compression might take 2-3 seconds for 20 big images)
    const createBtn = event.target;
    createBtn.innerText = "Processing Images... Please wait";
    createBtn.disabled = true;

    try {
        for (let block of roundBlocks) {
            const fileInput = block.querySelector('.host-image');
            const hint1Input = block.querySelector('.host-hint1');
            const hint2Input = block.querySelector('.host-hint2');
            const answerInput = block.querySelector('.host-answer');

            if (!fileInput || !hint1Input || !answerInput) continue;

            const file = fileInput.files[0];
            const hint1 = hint1Input.value;
            const hint2 = hint2Input.value;
            const answer = answerInput.value;

            if (!file || !hint1 || !answer) {
                alert("Please ensure all rounds have an image, hint 1, and an answer."); 
                createBtn.innerText = "Create Room & Start Game";
                createBtn.disabled = false;
                return;
            }
            
            // This compresses the image before saving!
            const b64Image = await compressImageAndGetBase64(file);
            roundsData.push({ image: b64Image, hint1, hint2, answer });
        }

        currentRoom = generateCode();
        
        let teams = {};
        teamsRaw.split(',').forEach(t => {
            if(t.trim()) teams[t.trim()] = { score: 0 };
        });

        const roomData = {
            status: "playing",
            teams: teams,
            players: {},
            rounds: roundsData,
            currentRoundIndex: 0,
            gameState: {
                showHint2: false,
                buzzerEnabled: false,
                buzzerQueue: [], 
                wrongGuesses: [], 
                activeBuzzerId: null,
                lastWrongTeam: null
            }
        };

        await db.ref(`rooms/${currentRoom}`).set(roomData);
        
        document.getElementById('display-room-code').innerText = currentRoom;
        document.getElementById('host-controls').style.display = "block";
        showView('view-game');
        listenToRoom();

    } catch (error) {
        console.error("Error creating room:", error);
        alert("An error occurred while creating the room.");
    } finally {
        createBtn.innerText = "Create Room & Start Game";
        createBtn.disabled = false;
    }
}

// --- PLAYER JOIN FUNCTIONS ---
async function fetchTeams() {
    currentRoom = document.getElementById('player-room-code').value.toUpperCase();
    const name = document.getElementById('player-name').value;
    if(!currentRoom || !name) { alert("Enter code and name."); return; }

    const snapshot = await db.ref(`rooms/${currentRoom}/teams`).once('value');
    if (snapshot.exists()) {
        const teams = snapshot.val();
        const select = document.getElementById('player-team');
        select.innerHTML = "";
        Object.keys(teams).forEach(team => {
            const opt = document.createElement('option');
            opt.value = opt.innerText = team;
            select.appendChild(opt);
        });
        document.getElementById('team-selection').style.display = "block";
        document.getElementById('fetch-teams-btn').style.display = "none";
    } else { alert("Room not found."); }
}

function joinGame() {
    myPlayerId = "player_" + Math.random().toString(36).substr(2, 9);
    myTeam = document.getElementById('player-team').value;
    const name = document.getElementById('player-name').value;

    db.ref(`rooms/${currentRoom}/players/${myPlayerId}`).set({ name, team: myTeam });
    
    document.getElementById('display-room-code').innerText = currentRoom;
    document.getElementById('player-controls').style.display = "block";
    showView('view-game');
    listenToRoom();
}

function buzzIn() {
    const name = document.getElementById('player-name').value;
    const queueRef = db.ref(`rooms/${currentRoom}/gameState/buzzerQueue`);
    queueRef.transaction(currentQueue => {
        let q = currentQueue || [];
        if (!q.find(p => p.id === myPlayerId)) {
            q.push({ id: myPlayerId, name: name, team: myTeam });
        }
        return q;
    });
}

// --- GAME LOGIC SYNC ---
function listenToRoom() {
    db.ref(`rooms/${currentRoom}`).on('value', snapshot => {
        const data = snapshot.val();
        if(!data) return;

        if (data.status === "ended") {
            displayWinner(data);
            return;
        }

        updateScores(data.teams);
        
        const currentRoundData = data.rounds[data.currentRoundIndex];
        document.getElementById('display-round-num').innerText = data.currentRoundIndex + 1;
        updateBoard(currentRoundData, data.gameState);
        
        if (isHost) updateHostControls(currentRoundData, data.gameState);
        else updatePlayerControls(data.gameState);
        
        processBuzzerQueue(data.gameState);
    });
}

function updateScores(teams) {
    const container = document.getElementById('team-scores');
    container.innerHTML = "";
    Object.keys(teams).forEach(team => {
        container.innerHTML += `<div class="team-score">${team}: ${teams[team].score}</div>`;
    });
}

function updateBoard(roundData, gameState) {
    document.getElementById('puzzle-image').src = roundData.image;
    document.getElementById('display-hint1').innerText = "Hint 1: " + roundData.hint1;
    
    const hint2El = document.getElementById('display-hint2');
    if(gameState.showHint2 && roundData.hint2) {
        hint2El.style.display = "block";
        hint2El.innerText = "Hint 2: " + roundData.hint2;
    } else {
        hint2El.style.display = "none";
    }
}

function updatePlayerControls(gameState) {
    const btn = document.getElementById('btn-buzz');
    const status = document.getElementById('player-status');
    const hasBuzzed = (gameState.buzzerQueue || []).some(p => p.id === myPlayerId);
    const isWrong = (gameState.wrongGuesses || []).includes(myPlayerId);

    if (!gameState.buzzerEnabled || isWrong) {
        btn.disabled = true;
    } else if (hasBuzzed) {
        btn.disabled = true;
        status.innerText = "Buzzed in! Waiting...";
    } else {
        btn.disabled = false;
        status.innerText = "Buzzer active!";
    }

    if (gameState.activeBuzzerId === myPlayerId) {
        status.innerText = "YOUR TURN TO ANSWER!";
        status.style.color = "#E50914";
        status.style.fontWeight = "bold";
    } else {
        status.style.color = "white";
        status.style.fontWeight = "normal";
    }
}

function updateHostControls(roundData, gameState) {
    document.getElementById('host-display-answer').innerText = roundData.answer;
    document.getElementById('btn-toggle-buzzer').innerText = gameState.buzzerEnabled ? "Disable Buzzers" : "Enable Buzzers";
}

function processBuzzerQueue(gameState) {
    const listEl = document.getElementById('buzzer-list');
    listEl.innerHTML = "";
    const queue = gameState.buzzerQueue || [];
    const wrong = gameState.wrongGuesses || [];
    const lastWrongTeam = gameState.lastWrongTeam;

    let activePlayer = null;
    let availablePlayers = queue.filter(p => !wrong.includes(p.id));

    if (availablePlayers.length > 0) {
        activePlayer = availablePlayers.find(p => p.team !== lastWrongTeam);
        if (!activePlayer) activePlayer = availablePlayers[0];
    }

    if (isHost && ((activePlayer ? activePlayer.id : null) !== gameState.activeBuzzerId)) {
        db.ref(`rooms/${currentRoom}/gameState/activeBuzzerId`).set(activePlayer ? activePlayer.id : null);
    }

    queue.forEach((p, index) => {
        let li = document.createElement('li');
        li.innerText = `${index + 1}. ${p.name} (${p.team})`;
        if (wrong.includes(p.id)) li.classList.add('wrong');
        else if (activePlayer && p.id === activePlayer.id) li.classList.add('active');
        listEl.appendChild(li);
    });

    if (isHost) {
        const judgePanel = document.getElementById('judging-panel');
        if (activePlayer) {
            judgePanel.style.display = "block";
            document.getElementById('active-player-name').innerText = `${activePlayer.name} (${activePlayer.team})`;
        } else { judgePanel.style.display = "none"; }
    }
}

// --- HOST ACTIONS ---
function toggleBuzzer() {
    db.ref(`rooms/${currentRoom}/gameState/buzzerEnabled`).once('value', s => {
        db.ref(`rooms/${currentRoom}/gameState/buzzerEnabled`).set(!s.val());
    });
}

function revealHint() { db.ref(`rooms/${currentRoom}/gameState/showHint2`).set(true); }

function judgeAnswer(isCorrect) {
    db.ref(`rooms/${currentRoom}`).once('value', snapshot => {
        const data = snapshot.val();
        const activeId = data.gameState.activeBuzzerId;
        if (!activeId) return;

        const activePlayer = data.gameState.buzzerQueue.find(p => p.id === activeId);
        
        if (isCorrect) {
            let newScore = (data.teams[activePlayer.team].score || 0) + 10;
            db.ref(`rooms/${currentRoom}/teams/${activePlayer.team}/score`).set(newScore);
            db.ref(`rooms/${currentRoom}/gameState/buzzerEnabled`).set(false);
            alert(`Correct! 10 points to ${activePlayer.team}.`);
        } else {
            let newScore = (data.teams[activePlayer.team].score || 0) - 5;
            db.ref(`rooms/${currentRoom}/teams/${activePlayer.team}/score`).set(newScore);
            let wrongGuesses = data.gameState.wrongGuesses || [];
            wrongGuesses.push(activeId);
            db.ref(`rooms/${currentRoom}/gameState/wrongGuesses`).set(wrongGuesses);
            db.ref(`rooms/${currentRoom}/gameState/lastWrongTeam`).set(activePlayer.team);
        }
    });
}

function startNextRound() {
    db.ref(`rooms/${currentRoom}`).once('value', snapshot => {
        const data = snapshot.val();
        const nextIndex = data.currentRoundIndex + 1;
        
        if (nextIndex >= data.rounds.length) {
            db.ref(`rooms/${currentRoom}/status`).set("ended");
        } else {
            db.ref(`rooms/${currentRoom}`).update({
                currentRoundIndex: nextIndex,
                gameState: {
                    showHint2: false,
                    buzzerEnabled: false,
                    buzzerQueue: [],
                    wrongGuesses: [],
                    activeBuzzerId: null,
                    lastWrongTeam: null
                }
            });
        }
    });
}

// --- ENDGAME LOGIC ---
function displayWinner(data) {
    showView('view-endgame');
    
    let winningTeam = "";
    let highestScore = -Infinity;
    
    Object.keys(data.teams).forEach(team => {
        if (data.teams[team].score > highestScore) {
            highestScore = data.teams[team].score;
            winningTeam = team;
        }
    });

    document.getElementById('winner-team-display').innerText = `🏆 Congratulations to ${winningTeam}!`;
    document.getElementById('winner-score-display').innerText = `Final Score: ${highestScore} Points`;

    const ul = document.getElementById('winner-members-list');
    ul.innerHTML = "";
    
    if (data.players) {
        Object.keys(data.players).forEach(pId => {
            if (data.players[pId].team === winningTeam) {
                const li = document.createElement('li');
                li.innerText = data.players[pId].name;
                ul.appendChild(li);
            }
        });
    } else {
        ul.innerHTML = "<li>No registered players</li>";
    }

    if (isHost) {
        document.getElementById('host-endgame-controls').style.display = "block";
    }
}
