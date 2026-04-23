// BUILD V8 ACCOUNTS FULL
// server.js
//
// Features:
// - Register
// - Login
// - Logout
// - Password hashing (bcryptjs)
// - Sessions
// - MongoDB Atlas
// - Profile page
//
// IMPORTANT package.json deps:
// express
// socket.io
// mongodb
// bcryptjs
// express-session

const express = require("express");
const http = require("http");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { MongoClient } = require("mongodb");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET =
  process.env.SESSION_SECRET || "change_this_secret_now";

// ================= PARSERS =================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= SESSION =================
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
    }
  })
);

// ================= DB =================
let users = null;

async function connectDB() {
  if (!MONGO_URI) {
    console.log("No MONGO_URI");
    return;
  }

  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db("neonbattle");
    users = db.collection("users");

    await users.createIndex({ username: 1 }, { unique: true });

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
font-family:Arial;
color:white;
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
margin-top:25px;
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
p{
font-size:18px;
}
small{opacity:.7}
.err{color:#ff6666}
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
    return res.send(
      page(
        "Neon Battle",
        `
<h1>⚡ Neon Battle ⚡</h1>
<p>Welcome!</p>

<a class="btn" href="/login">🔐 Login</a>
<a class="btn" href="/register">📝 Sign Up</a>
<a class="btn" href="/guest">🎮 Play As Guest</a>

<br><br>
<small>Create an account to save coins, wins and stats.</small>
`
      )
    );
  }

  const user = await users.findOne({
    username: req.session.user
  });

  res.send(
    page(
      "Dashboard",
      `
<h1>⚡ Welcome ${user.username}</h1>

<p>💰 Coins: ${user.coins || 0}</p>
<p>🏆 Wins: ${user.wins || 0}</p>
<p>🎮 Games: ${user.games || 0}</p>

<a class="btn" href="/play">🎮 Play</a>
<a class="btn" href="/profile">👤 Profile</a>
<a class="btn" href="/logout">🚪 Logout</a>
`
    )
  );
});

// ================= REGISTER =================
app.get("/register", (req, res) => {
  res.send(
    page(
      "Register",
      `
<h1>📝 Create Account</h1>

<form method="POST" action="/register">
<input name="username" placeholder="Username" required><br>
<input type="password" name="password" placeholder="Password" required><br>
<button type="submit">Create Account</button>
</form>

<a class="btn" href="/">⬅ Home</a>
`
    )
  );
});

app.post("/register", async (req, res) => {
  try {
    if (!users) {
      return res.send(
        page("Error", "<h1>DB Offline</h1>")
      );
    }

    let username = String(req.body.username || "").trim();
    let password = String(req.body.password || "");

    if (username.length < 3 || password.length < 4) {
      return res.send(
        page(
          "Register",
          `
<h1 class="err">Invalid Details</h1>
<p>Username 3+ chars<br>Password 4+ chars</p>
<a class="btn" href="/register">Try Again</a>
`
        )
      );
    }

    const existing = await users.findOne({ username });

    if (existing) {
      return res.send(
        page(
          "Register",
          `
<h1 class="err">Username Taken</h1>
<a class="btn" href="/register">Try Again</a>
`
        )
      );
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
    res.send(
      page(
        "Error",
        `<h1 class="err">Failed</h1><p>${err.message}</p>`
      )
    );
  }
});

// ================= LOGIN =================
app.get("/login", (req, res) => {
  res.send(
    page(
      "Login",
      `
<h1>🔐 Login</h1>

<form method="POST" action="/login">
<input name="username" placeholder="Username" required><br>
<input type="password" name="password" placeholder="Password" required><br>
<button type="submit">Login</button>
</form>

<a class="btn" href="/">⬅ Home</a>
`
    )
  );
});

app.post("/login", async (req, res) => {
  try {
    if (!users) {
      return res.send(
        page("Error", "<h1>DB Offline</h1>")
      );
    }

    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const user = await users.findOne({ username });

    if (!user) {
      return res.send(
        page(
          "Login",
          `
<h1 class="err">User Not Found</h1>
<a class="btn" href="/login">Try Again</a>
`
        )
      );
    }

    const ok = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!ok) {
      return res.send(
        page(
          "Login",
          `
<h1 class="err">Wrong Password</h1>
<a class="btn" href="/login">Try Again</a>
`
        )
      );
    }

    req.session.user = user.username;
    res.redirect("/");
  } catch (err) {
    res.send(
      page(
        "Error",
        `<h1>${err.message}</h1>`
      )
    );
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
  const user = await users.findOne({
    username: req.session.user
  });

  res.send(
    page(
      "Profile",
      `
<h1>👤 ${user.username}</h1>

<p>💰 Coins: ${user.coins || 0}</p>
<p>🏆 Wins: ${user.wins || 0}</p>
<p>🎮 Games: ${user.games || 0}</p>

<a class="btn" href="/">⬅ Dashboard</a>
`
    )
  );
});

// ================= PLAY PAGE =================
app.get("/play", requireLogin, async (req, res) => {
  const user = req.session.user;

  res.send(
    page(
      "Play",
      `
<h1>🎮 Logged in as ${user}</h1>
<p>Game room page ready for merge with V7 gameplay.</p>

<a class="btn" href="/">⬅ Dashboard</a>
`
    )
  );
});

// ================= GUEST MODE =================
app.get("/guest", (req, res) => {
  res.send(
    page(
      "Guest",
      `
<h1>🎮 Guest Mode</h1>
<p>Play without saving progress.</p>

<a class="btn" href="/">⬅ Home</a>
`
    )
  );
});

// ================= SOCKET.IO =================
io.on("connection", socket => {
  console.log("User Connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("User Left:", socket.id);
  });
});

// ================= START =================
server.listen(PORT, () => {
  console.log("Running on " + PORT);
});