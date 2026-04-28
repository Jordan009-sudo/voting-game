// =========================================
// NEON BATTLE V8.2 FULL
// Accounts + Coins + Profiles + Daily Reward + Leaderboard
// Render + Mongo Ready
// =========================================

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { MongoClient } = require("mongodb");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= PORT =================
const PORT = process.env.PORT || 10000;

// ================= SESSION =================
app.use(
  session({
    secret: process.env.SESSION_SECRET || "neonbattle_secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }
  })
);

// ================= DB =================
let users;

async function connectDB() {
  try {
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();

    const db = client.db("neonbattle");
    users = db.collection("users");

    console.log("Mongo Connected ✅");
  } catch (err) {
    console.log("Mongo Failed:", err.message);
  }
}
connectDB();

// ================= HELPERS =================
function loggedIn(req, res, next) {
  if (!req.session.user) return res.redirect("/");
  next();
}

function now() {
  return Date.now();
}

function canClaim(last) {
  if (!last) return true;
  return now() - last > 86400000;
}

// ================= HOME =================
app.get("/", async (req, res) => {
  if (req.session.user) return res.redirect("/profile");

  res.send(`
<!DOCTYPE html>
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
max-width:450px;
margin:auto;
background:#111;
padding:30px;
border-radius:20px;
box-shadow:0 0 25px #00ffe1;
}
input{
width:90%;
padding:14px;
margin:8px;
border:none;
border-radius:10px;
background:#222;
color:white;
font-size:16px;
}
button{
padding:14px 24px;
border:none;
border-radius:12px;
background:#00ffe1;
font-weight:bold;
cursor:pointer;
margin-top:10px;
}
a{
color:#00ffe1;
text-decoration:none;
}
</style>
</head>
<body>
<div class="box">
<h1>⚡ Neon Battle ⚡</h1>
<h2>Login</h2>

<form method="POST" action="/login">
<input name="username" placeholder="Username" required><br>
<input name="password" type="password" placeholder="Password" required><br>
<button type="submit">LOGIN</button>
</form>

<br>
<a href="/register">Create Account</a>
</div>
</body>
</html>
`);
});

// ================= REGISTER PAGE =================
app.get("/register", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Register</title>
<style>
body{background:#050505;color:white;font-family:Arial;text-align:center;padding:40px}
.box{max-width:450px;margin:auto;background:#111;padding:30px;border-radius:20px;box-shadow:0 0 25px #00ffe1}
input{width:90%;padding:14px;margin:8px;border:none;border-radius:10px;background:#222;color:white}
button{padding:14px 24px;border:none;border-radius:12px;background:#00ffe1;font-weight:bold}
a{color:#00ffe1}
</style>
</head>
<body>
<div class="box">
<h1>Create Account</h1>

<form method="POST" action="/register">
<input name="username" placeholder="Username" required><br>
<input name="password" type="password" placeholder="Password" required><br>
<button type="submit">REGISTER</button>
</form>

<br>
<a href="/">Back</a>
</div>
</body>
</html>
`);
});

// ================= REGISTER POST =================
app.post("/register", async (req, res) => {
  const username = req.body.username.trim();
  const password = req.body.password.trim();

  const found = await users.findOne({ username });

  if (found) return res.send("Username already exists.");

  const hash = await bcrypt.hash(password, 10);

  await users.insertOne({
    username,
    password: hash,
    wins: 0,
    games: 0,
    coins: 100,
    created: new Date(),
    daily: 0
  });

  res.redirect("/");
});

// ================= LOGIN =================
app.post("/login", async (req, res) => {
  const username = req.body.username.trim();
  const password = req.body.password.trim();

  const user = await users.findOne({ username });

  if (!user) return res.send("User not found.");

  const ok = await bcrypt.compare(password, user.password);

  if (!ok) return res.send("Wrong password.");

  req.session.user = username;
  res.redirect("/profile");
});

// ================= PROFILE =================
app.get("/profile", loggedIn, async (req, res) => {
  const user = await users.findOne({ username: req.session.user });

  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Profile</title>
<style>
body{
background:#050505;
color:white;
font-family:Arial;
text-align:center;
padding:40px;
}
.box{
max-width:600px;
margin:auto;
background:#111;
padding:30px;
border-radius:20px;
box-shadow:0 0 25px #00ffe1;
}
.card{
background:#000;
padding:18px;
border-radius:15px;
margin:10px;
}
button{
padding:12px 22px;
border:none;
border-radius:12px;
background:#00ffe1;
font-weight:bold;
margin:6px;
cursor:pointer;
}
a{
text-decoration:none;
}
</style>
</head>
<body>
<div class="box">

<h1>👤 ${user.username}</h1>

<div class="card">🏆 Wins: ${user.wins}</div>
<div class="card">🎮 Games: ${user.games}</div>
<div class="card">🪙 Coins: ${user.coins}</div>

<form action="/daily" method="POST">
<button>🎁 Claim Daily Reward</button>
</form>

<a href="/leaderboard"><button>🏆 Leaderboard</button></a>
<a href="/logout"><button>🚪 Logout</button></a>

</div>
</body>
</html>
`);
});

// ================= DAILY REWARD =================
app.post("/daily", loggedIn, async (req, res) => {
  const user = await users.findOne({ username: req.session.user });

  if (!canClaim(user.daily)) {
    return res.send("Daily reward already claimed. Come back tomorrow.");
  }

  await users.updateOne(
    { username: req.session.user },
    {
      $inc: { coins: 25 },
      $set: { daily: now() }
    }
  );

  res.redirect("/profile");
});

// ================= LEADERBOARD =================
app.get("/leaderboard", async (req, res) => {
  const top = await users
    .find({})
    .sort({ wins: -1 })
    .limit(10)
    .toArray();

  let html = "";

  top.forEach((u, i) => {
    html += `<div class="card">${i + 1}. ${u.username} - ${u.wins} wins - ${u.coins} coins</div>`;
  });

  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Leaderboard</title>
<style>
body{background:#050505;color:white;font-family:Arial;text-align:center;padding:40px}
.box{max-width:650px;margin:auto;background:#111;padding:30px;border-radius:20px;box-shadow:0 0 25px #00ffe1}
.card{background:#000;padding:15px;border-radius:12px;margin:10px}
button{padding:12px 22px;border:none;border-radius:12px;background:#00ffe1;font-weight:bold}
</style>
</head>
<body>
<div class="box">
<h1>🏆 Leaderboard</h1>
${html}
<a href="/profile"><button>Back</button></a>
</div>
</body>
</html>
`);
});

// ================= LOGOUT =================
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// ================= TEST WIN ROUTE =================
// Use later for game winner reward
app.get("/testwin", loggedIn, async (req, res) => {
  await users.updateOne(
    { username: req.session.user },
    {
      $inc: {
        wins: 1,
        coins: 50,
        games: 1
      }
    }
  );

  res.redirect("/profile");
});

// ================= START =================
app.listen(PORT, () => {
  console.log("Neon Battle V8.2 running on port " + PORT);
});