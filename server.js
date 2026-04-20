const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.set("trust proxy", 1);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// ---------------- GAME STATE ----------------

let players = [];
let scores = {};
let started = false;
let playing = false;
let round = 1;
let timer = 12;
let game = "";
let countdown = null;

const games = ["tap", "math", "door", "spam"];

// ---------------- HELPERS ----------------

function alive() {
  return players.filter(p => !p.out);
}

function getPlayer(id) {
  return players.find(p => p.id === id);
}

function resetGame() {
  players = [];
  scores = {};
  started = false;
  playing = false;
  round = 1;
  timer = 12;
  game = "";
  if (countdown) clearInterval(countdown);
}

function chooseGame() {
  game = games[Math.floor(Math.random() * games.length)];
}

function safeAdd(id, amount) {
  const p = getPlayer(id);
  if (!playing) return;
  if (!p) return;
  if (p.out) return;

  scores[id] = (scores[id] || 0) + amount;
}

function startRound() {
  if (alive().length <= 1) return;

  chooseGame();
  playing = true;
  timer = 12;
  scores = {};

  alive().forEach(p => {
    scores[p.id] = 0;
  });

  io.emit("roundStart", {
    round,
    game,
    timer
  });

  countdown = setInterval(() => {
    timer--;
    io.emit("tick", timer);

    if (timer <= 0) {
      clearInterval(countdown);
      endRound();
    }
  }, 1000);
}

function endRound() {
  playing = false;

  const list = alive()
    .map(p => ({
      id: p.id,
      name: p.name,
      points: scores[p.id] || 0
    }))
    .sort((a, b) => a.points - b.points);

  const loser = list[0];
  const target = getPlayer(loser.id);

  if (target) target.out = true;

  io.emit("scoreboard", list);

  io.emit("roundEnd", {
    name: loser.name,
    points: loser.points
  });

  if (alive().length === 1) {
    io.emit("winner", alive()[0].name);
    started = false;
    return;
  }

  round++;
  setTimeout(startRound, 5000);
}

// ---------------- WEBSITE ----------------

app.get("/", (req, res) => {
res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Neon Battle v3.1</title>
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
max-width:620px;
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
background:#222;
color:white;
width:220px;
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

.big{
font-size:28px;
padding:25px 40px;
}

.hidden{
display:none;
}

.red{
background:#ff0055;
color:white;
}

.green{
background:#00ff88;
}

#scoreboard{
margin-top:15px;
background:#0d0d0d;
padding:15px;
border-radius:12px;
text-align:left;
white-space:pre-line;
}

.door{
width:90px;
height:120px;
font-size:30px;
}
</style>
</head>
<body>

<div class="panel">

<h1>⚡ Neon Battle v3.1 ⚡</h1>

<div id="joinBox">
<input id="name" placeholder="Your Name">
<button onclick="joinGame()">JOIN</button>
</div>

<h2 id="status">Waiting for 5 players...</h2>
<h3 id="timer"></h3>

<button id="mainBtn" class="big hidden" onclick="mainClick()">GO</button>

<div id="mathBox" class="hidden">
<h2 id="mathQ"></h2>
<input id="mathA">
<button onclick="submitMath()">Submit</button>
</div>

<div id="doorBox" class="hidden">
<button class="door" onclick="pickDoor(1)">🚪1</button>
<button class="door" onclick="pickDoor(2)">🚪2</button>
<button class="door" onclick="pickDoor(3)">🚪3</button>
</div>

<div id="spamBox" class="hidden"></div>

<div id="scoreboard"></div>

</div>

<script src="/socket.io/socket.io.js"></script>

<script>
const socket = io(window.location.origin,{
 transports:["websocket","polling"]
});

let currentGame = "";
let answer = 0;

function hideGames(){
 mainBtn.classList.add("hidden");
 mathBox.classList.add("hidden");
 doorBox.classList.add("hidden");
 spamBox.classList.add("hidden");
}

function joinGame(){
 let n = name.value || "Player";
 socket.emit("join", n);
}

function mainClick(){
 socket.emit("score");
}

function submitMath(){
 let v = Number(mathA.value);
 if(v === answer){
   socket.emit("score");
 }
}

function pickDoor(n){
 socket.emit("door", n);
}

function buildSpam(){
 spamBox.innerHTML = "";
 spamBox.classList.remove("hidden");

 for(let i=0;i<12;i++){
   const b = document.createElement("button");

   if(i===0){
     b.innerText="TARGET";
     b.className="green";
     b.onclick=()=>socket.emit("score");
   }else{
     b.innerText="FAKE";
     b.className="red";
     b.onclick=()=>socket.emit("minus");
   }

   spamBox.appendChild(b);
 }
}

socket.on("joined", ()=>{
 joinBox.style.display="none";
});

socket.on("message", msg=>{
 status.innerText = msg;
});

socket.on("tick", t=>{
 timer.innerText = "⏱ " + t;
});

socket.on("roundStart", data=>{
 hideGames();
 currentGame = data.game;
 scoreboard.innerText = "";

 if(data.game==="tap"){
   status.innerText="⚡ TAP RACE";
   mainBtn.innerText="TAP!";
   mainBtn.classList.remove("hidden");
 }

 if(data.game==="math"){
   status.innerText="🧠 MATH RACE";
   mathBox.classList.remove("hidden");

   let a=Math.floor(Math.random()*10)+1;
   let b=Math.floor(Math.random()*10)+1;

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

socket.on("scoreboard", list=>{
 let txt="🏆 ROUND SCORES\\n\\n";

 list.forEach((p,i)=>{
   txt += (i+1)+". "+p.name+" - "+p.points+" pts\\n";
 });

 scoreboard.innerText = txt;
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

// ---------------- SOCKETS ----------------

io.on("connection", socket => {

socket.on("join", name => {

 if(started){
   socket.emit("message","Game already started");
   return;
 }

 if(players.length >= 5){
   socket.emit("message","Lobby Full");
   return;
 }

 players.push({
   id: socket.id,
   name,
   out:false
 });

 socket.emit("joined");

 io.emit("message", players.length + "/5 Joined");

 if(players.length === 5){
   started = true;
   io.emit("message","Starting...");
   setTimeout(startRound, 3000);
 }

});

socket.on("score", ()=>{
 safeAdd(socket.id, 1);
});

socket.on("minus", ()=>{
 safeAdd(socket.id, -1);
});

socket.on("door", n => {

 const p = getPlayer(socket.id);
 if(!playing) return;
 if(!p) return;
 if(p.out) return;

 const win = Math.floor(Math.random()*3)+1;

 if(n === win){
   safeAdd(socket.id, 5);
 }else{
   safeAdd(socket.id, -2);
 }

});

socket.on("disconnect", ()=>{

 players = players.filter(p => p.id !== socket.id);

 if(players.length === 0){
   resetGame();
 }

});

});

// ---------------- START ----------------

server.listen(PORT, ()=>{
 console.log("Running on " + PORT);
});