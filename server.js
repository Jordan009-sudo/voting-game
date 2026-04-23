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
  fire: { name: "🔥 Fire Name", price: 250, icon: "🔥" },
  crown: { name: "👑 Crown Trail", price: 500, icon: "👑" },
  diamond: { name: "💎 Diamond Glow", price: 800, icon: "💎" }
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
      items: [],
      equipped: "",
      lastDaily: 0
    });
  }
}

async function getUser(username) {
  if (!users) return null;
  return await users.findOne({ username });
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

async function buyItem(username, key) {
  if (!users || !SHOP[key]) return false;

  const user = await getUser(username);
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

async function equipItem(username, key) {
  if (!users) return false;

  const user = await getUser(username);
  if (!user) return false;

  if (!(user.items || []).includes(key)) return false;

  await users.updateOne(
    { username },
    { $set: { equipped: key } }
  );

  return true;
}

async function claimDaily(username) {
  if (!users) return false;

  const user = await getUser(username);
  if (!user) return false;

  const now = Date.now();
  const diff = now - (user.lastDaily || 0);

  if (diff < 86400000) return false;

  await users.updateOne(
    { username },
    {
      $inc: { coins: 100 },
      $set: { lastDaily: now }
    }
  );

  return true;
}

function getRank(wins) {
  if (wins >= 50) return "Champion";
  if (wins >= 30) return "Diamond";
  if (wins >= 15) return "Gold";
  if (wins >= 5) return "Silver";
  return "Bronze";
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
      name: p.display,
      points: scores[p.id] || 0
    }))
    .sort((a, b) => a.points - b.points);

  const loser = getPlayer(board[0].id);
  if (loser) loser.out = true;

  sendPlayers();

  io.emit("scoreboard", board);
  io.emit("roundEnd", loser.display);

  if (alive().length === 1) {
    const winner = alive()[0];

    await safeAddWin(winner.name);

    io.emit("winner", winner.display);

    started = false;
    return;
  }

  setTimeout(startRound, 4000);
}

// ================= HOME =================
app.get("/", (req, res) => {
res.send(`
<html>
<body style="background:#050505;color:white;font-family:Arial;text-align:center;padding:20px">
<h1>⚡ Neon Battle V5 Part 3 ⚡</h1>

<input id="u" placeholder="Username" style="padding:12px">
<button onclick="join()">JOIN</button>
<br><br>

<button onclick="go('/profile')">👤 Profile</button>
<button onclick="go('/shop')">🛒 Shop</button>
<button onclick="go('/leaderboard')">🏆 Leaderboard</button>
<button onclick="go('/daily')">🎁 Daily</button>

<h2 id="status">Waiting for 5 players...</h2>
<h3 id="timer"></h3>

<button id="tap" style="display:none;padding:25px;font-size:30px" onclick="socket.emit('score')">TAP!</button>

<pre id="players"></pre>
<pre id="scores"></pre>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();

function el(x){return document.getElementById(x)}

function user(){
 return el("u").value.trim();
}

function join(){
 socket.emit("join", user());
}

function go(path){
 if(user()) location.href = path + "?user=" + encodeURIComponent(user());
}

socket.on("joined", ()=>{
 el("u").style.display="none";
});

socket.on("message", m=>{
 el("status").innerText = m;
});

socket.on("players", list=>{
 let t="PLAYERS\\n\\n";
 list.forEach(p=>{
   t += p.display + (p.out?" ❌":" ✅") + "\\n";
 });
 el("players").innerText=t;
});

socket.on("tick", n=>{
 el("timer").innerText="⏱ "+n;
});

socket.on("roundStart", ()=>{
 el("status").innerText="⚡ TAP RACE";
 el("tap").style.display="inline-block";
 el("scores").innerText="";
});

socket.on("scoreboard", b=>{
 let t="SCORES\\n\\n";
 b.forEach((p,i)=>{
   t += (i+1)+". "+p.name+" - "+p.points+"\\n";
 });
 el("scores").innerText=t;
});

socket.on("roundEnd", n=>{
 el("status").innerText="❌ "+n+" eliminated";
 el("tap").style.display="none";
});

socket.on("winner", n=>{
 el("status").innerText="👑 "+n+" WINS!";
});
</script>
</body>
</html>
`);
});

// ================= PROFILE =================
app.get("/profile", async (req, res) => {
  const user = await getUser(req.query.user);
  if (!user) return res.send("User not found");

  res.send(`
  <html><body style="background:#050505;color:white;text-align:center;font-family:Arial;padding:30px">
  <h1>${user.username}</h1>
  <h2>💰 Coins: ${user.coins}</h2>
  <h2>🏆 Wins: ${user.wins}</h2>
  <h2>🎮 Games: ${user.games}</h2>
  <h2>🥇 Rank: ${getRank(user.wins)}</h2>
  <h2>🎁 Owned: ${(user.items||[]).join(", ") || "None"}</h2>
  <a href="/">⬅ Back</a>
  </body></html>
  `);
});

// ================= SHOP =================
app.get("/shop", async (req, res) => {
  const username = req.query.user;
  const user = await getUser(username);
  if (!user) return res.send("User not found");

  let html = "";

  for (const key in SHOP) {
    const item = SHOP[key];

    html += `
    <div style="margin:15px;padding:15px;background:#111">
    <h2>${item.name}</h2>
    <p>${item.price} coins</p>
    <a href="/buy?user=${username}&item=${key}">Buy</a> |
    <a href="/equip?user=${username}&item=${key}">Equip</a>
    </div>
    `;
  }

  res.send(`
  <html><body style="background:#050505;color:white;text-align:center;font-family:Arial;padding:30px">
  <h1>SHOP</h1>
  <h2>💰 ${user.coins}</h2>
  ${html}
  <a href="/">⬅ Back</a>
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
  const ok = await claimDaily(req.query.user);

  res.send(`
  <html><body style="background:#050505;color:white;text-align:center;padding:30px;font-family:Arial">
  <h1>${ok ? "🎁 +100 Coins Claimed!" : "⏳ Come back later"}</h1>
  <a href="/">⬅ Back</a>
  </body></html>
  `);
});

// ================= LEADERBOARD =================
app.get("/leaderboard", async (req, res) => {
  if (!users) return res.send("No DB");

  const top = await users.find().sort({ wins: -1 }).limit(10).toArray();

  let html = "<h1>🏆 Leaderboard</h1>";

  top.forEach((u,i)=>{
    html += "<h2>"+(i+1)+". "+u.username+" - "+u.wins+" wins</h2>";
  });

  res.send(`
  <html><body style="background:#050505;color:white;text-align:center;padding:30px;font-family:Arial">
  ${html}
  <a href="/">⬅ Back</a>
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

  await safeCreateUser(username);

  const user = await getUser(username);

  let display = username;

  if (user && user.equipped && SHOP[user.equipped]) {
    display = SHOP[user.equipped].icon + " " + username;
  }

  players.push({
    id: socket.id,
    name: username,
    display,
    out: false
  });

  safeAddGame(username);

  socket.emit("joined");
  sendPlayers();

  io.emit("message", players.length + "/5 Joined");

  if (players.length === 5) {
    started = true;
    io.emit("message", "Starting...");
    setTimeout(startRound, 3000);
  }
});

socket.on("score", ()=>{
  if (!canPlay(socket.id)) return;
  scores[socket.id] = (scores[socket.id] || 0) + 1;
});

socket.on("disconnect", ()=>{
  players = players.filter(p => p.id !== socket.id);
  sendPlayers();

  if (players.length === 0) resetGame();
});

});

server.listen(PORT, ()=>{
  console.log("Running on " + PORT);
});