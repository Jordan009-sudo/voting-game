// =======================================================
// NEON BATTLE V8.5 FULL
// CLEAN UI + BETTER MINIGAMES + MOBILE OPTIMIZED
// FULL server.js (single file)
// =======================================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const session = require("express-session");
const { MongoClient } = require("mongodb");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI || "";

// ================= APP =================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "neonbattle_secret",
    resave: false,
    saveUninitialized: false
  })
);

// ================= DB =================
let users = null;

async function connectDB() {
  try {
    if (!MONGO_URI) return console.log("No DB");
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    users = client.db("neonbattle").collection("users");
    console.log("Mongo Connected ✅");
  } catch (e) {
    console.log("Mongo Error", e.message);
  }
}
connectDB();

// ================= HELPERS =================
function username(req) {
  return req.session.user || null;
}

function requireLogin(req, res, next) {
  if (!username(req)) return res.redirect("/");
  next();
}

function guestName() {
  return "Guest" + Math.floor(1000 + Math.random() * 9000);
}

function shell(title, body) {
return `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
*{box-sizing:border-box}
body{
margin:0;
font-family:Arial;
background:linear-gradient(180deg,#030303,#0c0c0c);
color:white;
text-align:center;
padding:20px;
}
.wrap{
max-width:760px;
margin:auto;
}
.card{
background:#111;
border:1px solid #222;
padding:22px;
border-radius:22px;
box-shadow:0 0 25px rgba(0,255,255,.18);
}
h1{margin-top:0}
input,button,a{
width:100%;
max-width:340px;
padding:14px;
margin:8px auto;
display:block;
border:none;
border-radius:14px;
font-size:16px;
text-decoration:none;
}
input{
background:#1d1d1d;
color:#fff;
}
button,a{
background:#00ffe1;
color:#000;
font-weight:700;
cursor:pointer;
}
.small{font-size:14px;color:#bbb}
.row{
display:grid;
grid-template-columns:1fr 1fr;
gap:10px;
}
@media(max-width:600px){
.row{grid-template-columns:1fr}
}
.list{
background:#000;
padding:14px;
border-radius:14px;
margin-top:12px;
text-align:left;
white-space:pre-line;
}
.win{
font-size:28px;
animation:pop .6s infinite alternate;
}
@keyframes pop{
from{transform:scale(1)}
to{transform:scale(1.08)}
}
.target{
width:70px;height:70px;border-radius:50%;
background:#ff2b2b;
position:absolute;
}
.good{background:#00ff66!important}
.bad{background:#ff3131!important}
</style>
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

// ================= HOME =================
app.get("/", (req, res) => {
const me = username(req);

res.send(shell("Neon Battle", `
<h1>⚡ Neon Battle ⚡</h1>
${me ? `
<h3>Welcome ${me}</h3>
<a href="/game">🎮 PLAY</a>
<a href="/profile">👤 PROFILE</a>
<a href="/logout">🚪 LOGOUT</a>
` : `
<form method="POST" action="/login">
<input name="username" placeholder="Username">
<input name="password" type="password" placeholder="Password">
<button>🔐 LOGIN</button>
</form>
<form method="POST" action="/register">
<input name="username" placeholder="New Username">
<input name="password" type="password" placeholder="New Password">
<button>📝 REGISTER</button>
</form>
<a href="/guest">👤 PLAY AS GUEST</a>
`}
`));
});

// ================= AUTH =================
app.get("/guest", (req, res) => {
req.session.user = guestName();
res.redirect("/game");
});

app.post("/register", async (req, res) => {
try{
if(!users) return res.send("DB offline");

const u = String(req.body.username || "").trim();
const p = String(req.body.password || "").trim();

if(!u || !p) return res.redirect("/");

const exists = await users.findOne({ username:u });
if(exists) return res.send("Username taken");

await users.insertOne({
username:u,
password:p,
wins:0,
coins:100,
games:0
});

req.session.user = u;
res.redirect("/profile");
}catch{
res.send("Register failed");
}
});

app.post("/login", async (req, res) => {
try{
const u = String(req.body.username || "").trim();
const p = String(req.body.password || "").trim();

if(!users) return res.send("DB offline");

const user = await users.findOne({ username:u });
if(!user) return res.send("User not found");

if(user.password !== p) return res.send("Wrong password");

req.session.user = u;
res.redirect("/profile");
}catch{
res.send("Login failed");
}
});

app.get("/logout",(req,res)=>{
req.session.destroy(()=>res.redirect("/"));
});

// ================= PROFILE =================
app.get("/profile", requireLogin, async (req,res)=>{
const me = username(req);

if(me.startsWith("Guest")){
return res.send(shell("Guest",`
<h1>${me}</h1>
<p>Guest account</p>
<a href="/game">🎮 PLAY</a>
<a href="/">🏠 HOME</a>
`));
}

const user = await users.findOne({ username:me });

res.send(shell("Profile",`
<h1>👤 ${me}</h1>
<div class="row">
<div class="list">🏆 Wins: ${user.wins}</div>
<div class="list">🪙 Coins: ${user.coins}</div>
<div class="list">🎮 Games: ${user.games}</div>
<div class="list">⭐ Rank: ${Math.floor(user.wins/5)+1}</div>
</div>
<a href="/game">🎮 PLAY</a>
<a href="/">🏠 HOME</a>
`));
});

// ================= GAME PAGE =================
app.get("/game", requireLogin, (req,res)=>{
const me = username(req);

res.send(shell("Game",`
<h1>⚡ Neon Battle ⚡</h1>
<h3 id="status">Joining lobby...</h3>
<h2 id="timer"></h2>

<div id="arena" style="position:relative;height:320px;background:#000;border-radius:18px;margin:10px 0"></div>

<button id="mainBtn" onclick="mainTap()">TAP!</button>

<div id="players" class="list"></div>
<div id="score" class="list"></div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
const me = "${me}";
let game = "tap";

socket.emit("joinAuto", me);

function by(id){return document.getElementById(id)}

function mainTap(){
 if(game==="tap") socket.emit("score");
}

function moveTarget(){
 socket.emit("score");
}

function pickDoor(n){
 socket.emit("doorPick",n);
}

function spamGood(){
 socket.emit("score");
}

function mathAnswer(){
 const v = prompt("Answer:");
 socket.emit("mathAnswer",v);
}

socket.on("players", list=>{
 let t="👥 PLAYERS\\n\\n";
 list.forEach(p=> t += p.name+"\\n");
 by("players").innerText=t;
});

socket.on("message", m=>{
 by("status").innerText=m;
});

socket.on("tick", t=>{
 by("timer").innerText="⏱ "+t;
});

socket.on("roundStart", data=>{
 game = data.game;
 by("score").innerText="";
 by("arena").innerHTML="";
 by("mainBtn").style.display="block";

 if(game==="tap"){
   by("status").innerText="⚡ TAP FRENZY";
   by("mainBtn").innerText="TAP!";
 }

 if(game==="target"){
   by("status").innerText="🎯 MOVING TARGET";
   by("mainBtn").style.display="none";
   spawnTarget();
 }

 if(game==="door"){
   by("status").innerText="🚪 PICK A DOOR";
   by("mainBtn").style.display="none";
   by("arena").innerHTML='<button onclick="pickDoor(1)">Door 1</button><button onclick="pickDoor(2)">Door 2</button><button onclick="pickDoor(3)">Door 3</button>';
 }

 if(game==="spam"){
   by("status").innerText="💣 TAP ONLY GREEN";
   by("mainBtn").style.display="none";
   spamButtons();
 }

 if(game==="math"){
   by("status").innerText="🧠 QUICK MATH";
   by("mainBtn").innerText="ANSWER";
   by("mainBtn").onclick=mathAnswer;
 }

});

function spawnTarget(){
 const a = by("arena");
 const x = Math.random()*240;
 const y = Math.random()*220;
 a.innerHTML='<div class="target" onclick="moveTarget()" style="left:'+x+'px;top:'+y+'px"></div>';
}

function spamButtons(){
 const good = Math.random()>0.5;
 by("arena").innerHTML='<button class="'+(good?'good':'bad')+'" onclick="'+(good?'spamGood()':'')+'">'+(good?'TAP':'DONT TAP')+'</button>';
 setTimeout(spamButtons,800);
}

socket.on("moveTarget",spawnTarget);

socket.on("scoreboard", board=>{
 let t="🏆 RESULTS\\n\\n";
 board.forEach((p,i)=>{
   t += (i+1)+". "+p.name+" - "+p.points+"\\n";
 });
 by("score").innerText=t;
});

socket.on("winner", name=>{
 by("status").innerHTML='<span class="win">👑 '+name+' WINS!</span>';
});
</script>
`));
});

// ================= GAME SERVER =================
let players = [];
let scores = {};
let started = false;
let playing = false;
let timer = 10;
let loop = null;

const games = ["tap","target","door","spam","math"];

function sendPlayers(){
 io.emit("players",players);
}

function alive(){
 return players;
}

function startRound(){
 if(players.length < 2) return;

 playing = true;
 timer = 10;
 scores = {};

 players.forEach(p=>scores[p.id]=0);

 const current = games[Math.floor(Math.random()*games.length)];
 io.emit("roundStart",{game:current});

 loop = setInterval(()=>{
   timer--;
   io.emit("tick",timer);

   if(timer<=0){
     clearInterval(loop);
     endRound();
   }
 },1000);
}

async function endRound(){
playing = false;

const board = players.map(p=>({
 id:p.id,
 name:p.name,
 points:scores[p.id]||0
})).sort((a,b)=>b.points-a.points);

io.emit("scoreboard",board);

const winner = board[0];
if(winner){
 io.emit("winner",winner.name);

 if(users && !winner.name.startsWith("Guest")){
   await users.updateOne(
    { username:winner.name },
    { $inc:{ wins:1, coins:50, games:1 } }
   );
 }
}

setTimeout(()=>{
 players=[];
 sendPlayers();
 started=false;
},6000);
}

io.on("connection",socket=>{

socket.on("joinAuto",name=>{
 if(players.find(p=>p.name===name)) return;
 if(players.length>=5) return;

 players.push({
   id:socket.id,
   name
 });

 sendPlayers();
 io.emit("message",players.length+"/5 Joined");

 if(players.length>=2 && !started){
   started=true;
   setTimeout(startRound,2500);
 }
});

socket.on("score",()=>{
 if(!playing) return;
 scores[socket.id]=(scores[socket.id]||0)+1;
 io.emit("moveTarget");
});

socket.on("doorPick",n=>{
 if(!playing) return;
 if(n===Math.ceil(Math.random()*3)){
   scores[socket.id]+=3;
 }else{
   scores[socket.id]+=1;
 }
});

socket.on("mathAnswer",v=>{
 if(!playing) return;
 if(Number(v)===4) scores[socket.id]+=3;
});

socket.on("disconnect",()=>{
 players = players.filter(p=>p.id!==socket.id);
 sendPlayers();
});

});

// ================= START =================
server.listen(PORT,()=>{
 console.log("Running on "+PORT);
});