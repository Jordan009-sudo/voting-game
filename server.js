// BUILD V8.4 FULL
// server.js
// Neon Battle - Accounts + Auto Join + Rewards + Leaderboard + Skins + Match Stats

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// ---------------- APP ----------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// ---------------- DB ----------------
let users;

async function connectDB() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    users = client.db("neonbattle").collection("users");
    console.log("Mongo Connected ✅");
  } catch (err) {
    console.log("Mongo Failed ❌", err.message);
  }
}
connectDB();

// ---------------- SESSION ----------------
const sessions = {};

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

function loginUser(res, username) {
  const token = makeToken();
  sessions[token] = username;
  res.cookie("token", token);
}

function getUsername(req) {
  const token = req.cookies.token;
  if (!token) return null;
  return sessions[token] || null;
}

// ---------------- HELPERS ----------------
async function ensureUser(username) {
  if (!users) return null;

  let user = await users.findOne({ username });

  if (!user) {
    await users.insertOne({
      username,
      password: null,
      wins: 0,
      coins: 0,
      games: 0,
      eliminations: 0,
      rounds: 0,
      skin: "cyan",
      claimedDaily: 0
    });

    user = await users.findOne({ username });
  }

  return user;
}

function page(title, body) {
  return `
  <html>
  <head>
  <title>${title}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
  body{
    background:#050505;
    color:white;
    font-family:Arial;
    text-align:center;
    padding:25px;
  }
  .box{
    max-width:760px;
    margin:auto;
    background:#111;
    padding:25px;
    border-radius:18px;
    box-shadow:0 0 25px cyan;
  }
  input,button,a{
    padding:12px;
    margin:6px;
    border:none;
    border-radius:10px;
    font-size:16px;
    text-decoration:none;
    display:inline-block;
  }
  input{background:#222;color:#fff}
  button,a{
    background:cyan;
    color:#000;
    font-weight:bold;
    cursor:pointer;
  }
  table{
    width:100%;
    border-collapse:collapse;
    margin-top:15px;
  }
  td,th{
    padding:8px;
    border-bottom:1px solid #333;
  }
  </style>
  </head>
  <body>
    <div class="box">${body}</div>
  </body>
  </html>
  `;
}

// ---------------- HOME ----------------
app.get("/", async (req, res) => {
  const me = getUsername(req);

  res.send(page("Neon Battle", `
    <h1>⚡ Neon Battle ⚡</h1>
    ${
      me
      ? `
      <h2>Welcome ${me}</h2>
      <a href="/profile">Profile</a>
      <a href="/game">Play</a>
      <a href="/leaderboard">Leaderboard</a>
      <a href="/logout">Logout</a>
      `
      : `
      <a href="/register">Register</a>
      <a href="/login">Login</a>
      `
    }
  `));
});

// ---------------- REGISTER ----------------
app.get("/register", (req, res) => {
  res.send(page("Register", `
    <h1>Create Account</h1>
    <form method="POST">
      <input name="username" placeholder="Username" required><br>
      <input name="password" type="password" placeholder="Password" required><br>
      <button>Register</button>
    </form>
    <a href="/">Home</a>
  `));
});

app.post("/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!username || !password) return res.send("Missing info");

  const exists = await users.findOne({ username });
  if (exists) return res.send("Username taken");

  const hash = await bcrypt.hash(password, 10);

  await users.insertOne({
    username,
    password: hash,
    wins: 0,
    coins: 0,
    games: 0,
    eliminations: 0,
    rounds: 0,
    skin: "cyan",
    claimedDaily: 0
  });

  res.redirect("/login");
});

// ---------------- LOGIN ----------------
app.get("/login", (req, res) => {
  res.send(page("Login", `
    <h1>Login</h1>
    <form method="POST">
      <input name="username" placeholder="Username" required><br>
      <input name="password" type="password" placeholder="Password" required><br>
      <button>Login</button>
    </form>
    <a href="/">Home</a>
  `));
});

app.post("/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  const user = await users.findOne({ username });
  if (!user) return res.send("User not found");

  if (!user.password) {
    const hash = await bcrypt.hash(password, 10);
    await users.updateOne({ username }, { $set: { password: hash } });
  }

  const fresh = await users.findOne({ username });
  const ok = await bcrypt.compare(password, fresh.password);

  if (!ok) return res.send("Wrong password");

  loginUser(res, username);
  res.redirect("/profile");
});

// ---------------- LOGOUT ----------------
app.get("/logout", (req, res) => {
  const token = req.cookies.token;
  delete sessions[token];
  res.clearCookie("token");
  res.redirect("/");
});

// ---------------- PROFILE ----------------
app.get("/profile", async (req, res) => {
  const me = getUsername(req);
  if (!me) return res.redirect("/login");

  const u = await ensureUser(me);

  res.send(page("Profile", `
    <h1>👤 ${me}</h1>
    <h3>🏆 Wins: ${u.wins}</h3>
    <h3>🪙 Coins: ${u.coins}</h3>
    <h3>🎮 Games: ${u.games}</h3>
    <h3>💀 Eliminations: ${u.eliminations}</h3>
    <h3>🌀 Rounds Survived: ${u.rounds}</h3>
    <h3>🎨 Skin: ${u.skin}</h3>

    <a href="/daily">Daily Reward</a>
    <a href="/shop">Shop</a>
    <a href="/leaderboard">Leaderboard</a>
    <a href="/game">Play</a>
    <a href="/">Home</a>
  `));
});

// ---------------- DAILY ----------------
app.get("/daily", async (req, res) => {
  const me = getUsername(req);
  if (!me) return res.redirect("/login");

  const user = await ensureUser(me);
  const now = Date.now();

  if (now - user.claimedDaily < 86400000) {
    return res.send("Already claimed today.");
  }

  await users.updateOne(
    { username: me },
    {
      $inc: { coins: 50 },
      $set: { claimedDaily: now }
    }
  );

  res.redirect("/profile");
});

// ---------------- SHOP ----------------
app.get("/shop", async (req, res) => {
  const me = getUsername(req);
  if (!me) return res.redirect("/login");

  const u = await ensureUser(me);

  res.send(page("Shop", `
    <h1>🛒 Shop</h1>
    <h2>Coins: ${u.coins}</h2>

    <a href="/buy/red">Red Skin (100)</a>
    <a href="/buy/gold">Gold Skin (250)</a>
    <a href="/buy/green">Green Skin (150)</a>
    <br><br>
    <a href="/profile">Back</a>
  `));
});

app.get("/buy/:skin", async (req, res) => {
  const me = getUsername(req);
  if (!me) return res.redirect("/login");

  const prices = {
    red: 100,
    gold: 250,
    green: 150
  };

  const skin = req.params.skin;
  if (!prices[skin]) return res.redirect("/shop");

  const u = await ensureUser(me);

  if (u.coins < prices[skin]) {
    return res.send("Not enough coins");
  }

  await users.updateOne(
    { username: me },
    {
      $inc: { coins: -prices[skin] },
      $set: { skin }
    }
  );

  res.redirect("/profile");
});

// ---------------- LEADERBOARD ----------------
app.get("/leaderboard", async (req, res) => {
  const topWins = await users.find().sort({ wins: -1 }).limit(10).toArray();

  let rows = "";
  topWins.forEach((u, i) => {
    rows += `
      <tr>
        <td>${i + 1}</td>
        <td>${u.username}</td>
        <td>${u.wins}</td>
        <td>${u.coins}</td>
      </tr>
    `;
  });

  res.send(page("Leaderboard", `
    <h1>🏆 Leaderboard</h1>
    <table>
      <tr>
        <th>#</th>
        <th>Name</th>
        <th>Wins</th>
        <th>Coins</th>
      </tr>
      ${rows}
    </table>
    <br>
    <a href="/">Home</a>
  `));
});

// ---------------- GAME PAGE ----------------
app.get("/game", (req, res) => {
  const me = getUsername(req);
  if (!me) return res.redirect("/login");

  res.send(page("Game", `
    <h1>⚡ Neon Battle ⚡</h1>
    <h2 id="status">Joining...</h2>
    <h3 id="timer"></h3>
    <button onclick="tap()">TAP!</button>
    <div id="players"></div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
      const socket = io();

      socket.emit("joinAuto", "${me}");

      function tap(){
        socket.emit("score");
      }

      socket.on("message", t=>{
        document.getElementById("status").innerText=t;
      });

      socket.on("tick", t=>{
        document.getElementById("timer").innerText="⏱ "+t;
      });

      socket.on("players", list=>{
        document.getElementById("players").innerHTML =
          list.map(p=>p.name).join("<br>");
      });

      socket.on("winner", n=>{
        document.getElementById("status").innerText="👑 "+n+" wins!";
      });
    </script>
  `));
});

// ---------------- GAME SERVER ----------------
let players = [];
let scores = {};
let playing = false;
let timer = 10;
let loop = null;

function resetMatch() {
  players = [];
  scores = {};
  playing = false;
  if (loop) clearInterval(loop);
}

function startRound() {
  if (players.length < 2) return;

  playing = true;
  timer = 10;
  scores = {};

  players.forEach(p => scores[p.id] = 0);

  io.emit("message", "⚡ TAP FAST!");
  io.emit("tick", timer);

  loop = setInterval(async () => {
    timer--;
    io.emit("tick", timer);

    await users.updateMany({}, { $inc: { rounds: 1 } });

    if (timer <= 0) {
      clearInterval(loop);
      endRound();
    }
  }, 1000);
}

async function endRound() {
  playing = false;

  const sorted = [...players].sort((a, b) => {
    return (scores[b.id] || 0) - (scores[a.id] || 0);
  });

  const winner = sorted[0];

  if (winner) {
    await users.updateOne(
      { username: winner.name },
      { $inc: { wins: 1, coins: 100 } }
    );

    io.emit("winner", winner.name);
  }

  resetMatch();
}

io.on("connection", socket => {

  socket.on("joinAuto", async username => {
    if (players.find(p => p.name === username)) return;
    if (players.length >= 5) return;

    await ensureUser(username);

    players.push({
      id: socket.id,
      name: username
    });

    await users.updateOne(
      { username },
      { $inc: { games: 1 } }
    );

    io.emit("players", players);
    io.emit("message", players.length + "/5 Joined");

    if (players.length >= 2 && !playing) {
      setTimeout(startRound, 2000);
    }
  });

  socket.on("score", () => {
    if (!playing) return;
    scores[socket.id] = (scores[socket.id] || 0) + 1;
  });

  socket.on("disconnect", () => {
    players = players.filter(p => p.id !== socket.id);
    io.emit("players", players);
  });
});

// ---------------- START ----------------
server.listen(PORT, () => {
  console.log("Running on " + PORT);
});