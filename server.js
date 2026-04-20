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

// ---------------- DATA ----------------

let players = [];
let gameStarted = false;
let roundActive = false;
let round = 1;
let scores = {};
let timer = 10;
let countdown = null;

let currentGame = "tap";

const games = ["tap", "redgreen", "math"];

// ---------------- HELPERS ----------------

function alivePlayers() {
  return players.filter(p => !p.out);
}

function resetGame() {
  players = [];
  gameStarted = false;
  roundActive = false;
  round = 1;
  scores = {};
  timer = 10;
  currentGame = "tap";
  if (countdown) clearInterval(countdown);
}

function chooseGame() {
  currentGame = games[Math.floor(Math.random() * games.length)];
}

function startRound() {
  if (!gameStarted) return;
  if (alivePlayers().length <= 1) return;

  chooseGame();

  roundActive = true;
  scores = {};
  timer = 10;

  io.emit("roundStart", {
    round,
    timer,
    game: currentGame
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
  roundActive = false;

  const alive = alivePlayers();

  alive.forEach(p => {
    if (!scores[p.id]) scores[p.id] = 0;
  });

  const results = alive
    .map(p => ({
      id: p.id,
      name: p.name,
      score: scores[p.id]
    }))
    .sort((a, b) => a.score - b.score);

  const loser = results[0];
  const found = players.find(p => p.id === loser.id);
  if (found) found.out = true;

  io.emit("roundEnd", {
    evicted: loser.name,
    scores: results
  });

  io.emit("players", players);

  if (alivePlayers().length === 1) {
    io.emit("winner", alivePlayers()[0].name);
    gameStarted = false;
    return;
  }

  round++;
  setTimeout(startRound, 4000);
}

// ---------------- WEBSITE ----------------

app.get("/", (req, res) => {
res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Battle Game V2</title>
<meta name="viewport" content="width=device-width, initial-scale=1">

<style>
body{
background:#111;
color:white;
font-family:Arial;
text-align:center;
padding:20px;
}
input,button{
padding:12px;
margin:5px;
border:none;
border-radius:8px;
font-size:16px;
}
button{
background:#00b894;
color:white;
cursor:pointer;
}
#actionBtn{
display:none;
font-size:28px;
padding:25px 40px;
}
#mathBox{
display:none;
}
pre{
background:#222;
padding:15px;
border-radius:10px;
text-align:left;
max-width:500px;
margin:auto;
}
</style>
</head>

<body>

<h1>Minigame Battle V2</h1>

<div id="joinBox">
<input id="name" placeholder="Your Name">
<button onclick="joinGame()">Join</button>
</div>

<h2 id="status">Waiting for players...</h2>
<h3 id="timer"></h3>

<button id="actionBtn" onclick="mainAction()">GO!</button>

<div id="mathBox">
<h2 id="mathQuestion"></h2>
<input id="mathAnswer" placeholder="Answer">
<button onclick="submitMath()">Submit</button>
</div>

<pre id="players"></pre>

<script src="/socket.io/socket.io.js"></script>

<script>
const socket = io(window.location.origin,{
 transports:["websocket","polling"]
});

let currentGame = "";
let green = true;
let answer = 0;

function joinGame(){
 const name = document.getElementById("name").value || "Player";
 socket.emit("join",name);
}

function mainAction(){

 if(currentGame === "tap"){
   socket.emit("score");
 }

 if(currentGame === "redgreen"){
   if(green){
     socket.emit("score");
   }else{
     socket.emit("fail");
   }
 }

}

function submitMath(){
 const val = Number(document.getElementById("mathAnswer").value);
 if(val === answer){
   socket.emit("score");
 }
}

socket.on("joined",()=>{
 document.getElementById("joinBox").style.display="none";
});

socket.on("players",(list)=>{
 let txt="Players:\\n";
 list.forEach(p=>{
   txt += p.name + (p.out ? " (OUT)" : "") + "\\n";
 });
 document.getElementById("players").textContent = txt;
});

socket.on("message",(msg)=>{
 document.getElementById("status").textContent = msg;
});

socket.on("roundStart",(data)=>{
 currentGame = data.game;
 document.getElementById("mathBox").style.display="none";
 document.getElementById("actionBtn").style.display="inline-block";

 if(currentGame==="tap"){
   document.getElementById("status").textContent="TAP FAST!";
   document.getElementById("actionBtn").innerText="TAP!";
 }

 if(currentGame==="redgreen"){
   document.getElementById("status").textContent="Red Light Green Light";
   document.getElementById("actionBtn").innerText="MOVE!";
   green = true;

   const switcher = setInterval(()=>{
     green = !green;
     document.getElementById("status").textContent =
      green ? "GREEN LIGHT!" : "RED LIGHT!";
   },1200);

   setTimeout(()=>clearInterval(switcher),10000);
 }

 if(currentGame==="math"){
   document.getElementById("actionBtn").style.display="none";
   document.getElementById("mathBox").style.display="block";

   let a = Math.floor(Math.random()*10)+1;
   let b = Math.floor(Math.random()*10)+1;
   answer = a+b;

   document.getElementById("mathQuestion").innerText =
   a + " + " + b + " = ?";
 }

});

socket.on("tick",(t)=>{
 document.getElementById("timer").textContent="Time: "+t;
});

socket.on("roundEnd",(data)=>{
 document.getElementById("actionBtn").style.display="none";
 document.getElementById("mathBox").style.display="none";
 document.getElementById("status").textContent =
 data.evicted + " eliminated!";
});

socket.on("winner",(name)=>{
 document.getElementById("status").textContent =
 name + " WINS!";
});
</script>

</body>
</html>
`);
});

// ---------------- SOCKET ----------------

io.on("connection", socket => {

socket.on("join", name => {

 if(gameStarted){
   socket.emit("message","Game already started.");
   return;
 }

 if(players.length >= 5){
   socket.emit("message","Lobby full.");
   return;
 }

 players.push({
   id: socket.id,
   name,
   out:false
 });

 socket.emit("joined");

 io.emit("players",players);

 if(players.length < 5){
   io.emit("message",players.length + "/5 Players Joined");
 }

 if(players.length === 5){
   gameStarted = true;
   io.emit("message","Starting...");
   setTimeout(startRound,3000);
 }

});

socket.on("score",()=>{
 if(!roundActive) return;
 scores[socket.id] = (scores[socket.id] || 0) + 1;
});

socket.on("fail",()=>{
 if(!roundActive) return;
 scores[socket.id] = -999;
});

socket.on("disconnect",()=>{
 players = players.filter(p=>p.id !== socket.id);
 io.emit("players",players);

 if(players.length===0){
   resetGame();
 }
});

});

// ---------------- START ----------------

server.listen(PORT,()=>{
 console.log("Running on port "+PORT);
});