const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"]
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// ===================== DATABASE =====================
let users = null;

async function connectDB() {
  if (!MONGO_URI) {
    console.log("No MONGO_URI found.");
    return;
  }

  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db("neonbattle");
    users = db.collection("users");

    console.log("Mongo Connected ✅");
  } catch (err) {
    console.log("Mongo Failed:", err.message);
  }
}
connectDB();

async function ensureUser(username) {
  if (!users) return {
    username,
    wins: 0,
    coins: 0,
    games: 0
  };

  let user = await users.findOne({ username });

  if (!user) {
    await users.insertOne({
      username,
      wins: 0,
      coins: 0,
      games: 0
    });

    user = await users.findOne({ username });
  }

  return user;
}

async function addGame(username) {
  if (!users) return;
  await users.updateOne(
    { username },
    { $inc: { games: 1 } }
  );
}

async function addWin(username) {
  if (!users) return;
  await users.updateOne(
    { username },
    { $inc: { wins: 1, coins: 50 } }
  );
}

function rankFromWins(wins) {
  if (wins >= 50) return "Champion";
  if (wins >= 30) return "Diamond";
  if (wins >= 15) return "Gold";
  if (wins >= 5) return "Silver";
  return "Bronze";
}

// ===================== GAME =====================
let players = [];
let started = false;
let playing = false;
let timer = 10;
let scores = {};
let loop = null;

function alivePlayers() {
  return players.filter(p => !p.out);
}

function getPlayer(id) {
  return players.find(p => p.id === id);
}

function resetLobby() {
  players = [];
  started = false;
  playing = false;
  timer = 10;
  scores = {};
  if (loop) clearInterval(loop);
}

function sendPlayers() {
  io.emit("players", players);
}

function startRound() {
  if (alivePlayers().length <= 1) return;

  playing = true;
  timer = 10;
  scores = {};

  alivePlayers().forEach(p => {
    scores[p.id] = 0;
  });

  io.emit("roundStart");

  loop = setInterval(() => {
    timer--;
    io.emit("tick", timer);

    if (timer <= 0) {
      clearInterval(loop);
      endRound();
    }
  }, 1000);
}

async function endRound() {
  playing = false;

  const board = alivePlayers()
    .map(p => ({
      id: p.id,
      name: p.name,
      score: scores[p.id] || 0
    }))
    .sort((a, b) => a.score - b.score);

  const loser = getPlayer(board[0].id);
  if (loser) loser.out = true;

  sendPlayers();
  io.emit("scoreboard", board);
  io.emit("message", "❌ " + loser.name + " eliminated");

  if (alivePlayers().length === 1) {
    const winner = alivePlayers()[0];
    await addWin(winner.name);

    io.emit("message", "👑 " + winner.name + " wins!");
    started = false;
    return;
  }

  setTimeout(startRound, 4000);
}

// ===================== CSS =====================
function css() {
return `
<style>
body{
margin:0;
padding:0;
font-family:Arial;
background:#050505;
color:white;
text-align:center;
}
.wrap{
max-width:760px;
margin:auto;
padding:25px;
}
.card{
background:#111;
padding:25px;
border-radius:18px;
box-shadow:0 0 25px #00ffe1;
margin-top:20px;
}
input{
padding:14px;
width:240px;
border:none;
border-radius:10px;
background:#222;
color:#fff;
font-size:16px;
}
button,a.btn{
padding:12px 18px;
margin:6px;
border:none;
border-radius:10px;
background:#00ffe1;
color:#000;
font-weight:bold;
cursor:pointer;
text-decoration:none;
display:inline-block;
}
button:hover,a.btn:hover{
opacity:.9;
}
pre{
text-align:left;
background:#000;
padding:15px;
border-radius:12px;
white-space:pre-line;
overflow:auto;
}
.small{
opacity:.8;
font-size:14px;
}
</style>
`;
}

// ===================== HOME =====================
app.get("/", (req, res) => {
res.send(`
<html>
<head>
<title>Neon Battle V5.1</title>
${css()}
</head>
<body>
<div class="wrap">
<div class="card">
<h1>⚡ Neon Battle ⚡</h1>

<input id="user" placeholder="Enter username">
<button onclick="join()">JOIN</button>

<div style="margin-top:15px">
<button onclick="openPage('/profile')">👤 Profile</button>
<button onclick="openPage('/leaderboard')">🏆 Leaderboard</button>
</div>

<h2 id="status">Waiting for 5 players...</h2>
<h3 id="timer"></h3>

<button id="tapBtn" style="display:none;font-size:28px;padding:20px" onclick="socket.emit('score')">TAP!</button>

<pre id="players"></pre>
<pre id="scores"></pre>

<p class="small">Winner gets +50 coins</p>
</div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();

function el(x){ return document.getElementById(x); }

function username(){
 return el("user").value.trim();
}

function join(){
 socket.emit("join", username());
}

function openPage(path){
 let u = username();
 if(!u) u = "Guest";
 location.href = path + "?user=" + encodeURIComponent(u);
}

socket.on("joined", ()=>{
 el("user").style.display="none";
});

socket.on("message", msg=>{
 el("status").innerText = msg;
});

socket.on("players", list=>{
 let txt = "👥 PLAYERS\\n\\n";
 list.forEach(p=>{
   txt += p.name + (p.out ? " ❌ OUT" : " ✅ IN") + "\\n";
 });
 el("players").innerText = txt;
});

socket.on("tick", t=>{
 el("timer").innerText = "⏱ " + t;
});

socket.on("roundStart", ()=>{
 el("status").innerText = "⚡ TAP FAST!";
 el("tapBtn").style.display="inline-block";
 el("scores").innerText="";
});

socket.on("scoreboard", board=>{
 let txt = "🏆 ROUND SCORES\\n\\n";
 board.forEach((p,i)=>{
   txt += (i+1)+". " + p.name + " - " + p.score + "\\n";
 });
 el("scores").innerText = txt;
 el("tapBtn").style.display="none";
});
</script>
</body>
</html>
`);
});

// ===================== PROFILE =====================
app.get("/profile", async (req, res) => {
  const username = String(req.query.user || "Guest").trim();

  const user = await ensureUser(username);

  res.send(`
  <html>
  <head>${css()}</head>
  <body>
  <div class="wrap">
  <div class="card">
  <h1>👤 ${user.username}</h1>
  <h2>💰 Coins: ${user.coins}</h2>
  <h2>🏆 Wins: ${user.wins}</h2>
  <h2>🎮 Games: ${user.games}</h2>
  <h2>🥇 Rank: ${rankFromWins(user.wins)}</h2>
  <a class="btn" href="/">⬅ Home</a>
  </div>
  </div>
  </body>
  </html>
  `);
});

// ===================== LEADERBOARD =====================
app.get("/leaderboard", async (req, res) => {
  let html = "";

  if (users) {
    const top = await users.find().sort({ wins: -1 }).limit(10).toArray();

    top.forEach((u, i) => {
      html += `<h3>${i+1}. ${u.username} - ${u.wins} wins</h3>`;
    });
  } else {
    html = "<h3>Database offline</h3>";
  }

  res.send(`
  <html>
  <head>${css()}</head>
  <body>
  <div class="wrap">
  <div class="card">
  <h1>🏆 Leaderboard</h1>
  ${html}
  <a class="btn" href="/">⬅ Home</a>
  </div>
  </div>
  </body>
  </html>
  `);
});

// ===================== SOCKETS =====================
io.on("connection", socket => {

socket.on("join", async username => {
  try {
    if (started) {
      socket.emit("message", "Game already started");
      return;
    }

    if (players.length >= 5) {
      socket.emit("message", "Lobby full");
      return;
    }

    username = String(username || "").trim();
    if (!username) username = "Player" + (players.length + 1);

    await ensureUser(username);
    await addGame(username);

    players.push({
      id: socket.id,
      name: username,
      out: false
    });

    socket.emit("joined");
    sendPlayers();

    io.emit("message", players.length + "/5 Joined");

    if (players.length === 5) {
      started = true;
      io.emit("message", "🔥 5 Players Joined! Starting...");
      setTimeout(startRound, 3000);
    }

  } catch (err) {
    console.log(err);
    socket.emit("message", "Join failed");
  }
});

socket.on("score", () => {
  const p = getPlayer(socket.id);
  if (!p || p.out || !playing) return;

  scores[socket.id] = (scores[socket.id] || 0) + 1;
});

socket.on("disconnect", () => {
  players = players.filter(p => p.id !== socket.id);
  sendPlayers();

  if (players.length === 0) {
    resetLobby();
  }
});

});

// ===================== START =====================
server.listen(PORT, () => {
  console.log("Running on port " + PORT);
});