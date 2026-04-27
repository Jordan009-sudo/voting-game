// BUILD V8.1 STABLE ACCOUNTS
// server.js
// Render + GitHub ready
// Features:
// - Register
// - Login
// - Logout
// - Sessions fixed for Render
// - Mongo safe fallback
// - Password hashing
// - Better deploy stability

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { MongoClient } = require("mongodb");

const app = express();

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "change_this_secret";

// ================= PARSERS =================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= RENDER FIX =================
app.set("trust proxy", 1);

// ================= SESSION =================
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Render works fine with this
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

// ================= DB =================
let users = null;

async function connectDB() {
  if (!MONGO_URI) {
    console.log("No MONGO_URI set");
    return;
  }

  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db("neonbattle");
    users = db.collection("users");

    await users.createIndex(
      { username: 1 },
      { unique: true }
    );

    console.log("Mongo Connected ✅");
  } catch (err) {
    console.log("Mongo Failed:", err.message);
  }
}
connectDB();

// ================= HELPERS =================
function css() {
return `
<style>
body{
margin:0;
background:#050505;
color:white;
font-family:Arial;
text-align:center;
}
.wrap{
max-width:700px;
margin:auto;
padding:20px;
}
.card{
background:#111;
padding:25px;
border-radius:20px;
box-shadow:0 0 25px #00ffe1;
margin-top:30px;
}
input{
padding:12px;
width:260px;
border:none;
border-radius:10px;
background:#222;
color:white;
margin:6px;
}
button,a.btn{
padding:12px 18px;
border:none;
border-radius:10px;
background:#00ffe1;
color:#000;
font-weight:bold;
cursor:pointer;
text-decoration:none;
display:inline-block;
margin:5px;
}
.err{color:#ff7777}
.ok{color:#66ff99}
</style>
`;
}

function page(title, body) {
return `
<html>
<head>
<title>${title}</title>
${css()}
</head>
<body>
<div class="wrap">
<div class="card">
${body}
</div>
</div>
</body>
</html>
`;
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

// ================= HOME =================
app.get("/", async (req, res) => {

if (!req.session.user) {
return res.send(page("Home", `
<h1>⚡ Neon Battle ⚡</h1>

<a class="btn" href="/login">🔐 Login</a>
<a class="btn" href="/register">📝 Register</a>

<p>Create account to save wins & coins.</p>
`));
}

let username = req.session.user;
let user = null;

if (users) {
  user = await users.findOne({ username });
}

res.send(page("Dashboard", `
<h1>Welcome ${username}</h1>

<p>💰 Coins: ${user ? user.coins : 0}</p>
<p>🏆 Wins: ${user ? user.wins : 0}</p>
<p>🎮 Games: ${user ? user.games : 0}</p>

<a class="btn" href="/profile">👤 Profile</a>
<a class="btn" href="/play">🎮 Play</a>
<a class="btn" href="/logout">🚪 Logout</a>
`));

});

// ================= REGISTER =================
app.get("/register", (req, res) => {
res.send(page("Register", `
<h1>Create Account</h1>

<form method="POST" action="/register">
<input name="username" placeholder="Username" required><br>
<input type="password" name="password" placeholder="Password" required><br>
<button type="submit">Register</button>
</form>

<a class="btn" href="/">⬅ Home</a>
`));
});

app.post("/register", async (req, res) => {
try {

if (!users) {
return res.send(page("Error", `
<h1 class="err">Database Offline</h1>
<a class="btn" href="/">Home</a>
`));
}

let username = String(req.body.username || "").trim();
let password = String(req.body.password || "");

if (username.length < 3 || password.length < 4) {
return res.send(page("Error", `
<h1 class="err">Invalid details</h1>
<a class="btn" href="/register">Try Again</a>
`));
}

const exists = await users.findOne({ username });

if (exists) {
return res.send(page("Error", `
<h1 class="err">Username Taken</h1>
<a class="btn" href="/register">Try Again</a>
`));
}

const hash = await bcrypt.hash(password, 10);

await users.insertOne({
username,
passwordHash: hash,
wins: 0,
coins: 0,
games: 0,
createdAt: Date.now()
});

req.session.user = username;

res.redirect("/");

} catch (err) {
res.send(page("Error", `
<h1 class="err">Failed</h1>
<p>${err.message}</p>
`));
}
});

// ================= LOGIN =================
app.get("/login", (req, res) => {
res.send(page("Login", `
<h1>Login</h1>

<form method="POST" action="/login">
<input name="username" placeholder="Username" required><br>
<input type="password" name="password" placeholder="Password" required><br>
<button type="submit">Login</button>
</form>

<a class="btn" href="/">⬅ Home</a>
`));
});

app.post("/login", async (req, res) => {
try {

if (!users) {
return res.send(page("Error", `
<h1 class="err">Database Offline</h1>
<a class="btn" href="/">Home</a>
`));
}

const username = String(req.body.username || "").trim();
const password = String(req.body.password || "");

const user = await users.findOne({ username });

if (!user) {
return res.send(page("Error", `
<h1 class="err">User Not Found</h1>
<a class="btn" href="/login">Try Again</a>
`));
}

const match = await bcrypt.compare(
password,
user.passwordHash
);

if (!match) {
return res.send(page("Error", `
<h1 class="err">Wrong Password</h1>
<a class="btn" href="/login">Try Again</a>
`));
}

req.session.user = username;

res.redirect("/");

} catch (err) {
res.send(page("Error", `
<h1 class="err">Login Failed</h1>
<p>${err.message}</p>
`));
}
});

// ================= LOGOUT =================
app.get("/logout", (req, res) => {
req.session.destroy(() => {
res.redirect("/");
});
});

// ================= PROFILE =================
app.get("/profile", requireLogin, async (req, res) => {

let username = req.session.user;
let user = users
  ? await users.findOne({ username })
  : null;

res.send(page("Profile", `
<h1>👤 ${username}</h1>

<p>💰 Coins: ${user ? user.coins : 0}</p>
<p>🏆 Wins: ${user ? user.wins : 0}</p>
<p>🎮 Games: ${user ? user.games : 0}</p>

<a class="btn" href="/">⬅ Dashboard</a>
`));

});

// ================= PLAY =================
app.get("/play", requireLogin, (req, res) => {
res.send(page("Play", `
<h1>🎮 Multiplayer Game Next Step</h1>
<p>Logged in as ${req.session.user}</p>

<a class="btn" href="/">⬅ Dashboard</a>
`));
});

// ================= START =================
app.listen(PORT, () => {
console.log("Running on " + PORT);
});