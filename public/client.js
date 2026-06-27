var PLAYER_COLORS = ['#ef4444','#10b981','#0ea5e9','#f59e0b','#8b5cf6','#14b8a6','#f97316','#64748b'];
function playerColor(i){return PLAYER_COLORS[i%PLAYER_COLORS.length]}
var Sound={ctx:null,enabled:true,_init:function(){if(!this.ctx){try{this.ctx=new(window.AudioContext||window.webkitAudioContext)()}catch(e){this.enabled=false}}if(this.ctx&&this.ctx.state==='suspended')this.ctx.resume()},_play:function(f,d,t,v){if(!this.enabled)return;this._init();if(!this.ctx)return;var o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=t||'sine';o.frequency.setValueAtTime(f,this.ctx.currentTime);g.gain.setValueAtTime(v||0.12,this.ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+d);o.connect(g);g.connect(this.ctx.destination);o.start();o.stop(this.ctx.currentTime+d)},bid:function(){this._play(880,0.08,'sine',0.08)},win:function(){var s=this;s._play(523,0.12);setTimeout(function(){s._play(659,0.12)},120);setTimeout(function(){s._play(784,0.25)},240)},bankrupt:function(){var s=this;s._play(400,0.2,'sawtooth',0.06);setTimeout(function(){s._play(300,0.25,'sawtooth',0.06)},200);setTimeout(function(){s._play(200,0.4,'sawtooth',0.06)},400)},gameover:function(){var s=this;[523,659,784,1047].forEach(function(f,i){setTimeout(function(){s._play(f,0.18,'sine',0.1)},i*140)})},toggle:function(){this.enabled=!this.enabled;var b=document.getElementById('sound-toggle');if(b)b.classList.toggle('muted');if(this.enabled)this._play(880,0.1)},reveal:function(){var s=this;[330,392,523,659].forEach(function(f,i){setTimeout(function(){s._play(f,0.15,'sine',0.12)},i*200)})}}
var wakeLockSentinel=null;
function requestWakeLock(){if('wakeLock'in navigator){navigator.wakeLock.request('screen').then(function(wl){wakeLockSentinel=wl;wl.addEventListener('release',function(){wakeLockSentinel=null})}).catch(function(){})}}
function releaseWakeLock(){if(wakeLockSentinel){wakeLockSentinel.release().then(function(){wakeLockSentinel=null}).catch(function(){})}}
function enterFullscreen(){var el=document.documentElement;if(el.requestFullscreen)el.requestFullscreen().catch(function(){});else if(el.webkitRequestFullscreen)el.webkitRequestFullscreen();else if(el.msRequestFullscreen)el.msRequestFullscreen()}
function exitFullscreen(){if(document.exitFullscreen)document.exitFullscreen().catch(function(){});else if(document.webkitExitFullscreen)document.webkitExitFullscreen();else if(document.msExitFullscreen)document.msExitFullscreen()}
function escapeHtml(u){return(u||'').toString().replace(/[&<>"']/g,function(m){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]})}
function rankBadge(r){return r===1?'🥇':r===2?'🥈':r===3?'🥉':''}
var socket=io(),myId=null,currentView='room',roomCode=null,joined=false,myName=null,currentPartyMode=false,revealTimerId=null,readyTimerId=null;
function setView(v){var els=document.querySelectorAll('.view');for(var i=0;i<els.length;i++)els[i].classList.remove('active');document.getElementById(v+'-view').classList.add('active');currentView=v}
function updateURL(room){window.history.replaceState({room:room},'',window.location.protocol+'//'+window.location.host+'?room='+room);roomCode=room;var d=document.getElementById('room-display');if(d)d.textContent='Room: '+room;var ld=document.getElementById('room-display-login');if(ld)ld.textContent=room;var cb=document.getElementById('copy-room-btn');if(cb)cb.style.display=''}
function copyRoomLink(){if(navigator.clipboard){navigator.clipboard.writeText(window.location.href).then(function(){var b=document.getElementById('copy-room-btn');if(b){b.textContent='Copied!';setTimeout(function(){if(b)b.textContent='🔗'},2000)}})}}
var RV='<div id="room-view" class="view active"><h2>Puerto Banana</h2><p style="color:var(--muted);margin-bottom:20px">Start a new game or join an existing one.</p><button onclick="createRoom()" style="min-width:200px">Create New Game</button><div style="margin:20px 0;color:var(--muted)">- or -</div><input type="text" id="room-code-input" placeholder="Enter Room Code" style="width:160px;text-transform:uppercase" maxlength="5"><br><button onclick="joinRoom()" style="min-width:200px">Join Game</button><p id="room-error" style="color:var(--danger);margin-top:12px;display:none"></p></div>';
var LV='<div id="login-view" class="view"><h2>Welcome to the Docks</h2><p>Enter your Captain name to join <strong id="room-display-login"></strong>.</p><input type="text" id="player-name" placeholder="Captain Banana" autocomplete="off"><br><button onclick="joinGame()">Join Game</button></div>';
var WV='<div id="waiting-view" class="view"><h2>Waiting for Crew...</h2><ul id="waiting-players" class="player-list"></ul><div class="bot-controls"><button onclick="addBot()" class="btn-small">+ Add Bot</button><button onclick="removeBot()" class="btn-small">- Remove Bot</button><button id="timer-toggle-btn" onclick="toggleTimer()" class="btn-small">Timer: Off</button><button id="party-toggle-btn" onclick="togglePartyMode()" class="btn-small btn-party">Party: Off</button></div><button id="start-btn" onclick="startGame()" disabled>Start Game</button><div id="name-change-area" style="text-align:center;margin-top:12px"><button onclick="showNameInput()" class="btn-small" style="font-size:0.8em">✏️ Change Name</button><div id="name-input-area" style="display:none;margin-top:8px"><input type="text" id="new-name-input" placeholder="New captain name" maxlength="20" style="width:180px;font-size:0.9em"><button onclick="submitNameChange()" class="btn-small" style="font-size:0.8em">Save</button></div></div><div id="party-info" class="party-info" style="display:none"><span class="party-icon">🎭</span> Party Mode: each phone reveals only your own bid. Hold it up!</div></div>';
var BV='<div id="bidding-view" class="view"><div class="auction-board"><h3>Round <span id="round-number"></span></h3><div class="amount"><span id="auction-amount"></span> 🍌</div><div class="auction-label">Bananas on Auction</div><div id="timer-display" style="display:none;margin-top:8px;font-size:0.8em;opacity:0.8">⏱ <span id="timer-seconds">30</span>s</div></div><div id="bidding-area"><p>Enter your secret bid:</p><input type="number" id="bid-input" min="0" placeholder="0"><br><button id="submit-bid-btn" onclick="submitBid()">Place Bid</button></div><p id="bidding-status"></p><ul id="bidding-players" class="player-list"></ul></div>';
var REV='<div id="reveal-view" class="view"><div id="reveal-stage-1" class="reveal-stage"><div class="reveal-lobby-title">🎭 All Bids In!</div><div class="reveal-lobby-name">Place your phone on the table...</div><div id="ready-countdown" class="ready-countdown">3</div></div><div id="reveal-stage-2" class="reveal-stage" style="display:none"><div class="reveal-lobby-title" style="font-size:1em">Your Bid</div><div class="reveal-lobby-name">Captain <span id="reveal-my-name"></span></div><div class="reveal-bid-area" id="reveal-bid-area"></div><div id="reveal-rankings" class="reveal-rankings"></div></div><div class="reveal-footer"><div class="reveal-round">Round <span id="reveal-round-num"></span> &middot; Auction: <strong><span id="reveal-auction-amount"></span></strong> 🍌</div><div id="reveal-countdown" class="reveal-countdown">Next round in 15...</div><button class="btn-small reveal-skip-btn" onclick="skipReveal()">Next →</button></div></div>';
var RSV='<div id="resolution-view" class="view"><h2>Auction Results</h2><div id="round-winner" class="round-winner"></div><div class="auction-board" style="padding:12px 20px;width:auto"><p style="margin:0">Auction was for: <strong><span id="res-auction-amount"></span></strong> 🍌</p></div><div id="resolution-details" class="resolution-list"></div><button id="next-round-btn" onclick="nextRound()" style="display:none">Next Round</button></div>';
var GOV='<div id="gameover-view" class="view"><h2>Game Over!</h2><div id="winner-announcement" class="winner-banner"></div><div id="final-scores" class="resolution-list"></div><button onclick="playAgain()">Play Again</button></div>';
var mainEl=document.getElementById('main-content');
mainEl.innerHTML=RV+LV+WV+BV+REV+RSV+GOV;

function createRoom(){socket.emit('create_room')}
function joinRoom(){var c=document.getElementById('room-code-input').value.trim().toUpperCase();if(c)socket.emit('join_room',c)}
function addBot(){socket.emit('add_bot')}
function removeBot(){socket.emit('remove_bot')}
function startGame(){socket.emit('start_game')}
function nextRound(){socket.emit('next_round')}
function playAgain(){socket.emit('play_again')}
function toggleTimer(){socket.emit('toggle_timer')}
function togglePartyMode(){socket.emit('toggle_party_mode')}
function showNameInput(){document.getElementById('name-input-area').style.display=''}function submitNameChange(){var n=document.getElementById('new-name-input').value.trim();if(n){myName=n;socket.emit('change_name',n);try{localStorage.setItem('pb_name',n)}catch(e){}}document.getElementById('name-input-area').style.display='none';document.getElementById('new-name-input').value=''}function skipReveal(){socket.emit('reveal_done')}
function joinGame(){myName=document.getElementById('player-name').value;if(myName){try{localStorage.setItem('pb_name',myName);localStorage.setItem('pb_room',roomCode)}catch(e){}socket.emit('join',myName)}}
function submitBid(){var bid=document.getElementById('bid-input').value;if(bid!==''){socket.emit('submit_bid',bid);document.getElementById('submit-bid-btn').disabled=true;document.getElementById('bidding-status').innerText='Bid locked in!';Sound.bid()}}

function animateBidIn(el){
    if(!el)return;
    el.style.transition='transform 2s cubic-bezier(0.34,1.56,0.64,1), opacity 1.5s ease-out';
    el.style.transform='scale(0.1)';
    el.style.opacity='0';
    void el.offsetHeight;
    setTimeout(function(){
        el.style.transform='scale(1)';
        el.style.opacity='1';
    },100);
}

socket.on('connect',function(){myId=socket.id;var sr=null,sn=null;try{sr=localStorage.getItem('pb_room');sn=localStorage.getItem('pb_name')}catch(e){}var ur=(window.location.search.match(/[?&]room=([A-Za-z0-9]+)/)||[])[1];if(ur){ur=ur.toUpperCase();socket.emit('join_room',ur);if(sn&&sr===ur)myName=sn}else if(sr&&sn){socket.emit('join_room',sr);myName=sn}})
socket.on('room_created',function(code){updateURL(code);setView('login')})
socket.on('room_joined',function(code){updateURL(code);setView('login');joined=true})
socket.on('error',function(msg){if(currentView==='room'){var e=document.getElementById('room-error');if(e){e.textContent=msg;e.style.display='block'}}else alert(msg)})
socket.on('timer',function(r){var td=document.getElementById('timer-display'),ts=document.getElementById('timer-seconds');if(td&&ts){td.style.display='';ts.textContent=r;if(r<=5)ts.style.color='#f43f5e';else ts.style.color=''}})

socket.on('state',function(state){
var me=null;
for(var i=0;i<state.players.length;i++){if(state.players[i].id===myId){me=state.players[i];break}}
var oldP=currentPartyMode;currentPartyMode=state.partyMode;
if(currentPartyMode&&!oldP){enterFullscreen();requestWakeLock()}else if(!currentPartyMode&&oldP){releaseWakeLock()}
if(!me&&myName&&roomCode&&joined){socket.emit('join',myName);return}
if(!joined&&roomCode&&currentView==='room')setView('login');
if(me&&currentView==='login')setView('waiting');
var rd=document.getElementById('room-display');
if(!rd&&roomCode){
var wrap=document.getElementById('room-display-wrap');
if(!wrap){
wrap=document.createElement('div');
wrap.id='room-display-wrap';
wrap.style.cssText='text-align:center;margin-top:-8px;margin-bottom:12px';
var hdr=document.querySelector('header');
if(hdr)hdr.parentNode.insertBefore(wrap,hdr.nextSibling);
}
var s=document.createElement('span');
s.id='room-display';
s.style.cssText='font-size:0.75em;color:var(--ocean);background:rgba(14,165,233,0.1);padding:4px 14px;border-radius:8px;letter-spacing:2px;font-weight:600';
s.textContent='Room: '+roomCode;
wrap.appendChild(s);
}
if(me){var se=document.getElementById('player-status');if(se)se.innerHTML='Captain '+escapeHtml(me.name)+' | Stock: <strong>'+me.stock+' 🍌</strong>'}

if(state.state==='waiting'&&currentView!=='login'&&currentView!=='room'){
setView('waiting');
var ttb=document.getElementById('timer-toggle-btn');if(ttb)ttb.textContent='Timer: '+(state.useTimer?'On':'Off');
var ptb=document.getElementById('party-toggle-btn');if(ptb){ptb.textContent='Party: '+(state.partyMode?'On':'Off');ptb.classList.toggle('active',state.partyMode)}
var pinfo=document.getElementById('party-info');if(pinfo)pinfo.style.display=state.partyMode?'block':'none';
var list=document.getElementById('waiting-players');var html='';
for(var i=0;i<state.players.length;i++){var p=state.players[i];var c=playerColor(i);var tag='';if(p.isBot)tag='<span class="bot-tag">Bot</span>';if(p.id===myId)tag+=' <em>(You)</em>';if(p.connected===false)tag+=' <em style="color:var(--muted)">(away)</em>';html+='<li class="player-card" style="border-left:4px solid '+c+';">'+'<div class="player-name" style="color:'+c+';">'+escapeHtml(p.name)+'</div><div>'+tag+'</div><div class="player-stock">Stock: '+p.stock+' 🍌</div></li>'}
list.innerHTML=html;document.getElementById('start-btn').disabled=state.players.length<2;
}

else if(state.state==='bidding'){
setView('bidding');document.getElementById('round-number').innerText=state.round;document.getElementById('auction-amount').innerText=state.auctionAmount;
var td=document.getElementById('timer-display');if(td)td.style.display=state.useTimer?'':'none';
var list=document.getElementById('bidding-players');var html='';
for(var i=0;i<state.players.length;i++){var p=state.players[i];var c=playerColor(i);var tag='';if(p.isBot)tag='<span class="bot-tag">Bot</span>';if(p.connected===false)tag+=' <em style="color:var(--muted)">(away)</em>';var status=p.hasBid?'Bid Placed':'Thinking...';var cls=p.hasBid?'ready':'';html+='<li class="player-card '+cls+'" style="border-left:4px solid '+c+';">'+'<div class="player-name" style="color:'+c+';">'+escapeHtml(p.name)+'</div><div>'+tag+'</div><div class="player-stock">'+status+' &middot; Stock: '+p.stock+' 🍌</div></li>'}
list.innerHTML=html;if(!me||!me.hasBid){document.getElementById('submit-bid-btn').disabled=false;document.getElementById('bidding-status').innerText=''}
}

else if(state.state==='reveal'){
setView('reveal');
if(readyTimerId)clearTimeout(readyTimerId);
document.getElementById('reveal-stage-1').style.display='';document.getElementById('reveal-stage-2').style.display='none';document.getElementById('reveal-bid-area').innerHTML='';var rkTmp=document.getElementById('reveal-rankings');if(rkTmp)rkTmp.innerHTML='';
var mp=null;for(var i=0;i<state.players.length;i++){if(state.players[i].id===myId){mp=state.players[i];break}}
var rc=3,re=document.getElementById('ready-countdown');if(re)re.textContent=rc;
var ci=setInterval(function(){rc--;if(re){if(rc>0)re.textContent=rc;else re.textContent='Go!'}if(rc<=0)clearInterval(ci)},700);
readyTimerId=setTimeout(function(){
readyTimerId=null;
document.getElementById('reveal-stage-1').style.display='none';document.getElementById('reveal-stage-2').style.display='';if(re)re.textContent='';
if(mp){
document.getElementById('reveal-my-name').innerText=mp.name;
var area=document.getElementById('reveal-bid-area');
// Create bid number element with inline style: starts tiny+invisible
area.innerHTML='<div class="reveal-bid-number" style="transform:scale(0.1);opacity:0">'+mp.bid+'</div><div class="reveal-bid-unit" style="font-size:min(10vw,12vh);color:var(--sun);text-align:center;line-height:1">🍌</div>';
// Animate bid number after a brief delay so element renders first
setTimeout(function(){
var el=area.querySelector('.reveal-bid-number');
if(!el)return;
el.style.transform='scale(0.1)';
el.style.opacity='0';
var start=performance.now();
var dur=2000;
function rafStep(now){
var t=Math.min((now-start)/dur,1);
var s=1-Math.pow(1-t,3);
el.style.transform='scale('+(0.1+0.9*s)+')';
el.style.opacity=Math.min(t*2,1);
if(t<1)requestAnimationFrame(rafStep);
}
requestAnimationFrame(rafStep);
},150);
}
Sound.reveal();
setTimeout(function(){
var rk=document.getElementById('reveal-rankings');
if(!rk||!state.reveal||!state.reveal.sorted)return;
var rd=state.reveal;
var first=rd.sorted[0];
var second=rd.sorted[1];
if(!first)return;
// Winner card
var wCard=document.createElement('div');
wCard.className='rk-card rk-first';
wCard.innerHTML='<div class="rk-rank" style="font-size:3em">🥇</div><div class="rk-name">'+escapeHtml(first.name)+(first.isBot?' <span class="bot-tag">Bot</span>':'')+'</div><div class="rk-result"><span class="rk-won">+'+state.auctionAmount+' 🍌</span></div>';
rk.appendChild(wCard);
// Show winner info on the bid area too if this player is 1st or 2nd
if(mp&&first&&mp.id===first.id){
var ba=document.getElementById('reveal-bid-area');
if(ba){
var winfo=document.createElement('div');
winfo.className='bid-winner-info';
winfo.style.cssText='text-align:center;margin-top:30px;animation:winnerInfoIn 0.8s cubic-bezier(0.34,1.56,0.64,1) both';
var bonusHtml='';
if(rd.bonus>0)bonusHtml='<div style="color:#ef4444;font-weight:900;font-size:min(10vw,12vh);margin-top:8px;line-height:1.1">-'+rd.bonus+' 🍌</div><div style="color:#ef4444;font-size:min(3vw,4vh);opacity:0.8">bonus paid</div>';
winfo.innerHTML='<div style="color:#10b981;font-weight:900;font-size:min(14vw,17vh);line-height:1.1">+'+state.auctionAmount+' 🍌</div>'+bonusHtml+'<div style="font-size:min(12vw,15vh);margin-top:12px;line-height:1">🥇</div>';
ba.appendChild(winfo);
}
}
if(mp&&second&&mp.id===second.id){
var ba2=document.getElementById('reveal-bid-area');
if(ba2){
var winfo2=document.createElement('div');
winfo2.className='bid-winner-info';
winfo2.style.cssText='text-align:center;margin-top:30px;animation:winnerInfoIn 0.8s cubic-bezier(0.34,1.56,0.64,1) both';
var bonusHtml2='';
if(rd.bonus>0)bonusHtml2='<div style="color:#10b981;font-weight:900;font-size:min(10vw,12vh);margin-top:8px;line-height:1.1">+'+rd.bonus+' 🍌</div><div style="color:#10b981;font-size:min(3vw,4vh);opacity:0.8">bonus received</div>';
winfo2.innerHTML=bonusHtml2+'<div style="font-size:min(12vw,15vh);margin-top:12px;line-height:1">🥈</div>';
ba2.appendChild(winfo2);
}
}
// Bonus info (if any) appears on winner card after delay
if(rd.bonus>0){
setTimeout(function(){
var bonusEl=document.createElement('div');
bonusEl.className='rk-bonus-anim';
bonusEl.innerHTML='<span class="rk-paid">-'+rd.bonus+' 🍌</span> bonus to 2nd';
wCard.appendChild(bonusEl);
},1800);
}
// Runner-up card appears after winner
if(second){
setTimeout(function(){
var sCard=document.createElement('div');
sCard.className='rk-card rk-second';
var bonusHtml='';
if(rd.bonus>0)bonusHtml='<div class="rk-bonus"><span class="rk-recvd">+'+rd.bonus+' 🍌</span> bonus from 1st</div>';
sCard.innerHTML='<div class="rk-rank">🥈</div><div class="rk-name">'+escapeHtml(second.name)+(second.isBot?' <span class="bot-tag">Bot</span>':'')+'</div>'+bonusHtml;
rk.appendChild(sCard);
},2800);
}
},3500);
},2800);
document.getElementById('reveal-round-num').innerText=state.round;document.getElementById('reveal-auction-amount').innerText=state.auctionAmount;
if(revealTimerId)clearInterval(revealTimerId);
var cnt=15,cd=document.getElementById('reveal-countdown');if(cd)cd.textContent='Next round in 15...';
revealTimerId=setInterval(function(){cnt--;if(cd)cd.textContent='Next round in '+cnt+'...';if(cnt<=0){clearInterval(revealTimerId);revealTimerId=null;if(cd)cd.textContent='Resolving...'}},1000);
}

else if(state.state==='resolution'){
if(revealTimerId){clearInterval(revealTimerId);revealTimerId=null}
setView('resolution');
document.getElementById('res-auction-amount').innerText=state.auctionAmount;
// Round winner announcement
var rw=document.getElementById('round-winner');if(rw){
var winners=[];for(var xi=0;xi<state.players.length;xi++){if(state.players[xi].winnings>0)winners.push(state.players[xi]);}
if(winners.length>0){
var wn='<div class="rw-inner"><div class="rw-trophy">🏆</div><div class="rw-label">Winner</div><div class="rw-name">'+winners.map(function(w){return escapeHtml(w.name)}).join(', ')+'</div><div class="rw-amount">+'+winners[0].winnings+' 🍌</div></div>';
rw.outerHTML='<div id="round-winner" class="round-winner">'+wn+'</div>';
}else{rw.innerHTML='';}
}
var hw=false,hb=false;for(var i=0;i<state.players.length;i++){if(state.players[i].winnings>0)hw=true;if(state.players[i].bankrupt)hb=true}
if(hb)Sound.bankrupt();else if(hw)Sound.win();
var sorted=state.players.slice().sort(function(a,b){return(b.bid||0)-(a.bid||0)});var bv=sorted.map(function(p){return p.bid});var html='';
for(var i=0;i<sorted.length;i++){var p=sorted[i],idx=state.players.indexOf(p),c=playerColor(idx),cls='resolution-row',dt='';var rk=i===0?1:(bv[i]===bv[i-1]?null:i+1);var badge=currentPartyMode&&rk?rankBadge(rk):'';
if(p.bankrupt){cls+=' bankrupt';dt=currentPartyMode?'Bid: <strong>'+p.bid+'</strong> 🍌<br><em style="color:#f43f5e">Bankrupt!</em>':'<em style="color:#f43f5e">Bankrupt!</em>'}
else{if(currentPartyMode){dt='Bid: <strong>'+p.bid+'</strong> 🍌';if(p.winnings>0)dt+='<br><span class="res-win">Won +'+p.winnings+' 🍌</span>';if(p.bonusPaid>0)dt+='<br><span class="res-bonus-paid">Paid -'+p.bonusPaid+' 🍌 bonus to 2nd</span>';if(p.bonusReceived>0)dt+='<br><span class="res-bonus-received">Received +'+p.bonusReceived+' 🍌 bonus from 1st</span>'}
else{if(p.winnings>0){cls+=' winner';dt='Won <strong>+'+p.winnings+'</strong> 🍌'}if(p.bonusPaid>0)dt+='<br>Paid <strong>-'+p.bonusPaid+'</strong> 🍌 bonus';if(p.bonusReceived>0)dt+='<br>Received <strong>+'+p.bonusReceived+'</strong> 🍌 bonus';if(!p.winnings&&!p.bonusPaid&&!p.bonusReceived)dt='Bid '+p.bid}dt+='<br>Stock: <strong>'+p.stock+'</strong> 🍌'}var tag=p.isBot?'<span class="bot-tag">Bot</span>':'';html+='<div class="'+cls+'" style="border-left-color:'+c+';">'+'<div class="res-player" style="color:'+c+';">'+badge+' '+escapeHtml(p.name)+' '+tag+'</div>'+'<div class="res-details">'+dt+'</div></div>'}
document.getElementById('resolution-details').innerHTML=html;
var nrBtn=document.getElementById('next-round-btn');if(nrBtn){var rc2=state.nextReady?state.nextReady.length:0;var hc2=state.players.filter(function(p){return!p.isBot&&p.connected!==false}).length;var iam=state.nextReady&&state.nextReady.indexOf(myId)!==-1;if(iam){nrBtn.disabled=true;nrBtn.textContent='Waiting for others... ('+rc2+'/'+hc2+')'}else{nrBtn.disabled=false;nrBtn.textContent='Next Round'}nrBtn.style.display='inline-block'}
}

else if(state.state==='gameover'){
if(revealTimerId){clearInterval(revealTimerId);revealTimerId=null}
if(currentPartyMode)releaseWakeLock();
setView('gameover');Sound.gameover();
var ms=0;for(var i=0;i<state.players.length;i++)if(state.players[i].stock>ms)ms=state.players[i].stock;
var winners=[];for(var i=0;i<state.players.length;i++)if(state.players[i].stock===ms)winners.push(state.players[i]);
var govH2=document.querySelector('#gameover-view h2');if(govH2){govH2.outerHTML='<h2>Game Over!</h2>'}
var wa=document.getElementById('winner-announcement');
var wh='<div class="winner-trophy">🏆</div><div class="winner-text">'+winners.map(function(w){return escapeHtml(w.name)}).join(', ')+'</div><div class="winner-score">'+ms+' 🍌</div>';
wa.outerHTML='<div id="winner-announcement" class="winner-banner">'+wh+'</div>';
var sorted=state.players.slice().sort(function(a,b){return b.stock-a.stock});var html='';
for(var i=0;i<sorted.length;i++){var p=sorted[i],idx=state.players.indexOf(p),c=playerColor(idx);var iw=false;for(var j=0;j<winners.length;j++)if(winners[j].id===p.id){iw=true;break}var cls=iw?'resolution-row winner':'resolution-row';var tag=p.isBot?'<span class="bot-tag">Bot</span>':'';var det='<strong>'+p.stock+'</strong> 🍌';if(currentPartyMode)det='Bid: '+(p.bid!==null?p.bid:'-')+' 🍌 &middot; '+det;html+='<div class="'+cls+'" style="border-left-color:'+c+';">'+'<div class="res-player" style="color:'+c+';">'+(iw?'🏆 ':'')+escapeHtml(p.name)+' '+tag+'</div>'+'<div class="res-details">'+det+'</div></div>'}
document.getElementById('final-scores').innerHTML=html;
var paBtn=document.querySelector('#gameover-view button');if(paBtn){var rc3=state.nextReady?state.nextReady.length:0;var hc3=state.players.filter(function(p){return!p.isBot&&p.connected!==false}).length;var iam2=state.nextReady&&state.nextReady.indexOf(myId)!==-1;if(iam2){paBtn.disabled=true;paBtn.textContent='Waiting for others... ('+rc3+'/'+hc3+')'}else{paBtn.disabled=false;paBtn.textContent='Play Again'}}
}
});
