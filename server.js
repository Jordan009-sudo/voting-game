// VERSION 3 PRO - DARK NEON UI
// Replace your server.js with this file

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// ---------------- GAME DATA ----------------

let players = [];
let scores = {};
let round = 1;
let timer = 12;
let started = false;
let playing = false;
let game = "";

const games = ["tap", "math", "door", "spam"];
let countdown;

// ---------------- HELPERS ----------------

function alive() {
  return players.filter(p => !p.out);
}

function resetGame() {
  players = [];
  scores = {};
  round = 1;
  started = false;
  playing = false;
}

function chooseGame() {
  game = games[Math.floor(Math.random() * games.length)];
}

function startRound() {
  if (alive().length <= 1) return;

  chooseGame();
  timer = 12;
  playing = true;

  alive().forEach(p => scores[p.id] = 0);

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
  const dead = players.find(p => p.id === loser.id);
  if (dead) dead.out = true;

  io.emit("scoreboard", list);
  io.emit("roundEnd", loser.name);

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
<title>Neon Battle</title>
<meta name="viewport" content="width=device-width, initial-scale=1">

<style>
body{
margin:0;
font-family:Arial;
background:#050505;
color:white;
text-align:center;
padding:20px;
}

.panel{
max-width:600px;
margin:auto;
background:#111;
padding:25px;
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

.big{
font-size:28px;
padding:25px 40px;
}

.hidden{
display:none;
}

#scoreboard{
text-align:left;
background:#0f0f0f;
padding:15px;
border-radius:12px;
margin-top:15px;
white-space:pre-line;
}

.door{
width:90px;
height:120px;
font-size:30px;
}

.red{
background:#ff004c;
color:white;
}

.green{
background:#00ff99;
}

</style>
</head>
<body>

<div class="panel">

<h1>⚡ Neon Battle ⚡</h1>

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
<button class="door" onclick="doorPick(1)">🚪1</button>
<button class="door" onclick="doorPick(2)">🚪2</button>
<button class="door" onclick="doorPick(3)">🚪3</button>
</div>

<div id="spamBox" class="hidden"></div>

<div id="scoreboard"></div>

</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io(window.location.origin,{
 transports:["websocket","polling"]
});

let currentGame="";
let mathAns=0;

function joinGame(){
 let n=document.getElementById("name").value || "Player";
 socket.emit("join",n);
}

function hideAll(){
 document.getElementById("mainBtn").classList.add("hidden");
 document.getElementById("mathBox").classList.add("hidden");
 document.getElementById("doorBox").classList.add("hidden");
 document.getElementById("spamBox").classList.add("hidden");
}

function mainClick(){
 socket.emit("score");
}

function submitMath(){
 let v=Number(document.getElementById("mathA").value);
 if(v===mathAns) socket.emit("score");
}

function doorPick(n){
 socket.emit("door",n);
}

function makeSpam(){
 let box=document.getElementById("spamBox");
 box.innerHTML="";
 box.classList.remove("hidden");

 for(let i=0;i<12;i++){
   let b=document.createElement("button");
   b.innerText = i===0 ? "TARGET" : "FAKE";
   b.className = i===0 ? "green" : "red";
   b.onclick = ()=>{
     if(i===0) socket.emit("score");
     else socket.emit("minus");
   };
   box.appendChild(b);
 }
}

socket.on("joined",()=>{
 document.getElementById("joinBox").style.display="none";
});

socket.on("message",(m)=>{
 document.getElementById("status").innerText=m;
});

socket.on("tick",(t)=>{
 document.getElementById("timer").innerText="⏱ "+t;
});

socket.on("roundStart",(d)=>{
 hideAll();
 currentGame=d.game;

 if(d.game==="tap"){
   status.innerText="⚡ TAP RACE";
   mainBtn.innerText="TAP!";
   mainBtn.classList.remove("hidden");
 }

 if(d.game==="math"){
   status.innerText="🧠 MATH RACE";
   mathBox.classList.remove("hidden");
   let a=Math.floor(Math.random()*10)+1;
   let b=Math.floor(Math.random()*10)+1;
   mathAns=a+b;
   mathQ.innerText=a+" + "+b+" = ?";
 }

 if(d.game==="door"){
   status.innerText="🚪 LUCKY DOOR";
   doorBox.classList.remove("hidden");
 }

 if(d.game==="spam"){
   status.innerText="🎯 SPAM DODGE";
   makeSpam();
 }
});

socket.on("scoreboard",(list)=>{
 let txt="🏆 ROUND SCORES\\n\\n";
 list.forEach((p,i)=>{
   txt += (i+1)+". "+p.name+" - "+p.points+" pts\\n";
 });
 scoreboard.innerText=txt;
});

socket.on("roundEnd",(name)=>{
 hideAll();
 status.innerText="❌ "+name+" Eliminated";
});

socket.on("winner",(name)=>{
 hideAll();
 status.innerText="👑 "+name+" WINS THE GAME!";
});
</script>

</body>
</html>
`);
});

// ---------------- SOCKET ----------------

io.on("connection", socket => {

socket.on("join", name => {

 if (started) {
   socket.emit("message","Game already started");
   return;
 }

 if (players.length >= 5) {
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

 if (players.length === 5) {
   started = true;
   io.emit("message","Starting...");
   setTimeout(startRound,3000);
 }

});

socket.on("score",()=>{
 if(!playing) return;
 scores[socket.id]=(scores[socket.id]||0)+1;
});

socket.on("minus",()=>{
 if(!playing) return;
 scores[socket.id]=(scores[socket.id]||0)-1;
});

socket.on("door",(n)=>{
 if(!playing) return;
 let win=Math.floor(Math.random()*3)+1;
 if(n===win){
   scores[socket.id]=(scores[socket.id]||0)+5;
 }else{
   scores[socket.id]=(scores[socket.id]||0)-2;
 }
});

socket.on("disconnect",()=>{
 players = players.filter(p=>p.id!==socket.id);
 if(players.length===0) resetGame();
});

});

// ---------------- START ----------------

server.listen(PORT,()=>{
 console.log("Running on "+PORT);
});