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

// ================= DATABASE =================
let users = null;

const SHOP = {
  fire: { name: "🔥 Fire Name", price: 250 },
  crown: { name: "👑 Crown Trail", price: 500 },
  diamond: { name: "💎 Diamond Glow", price: 800 }
};

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
    console.log("Mongo Failed:", err.message);
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
      games: 0,
      items: []
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

async function getUser(username) {
  if (!users) return null;
  return await users.findOne({ username });
}

async function buyItem(username, key) {
  if (!users || !SHOP[key]) return false;

  const user = await users.findOne({ username });
  if (!user) return false;

  if (user.coins < SHOP[key].price) return false;
  if ((user.items || []).includes(key)) return false;

  await users.updateOne(
    { username },
    {
      $inc: { coins: -SHOP[key].price },
      $push: { items: key }
    }
  );

  return true;
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
  timer = 10;

  if (loop) clearInterval(loop);
}

function startRound() {
  if (alive().length <= 1) return;

  currentGame = games[Math.floor(Math.random() * games.length)];
  playing = true;
  timer = 10;
  scores = {};

  alive().forEach(p => {
    scores[p.id] = 0;
  });

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
  if (loser) loser.out = true;

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

// ================= ROUTES =================

app.get("/", (req, res) => {
res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neon Battle V5</title>

<style>
body{
background:#050505;
color:white;
font-family:Arial;
text-align:center;
padding:20px;
margin:0;
}

.box{
max-width:750px;
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
background:#222;
color:white;
}

button{
background:#00ffe1;
font-weight:bold;
cursor:pointer;
}

.hidden{
display:none;
}

#players,#score{
white-space:pre-line;
text-align:left;
background:#000;
padding:15px;
border-radius:12px;
margin-top:15px;
}
</style>
</head>

<body>

<div class="box">

<h1>⚡ Neon Battle V5 ⚡</h1>

<div id="joinBox">
<input id="username" placeholder="Your Name">
<button onclick="join()">JOIN</button>

<div>
<button onclick="goProfile()">👤 Profile</button>
<button onclick="goShop()">🛒 Shop</button>
</div>
</div>

<h2 id="status">Waiting for 5 players...</h2>
<h3 id="timer"></h3>

<button id="tapBtn" class="hidden" onclick="socket.emit('score')">TAP!</button>

<div id="players"></div>
<div id="score"></div>

</div>

<script src="/socket.io/socket.io.js"></script>

<script>
const socket = io({
 transports:["websocket","polling"]
});

function el(x){
 return document.getElementById(x);
}

function join(){
 const n = el("username").value.trim();
 socket.emit("join", n);
}

function goProfile(){
 const u = el("username").value.trim();
 if(u) location.href="/profile?user="+encodeURIComponent(u);
}

function goShop(){
 const u = el("username").value.trim();
 if(u) location.href="/shop?user="+encodeURIComponent(u);
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
   txt += p.name + (p.out ? " ❌ OUT" : " ✅ IN") + "\\n";
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
 el("status").innerText = "❌ " + d.name + " eliminated";
 el("tapBtn").classList.add("hidden");
});

socket.on("winner", name=>{
 el("status").innerText = "👑 " + name + " wins +50 coins!";
});
</script>

</body>
</html>
`);
});

// PROFILE PAGE
app.get("/profile", async (req, res) => {
  const username = req.query.user;

  if (!username) return res.send("No username");

  const user = await getUser(username);

  if (!user) return res.send("User not found");

  res.send(`
  <html>
  <body style="background:#050505;color:white;font-family:Arial;text-align:center;padding:30px">
  <h1>👤 ${user.username}</h1>
  <h2>💰 Coins: ${user.coins}</h2>
  <h2>🏆 Wins: ${user.wins}</h2>
  <h2>🎮 Games: ${user.games}</h2>
  <h2>🎁 Owned: ${(user.items || []).join(", ") || "None"}</h2>
  <br><br>
  <a href="/" style="color:#00ffe1">⬅ Back</a>
  </body>
  </html>
  `);
});

// SHOP PAGE
app.get("/shop", async (req, res) => {
  const username = req.query.user;

  if (!username) return res.send("No username");

  const user = await getUser(username);

  if (!user) return res.send("User not found");

  let html = "";

  for (const key in SHOP) {
    const item = SHOP[key];

    html += `
    <div style="margin:15px;padding:15px;background:#111;border-radius:12px">
      <h2>${item.name}</h2>
      <p>💰 ${item.price}</p>
      <a href="/buy?user=${username}&item=${key}">
        <button style="padding:10px 20px">Buy</button>
      </a>
    </div>
    `;
  }

  res.send(`
  <html>
  <body style="background:#050505;color:white;font-family:Arial;text-align:center;padding:30px">
  <h1>🛒 SHOP</h1>
  <h2>${username}</h2>
  <h2>💰 Coins: ${user.coins}</h2>
  ${html}
  <br>
  <a href="/" style="color:#00ffe1">⬅ Back</a>
  </body>
  </html>
  `);
});

// BUY
app.get("/buy", async (req, res) => {
  const username = req.query.user;
  const item = req.query.item;

  const ok = await buyItem(username, item);

  if (ok) {
    res.redirect("/shop?user=" + username);
  } else {
    res.send("Purchase failed. <a href='/shop?user=" + username + "'>Back</a>");
  }
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

    if (!username) {
      username = "Player" + (players.length + 1);
    }

    players.push({
      id: socket.id,
      name: username,
      out: false
    });

    socket.emit("joined");

    sendPlayers();

    io.emit("message", players.length + "/5 Joined");

    safeCreateUser(username);
    safeAddGame(username);

    if (players.length === 5) {
      started = true;
      io.emit("message", "5 Players Joined! Starting...");
      setTimeout(startRound, 3000);
    }

  } catch (err) {
    socket.emit("message", "Join failed");
    console.log(err);
  }
});

socket.on("score", ()=>{
  if (!canPlay(socket.id)) return;

  scores[socket.id] = (scores[socket.id] || 0) + 1;
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

server.listen(PORT, () => {
  console.log("Running on " + PORT);
});