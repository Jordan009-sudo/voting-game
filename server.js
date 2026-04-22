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

// =======================
// DATABASE
// =======================

let db;
let users;

async function connectDB() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();

    db = client.db("neonbattle");
    users = db.collection("users");

    console.log("MongoDB Connected");
  } catch (err) {
    console.log("Mongo Error:", err);
  }
}

connectDB();

// =======================
// GAME STATE
// =======================

let players = [];
let started = false;
let playing = false;
let round = 1;
let timer = 10;
let currentGame = "";
let scores = {};
let loop = null;

const games = ["tap", "math", "door", "spam"];

// =======================
// HELPERS
// =======================

function alivePlayers() {
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
  round = 1;
  timer = 10;
  currentGame = "";
  scores = {};
  if (loop) clearInterval(loop);
}

function randomGame() {
  currentGame = games[Math.floor(Math.random() * games.length)];
}

// =======================
// DATABASE HELPERS
// =======================

async function getOrCreateUser(username) {
  let user = await users.findOne({ username });

  if (!user) {
    user = {
      username,
      wins: 0,
      coins: 0,
      games: 0
    };

    await users.insertOne(user);
  }

  return user;
}

async function addCoins(username, amount) {
  await users.updateOne(
    { username },
    { $inc: { coins: amount } }
  );
}

async function addWin(username) {
  await users.updateOne(
    { username },
    {
      $inc: {
        wins: 1,
        coins: 50
      }
    }
  );
}

async function addGame(username) {
  await users.updateOne(
    { username },
    { $inc: { games: 1 } }
  );
}

// =======================
// GAME FLOW
// =======================

function startRound() {
  if (alivePlayers().length <= 1) return;

  randomGame();
  playing = true;
  timer = 10;
  scores = {};

  alivePlayers().forEach(p => {
    scores[p.id] = 0;
  });

  io.emit("roundStart", {
    round,
    game: currentGame
  });

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
      points: scores[p.id] || 0
    }))
    .sort((a, b) => a.points - b.points);

  const loser = board[0];
  const target = getPlayer(loser.id);

  if (target) target.out = true;

  sendPlayers();

  io.emit("scoreboard", board);

  io.emit("roundEnd", {
    name: loser.name,
    points: loser.points
  });

  // everyone gets coins
  for (const p of board) {
    await addCoins(p.name, 10);
  }

  if (alivePlayers().length === 1) {
    const winner = alivePlayers()[0];

    await addWin(winner.name);

    io.emit("winner", winner.name);

    started = false;
    return;
  }

  round++;
  setTimeout(startRound, 5000);
}

// =======================
// WEBSITE
// =======================

app.get("/", (req, res) => {
res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neon Battle V5</title>

<style>
body{
margin:0;
padding:20px;
font-family:Arial;
background:#050505;
color:white;
text-align:center;
}

.panel{
max-width:700px;
margin:auto;
background:#111;
padding:25px;
border-radius:20px;
box-shadow:0 0 25px #00ffe1;
}

input,button{
padding:14px;
margin:6px;
border:none;
border-radius:10px;
font-size:16px;
}

input{
width:220px;
background:#222;
color:white;
}

button{
background:#00ffe1;
font-weight:bold;
cursor:pointer;
}

.big{
font-size:28px;
padding:22px 40px;
}

.hidden{
display:none;
}

.red{background:#ff0055;color:white;}
.green{background:#00ff88;color:black;}

#players,#scoreboard{
margin-top:15px;
padding:15px;
background:#000;
border-radius:12px;
white-space:pre-line;
text-align:left;
}

#spamBox{
display:grid;
grid-template-columns:repeat(4,1fr);
gap:8px;
margin-top:10px;
}
</style>
</head>
<body>

<div class="panel">

<h1>⚡ Neon Battle V5 ⚡</h1>

<div id="joinBox">
<input id="username" placeholder="Your Name">
<button onclick="join()">JOIN</button>
</div>

<h2 id="status">Waiting for 5 players...</h2>
<h3 id="timer"></h3>

<button id="mainBtn" class="big hidden" onclick="socket.emit('score')">TAP!</button>

<div id="mathBox" class="hidden">
<h2 id="mathQ"></h2>
<input id="mathA">
<button onclick="submitMath()">Submit</button>
</div>

<div id="doorBox" class="hidden">
<button onclick="socket.emit('door',1)">🚪1</button>
<button onclick="socket.emit('door',2)">🚪2</button>
<button onclick="socket.emit('door',3)">🚪3</button>
</div>

<div id="spamBox" class="hidden"></div>

<div id="players"></div>
<div id="scoreboard"></div>

</div>

<script src="/socket.io/socket.io.js"></script>

<script>
const socket = io({
 transports:["websocket","polling"]
});

let answer = 0;

function el(id){
 return document.getElementById(id);
}

function hideGames(){
 el("mainBtn").classList.add("hidden");
 el("mathBox").classList.add("hidden");
 el("doorBox").classList.add("hidden");
 el("spamBox").classList.add("hidden");
}

function join(){
 const username = el("username").value.trim();
 socket.emit("join", username);
}

function submitMath(){
 if(Number(el("mathA").value) === answer){
   socket.emit("score");
 }
}

function buildSpam(){
 const box = el("spamBox");
 box.classList.remove("hidden");

 function render(){
   box.innerHTML = "";

   const target = Math.floor(Math.random()*12);

   for(let i=0;i<12;i++){

     const b = document.createElement("button");

     if(i===target){
       b.innerText="TARGET";
       b.className="green";
       b.onclick=()=>{
         socket.emit("score");
         render();
       };
     }else{
       b.innerText="FAKE";
       b.className="red";
       b.onclick=()=>{
         socket.emit("minus");
       };
     }

     box.appendChild(b);
   }
 }

 render();
}

socket.on("joined", ()=>{
 el("joinBox").style.display="none";
});

socket.on("message", msg=>{
 el("status").innerText = msg;
});

socket.on("tick", t=>{
 el("timer").innerText = "⏱ " + t;
});

socket.on("players", list=>{
 let txt="👥 PLAYERS\\n\\n";

 list.forEach(p=>{
   txt += p.name + (p.out ? " ❌ OUT":" ✅ IN") + "\\n";
 });

 el("players").innerText = txt;
});

socket.on("roundStart", data=>{
 hideGames();
 el("scoreboard").innerText="";

 if(data.game==="tap"){
   el("status").innerText="⚡ TAP RACE";
   el("mainBtn").classList.remove("hidden");
 }

 if(data.game==="math"){
   el("status").innerText="🧠 MATH RACE";
   el("mathBox").classList.remove("hidden");

   const a=Math.floor(Math.random()*10)+1;
   const b=Math.floor(Math.random()*10)+1;

   answer=a+b;
   el("mathQ").innerText=a+" + "+b+" = ?";
 }

 if(data.game==="door"){
   el("status").innerText="🚪 LUCKY DOOR";
   el("doorBox").classList.remove("hidden");
 }

 if(data.game==="spam"){
   el("status").innerText="🎯 SPAM DODGE";
   buildSpam();
 }
});

socket.on("scoreboard", board=>{
 let txt="🏆 ROUND SCORES\\n\\n";

 board.forEach((p,i)=>{
   txt += (i+1)+". "+p.name+" - "+p.points+" pts\\n";
 });

 el("scoreboard").innerText = txt;
});

socket.on("roundEnd", data=>{
 hideGames();
 el("status").innerText =
 "❌ " + data.name + " eliminated with " + data.points + " pts";
});

socket.on("winner", name=>{
 hideGames();
 el("status").innerText =
 "👑 " + name + " WINS +50 COINS!";
});
</script>

</body>
</html>
`);
});

// =======================
// SOCKETS
// =======================

io.on("connection", socket => {

socket.on("join", async username => {

  if (started) {
    socket.emit("message","Game already started");
    return;
  }

  if (players.length >= 5) {
    socket.emit("message","Lobby Full");
    return;
  }

  username = String(username || "").trim();

  if (!username) {
    username = "Player" + (players.length + 1);
  }

  await getOrCreateUser(username);
  await addGame(username);

  players.push({
    id: socket.id,
    name: username,
    out:false
  });

  socket.emit("joined");

  sendPlayers();

  io.emit("message", players.length + "/5 Joined");

  if (players.length === 5) {
    started = true;
    io.emit("message","5 Players Joined! Starting...");
    setTimeout(startRound, 3000);
  }

});

socket.on("score", ()=>{
  if (!canPlay(socket.id)) return;
  scores[socket.id] = (scores[socket.id] || 0) + 1;
});

socket.on("minus", ()=>{
  if (!canPlay(socket.id)) return;
  scores[socket.id] = (scores[socket.id] || 0) - 1;
});

socket.on("door", n=>{
  if (!canPlay(socket.id)) return;

  const lucky = Math.floor(Math.random()*3)+1;

  if (n === lucky) {
    scores[socket.id] += 5;
  } else {
    scores[socket.id] -= 2;
  }
});

socket.on("disconnect", ()=>{

  players = players.filter(p => p.id !== socket.id);

  sendPlayers();

  if (players.length === 0) {
    resetGame();
  }

});

});

// =======================

server.listen(PORT, ()=>{
 console.log("Running on port " + PORT);
});