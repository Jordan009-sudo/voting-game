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
  crown: { name: "👑 Crown", price: 250, icon: "👑" },
  fire: { name: "🔥 Fire", price: 500, icon: "🔥" },
  diamond: { name: "💎 Diamond", price: 1000, icon: "💎" },
  star: { name: "⭐ Star", price: 1500, icon: "⭐" }
};

async function connectDB() {
  if (!MONGO_URI) {
    console.log("No MONGO_URI found.");
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

async function ensureUser(username) {
  if (!users) {
    return {
      username,
      wins: 0,
      coins: 0,
      games: 0,
      items: [],
      equipped: "",
      lastDaily: 0
    };
  }

  let user = await users.findOne({ username });

  if (!user) {
    await users.insertOne({
      username,
      wins: 0,
      coins: 0,
      games: 0,
      items: [],
      equipped: "",
      lastDaily: 0
    });

    user = await users.findOne({ username });
  }

  return user;
}

async function getUser(username) {
  if (!users) return null;
  return await users.findOne({ username });
}

async function addGame(username) {
  if (!users) return;
  await users.updateOne({ username }, { $inc: { games: 1 } });
}

async function addWin(username) {
  if (!users) return;
  await users.updateOne(
    { username },
    { $inc: { wins: 1, coins: 50 } }
  );
}

async function buyItem(username, item) {
  if (!users || !SHOP[item]) return false;

  const user = await ensureUser(username);

  if ((user.items || []).includes(item)) return false;
  if (user.coins < SHOP[item].price) return false;

  await users.updateOne(
    { username },
    {
      $inc: { coins: -SHOP[item].price },
      $push: { items: item }
    }
  );

  return true;
}

async function equipItem(username, item) {
  if (!users || !SHOP[item]) return false;

  const user = await ensureUser(username);

  if (!(user.items || []).includes(item)) return false;

  await users.updateOne(
    { username },
    { $set: { equipped: item } }
  );

  return true;
}

async function claimDaily(username) {
  if (!users) return false;

  const user = await ensureUser(username);
  const now = Date.now();

  if (now - (user.lastDaily || 0) < 86400000) {
    return false;
  }

  await users.updateOne(
    { username },
    {
      $inc: { coins: 100 },
      $set: { lastDaily: now }
    }
  );

  return true;
}

function rankFromWins(wins) {
  if (wins >= 50) return "Champion";
  if (wins >= 30) return "Diamond";
  if (wins >= 15) return "Gold";
  if (wins >= 5) return "Silver";
  return "Bronze";
}

function displayName(user) {
  if (!user) return "Player";
  if (user.equipped && SHOP[user.equipped]) {
    return SHOP[user.equipped].icon + " " + user.username;
  }
  return user.username;
}

// ================= GAME =================
let players = [];
let started = false;
let playing = false;
let scores = {};
let timer = 10;
let loop = null;

function alive() {
  return players.filter(p => !p.out);
}

function getPlayer(id) {
  return players.find(p => p.id === id);
}

function sendPlayers() {
  io.emit("players", players);
}

function resetLobby() {
  players = [];
  started = false;
  playing = false;
  scores = {};
  timer = 10;
  if (loop) clearInterval(loop);
}

function startRound() {
  if (alive().length <= 1) return;

  playing = true;
  timer = 10;
  scores = {};

  alive().forEach(p => scores[p.id] = 0);

  io.emit("roundStart");

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
      score: scores[p.id] || 0
    }))
    .sort((a, b) => a.score - b.score);

  const loser = getPlayer(board[0].id);
  loser.out = true;

  sendPlayers();
  io.emit("scoreboard", board);
  io.emit("message", "❌ " + loser.name + " eliminated");

  if (alive().length === 1) {
    const winner = alive()[0];
    await addWin(winner.username);
    io.emit("message", "👑 " + winner.name + " wins!");
    started = false;
    return;
  }

  setTimeout(startRound, 4000);
}

// ================= CSS =================
function css() {
return `
<style>
body{
margin:0;
padding:0;
background:#050505;
color:#fff;
font-family:Arial;
text-align:center;
}
.wrap{
max-width:800px;
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
width:240px;
border:none;
border-radius:10px;
background:#222;
color:white;
}
button,a.btn{
padding:12px 18px;
margin:5px;
border:none;
border-radius:10px;
background:#00ffe1;
color:#000;
font-weight:bold;
text-decoration:none;
display:inline-block;
cursor:pointer;
}
pre{
background:#000;
padding:15px;
border-radius:12px;
text-align:left;
white-space:pre-line;
}
.shop{
background:#000;
padding:15px;
margin:10px;
border-radius:12px;
}
</style>
`;
}

// ================= HOME =================
app.get("/", (req, res) => {
res.send(`
<html>
<head>
<title>Neon Battle V6</title>
${css()}
</head>
<body>
<div class="wrap">
<div class="card">

<h1>⚡ Neon Battle V6 ⚡</h1>

<input id="user" placeholder="Username">
<button onclick="join()">JOIN</button>

<br><br>

<button onclick="go('/profile')">👤 Profile</button>
<button onclick="go('/shop')">🛒 Shop</button>
<button onclick="go('/daily')">🎁 Daily</button>
<button onclick="go('/leaderboard')">🏆 Leaderboard</button>

<h2 id="status">Waiting for 5 players...</h2>
<h3 id="timer"></h3>

<button id="tap" style="display:none;font-size:28px;padding:20px" onclick="socket.emit('score')">TAP!</button>

<pre id="players"></pre>
<pre id="scores"></pre>

</div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();

function el(x){return document.getElementById(x)}

function username(){
 return el("user").value.trim() || "Guest";
}

function join(){
 socket.emit("join", username());
}

function go(path){
 location.href = path + "?user=" + encodeURIComponent(username());
}

socket.on("joined", ()=>{
 el("user").style.display="none";
});

socket.on("message", m=>{
 el("status").innerText = m;
});

socket.on("players", list=>{
 let t="PLAYERS\\n\\n";
 list.forEach(p=>{
   t += p.name + (p.out ? " ❌ OUT" : " ✅ IN") + "\\n";
 });
 el("players").innerText=t;
});

socket.on("tick", n=>{
 el("timer").innerText="⏱ " + n;
});

socket.on("roundStart", ()=>{
 el("status").innerText="⚡ TAP RACE";
 el("tap").style.display="inline-block";
 el("scores").innerText="";
});

socket.on("scoreboard", b=>{
 let t="ROUND SCORES\\n\\n";
 b.forEach((p,i)=>{
   t += (i+1)+". "+p.name+" - "+p.score+"\\n";
 });
 el("scores").innerText=t;
 el("tap").style.display="none";
});
</script>
</body>
</html>
`);
});

// ================= PROFILE =================
app.get("/profile", async (req, res) => {
  const username = req.query.user || "Guest";
  const user = await ensureUser(username);

  const winRate = user.games > 0
    ? ((user.wins / user.games) * 100).toFixed(1)
    : 0;

  res.send(`
  <html><head>${css()}</head><body>
  <div class="wrap"><div class="card">
  <h1>${displayName(user)}</h1>
  <h2>💰 Coins: ${user.coins}</h2>
  <h2>🏆 Wins: ${user.wins}</h2>
  <h2>🎮 Games: ${user.games}</h2>
  <h2>📈 Win Rate: ${winRate}%</h2>
  <h2>🥇 Rank: ${rankFromWins(user.wins)}</h2>
  <h3>🎒 Items: ${(user.items || []).join(", ") || "None"}</h3>
  <a class="btn" href="/">⬅ Home</a>
  </div></div>
  </body></html>
  `);
});

// ================= SHOP =================
app.get("/shop", async (req, res) => {
  const username = req.query.user || "Guest";
  const user = await ensureUser(username);

  let html = "";

  for (let key in SHOP) {
    const item = SHOP[key];
    const owned = (user.items || []).includes(key);

    html += `
    <div class="shop">
    <h2>${item.name}</h2>
    <p>${item.price} Coins</p>
    ${
      owned
      ? `<a class="btn" href="/equip?user=${username}&item=${key}">Equip</a>`
      : `<a class="btn" href="/buy?user=${username}&item=${key}">Buy</a>`
    }
    </div>
    `;
  }

  res.send(`
  <html><head>${css()}</head><body>
  <div class="wrap"><div class="card">
  <h1>🛒 Shop</h1>
  <h2>💰 ${user.coins} Coins</h2>
  ${html}
  <a class="btn" href="/">⬅ Home</a>
  </div></div>
  </body></html>
  `);
});

app.get("/buy", async (req, res) => {
  await buyItem(req.query.user, req.query.item);
  res.redirect("/shop?user=" + req.query.user);
});

app.get("/equip", async (req, res) => {
  await equipItem(req.query.user, req.query.item);
  res.redirect("/shop?user=" + req.query.user);
});

// ================= DAILY =================
app.get("/daily", async (req, res) => {
  const username = req.query.user || "Guest";
  const ok = await claimDaily(username);

  res.send(`
  <html><head>${css()}</head><body>
  <div class="wrap"><div class="card">
  <h1>${ok ? "🎁 +100 Coins Claimed!" : "⏳ Already claimed today"}</h1>
  <a class="btn" href="/">⬅ Home</a>
  </div></div>
  </body></html>
  `);
});

// ================= LEADERBOARD =================
app.get("/leaderboard", async (req, res) => {
  let html = "";

  if (users) {
    const top = await users.find().sort({ wins: -1 }).limit(10).toArray();

    top.forEach((u,i)=>{
      html += `<h2>${i+1}. ${u.username} - ${u.wins} wins</h2>`;
    });
  }

  res.send(`
  <html><head>${css()}</head><body>
  <div class="wrap"><div class="card">
  <h1>🏆 Leaderboard</h1>
  ${html}
  <a class="btn" href="/">⬅ Home</a>
  </div></div>
  </body></html>
  `);
});

// ================= SOCKETS =================
io.on("connection", socket => {

socket.on("join", async username => {
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

  const user = await ensureUser(username);
  await addGame(username);

  players.push({
    id: socket.id,
    username,
    name: displayName(user),
    out: false
  });

  socket.emit("joined");
  sendPlayers();

  io.emit("message", players.length + "/5 Joined");

  if (players.length === 5) {
    started = true;
    io.emit("message", "🔥 Starting...");
    setTimeout(startRound, 3000);
  }
});

socket.on("score", ()=>{
  const p = getPlayer(socket.id);
  if (!p || p.out || !playing) return;

  scores[socket.id] = (scores[socket.id] || 0) + 1;
});

socket.on("disconnect", ()=>{
  players = players.filter(p => p.id !== socket.id);
  sendPlayers();

  if (players.length === 0) resetLobby();
});

});

// ================= START =================
server.listen(PORT, ()=>{
  console.log("Running on " + PORT);
});