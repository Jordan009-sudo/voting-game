const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

let room = { players: [], state: 'lobby', scores: {}, round: 1, timer: 10 };

function alive(){ return room.players.filter(p => !p.out); }
function resetIfEmpty(){ if(room.players.length===0) room={players:[],state:'lobby',scores:{},round:1,timer:10}; }

function startRound(){
  room.state='playing'; room.scores={}; room.timer=10;
  io.emit('roundStart',{round:room.round,timer:room.timer});
  const int = setInterval(()=>{
    room.timer--; io.emit('tick',room.timer);
    if(room.timer<=0){ clearInterval(int); endRound(); }
  },1000);
}

function endRound(){
  alive().forEach(p=>{ if(room.scores[p.id]==null) room.scores[p.id]=0; });
  const scores = alive().map(p=>({name:p.name,id:p.id,score:room.scores[p.id]})).sort((a,b)=>a.score-b.score);
  const loser = scores[0];
  room.players.find(p=>p.id===loser.id).out=true;
  io.emit('roundEnd',{scores,evicted:loser.name});
  if(alive().length===1){ io.emit('winner',alive()[0].name); room.state='ended'; }
  else { room.round++; setTimeout(startRound,4000); }
}
app.get('/',(req,res)=>{
res.send(`<!DOCTYPE html><html><head><title>Battle</title><meta name='viewport' content='width=device-width,initial-scale=1'><script src='/socket.io/socket.io.js'></script><style>body{font-family:Arial;background:#111;color:#fff;text-align:center;padding:20px}input,button{padding:12px;margin:5px;font-size:16px}#tap{font-size:28px;padding:25px 40px}#box{max-width:500px;margin:auto}</style></head><body><div id='box'><h1>Minigame Battle</h1><div id='joinBox'><input id='name' placeholder='Your Name'><button onclick='joinGame()'>Join Game</button></div><h2 id='status'>Waiting...</h2><h3 id='timer'></h3><button id='tap' style='display:none' onclick='tapNow()'>TAP FAST</button><pre id='players'></pre></div><script>const socket=io();function joinGame(){socket.emit('join',document.getElementById('name').value||'Player');}function tapNow(){socket.emit('tap');}socket.on('joined',()=>{document.getElementById('joinBox').style.display='none';});socket.on('players',p=>{document.getElementById('players').textContent='Players:\n'+p.map(x=>x.name+(x.out?' (OUT)':'')).join('\n');});socket.on('message',m=>document.getElementById('status').textContent=m);socket.on('roundStart',d=>{document.getElementById('status').textContent='Round '+d.round;document.getElementById('tap').style.display='inline-block';});socket.on('tick',t=>document.getElementById('timer').textContent='Time: '+t);socket.on('roundEnd',d=>{document.getElementById('tap').style.display='none';document.getElementById('status').textContent=d.evicted+' eliminated';});socket.on('winner',n=>{document.getElementById('status').textContent=n+' WINS!';document.getElementById('tap').style.display='none';});</script></body></html>`);
});

io.on('connection',socket=>{
  socket.on('join',name=>{
    if(room.players.length>=5) return socket.emit('message','Game Full');
    if(room.players.find(p=>p.id===socket.id)) return;
    room.players.push({id:socket.id,name,out:false});
    socket.emit('joined');
    io.emit('players',room.players);
    io.emit('message', room.players.length+'/5 Players Joined');
    if(room.players.length===5 && room.state==='lobby') startRound();
  });
  socket.on('tap',()=>{ if(room.state==='playing') room.scores[socket.id]=(room.scores[socket.id]||0)+1; });
  socket.on('disconnect',()=>{ room.players=room.players.filter(p=>p.id!==socket.id); io.emit('players',room.players); resetIfEmpty(); });
});

server.listen(PORT,()=>console.log('Running on '+PORT));