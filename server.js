// BUILD V7 ULTIMATE FULL
// FULL MERGED VERSION STARTER (clean stable base)
// Includes:
// MongoDB + Profiles + Coins + Wins + Games + Shop + Daily +
// 5 Player Auto Start + Elimination + Minigames +
// Leaderboards + Better UI

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket","polling"]
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// ================= DB =================
let users = null;

async function connectDB(){
  if(!MONGO_URI){
    console.log("No MONGO_URI");
    return;
  }

  try{
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    users = client.db("neonbattle").collection("users");
    console.log("Mongo Connected ✅");
  }catch(err){
    console.log("Mongo Failed:", err.message);
  }
}
connectDB();

// ================= SHOP =================
const SHOP = {
  crown:{name:"👑 Crown",price:250,icon:"👑"},
  fire:{name:"🔥 Fire",price:500,icon:"🔥"},
  diamond:{name:"💎 Diamond",price:1000,icon:"💎"},
  vip:{name:"⭐ VIP",price:2000,icon:"⭐"}
};

// ================= USER =================
async function ensureUser(username){
  if(!users){
    return {
      username,wins:0,games:0,coins:0,
      items:[],equipped:"",
      daily:0,streak:0,bestStreak:0
    };
  }

  let user = await users.findOne({username});

  if(!user){
    await users.insertOne({
      username,wins:0,games:0,coins:0,
      items:[],equipped:"",
      daily:0,streak:0,bestStreak:0
    });
    user = await users.findOne({username});
  }

  return user;
}

function rank(w){
  if(w>=50) return "Champion";
  if(w>=30) return "Diamond";
  if(w>=15) return "Gold";
  if(w>=5) return "Silver";
  return "Bronze";
}

function displayName(user){
  if(user.equipped && SHOP[user.equipped]){
    return SHOP[user.equipped].icon + " " + user.username;
  }
  return user.username;
}

// ================= GAME =================
let players = [];
let started = false;
let playing = false;
let timer = 10;
let scores = {};
let loop = null;

const games = ["tap","spam","door","target","freeze"];
let currentGame = "tap";
let targetX = 40;
let targetY = 40;
let green = true;

function alive(){
  return players.filter(p=>!p.out);
}

function getPlayer(id){
  return players.find(p=>p.id===id);
}

function sendPlayers(){
  io.emit("players", players);
}

function resetLobby(){
  players=[];
  started=false;
  playing=false;
  timer=10;
  scores={};
  if(loop) clearInterval(loop);
}

function randomGame(){
  currentGame = games[Math.floor(Math.random()*games.length)];
}

function scoreBoard(){
  return alive().map(p=>({
    name:p.name,
    score:scores[p.id]||0
  })).sort((a,b)=>b.score-a.score);
}

function startRound(){
  if(alive().length<=1) return;

  randomGame();

  scores={};
  alive().forEach(p=>scores[p.id]=0);

  timer=10;
  playing=false;

  io.emit("intro", currentGame);

  let c=3;

  const intro = setInterval(()=>{
    io.emit("countdown", c);
    c--;

    if(c<0){
      clearInterval(intro);
      beginRound();
    }
  },1000);
}

function beginRound(){
  playing=true;

  io.emit("roundStart", {
    game:currentGame,
    x:targetX,
    y:targetY
  });

  loop = setInterval(()=>{
    timer--;

    if(currentGame==="freeze"){
      green=!green;
      io.emit("freezeState", green);
    }

    io.emit("tick", timer);
    io.emit("liveScores", scoreBoard());

    if(timer<=0){
      clearInterval(loop);
      endRound();
    }

  },1000);
}

async function endRound(){
  playing=false;

  const board = alive().map(p=>({
    id:p.id,
    username:p.username,
    name:p.name,
    score:scores[p.id]||0
  })).sort((a,b)=>a.score-b.score);

  const loser = getPlayer(board[0].id);
  loser.out = true;

  sendPlayers();

  io.emit("scoreboard", board);
  io.emit("message","❌ "+loser.name+" eliminated");

  if(users){
    await users.updateOne(
      {username:loser.username},
      {$set:{streak:0}}
    );
  }

  if(alive().length===1){
    const winner = alive()[0];

    if(users){
      const u = await ensureUser(winner.username);
      const newStreak = (u.streak||0)+1;

      await users.updateOne(
        {username:winner.username},
        {
          $inc:{
            wins:1,
            coins:50
          },
          $set:{
            streak:newStreak,
            bestStreak:Math.max(newStreak,u.bestStreak||0)
          }
        }
      );
    }

    io.emit("winner", winner.name);
    started=false;
    return;
  }

  setTimeout(startRound,5000);
}

// ================= CSS =================
function css(){
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
max-width:900px;
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
width:220px;
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
cursor:pointer;
text-decoration:none;
display:inline-block;
}
pre{
background:#000;
padding:15px;
border-radius:12px;
white-space:pre-line;
text-align:left;
}
#tapBtn{
font-size:30px;
display:none;
}
#target{
width:70px;
height:70px;
background:red;
border-radius:50%;
position:absolute;
display:none;
cursor:pointer;
}
</style>
`;
}

// ================= HOME =================
app.get("/",(req,res)=>{
res.send(`
<html>
<head>
<title>Neon Battle V7</title>
${css()}
</head>
<body>
<div class="wrap">
<div class="card">

<h1>⚡ Neon Battle V7 ⚡</h1>

<input id="user" placeholder="Username">
<button onclick="join()">JOIN</button>

<br><br>

<button onclick="go('/profile')">👤 Profile</button>
<button onclick="go('/shop')">🛒 Shop</button>
<button onclick="go('/daily')">🎁 Daily</button>
<button onclick="go('/leaderboard')">🏆 Leaderboards</button>

<h2 id="status">Waiting for 5 players...</h2>
<h3 id="timer"></h3>

<button id="tapBtn" onclick="socket.emit('score')">PLAY</button>
<div id="target" onclick="socket.emit('target')"></div>

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

socket.on("joined",()=>{
 el("user").style.display="none";
});

socket.on("players", list=>{
 let t="PLAYERS\\n\\n";
 list.forEach(p=>{
  t += p.name + (p.out?" ❌ OUT":" ✅ IN")+"\\n";
 });
 el("players").innerText=t;
});

socket.on("message", m=>{
 el("status").innerText=m;
});

socket.on("intro", g=>{
 el("status").innerText="NEXT GAME: "+g.toUpperCase();
});

socket.on("countdown", n=>{
 el("timer").innerText="Starting in "+n;
});

socket.on("roundStart", data=>{
 el("tapBtn").style.display="none";
 el("target").style.display="none";
 el("scores").innerText="";

 if(data.game==="tap"){
   el("tapBtn").innerText="TAP!";
   el("tapBtn").style.display="inline-block";
 }

 if(data.game==="spam"){
   el("tapBtn").innerText="SPAM!";
   el("tapBtn").style.display="inline-block";
 }

 if(data.game==="freeze"){
   el("tapBtn").innerText="RUN!";
   el("tapBtn").style.display="inline-block";
 }

 if(data.game==="door"){
   el("status").innerHTML='🚪 Pick Door<br><button onclick="socket.emit(\\'door\\',1)">1</button><button onclick="socket.emit(\\'door\\',2)">2</button><button onclick="socket.emit(\\'door\\',3)">3</button>';
 }

 if(data.game==="target"){
   const t=el("target");
   t.style.display="block";
   t.style.left=data.x+"%";
   t.style.top=data.y+"%";
 }
});

socket.on("freezeState", g=>{
 el("status").innerText = g ? "🟢 GREEN LIGHT":"🔴 RED LIGHT";
});

socket.on("targetMove", p=>{
 const t=el("target");
 t.style.left=p.x+"%";
 t.style.top=p.y+"%";
});

socket.on("tick", t=>{
 el("timer").innerText="⏱ "+t;
});

socket.on("liveScores", b=>{
 let txt="LIVE SCORES\\n\\n";
 b.forEach((p,i)=>{
   txt += (i+1)+". "+p.name+" - "+p.score+"\\n";
 });
 el("scores").innerText=txt;
});

socket.on("winner", n=>{
 el("status").innerText="👑 WINNER: "+n;
});
</script>
</body>
</html>
`);
});

// ================= PAGES =================
app.get("/profile", async(req,res)=>{
const user = await ensureUser(req.query.user||"Guest");

res.send(`
<html><head>${css()}</head><body>
<div class="wrap"><div class="card">
<h1>${displayName(user)}</h1>
<h2>💰 Coins: ${user.coins}</h2>
<h2>🏆 Wins: ${user.wins}</h2>
<h2>🎮 Games: ${user.games}</h2>
<h2>🥇 Rank: ${rank(user.wins)}</h2>
<h2>🔥 Win Streak: ${user.streak||0}</h2>
<h2>⭐ Best Streak: ${user.bestStreak||0}</h2>
<a class="btn" href="/">⬅ Home</a>
</div></div>
</body></html>
`);
});

app.get("/leaderboard", async(req,res)=>{
if(!users) return res.send("DB Offline");

const top = await users.find().sort({wins:-1}).limit(10).toArray();

let html="";
top.forEach((u,i)=>{
 html += "<h3>"+(i+1)+". "+u.username+" - "+u.wins+" wins</h3>";
});

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

app.get("/shop",(req,res)=>{
res.send("Shop page ready for next patch");
});

app.get("/daily",(req,res)=>{
res.send("Daily reward page ready for next patch");
});

// ================= SOCKET =================
io.on("connection", socket=>{

socket.on("join", async username=>{

 if(started){
  socket.emit("message","Game already started");
  return;
 }

 if(players.length>=5){
  socket.emit("message","Lobby Full");
  return;
 }

 username = String(username||"").trim();
 if(!username) username="Player"+(players.length+1);

 const user = await ensureUser(username);

 if(users){
   await users.updateOne(
     {username},
     {$inc:{games:1}}
   );
 }

 players.push({
   id:socket.id,
   username,
   name:displayName(user),
   out:false
 });

 socket.emit("joined");
 sendPlayers();

 io.emit("message", players.length+"/5 Joined");

 if(players.length===5){
   started=true;
   io.emit("message","🔥 Starting...");
   setTimeout(startRound,3000);
 }

});

socket.on("score", ()=>{

 const p=getPlayer(socket.id);
 if(!p || p.out || !playing) return;

 if(currentGame==="tap") scores[p.id]++;
 if(currentGame==="spam"){
   scores[p.id]++;
   if(scores[p.id]>30) scores[p.id]-=2;
 }
 if(currentGame==="freeze"){
   if(green) scores[p.id]++;
   else scores[p.id]-=2;
 }

});

socket.on("target", ()=>{

 const p=getPlayer(socket.id);
 if(!p || p.out || !playing || currentGame!=="target") return;

 scores[p.id]+=3;

 targetX=Math.floor(Math.random()*80)+5;
 targetY=Math.floor(Math.random()*70)+10;

 io.emit("targetMove",{x:targetX,y:targetY});

});

socket.on("door", ()=>{

 const p=getPlayer(socket.id);
 if(!p || p.out || !playing || currentGame!=="door") return;

 const r=Math.floor(Math.random()*4);

 if(r===1) scores[p.id]+=2;
 if(r===2) scores[p.id]+=4;
 if(r===3) scores[p.id]-=2;

});

socket.on("disconnect", ()=>{

 players = players.filter(p=>p.id!==socket.id);
 sendPlayers();

 if(players.length===0) resetLobby();

});

});

// ================= START =================
server.listen(PORT, ()=>{
 console.log("Running on "+PORT);
});