const firebaseConfig = {
  apiKey: "AIzaSyACUjgoLEGh0RsiKS4B1MUyrwUbJUmLeSc",
  authDomain: "cbrebuspuzzle.firebaseapp.com",
  databaseURL: "https://cbrebuspuzzle-default-rtdb.firebaseio.com/",
  projectId: "cbrebuspuzzle",
  storageBucket: "cbrebuspuzzle.firebasestorage.app",
  messagingSenderId: "599192549189",
  appId: "1:599192549189:web:5f47874eaae9e1c948b02c"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// State Variables
let isHost = false;
let currentRoom = "";
let myPlayerId = "";
let myTeam = "";

// UI Helper
function showView(viewId) {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

// Helper: Convert Image to Base64
function getBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// Generate random 4-letter room code
function generateCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// --- HOST FUNCTIONS ---

function verifyHost() {
    const pw = document.getElementById('host-password').value;
    if (pw === "Bryan") {
        isHost = true;
        showView('view-host-setup');
    } else {
        alert("Incorrect password");
    }
}

async function createRoom() {
    const file = document.getElementById('host-image').files[0];
    const hint1 = document.getElementById('host-hint1').value;
    const hint2 = document.getElementById('host-hint2').value;
    const answer = document.getElementById('host-answer').value;
    const teamsRaw = document.getElementById('host-teams').value;

    if (!file || !hint1 || !answer || !teamsRaw) {
        alert("Please fill all fields and upload an image."); return;
    }

    const b64Image = await getBase64(file);
    currentRoom = generateCode();
    
    // Parse Teams and initialize scores to 0
    let teams = {};
    teamsRaw.split(',').forEach(t => {
        teams[t.trim()] = { score: 0 };
    });

    const roomData = {
        teams: teams,
        round: {
            image: b64Image,
            hint1: hint1,
            hint2: hint2,
            answer: answer,
            showHint2: false,
            buzzerEnabled: false,
            buzzerQueue: [], // Array of objects: {id, name, team}
            wrongGuesses: [], // Array of ids
            activeBuzzerId: null,
            lastWrongTeam: null
        }
    };

    await db.ref(`rooms/${currentRoom}`).set(roomData);
    
    document.getElementById('display-room-code').innerText = currentRoom;
    document.getElementById('host-controls').style.display = "block";
    showView('view-game');
    listenToRoom();
}

// --- PLAYER FUNCTIONS ---

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
    } else {
        alert("Room not found.");
    }
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
    
    // Add to buzzer queue transactionally to ensure exact order
    const queueRef = db.ref(`rooms/${currentRoom}/round/buzzerQueue`);
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

        updateScores(data.teams);
        updateBoard(data.round);
        
        if (isHost) updateHostControls(data.round);
        else updatePlayerControls(data.round);
        
        processBuzzerQueue(data.round);
    });
}

function updateScores(teams) {
    const container = document.getElementById('team-scores');
    container.innerHTML = "";
    Object.keys(teams).forEach(team => {
        container.innerHTML += `<div class="team-score">${team}: ${teams[team].score}</div>`;
    });
}

function updateBoard(round) {
    document.getElementById('puzzle-image').src = round.image;
    document.getElementById('display-hint1').innerText = "Hint 1: " + round.hint1;
    
    const hint2El = document.getElementById('display-hint2');
    if(round.showHint2 && round.hint2) {
        hint2El.style.display = "block";
        hint2El.innerText = "Hint 2: " + round.hint2;
    } else {
        hint2El.style.display = "none";
    }
}

function updatePlayerControls(round) {
    const btn = document.getElementById('btn-buzz');
    const status = document.getElementById('player-status');
    const hasBuzzed = (round.buzzerQueue || []).some(p => p.id === myPlayerId);
    const isWrong = (round.wrongGuesses || []).includes(myPlayerId);

    if (!round.buzzerEnabled || isWrong) {
        btn.disabled = true;
    } else if (hasBuzzed) {
        btn.disabled = true;
        status.innerText = "Buzzed in! Waiting...";
    } else {
        btn.disabled = false;
        status.innerText = "Buzzer active!";
    }

    if (round.activeBuzzerId === myPlayerId) {
        status.innerText = "YOUR TURN TO ANSWER!";
        status.style.color = "#E50914";
        status.style.fontWeight = "bold";
    } else {
        status.style.color = "white";
        status.style.fontWeight = "normal";
    }
}

function updateHostControls(round) {
    document.getElementById('host-display-answer').innerText = round.answer;
    document.getElementById('btn-toggle-buzzer').innerText = round.buzzerEnabled ? "Disable Buzzers" : "Enable Buzzers";
}

function processBuzzerQueue(round) {
    const listEl = document.getElementById('buzzer-list');
    listEl.innerHTML = "";
    const queue = round.buzzerQueue || [];
    const wrong = round.wrongGuesses || [];
    const lastWrongTeam = round.lastWrongTeam;

    // Determine Active Player considering Team Skips
    let activePlayer = null;
    let availablePlayers = queue.filter(p => !wrong.includes(p.id));

    if (availablePlayers.length > 0) {
        // Find first player NOT on the last wrong team
        activePlayer = availablePlayers.find(p => p.team !== lastWrongTeam);
        
        // If all available players are on the last wrong team, revert back to normal sequence
        if (!activePlayer) activePlayer = availablePlayers[0];
    }

    // Update active player in DB if changed (Host handles DB updates to avoid conflict)
    if (isHost && ((activePlayer ? activePlayer.id : null) !== round.activeBuzzerId)) {
        db.ref(`rooms/${currentRoom}/round/activeBuzzerId`).set(activePlayer ? activePlayer.id : null);
    }

    // Render Queue
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
        } else {
            judgePanel.style.display = "none";
        }
    }
}

// --- HOST ACTIONS ---

function toggleBuzzer() {
    db.ref(`rooms/${currentRoom}/round/buzzerEnabled`).once('value', s => {
        db.ref(`rooms/${currentRoom}/round/buzzerEnabled`).set(!s.val());
    });
}

function revealHint() {
    db.ref(`rooms/${currentRoom}/round/showHint2`).set(true);
}

function judgeAnswer(isCorrect) {
    db.ref(`rooms/${currentRoom}`).once('value', snapshot => {
        const data = snapshot.val();
        const activeId = data.round.activeBuzzerId;
        if (!activeId) return;

        const activePlayer = data.round.buzzerQueue.find(p => p.id === activeId);
        
        if (isCorrect) {
            // Correct: +10 points, end round
            let newScore = (data.teams[activePlayer.team].score || 0) + 10;
            db.ref(`rooms/${currentRoom}/teams/${activePlayer.team}/score`).set(newScore);
            db.ref(`rooms/${currentRoom}/round/buzzerEnabled`).set(false);
            alert(`Correct! 10 points to ${activePlayer.team}. Proceed to next round.`);
        } else {
            // Wrong: -5 points, mark wrong, track team to skip
            let newScore = (data.teams[activePlayer.team].score || 0) - 5;
            db.ref(`rooms/${currentRoom}/teams/${activePlayer.team}/score`).set(newScore);
            
            let wrongGuesses = data.round.wrongGuesses || [];
            wrongGuesses.push(activeId);
            db.ref(`rooms/${currentRoom}/round/wrongGuesses`).set(wrongGuesses);
            db.ref(`rooms/${currentRoom}/round/lastWrongTeam`).set(activePlayer.team);
        }
    });
}

async function startNextRound() {
    const file = document.getElementById('next-image').files[0];
    const hint1 = document.getElementById('next-hint1').value;
    const hint2 = document.getElementById('next-hint2').value;
    const answer = document.getElementById('next-answer').value;

    if (!file || !hint1 || !answer) {
        alert("Upload image, Hint 1, and Answer to proceed."); return;
    }

    const b64Image = await getBase64(file);
    
    db.ref(`rooms/${currentRoom}/round`).update({
        image: b64Image,
        hint1: hint1,
        hint2: hint2,
        answer: answer,
        showHint2: false,
        buzzerEnabled: false,
        buzzerQueue: [],
        wrongGuesses: [],
        activeBuzzerId: null,
        lastWrongTeam: null
    });

    // Clear host inputs
    document.getElementById('next-image').value = "";
    document.getElementById('next-hint1').value = "";
    document.getElementById('next-hint2').value = "";
    document.getElementById('next-answer').value = "";
}