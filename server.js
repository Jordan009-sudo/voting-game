const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// ================= STATE =================

let players = [];
let scores = {};
let started = false;
let playing = false;
let round = 1;
let timer = 12;
let currentGame = "";
let loop = null;

const games = ["tap", "math", "door", "spam"];

// ================= HELPERS =================

function getPlayer(id) {
  return players.find(p => p.id === id);
}

function alivePlayers() {
  return players.filter(p => !p.out);
}

function canPlay(id) {
  const p = getPlayer(id);
  if (!p) return false;
  if (p.out) return false;
  if (!playing) return false;
  return true;
}

function sendPlayers() {
  io.emit("players", players);
}

function resetGame() {
  players = [];
  scores = {};
  started = false;
  playing = false;
  round = 1;
  timer = 12;
  currentGame = "";
  if (loop) clearInterval(loop);
}

function chooseGame() {
  currentGame = games[Math.floor(Math.random() * games.length)];
}

// ================= GAME =================

function startRound() {
  if (alivePlayers().length <= 1) return;

  chooseGame();

  playing = true;
  timer = 12;
  scores = {};

  alivePlayers().forEach(p => {
    scores[p.id] = 0;
  });

  sendPlayers();

  io.emit("roundStart", {
    round,
    game: currentGame,
    timer
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

function endRound() {
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

  if (alivePlayers().length === 1) {
    io.emit("winner", alivePlayers()[0].name);
    started = false;
    return;
  }

  round++;
  setTimeout(startRound, 5000);
}

// ================= WEBSITE =================

app.get("/", (req, res) => {
res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Neon Battle v3.3</title>
<meta name="viewport" content="width=device-width, initial-scale=1">

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
max-width:650px;
margin:auto;
padding:25px;
background:#111;
border-radius:18px;
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
color:black;
font-weight:bold;
cursor:pointer;
}

button:hover{
transform:scale(1.05);
}

.hidden{
display:none;
}

.big{
font-size:28px;
padding:25px 40px;
}

.red{
background:#ff0055;
color:white;
}

.green{
background:#00ff88;
}

.door{
width:90px;
height:120px;
font-size:30px;
}

#players,#scoreboard{
margin-top:15px;
padding:15px;
background:#0d0d0d;
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

<h1>⚡ Neon Battle v3.3 ⚡</h1>

<div id="joinBox">
<input id="name" placeholder="Your Name">
<button onclick="joinGame()">JOIN</button>
</div>

<h2 id="status">Waiting for 5 players...</h2>
<h3 id="timer"></h3>

<button id="mainBtn" class="big hidden" onclick="socket.emit('score')">GO</button>

<div id="mathBox" class="hidden">
<h2 id="mathQ"></h2>
<input id="mathA">
<button onclick="submitMath()">Submit</button>
</div>

<div id="doorBox" class="hidden">
<button class="door" onclick="socket.emit('door',1)">🚪1</button>
<button class="door" onclick="socket.emit('door',2)">🚪2</button>
<button class="door" onclick="socket.emit('door',3)">🚪3</button>
</div>

<div id="spamBox" class="hidden"></div>

<div id="players"></div>
<div id="scoreboard"></div>

</div>

<script src="/socket.io/socket.io.js"></script>

<script>
const socket = io(window.location.origin,{
 transports:["websocket","polling"]
});

let answer = 0;

function hideGames(){
 mainBtn.classList.add("hidden");
 mathBox.classList.add("hidden");
 doorBox.classList.add("hidden");
 spamBox.classList.add("hidden");
}

function joinGame(){
 let username = name.value.trim();

 if(username === ""){
   username = "";
 }

 socket.emit("join", username);
}

function submitMath(){
 if(Number(mathA.value) === answer){
   socket.emit("score");
 }
}

function buildSpam(){
 spamBox.classList.remove("hidden");

 function render(){
   spamBox.innerHTML="";

   const targetIndex = Math.floor(Math.random()*12);

   for(let i=0;i<12;i++){

     const b = document.createElement("button");

     if(i === targetIndex){
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

     spamBox.appendChild(b);
   }
 }

 render();
}

socket.on("joined", ()=>{
 joinBox.style.display="none";
});

socket.on("players", list=>{
 let txt="👥 PLAYERS\\n\\n";

 list.forEach(p=>{
   txt += p.name + (p.out ? " ❌ OUT" : " ✅ IN") + "\\n";
 });

 players.innerText = txt;
});

socket.on("message", msg=>{
 status.innerText = msg;
});

socket.on("tick", t=>{
 timer.innerText = "⏱ " + t;
});

socket.on("roundStart", data=>{
 hideGames();
 scoreboard.innerText="";

 if(data.game==="tap"){
   status.innerText="⚡ TAP RACE";
   mainBtn.innerText="TAP!";
   mainBtn.classList.remove("hidden");
 }

 if(data.game==="math"){
   status.innerText="🧠 MATH RACE";
   mathBox.classList.remove("hidden");

   const a=Math.floor(Math.random()*10)+1;
   const b=Math.floor(Math.random()*10)+1;

   answer=a+b;
   mathQ.innerText=a+" + "+b+" = ?";
 }

 if(data.game==="door"){
   status.innerText="🚪 LUCKY DOOR";
   doorBox.classList.remove("hidden");
 }

 if(data.game==="spam"){
   status.innerText="🎯 SPAM DODGE";
   buildSpam();
 }
});

socket.on("scoreboard", board=>{
 let txt="🏆 ROUND SCORES\\n\\n";

 board.forEach((p,i)=>{
   txt += (i+1)+". "+p.name+" - "+p.points+" pts\\n";
 });

 scoreboard.innerText=txt;
});

socket.on("roundEnd", data=>{
 hideGames();

 status.innerText =
 "❌ " + data.name + " eliminated with " + data.points + " pts";
});

socket.on("winner", name=>{
 hideGames();
 status.innerText = "👑 " + name + " WINS!";
});
</script>

</body>
</html>
`);
});

// ================= SOCKET =================

io.on("connection", socket => {

socket.on("join", username => {

  if (started) {
    socket.emit("message","Game already started");
    return;
  }

  if (players.length >= 5) {
    socket.emit("message","Lobby Full");
    return;
  }

  username = String(username || "").trim();

  if (username === "") {
    username = "Player" + (players.length + 1);
  }

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
    io.emit("message","Starting...");
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
    scores[socket.id] = (scores[socket.id] || 0) + 5;
  } else {
    scores[socket.id] = (scores[socket.id] || 0) - 2;
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

// ================= START =================

server.listen(PORT, ()=>{
  console.log("Running on port " + PORT);
});