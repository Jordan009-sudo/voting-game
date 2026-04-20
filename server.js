const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

let rooms = {};
function createRoom(id){rooms[id]={players:[],state:'lobby',round:1,scores:{},timer:15};}
function alivePlayers(room){return room.players.filter(p=>!p.evicted)}
function startRound(room){room.state='playing'; room.scores={}; room.timer=15; io.to(room.id).emit('roundStart', {round:room.round,timer:room.timer}); let int=setInterval(()=>{room.timer--; io.to(room.id).emit('tick',room.timer); if(room.timer<=0){clearInterval(int); endRound(room);}},1000);}
function endRound(room){alivePlayers(room).forEach(p=>{if(room.scores[p.id]==null) room.scores[p.id]=0;}); let arr=alivePlayers(room).map(p=>({id:p.id,name:p.name,score:room.scores[p.id]||0})); arr.sort((a,b)=>a.score-b.score); let loser=arr[0]; let lp=room.players.find(p=>p.id===loser.id); lp.evicted=true; io.to(room.id).emit('roundEnd',{scores:arr,evicted:loser.name}); let alive=alivePlayers(room); if(alive.length===1){io.to(room.id).emit('winner',alive[0].name); room.state='ended';} else {room.round++; setTimeout(()=>startRound(room),5000);} }

app.get('/',(req,res)=>res.send(`<!DOCTYPE html><html><head><title>Battle Game</title><script src='/socket.io/socket.io.js'></script><style>body{font-family:Arial;background:#111;color:#fff;text-align:center}button,input{padding:10px;margin:5px}#tap{font-size:28px;padding:20px 40px}</style></head><body><h1>Minigame Battle</h1><div id='join'><input id='name' placeholder='Name'><input id='room' placeholder='Room' value='main'><button onclick='join()'>Join</button></div><div id='game' style='display:none'><h2 id='status'></h2><h3 id='timer'></h3><button id='tap' onclick='tap()' style='display:none'>TAP FAST!</button><pre id='log'></pre></div><script>const socket=io(); let joined=false; function join(){socket.emit('join',{name:name.value||'Player',room:room.value||'main'});} function tap(){socket.emit('tap');}
 socket.on('joined',d=>{join.style.display='none';game.style.display='block';status.innerText='Waiting for 5 players...';}); socket.on('players',list=>{log.innerText='Players:\n'+list.map(p=>p.name+(p.evicted?' (OUT)':'')).join('\n');}); socket.on('roundStart',d=>{status.innerText='Round '+d.round+' - Tap as much as you can!'; tap.style.display='inline-block';}); socket.on('tick',t=>timer.innerText='Time: '+t); socket.on('roundEnd',d=>{tap.style.display='none'; status.innerText=d.evicted+' was evicted!'; log.innerText+='\nScores:\n'+d.scores.map(s=>s.name+': '+s.score).join('\n');}); socket.on('winner',n=>{status.innerText=n+' wins the game!'; tap.style.display='none';});</script></body></html>`));

io.on('connection',socket=>{
 socket.on('join',({name,room})=>{ if(!rooms[room]) createRoom(room); let r=rooms[room]; r.id=room; if(r.players.length>=5) return socket.emit('full'); socket.join(room); socket.data.room=room; r.players.push({id:socket.id,name,evicted:false}); socket.emit('joined'); io.to(room).emit('players',r.players); if(r.players.length===5 && r.state==='lobby') startRound(r); });
 socket.on('tap',()=>{let room=rooms[socket.data.room]; if(!room||room.state!=='playing') return; room.scores[socket.id]=(room.scores[socket.id]||0)+1;});
 socket.on('disconnect',()=>{let room=rooms[socket.data.room]; if(!room) return; room.players=room.players.filter(p=>p.id!==socket.id); io.to(socket.data.room).emit('players',room.players);});
});
server.listen(PORT,()=>console.log('Running '+PORT));
