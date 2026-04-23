// V6 PART 2B FULL
// Paste as server.js
// Features:
// 5 Minigames
// Better UI
// Live scoreboard
// Round intros
// Winner celebration

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket","polling"]
});

const PORT = process.env.PORT || 3000;

// ================= GAME =================
let players = [];
let started = false;
let playing = false;
let timer = 10;
let scores = {};
let loop = null;

const games = ["tap","spam","target","door","freeze"];
let currentGame = "tap";
let targetX = 50;
let targetY = 50;
let green = true;

function alive(){
  return players.filter(p=>!p.out);
}

function getPlayer(id){
  return players.find(p=>p.id===id);
}

function sendPlayers(){
  io.emit("players", players);
}

function resetLobby(){
  players = [];
  started = false;
  playing = false;
  scores = {};
  timer = 10;
  if(loop) clearInterval(loop);
}

function pickGame(){
  currentGame = games[Math.floor(Math.random()*games.length)];
}

function startRound(){
  if(alive().length <= 1) return;

  pickGame();

  scores = {};
  alive().forEach(p => scores[p.id]=0);

  timer = 10;
  playing = false;

  io.emit("intro", currentGame);

  let count = 3;

  const intro = setInterval(()=>{
    io.emit("countdown", count);
    count--;

    if(count < 0){
      clearInterval(intro);
      beginGame();
    }
  },1000);
}

function beginGame(){
  playing = true;
  io.emit("roundStart", {
    game: currentGame,
    x: targetX,
    y: targetY
  });

  if(currentGame === "freeze"){
    green = true;
  }

  loop = setInterval(()=>{
    timer--;

    if(currentGame === "freeze"){
      green = !green;
      io.emit("freezeState", green);
    }

    io.emit("tick", timer);
    io.emit("liveScores", scoreBoard());

    if(timer <= 0){
      clearInterval(loop);
      endRound();
    }
  },1000);
}

function scoreBoard(){
  return alive().map(p => ({
    name:p.name,
    score:scores[p.id] || 0
  })).sort((a,b)=>b.score-a.score);
}

function endRound(){
  playing = false;

  const board = alive()
    .map(p=>({
      id:p.id,
      name:p.name,
      score:scores[p.id] || 0
    }))
    .sort((a,b)=>a.score-b.score);

  const loser = getPlayer(board[0].id);
  loser.out = true;

  sendPlayers();
  io.emit("scoreboard", board);
  io.emit("eliminated", loser.name);

  if(alive().length === 1){
    io.emit("winner", alive()[0].name);
    started = false;
    return;
  }

  setTimeout(startRound, 5000);
}

// ================= PAGE =================
app.get("/", (req,res)=>{
res.send(`
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neon Battle V6</title>
<style>
body{
margin:0;
background:#050505;
font-family:Arial;
color:white;
text-align:center;
}
.wrap{
max-width:900px;
margin:auto;
padding:20px;
}
.card{
background:#111;
padding:25px;
border-radius:20px;
box-shadow:0 0 25px #00ffe1;
margin-top:20px;
}
input{
padding:12px;
width:220px;
border:none;
border-radius:10px;
background:#222;
color:#fff;
}
button{
padding:14px 20px;
margin:5px;
border:none;
border-radius:10px;
background:#00ffe1;
font-weight:bold;
cursor:pointer;
}
#tapBtn{
font-size:30px;
display:none;
}
#target{
width:70px;
height:70px;
border-radius:50%;
background:red;
position:absolute;
display:none;
cursor:pointer;
}
pre{
background:#000;
padding:15px;
border-radius:12px;
text-align:left;
white-space:pre-line;
}
.big{
font-size:34px;
font-weight:bold;
margin:15px;
}
</style>
</head>
<body>

<div class="wrap">
<div class="card">

<h1>⚡ Neon Battle ⚡</h1>

<input id="name" placeholder="Username">
<button onclick="join()">JOIN</button>

<div id="status" class="big">Waiting for 5 players...</div>
<div id="timer"></div>

<button id="tapBtn" onclick="score()">TAP!</button>

<div id="target" onclick="hitTarget()"></div>

<pre id="players"></pre>
<pre id="scores"></pre>

</div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();

function el(x){return document.getElementById(x)}

function join(){
 socket.emit("join", el("name").value.trim());
}

function score(){
 socket.emit("score");
}

function hitTarget(){
 socket.emit("target");
}

socket.on("joined", ()=>{
 el("name").style.display="none";
});

socket.on("players", list=>{
 let t="PLAYERS\\n\\n";
 list.forEach(p=>{
   t += p.name + (p.out?" ❌ OUT":" ✅ IN") + "\\n";
 });
 el("players").innerText=t;
});

socket.on("message", m=>{
 el("status").innerText=m;
});

socket.on("intro", game=>{
 let names = {
 tap:"⚡ TAP RACE",
 spam:"🔥 SPAM DODGE",
 target:"🎯 MOVING TARGET",
 door:"🚪 LUCKY DOOR",
 freeze:"🚦 RED LIGHT GREEN LIGHT"
 };
 el("status").innerText="NEXT GAME: " + names[game];
});

socket.on("countdown", n=>{
 el("timer").innerText="Starting in " + n;
});

socket.on("roundStart", data=>{
 el("scores").innerText="";
 el("tapBtn").style.display="none";
 el("target").style.display="none";

 if(data.game==="tap"){
   el("tapBtn").innerText="TAP!";
   el("tapBtn").style.display="inline-block";
 }

 if(data.game==="spam"){
   el("tapBtn").innerText="SPAM!";
   el("tapBtn").style.display="inline-block";
 }

 if(data.game==="door"){
   el("status").innerHTML='🚪 Pick Door<br><button onclick="socket.emit(\\'door\\',1)">1</button><button onclick="socket.emit(\\'door\\',2)">2</button><button onclick="socket.emit(\\'door\\',3)">3</button>';
 }

 if(data.game==="target"){
   let t = el("target");
   t.style.display="block";
   t.style.left=data.x+"%";
   t.style.top=data.y+"%";
 }

 if(data.game==="freeze"){
   el("tapBtn").innerText="RUN!";
   el("tapBtn").style.display="inline-block";
 }
});

socket.on("freezeState", green=>{
 el("status").innerText = green ? "🟢 GREEN LIGHT" : "🔴 RED LIGHT";
});

socket.on("targetMove", pos=>{
 let t = el("target");
 t.style.left=pos.x+"%";
 t.style.top=pos.y+"%";
});

socket.on("tick", t=>{
 el("timer").innerText="⏱ "+t;
});

socket.on("liveScores", board=>{
 let txt="LIVE SCORES\\n\\n";
 board.forEach((p,i)=>{
   txt += (i+1)+". "+p.name+" - "+p.score+"\\n";
 });
 el("scores").innerText=txt;
});

socket.on("eliminated", name=>{
 el("status").innerText="❌ "+name+" eliminated!";
});

socket.on("winner", name=>{
 el("status").innerText="👑 WINNER: "+name;
});
</script>

</body>
</html>
`);
});

// ================= SOCKETS =================
io.on("connection", socket=>{

socket.on("join", name=>{

  if(started){
    socket.emit("message","Game already started");
    return;
  }

  if(players.length >= 5){
    socket.emit("message","Lobby Full");
    return;
  }

  name = String(name || "").trim();
  if(!name) name = "Player"+(players.length+1);

  players.push({
    id:socket.id,
    name,
    out:false
  });

  socket.emit("joined");
  sendPlayers();

  io.emit("message", players.length + "/5 Joined");

  if(players.length === 5){
    started = true;
    io.emit("message","🔥 Game Starting...");
    setTimeout(startRound,3000);
  }

});

socket.on("score", ()=>{

  const p = getPlayer(socket.id);
  if(!p || p.out || !playing) return;

  if(currentGame==="tap"){
    scores[socket.id]++;
  }

  if(currentGame==="spam"){
    scores[socket.id]++;
    if(scores[socket.id] > 30) scores[socket.id]-=2;
  }

  if(currentGame==="freeze"){
    if(green) scores[socket.id]++;
    else scores[socket.id]-=2;
  }

});

socket.on("target", ()=>{

  const p = getPlayer(socket.id);
  if(!p || p.out || !playing || currentGame!=="target") return;

  scores[socket.id]+=3;

  targetX = Math.floor(Math.random()*80)+5;
  targetY = Math.floor(Math.random()*70)+10;

  io.emit("targetMove", {x:targetX,y:targetY});
});

socket.on("door", num=>{

  const p = getPlayer(socket.id);
  if(!p || p.out || !playing || currentGame!=="door") return;

  let reward = Math.floor(Math.random()*4);

  if(reward===0) scores[socket.id]+=0;
  if(reward===1) scores[socket.id]+=2;
  if(reward===2) scores[socket.id]+=4;
  if(reward===3) scores[socket.id]-=2;

});

socket.on("disconnect", ()=>{

  players = players.filter(p=>p.id!==socket.id);
  sendPlayers();

  if(players.length===0){
    resetLobby();
  }

});

});

// ================= START =================
server.listen(PORT, ()=>{
 console.log("Running on "+PORT);
});