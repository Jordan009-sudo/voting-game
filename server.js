const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.set("trust proxy", 1);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const PORT = process.env.PORT || 3000;

// -------------------- GAME DATA --------------------

let players = [];
let gameStarted = false;
let round = 1;
let scores = {};
let timer = 10;

// -------------------- HELPERS --------------------

function alivePlayers() {
  return players.filter(p => !p.out);
}

function resetGame() {
  players = [];
  gameStarted = false;
  round = 1;
  scores = {};
  timer = 10;
}

function startRound() {
  scores = {};
  timer = 10;

  io.emit("roundStart", {
    round,
    timer
  });

  const countdown = setInterval(() => {
    timer--;
    io.emit("tick", timer);

    if (timer <= 0) {
      clearInterval(countdown);
      endRound();
    }
  }, 1000);
}

function endRound() {
  alivePlayers().forEach(player => {
    if (!scores[player.id]) scores[player.id] = 0;
  });

  const results = alivePlayers()
    .map(player => ({
      id: player.id,
      name: player.name,
      score: scores[player.id]
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

// -------------------- WEBSITE --------------------

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Battle Game</title>
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
font-size:16px;
margin:5px;
border:none;
border-radius:8px;
}
button{
background:#00b894;
color:white;
cursor:pointer;
}
#tapBtn{
font-size:28px;
padding:25px 40px;
display:none;
}
#box{
max-width:500px;
margin:auto;
}
pre{
text-align:left;
background:#222;
padding:15px;
border-radius:10px;
}
</style>
</head>

<body>

<div id="box">

<h1>Minigame Battle</h1>

<div id="joinBox">
<input id="name" placeholder="Your Name">
<button onclick="joinGame()">Join</button>
</div>

<h2 id="status">Waiting for players...</h2>
<h3 id="timer"></h3>

<button id="tapBtn" onclick="tapNow()">TAP FAST!</button>

<pre id="players"></pre>

</div>

<script src="/socket.io/socket.io.js"></script>

<script>
const socket = io(window.location.origin, {
  transports: ["websocket", "polling"]
});

function joinGame(){
  const name = document.getElementById("name").value || "Player";
  socket.emit("join", name);
}

function tapNow(){
  socket.emit("tap");
}

socket.on("joined", () => {
  document.getElementById("joinBox").style.display = "none";
});

socket.on("players", (list) => {
  let text = "Players:\\n";
  list.forEach(p => {
    text += p.name;
    if (p.out) text += " (OUT)";
    text += "\\n";
  });
  document.getElementById("players").textContent = text;
});

socket.on("message", msg => {
  document.getElementById("status").textContent = msg;
});

socket.on("roundStart", data => {
  document.getElementById("status").textContent =
    "Round " + data.round + " Started!";
  document.getElementById("tapBtn").style.display = "inline-block";
});

socket.on("tick", t => {
  document.getElementById("timer").textContent = "Time: " + t;
});

socket.on("roundEnd", data => {
  document.getElementById("tapBtn").style.display = "none";
  document.getElementById("status").textContent =
    data.evicted + " was eliminated!";
});

socket.on("winner", name => {
  document.getElementById("tapBtn").style.display = "none";
  document.getElementById("status").textContent =
    name + " WINS THE GAME!";
});
</script>

</body>
</html>
`);
});

// -------------------- SOCKETS --------------------

io.on("connection", socket => {

  socket.on("join", name => {

    if (gameStarted) {
      socket.emit("message", "Game already started.");
      return;
    }

    if (players.length >= 5) {
      socket.emit("message", "Lobby full.");
      return;
    }

    players.push({
      id: socket.id,
      name,
      out: false
    });

    socket.emit("joined");

    io.emit("players", players);
    io.emit("message", players.length + "/5 Players Joined");

    if (players.length === 5) {
      gameStarted = true;
      setTimeout(startRound, 2000);
    }

  });

  socket.on("tap", () => {
    if (!gameStarted) return;
    scores[socket.id] = (scores[socket.id] || 0) + 1;
  });

  socket.on("disconnect", () => {
    players = players.filter(p => p.id !== socket.id);
    io.emit("players", players);

    if (players.length === 0) {
      resetGame();
    }
  });

});

// -------------------- START --------------------

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});