const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"]
});

const PORT = process.env.PORT || 3000;

let players = [];
let started = false;

function sendPlayers() {
  io.emit("players", players);
}

app.get("/", (req, res) => {
res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Join Fix</title>
<style>
body{
background:#050505;
color:white;
font-family:Arial;
text-align:center;
padding:40px;
}
.box{
max-width:500px;
margin:auto;
background:#111;
padding:25px;
border-radius:18px;
box-shadow:0 0 20px #00ffe1;
}
input,button{
padding:14px;
margin:8px;
font-size:16px;
border:none;
border-radius:10px;
}
button{
background:#00ffe1;
font-weight:bold;
cursor:pointer;
}
#players{
white-space:pre-line;
text-align:left;
margin-top:20px;
background:#000;
padding:15px;
border-radius:12px;
}
</style>
</head>
<body>

<div class="box">
<h1>⚡ Neon Battle ⚡</h1>

<input id="name" placeholder="Your Name">
<button onclick="join()">JOIN</button>

<h2 id="status">Waiting...</h2>
<div id="players"></div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io({
 transports:["websocket","polling"]
});

socket.on("connect", ()=>{
 status.innerText = "Connected ✅";
});

socket.on("disconnect", ()=>{
 status.innerText = "Disconnected ❌";
});

function join(){
 let n = document.getElementById("name").value.trim();
 if(!n) n = "Player";
 socket.emit("join", n);
}

socket.on("message", msg=>{
 status.innerText = msg;
});

socket.on("players", list=>{
 let txt="👥 PLAYERS\\n\\n";
 list.forEach((p,i)=>{
   txt += (i+1)+". " + p.name + "\\n";
 });
 players.innerText = txt;
});
</script>

</body>
</html>
`);
});

io.on("connection", socket => {

socket.on("join", name => {

  if (started) {
    socket.emit("message", "Game already started");
    return;
  }

  if (players.length >= 5) {
    socket.emit("message", "Lobby Full");
    return;
  }

  name = String(name || "").trim();
  if (!name) name = "Player" + (players.length + 1);

  players.push({
    id: socket.id,
    name
  });

  sendPlayers();

  io.emit("message", players.length + "/5 Joined");

  if (players.length === 5) {
    started = true;
    io.emit("message", "5 Players Joined! Starting...");
  }

});

socket.on("disconnect", ()=>{
  players = players.filter(p => p.id !== socket.id);
  sendPlayers();

  if (players.length === 0) {
    started = false;
  }
});

});

server.listen(PORT, ()=>{
 console.log("Running on " + PORT);
});