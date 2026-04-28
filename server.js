// V8.3 FULL STABLE ACCOUNTS
// server.js

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

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// ================= DATABASE =================
let users;

async function connectDB() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db("neonbattle");
    users = db.collection("users");
    console.log("Mongo Connected ✅");
  } catch (err) {
    console.log("Mongo Failed ❌", err.message);
  }
}
connectDB();

// ================= SIMPLE SESSION =================
const sessions = {};

function createSession(username) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions[token] = username;
  return token;
}

function getUser(req) {
  const token = req.cookies.token;
  if (!token) return null;
  return sessions[token] || null;
}

// ================= HELPERS =================
async function createLegacySafeUser(username) {
  if (!users) return;

  const found = await users.findOne({ username });

  if (!found) {
    await users.insertOne({
      username,
      password: null,
      wins: 0,
      coins: 0,
      games: 0,
      skin: "cyan"
    });
  }
}

// ================= PAGES =================

// HOME
app.get("/", (req, res) => {
  const me = getUser(req);

  res.send(`
  <html>
  <head>
  <title>Neon Battle</title>
  <style>
  body{
    background:#050505;
    color:white;
    font-family:Arial;
    text-align:center;
    padding:40px;
  }
  .box{
    max-width:700px;
    margin:auto;
    background:#111;
    padding:30px;
    border-radius:20px;
    box-shadow:0 0 30px cyan;
  }
  a,button{
    display:inline-block;
    margin:8px;
    padding:12px 18px;
    background:cyan;
    color:black;
    text-decoration:none;
    border:none;
    border-radius:10px;
    font-weight:bold;
    cursor:pointer;
  }
  </style>
  </head>
  <body>
    <div class="box">
      <h1>⚡ Neon Battle ⚡</h1>

      ${
        me
          ? `
          <h2>Welcome ${me}</h2>
          <a href="/profile">Profile</a>
          <a href="/game">Enter Game</a>
          <a href="/logout">Logout</a>
        `
          : `
          <a href="/register">Register</a>
          <a href="/login">Login</a>
        `
      }
    </div>
  </body>
  </html>
  `);
});

// REGISTER
app.get("/register", (req, res) => {
  res.send(`
  <html><body style="background:#050505;color:white;text-align:center;font-family:Arial;padding:50px">
  <h1>Register</h1>
  <form method="POST">
    <input name="username" placeholder="Username" required><br><br>
    <input name="password" type="password" placeholder="Password" required><br><br>
    <button>Register</button>
  </form>
  <br><a href="/">Home</a>
  </body></html>
  `);
});

app.post("/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.send("Fill all fields");
    }

    const exists = await users.findOne({ username });

    if (exists) {
      return res.send("Username taken");
    }

    const hash = await bcrypt.hash(password, 10);

    await users.insertOne({
      username,
      password: hash,
      wins: 0,
      coins: 0,
      games: 0,
      skin: "cyan"
    });

    res.redirect("/login");
  } catch (err) {
    res.send("Register failed");
  }
});

// LOGIN
app.get("/login", (req, res) => {
  res.send(`
  <html><body style="background:#050505;color:white;text-align:center;font-family:Arial;padding:50px">
  <h1>Login</h1>
  <form method="POST">
    <input name="username" placeholder="Username" required><br><br>
    <input name="password" type="password" placeholder="Password" required><br><br>
    <button>Login</button>
  </form>
  <br><a href="/">Home</a>
  </body></html>
  `);
});

app.post("/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const user = await users.findOne({ username });

    if (!user) return res.send("User not found");

    // old accounts
    if (!user.password) {
      const newHash = await bcrypt.hash(password, 10);

      await users.updateOne(
        { username },
        { $set: { password: newHash } }
      );
    }

    const fresh = await users.findOne({ username });

    const ok = await bcrypt.compare(password, fresh.password);

    if (!ok) return res.send("Wrong password");

    const token = createSession(username);
    res.cookie("token", token);

    res.redirect("/profile");
  } catch (err) {
    console.log(err);
    res.send("Login failed");
  }
});

// PROFILE
app.get("/profile", async (req, res) => {
  const me = getUser(req);
  if (!me) return res.redirect("/login");

  const user = await users.findOne({ username: me });

  res.send(`
  <html>
  <body style="background:#050505;color:white;text-align:center;font-family:Arial;padding:40px">
  <h1>👤 ${me}</h1>
  <h2>🏆 Wins: ${user.wins || 0}</h2>
  <h2>🪙 Coins: ${user.coins || 0}</h2>
  <h2>🎮 Games: ${user.games || 0}</h2>
  <h2>🎨 Skin: ${user.skin || "cyan"}</h2>
  <br>
  <a href="/shop">Shop</a><br><br>
  <a href="/game">Play</a><br><br>
  <a href="/">Home</a>
  </body>
  </html>
  `);
});

// SHOP
app.get("/shop", async (req, res) => {
  const me = getUser(req);
  if (!me) return res.redirect("/login");

  const user = await users.findOne({ username: me });

  res.send(`
  <html>
  <body style="background:#050505;color:white;text-align:center;font-family:Arial;padding:40px">
  <h1>🛒 Shop</h1>
  <h2>Coins: ${user.coins}</h2>

  <a href="/buy/red">Buy Red Skin (100)</a><br><br>
  <a href="/buy/gold">Buy Gold Skin (250)</a><br><br>
  <a href="/profile">Back</a>
  </body>
  </html>
  `);
});

app.get("/buy/:skin", async (req, res) => {
  const me = getUser(req);
  if (!me) return res.redirect("/login");

  const skin = req.params.skin;

  const prices = {
    red: 100,
    gold: 250
  };

  if (!prices[skin]) return res.redirect("/shop");

  const user = await users.findOne({ username: me });

  if (user.coins < prices[skin]) {
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

// LOGOUT
app.get("/logout", (req, res) => {
  const token = req.cookies.token;
  delete sessions[token];
  res.clearCookie("token");
  res.redirect("/");
});

// ================= GAME PAGE =================
app.get("/game", (req, res) => {
  res.send(`
  <html>
  <body style="background:#000;color:#fff;text-align:center;font-family:Arial;padding:30px">
  <h1>⚡ Neon Battle Lobby ⚡</h1>
  <h2 id="status">Connecting...</h2>
  <div id="players"></div>
  <button onclick="score()">TAP!</button>

  <script src="/socket.io/socket.io.js"></script>
  <script>
  const socket = io();

  function score(){
    socket.emit("score");
  }

  socket.on("message", t=>{
    document.getElementById("status").innerText=t;
  });

  socket.on("players", list=>{
    document.getElementById("players").innerHTML =
      list.map(x=>x.name).join("<br>");
  });
  </script>
  </body>
  </html>
  `);
});

// ================= GAME SERVER =================
let players = [];
let scores = {};
let started = false;

io.on("connection", socket => {
  socket.on("score", () => {
    scores[socket.id] = (scores[socket.id] || 0) + 1;
  });

  socket.on("joinAuto", async username => {
    if (players.length >= 5) return;

    players.push({
      id: socket.id,
      name: username
    });

    io.emit("players", players);
    io.emit("message", players.length + "/5 Joined");

    await createLegacySafeUser(username);
    await users.updateOne(
      { username },
      { $inc: { games: 1 } }
    );
  });

  socket.on("disconnect", () => {
    players = players.filter(p => p.id !== socket.id);
    io.emit("players", players);
  });
});

// auto join if logged in
io.use((socket, next) => {
  next();
});

// ================= START =================
server.listen(PORT, () => {
  console.log("Running on " + PORT);
});