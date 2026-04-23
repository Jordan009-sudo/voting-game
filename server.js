//
// Neon Battle V6 Part 2A
// Drop-in server.js
// Features:
// - Daily reward streak system
// - Win streak bonuses
// - Better shop
// - Leaderboards (wins / coins / streak / games)
// - Keeps 5-player join/start flow
//

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

// ================= DB =================
let users = null;

async function connectDB() {
  if (!MONGO_URI) {
    console.log("No MONGO_URI found");
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

// ================= SHOP =================
const SHOP = {
  crown: { name: "👑 Crown", price: 250, icon: "👑" },
  fire: { name: "🔥 Fire", price: 500, icon: "🔥" },
  diamond: { name: "💎 Diamond", price: 1000, icon: "💎" },
  vip: { name: "⭐ VIP", price: 2000, icon: "⭐" }
};

// ================= HELPERS =================
function css() {
return `
<style>
body{margin:0;background:#050505;color:#fff;font-family:Arial;text-align:center}
.wrap{max-width:850px;margin:auto;padding:20px}
.card{background:#111;padding:24px;border-radius:20px;box-shadow:0 0 25px #00ffe1;margin-top:20px}
input{padding:12px;width:240px;border:none;border-radius:10px;background:#222;color:#fff}
button,a.btn{padding:12px 18px;margin:5px;border:none;border-radius:10px;background:#00ffe1;color:#000;font-weight:bold;text-decoration:none;display:inline-block;cursor:pointer}
pre{background:#000;padding:15px;border-radius:12px;text-align:left;white-space:pre-line}
.shop{background:#000;padding:14px;border-radius:12px;margin:10px}
small{opacity:.75}
</style>
`;
}

function rankFromWins(w) {
  if (w >= 50) return "Champion";
  if (w >= 30) return "Diamond";
  if (w >= 15) return "Gold";
  if (w >= 5) return "Silver";
  return "Bronze";
}

function rewardForDailyStreak(streak) {
  if (streak <= 1) return 50;
  if (streak === 2) return 75;
  if (streak === 3) return 100;
  if (streak === 4) return 125;
  return 150;
}

function winStreakBonus(streak) {
  if (streak >= 5) return 100;
  if (streak >= 3) return 50;
  if (streak >= 2) return 25;
  return 0;
}

async function ensureUser(username) {
  if (!users) {
    return {
      username,
      wins: 0,
      coins: 0,
      games: 0,
      items: [],
      equipped: "",
      lastDaily: 0,
      dailyStreak: 0,
      winStreak: 0,
      bestWinStreak: 0
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
      lastDaily: 0,
      dailyStreak: 0,
      winStreak: 0,
      bestWinStreak: 0
    });

    user = await users.findOne({ username });
  }

  return user;
}

async function getUser(username) {
  if (!users) return null;
  return await users.findOne({ username });
}

function displayName(user) {
  if (!user) return "Player";
  if (user.equipped && SHOP[user.equipped]) {
    return SHOP[user.equipped].icon + " " + user.username;
  }
  return user.username;
}

async function addGame(username) {
  if (!users) return;
  await users.updateOne(
    { username },
    { $inc: { games: 1 } }
  );
}

async function addLoss(username) {
  if (!users) return;
  await users.updateOne(
    { username },
    { $set: { winStreak: 0 } }
  );
}

async function addWin(username) {
  if (!users) return;

  const user = await ensureUser(username);
  const newStreak = (user.winStreak || 0) + 1;
  const bonus = winStreakBonus(newStreak);

  await users.updateOne(
    { username },
    {
      $inc: {
        wins: 1,
        coins: 50 + bonus
      },
      $set: {
        winStreak: newStreak,
        bestWinStreak: Math.max(newStreak, user.bestWinStreak || 0)
      }
    }
  );

  return bonus;
}

async function claimDaily(username) {
  if (!users) return { ok: false, msg: "DB offline" };

  const user = await ensureUser(username);
  const now = Date.now();
  const last = user.lastDaily || 0;
  const diff = now - last;

  if (diff < 86400000) {
    return { ok: false, msg: "Already claimed today" };
  }

  let streak = 1;

  // within 48h keeps streak alive
  if (diff < 172800000 && last > 0) {
    streak = (user.dailyStreak || 0) + 1;
  }

  const reward = rewardForDailyStreak(streak);

  await users.updateOne(
    { username },
    {
      $inc: { coins: reward },
      $set: {
        lastDaily: now,
        dailyStreak: streak
      }
    }
  );

  return { ok: true, reward, streak };
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

// ================= GAME =================
let players = [];
let started = false;
let playing = false;
let timer = 10;
let scores = {};
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
  timer = 10;
  scores = {};
  if (loop) clearInterval(loop);
}

function startRound() {
  if (alive().length <= 1) return;

  playing = true;
  timer = 10;
  scores = {};

  alive().forEach(p => {
    scores[p.id] = 0;
  });

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
      username: p.username,
      name: p.name,
      score: scores[p.id] || 0
    }))
    .sort((a, b) => a.score - b.score);

  const loser = getPlayer(board[0].id);
  if (loser) loser.out = true;

  await addLoss(board[0].username);

  sendPlayers();
  io.emit("scoreboard", board);
  io.emit("message", "❌ " + board[0].name + " eliminated");

  if (alive().length === 1) {
    const winner = alive()[0];
    const bonus = await addWin(winner.username);

    io.emit(
      "message",
      "👑 " + winner.name + " wins! +50 coins" +
      (bonus ? " +" + bonus + " streak bonus" : "")
    );

    started = false;
    return;
  }

  setTimeout(startRound, 4000);
}

// ================= HOME =================
app.get("/", (req, res) => {
res.send(`
<html>
<head>
<title>Neon Battle V6.2A</title>
${css()}
</head>
<body>
<div class="wrap">
<div class="card">

<h1>⚡ Neon Battle ⚡</h1>

<input id="user" placeholder="Username">
<button onclick="join()">JOIN</button>

<br><br>

<button onclick="go('/profile')">👤 Profile</button>
<button onclick="go('/shop')">🛒 Shop</button>
<button onclick="go('/daily')">🎁 Daily</button>
<button onclick="go('/leaderboard')">🏆 Leaderboards</button>

<h2 id="status">Waiting for 5 players...</h2>
<h3 id="timer"></h3>

<button id="tap" style="display:none;font-size:28px;padding:20px" onclick="socket.emit('score')">TAP!</button>

<pre id="players"></pre>
<pre id="scores"></pre>

<small>Win = 50 coins + streak bonuses</small>

</div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();

function el(x){ return document.getElementById(x); }

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
 let txt = "PLAYERS\\n\\n";
 list.forEach(p=>{
   txt += p.name + (p.out ? " ❌ OUT" : " ✅ IN") + "\\n";
 });
 el("players").innerText = txt;
});

socket.on("tick", t=>{
 el("timer").innerText = "⏱ " + t;
});

socket.on("roundStart", ()=>{
 el("status").innerText = "⚡ TAP RACE";
 el("tap").style.display = "inline-block";
 el("scores").innerText = "";
});

socket.on("scoreboard", board=>{
 let txt = "ROUND SCORES\\n\\n";
 board.forEach((p,i)=>{
   txt += (i+1)+". "+p.name+" - "+p.score+"\\n";
 });
 el("scores").innerText = txt;
 el("tap").style.display = "none";
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

  const winRate = user.games
    ? ((user.wins / user.games) * 100).toFixed(1)
    : "0";

  res.send(`
  <html><head>${css()}</head><body>
  <div class="wrap"><div class="card">

  <h1>${displayName(user)}</h1>
  <h2>💰 Coins: ${user.coins}</h2>
  <h2>🏆 Wins: ${user.wins}</h2>
  <h2>🎮 Games: ${user.games}</h2>
  <h2>📈 Win Rate: ${winRate}%</h2>
  <h2>🥇 Rank: ${rankFromWins(user.wins)}</h2>
  <h2>🔥 Win Streak: ${user.winStreak || 0}</h2>
  <h2>⭐ Best Streak: ${user.bestWinStreak || 0}</h2>
  <h2>🎁 Daily Streak: ${user.dailyStreak || 0}</h2>

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

  for (const key in SHOP) {
    const item = SHOP[key];
    const owned = (user.items || []).includes(key);

    html += `
      <div class="shop">
        <h2>${item.name}</h2>
        <p>${item.price} coins</p>
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
  const result = await claimDaily(username);

  let msg = result.msg;
  if (result.ok) {
    msg = "🎁 +" + result.reward + " Coins<br>Daily Streak: " + result.streak;
  }

  res.send(`
  <html><head>${css()}</head><body>
  <div class="wrap"><div class="card">

  <h1>${msg}</h1>

  <a class="btn" href="/">⬅ Home</a>

  </div></div>
  </body></html>
  `);
});

// ================= LEADERBOARDS =================
app.get("/leaderboard", async (req, res) => {
  if (!users) {
    return res.send("DB offline");
  }

  const wins = await users.find().sort({ wins: -1 }).limit(5).toArray();
  const coins = await users.find().sort({ coins: -1 }).limit(5).toArray();
  const streak = await users.find().sort({ bestWinStreak: -1 }).limit(5).toArray();
  const games = await users.find().sort({ games: -1 }).limit(5).toArray();

  function block(title, arr, field) {
    let h = `<h2>${title}</h2>`;
    arr.forEach((u,i)=>{
      h += `<p>${i+1}. ${u.username} - ${u[field] || 0}</p>`;
    });
    return h;
  }

  res.send(`
  <html><head>${css()}</head><body>
  <div class="wrap"><div class="card">

  <h1>🏆 Leaderboards</h1>

  ${block("Most Wins", wins, "wins")}
  ${block("Most Coins", coins, "coins")}
  ${block("Best Win Streak", streak, "bestWinStreak")}
  ${block("Most Games", games, "games")}

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