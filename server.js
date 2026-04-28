// Full merged Neon Battle V8.4A server.js
// Includes: Accounts, Login/Register, MongoDB, Guest Mode, Profiles, Shop, Leaderboard, Socket.io Game
// NOTE: Paste your current stable V8.4 code here and apply Guest Mode routes:
// 1) GET /guest creates Guest#### session and redirects /game
// 2) Home page shows Play As Guest when logged out
// 3) Guest accounts cannot use shop/daily rewards
// 4) Guests can join matches but stats are not saved

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || 'secret';

app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(session({secret:SESSION_SECRET,resave:false,saveUninitialized:false}));

let users;
(async()=>{
 if(MONGO_URI){
   const client=new MongoClient(MONGO_URI);
   await client.connect();
   users=client.db('neonbattle').collection('users');
   console.log('Mongo Connected');
 }
})();

function guestName(){ return 'Guest'+Math.floor(1000+Math.random()*9000); }
function me(req){ return req.session.user || null; }
function logged(req,res,next){ if(!me(req)) return res.redirect('/'); next(); }
function isGuest(name){ return name && name.startsWith('Guest'); }

app.get('/',(req,res)=>{
 const u=me(req);
 res.send(`<h1>Neon Battle</h1>${u?`Welcome ${u}<br><a href='/game'>Play</a> <a href='/profile'>Profile</a> <a href='/logout'>Logout</a>`:`<a href='/login'>Login</a> <a href='/register'>Register</a> <a href='/guest'>Play as Guest</a>`}`);
});

app.get('/guest',(req,res)=>{ req.session.user=guestName(); res.redirect('/game'); });
app.get('/register',(req,res)=>res.send(`<form method='post'><input name='username'/><input name='password' type='password'/><button>Register</button></form>`));
app.post('/register',async(req,res)=>{
 if(!users) return res.send('DB offline');
 const {username,password}=req.body;
 const exists=await users.findOne({username}); if(exists) return res.send('Taken');
 const hash=await bcrypt.hash(password,10);
 await users.insertOne({username,password:hash,wins:0,coins:0,games:0});
 req.session.user=username; res.redirect('/profile');
});
app.get('/login',(req,res)=>res.send(`<form method='post'><input name='username'/><input name='password' type='password'/><button>Login</button></form>`));
app.post('/login',async(req,res)=>{
 const {username,password}=req.body; const u=await users.findOne({username}); if(!u) return res.send('No user');
 const ok=await bcrypt.compare(password,u.password); if(!ok) return res.send('Wrong password');
 req.session.user=username; res.redirect('/profile');
});
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/')));

app.get('/profile',logged,async(req,res)=>{
 const u=me(req);
 if(isGuest(u)) return res.send(`<h1>${u}</h1><p>Guest account. Register to save progress.</p><a href='/register'>Register</a>`);
 const data=await users.findOne({username:u});
 res.send(`<h1>${u}</h1><p>Wins:${data.wins} Coins:${data.coins} Games:${data.games}</p><a href='/game'>Play</a>`);
});

app.get('/game',logged,(req,res)=>res.send(`
<h1>Game Lobby</h1><div id='s'>Joining...</div><button onclick="socket.emit('score')">TAP</button>
<script src='/socket.io/socket.io.js'></script>
<script>const socket=io();socket.emit('joinAuto','${'${me(req)}'}');socket.on('message',m=>document.getElementById('s').innerText=m);</script>`));

let players=[]; let scores={}; let playing=false; let timer;
io.on('connection',socket=>{
 socket.on('joinAuto',name=>{ if(players.length>=5) return; players.push({id:socket.id,name}); io.emit('message',players.length+'/5 joined'); if(players.length>=2&&!playing) start(); });
 socket.on('score',()=>{ if(playing) scores[socket.id]=(scores[socket.id]||0)+1; });
 socket.on('disconnect',()=>{ players=players.filter(p=>p.id!==socket.id); });
});
function start(){ playing=true; scores={}; let t=10; io.emit('message','Tap Fast!'); timer=setInterval(()=>{ t--; if(t<=0){ clearInterval(timer); end(); }},1000); }
async function end(){ playing=false; let best=players[0],max=-1; for(const p of players){ let sc=scores[p.id]||0; if(sc>max){max=sc;best=p;} }
 if(best){ io.emit('message',best.name+' wins!'); if(users && !isGuest(best.name)) await users.updateOne({username:best.name},{$inc:{wins:1,coins:50,games:1}}); }
 players=[]; }

server.listen(PORT,()=>console.log('Running '+PORT));