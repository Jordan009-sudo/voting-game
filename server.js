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

// ================= DB =================
let users = null;

async function connectDB() {
  if (!MONGO_URI) {
    console.log("No MONGO_URI set. Running without DB.");
    return;
  }

  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db("neonbattle");
    users = db.collection("users");
    console.log("Mongo Connected ✅");
  } catch (err) {
    console.log("Mongo Failed, continuing without DB:", err.message);
  }
}
connectDB();

async function safeCreateUser(username) {
  if (!users) return;
  const found = await users.findOne({ username });
  if (!found) {
    await users.insertOne({
      username,
      wins: 0,
      coins: 0,
      games: 0
    });
  }
}

async function safeAddGame(username) {
  if (!users) return;
  await users.updateOne({ username }, { $inc: { games: 1 } });
}

async function safeAddWin(username) {
  if (!users) return;
  await users.updateOne(
    { username },
    { $inc: { wins: 1, coins: 50 } }
  );
}

// ================= GAME =================
let players = [];
let started = false;
let playing = false;
let scores = {};
let timer = 10;
let loop = null;

const games = ["tap", "math", "door", "spam"];
let currentGame = "tap";

function alive() {
  return players.filter(p => !p.out);
}

function getPlayer(id) {
  return players.find(p => p.id === id);
}

function canPlay(id) {
  const p = getPlayer(id);
  return p && !p.out && playing;
}

function sendPlayers() {
  io.emit("players", players);
}

function resetGame() {
  players = [];
  started = false;
  playing = false;
  scores = {};
  if (loop) clearInterval(loop);
}

function startRound() {
  if (alive().length <= 1) return;

  currentGame = games[Math.floor(Math.random() * games.length)];
  playing = true;
  timer = 10;
  scores = {};

  alive().forEach(p => scores[p.id] = 0);

  io.emit("roundStart", { game: currentGame });

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

  const board = alive()
    .map(p => ({
      id: p.id,
      name: p.name,
      points: scores[p.id] || 0
    }))
    .sort((a, b) => a.points - b.points);

  const loser = getPlayer(board[0].id);
  loser.out = true;

  sendPlayers();
  io.emit("scoreboard", board);
  io.emit("roundEnd", {
    name: loser.name,
    points: board[0].points
  });

  if (alive().length === 1) {
    const winner = alive()[0];
    await safeAddWin(winner.name);
    io.emit("winner", winner.name);
    started = false;
    return;
  }

  setTimeout(startRound, 4000);
}

// ================= PAGE =================
app.get("/", (req, res) => {
res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neon Battle</title>
<style>
body{background:#050505;color:#fff;font-family:Arial;text-align:center;padding:20px}
.box{max-width:700px;margin:auto;background:#111;padding:25px;border-radius:20px;box-shadow:0 0 25px #00ffe1}
input,button{padding:14px;margin:6px;border:none;border-radius:10px;font-size:16px}
input{background:#222;color:#fff}
button{background:#00ffe1;font-weight:bold}
.hidden{display:none}
#players,#score{white-space:pre-line;text-align:left;background:#000;padding:15px;border-radius:12px;margin-top:15px}
</style>
</head>
<body>
<div class="box">
<h1>⚡ Neon Battle ⚡</h1>

<div id="joinBox">
<input id="username" placeholder="Your Name">
<button onclick="join()">JOIN</button>
</div>

<h2 id="status">Waiting for 5 players...</h2>
<h3 id="timer"></h3>

<button id="tapBtn" class="hidden" onclick="socket.emit('score')">TAP!</button>

<div id="players"></div>
<div id="score"></div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io({transports:["websocket","polling"]});

function el(x){return document.getElementById(x)}

function join(){
 const n = el("username").value.trim();
 socket.emit("join", n);
}

socket.on("joined", ()=>{
 el("joinBox").style.display="none";
});

socket.on("message", msg=>{
 el("status").innerText = msg;
});

socket.on("players", list=>{
 let txt="👥 PLAYERS\\n\\n";
 list.forEach(p=>{
   txt += p.name + (p.out?" ❌ OUT":" ✅ IN") + "\\n";
 });
 el("players").innerText = txt;
});

socket.on("tick", t=>{
 el("timer").innerText = "⏱ " + t;
});

socket.on("roundStart", data=>{
 el("score").innerText="";
 if(data.game==="tap"){
   el("status").innerText="⚡ TAP RACE";
   el("tapBtn").classList.remove("hidden");
 } else {
   el("status").innerText="🎮 " + data.game.toUpperCase();
   el("tapBtn").classList.add("hidden");
 }
});

socket.on("scoreboard", board=>{
 let txt="🏆 SCORES\\n\\n";
 board.forEach((p,i)=>{
   txt += (i+1)+". "+p.name+" - "+p.points+"\\n";
 });
 el("score").innerText = txt;
});

socket.on("roundEnd", d=>{
 el("status").innerText = "❌ "+d.name+" eliminated";
 el("tapBtn").classList.add("hidden");
});

socket.on("winner", name=>{
 el("status").innerText = "👑 "+name+" wins!";
});
</script>
</body>
</html>
`);
});

// ================= SOCKETS =================
io.on("connection", socket => {

socket.on("join", async username => {
  try {
    if (started) {
      socket.emit("message", "Game already started");
      return;
    }

    if (players.length >= 5) {
      socket.emit("message", "Lobby Full");
      return;
    }

    username = String(username || "").trim();
    if (!username) username = "Player" + (players.length + 1);

    // Join FIRST
    players.push({
      id: socket.id,
      name: username,
      out: false
    });

    socket.emit("joined");
    sendPlayers();
    io.emit("message", players.length + "/5 Joined");

    // Save in background
    safeCreateUser(username);
    safeAddGame(username);

    if (players.length === 5) {
      started = true;
      io.emit("message", "5 Players Joined! Starting...");
      setTimeout(startRound, 3000);
    }

  } catch (e) {
    socket.emit("message", "Join failed");
    console.log(e);
  }
});

socket.on("score", ()=>{
  if (!canPlay(socket.id)) return;
  scores[socket.id] = (scores[socket.id] || 0) + 1;
});

socket.on("disconnect", ()=>{
  players = players.filter(p => p.id !== socket.id);
  sendPlayers();
  if (players.length === 0) resetGame();
});

});

server.listen(PORT, () => {
  console.log("Running on " + PORT);
});