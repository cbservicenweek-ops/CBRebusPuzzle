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
let modalCallback = null;
let lastAlertTimestamp = 0; // Tracks the newest alert

// --- CUSTOM UI HELPERS ---
function showView(viewId) {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

function customAlert(message, title = "Notice", callback = null) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-text').innerText = message;
    document.getElementById('custom-modal').classList.add('active');
    modalCallback = callback;
}

function closeModal() {
    document.getElementById('custom-modal').classList.remove('active');
    if (modalCallback) {
        modalCallback();
        modalCallback = null;
    }
}

function triggerFireworks() {
    var duration = 15 * 1000;
    var animationEnd = Date.now() + duration;
    var defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

    function randomInRange(min, max) { return Math.random() * (max - min) + min; }

    var interval = setInterval(function() {
        var timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) { return clearInterval(interval); }
        var particleCount = 50 * (timeLeft / duration);
        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
    }, 250);
}

// --- CORE LOGIC ---
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
                const MAX_WIDTH = 800; 
                let width = img.width;
                let height = img.height;
                if (width > MAX_WIDTH) { height = Math.round((height * MAX_WIDTH) / width); width = MAX_WIDTH; }
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
    });
}

function generateCode() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }

// --- HOST SETUP ---
function verifyHost() {
    const pw = document.getElementById('host-password').value;
    if (pw === "Bryan") { isHost = true; showView('view-host-setup'); } 
    else { customAlert("Incorrect password", "Access Denied"); }
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

async function createRoom(event) {
    const teamsRaw = document.getElementById('host-teams').value;
    if (!teamsRaw) { customAlert("Please enter team names.", "Setup Error"); return; }

    const roundBlocks = document.querySelectorAll('.round-setup-block');
    let roundsData = [];
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
                customAlert("Please ensure all rounds have an image, hint 1, and an answer.", "Setup Error"); 
                createBtn.innerText = "Create Room & Start Game";
                createBtn.disabled = false;
                return;
            }
            const b64Image = await compressImageAndGetBase64(file);
            roundsData.push({ image: b64Image, hint1, hint2, answer });
        }

        currentRoom = generateCode();
        let teams = {};
        teamsRaw.split(',').forEach(t => { if(t.trim()) teams[t.trim()] = { score: 0 }; });

        const roomData = {
            status: "playing",
            teams: teams,
            players: {},
            rounds: roundsData,
            currentRoundIndex: 0,
            gameState: {
                showHint2: false, buzzerEnabled: false, buzzerQueue: [], 
                wrongGuesses: [], activeBuzzerId: null, lastWrongTeam: null, alertEvent: null
            }
        };

        await db.ref(`rooms/${currentRoom}`).set(roomData);
        document.getElementById('display-room-code').innerText = currentRoom;
        document.getElementById('host-controls').style.display = "block";
        showView('view-game');
        listenToRoom();
    } catch (error) {
        console.error(error);
        customAlert("An error occurred while creating the room.", "Error");
    } finally {
        createBtn.innerText = "Create Room & Start Game";
        createBtn.disabled = false;
    }
}

// --- PLAYER JOIN ---
async function fetchTeams() {
    currentRoom = document.getElementById('player-room-code').value.toUpperCase();
    const name = document.getElementById('player-name').value;
    if(!currentRoom || !name) { customAlert("Enter code and name.", "Hold on"); return; }

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
    } else { customAlert("Room not found.", "Error"); }
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
        if (!q.find(p => p.id === myPlayerId)) { q.push({ id: myPlayerId, name: name, team: myTeam }); }
        return q;
    });
}

// --- GAME LOGIC SYNC ---
function listenToRoom() {
    db.ref(`rooms/${currentRoom}`).on('value', snapshot => {
        const data = snapshot.val();
        if(!data) return;

        if (data.status === "ended") { displayWinner(data); return; }

        updateScores(data.teams);
        const currentRoundData = data.rounds[data.currentRoundIndex];
        document.getElementById('display-round-num').innerText = data.currentRoundIndex + 1;
        
        updateBoard(currentRoundData, data.gameState);
        
        if (isHost) updateHostControls(currentRoundData, data.gameState);
        else updatePlayerControls(data.gameState);
        
        processBuzzerQueue(data.gameState);

        // --- GLOBAL ALERT SYSTEM ---
        if (data.gameState.alertEvent) {
            const alertData = data.gameState.alertEvent;
            
            // Only trigger if this is a brand new alert
            if (alertData.timestamp > lastAlertTimestamp) {
                lastAlertTimestamp = alertData.timestamp;
                
                // If it's correct, only the Host gets the callback to advance the game
                if (isHost && alertData.type === "correct") {
                    customAlert(alertData.message, alertData.title, () => {
                        startNextRound();
                    });
                } else {
                    // Players just view the message and hit OK to close locally
                    customAlert(alertData.message, alertData.title);
                }
            }
        }
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
    document.querySelector('#display-hint1 span').innerText = roundData.hint1;
    
    const hint2El = document.getElementById('display-hint2');
    if(gameState.showHint2 && roundData.hint2) {
        hint2El.style.display = "block";
        hint2El.querySelector('span').innerText = roundData.hint2;
    } else {
        hint2El.style.display = "none";
    }
}

function updatePlayerControls(gameState) {
    const btn = document.getElementById('btn-buzz');
    const status = document.getElementById('player-status');
    const hasBuzzed = (gameState.buzzerQueue || []).some(p => p.id === myPlayerId);
    const isWrong = (gameState.wrongGuesses || []).includes(myPlayerId);

    let availablePlayers = (gameState.buzzerQueue || []).filter(p => !(gameState.wrongGuesses || []).includes(p.id));
    let myIndex = availablePlayers.findIndex(p => p.id === myPlayerId);

    if (!gameState.buzzerEnabled || isWrong) {
        btn.disabled = true;
    } else if (hasBuzzed) {
        btn.disabled = true;
    } else {
        btn.disabled = false;
    }

    if (gameState.activeBuzzerId === myPlayerId) {
        status.innerHTML = `<div class="turn-notice">Your Turn to Answer!</div>`;
    } else if (hasBuzzed && !isWrong) {
        status.innerHTML = `<div class="queue-notice">Buzzed in! You are <span class="queue-number">#${myIndex + 1}</span> in line.</div>`;
    } else if (isWrong) {
        status.innerHTML = `<div class="queue-notice" style="color:#dc3545;">Incorrect guess. Waiting for next round.</div>`;
    } else {
        status.innerHTML = ``;
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
        li.innerText = `${p.name} (${p.team})`;
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
        const currentAnswer = data.rounds[data.currentRoundIndex].answer;
        
        if (isCorrect) {
            let newScore = (data.teams[activePlayer.team].score || 0) + 10;
            
            db.ref(`rooms/${currentRoom}/teams/${activePlayer.team}/score`).set(newScore);
            db.ref(`rooms/${currentRoom}/gameState`).update({
                buzzerEnabled: false,
                alertEvent: {
                    title: "Correct! 🎉",
                    message: `${activePlayer.team} got it right!\n\nThe answer was: ${currentAnswer}`,
                    type: "correct",
                    timestamp: Date.now()
                }
            });
        } else {
            let newScore = (data.teams[activePlayer.team].score || 0) + 5;
            let wrongGuesses = data.gameState.wrongGuesses || [];
            wrongGuesses.push(activeId);
            
            db.ref(`rooms/${currentRoom}/teams/${activePlayer.team}/score`).set(newScore);
            db.ref(`rooms/${currentRoom}/gameState`).update({
                wrongGuesses: wrongGuesses,
                lastWrongTeam: activePlayer.team,
                alertEvent: {
                    title: "Incorrect! ❌",
                    message: `${activePlayer.name} guessed incorrectly. Moving to the next player!`,
                    type: "incorrect",
                    timestamp: Date.now()
                }
            });
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
                    lastWrongTeam: null,
                    alertEvent: null // Clear the alert for the new round
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

    // FIREWORKS
    triggerFireworks();
}
