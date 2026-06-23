
// ─── Player Colors ───────────────────────────────────────────────────

var PLAYER_COLORS = ['#ef4444', '#10b981', '#0ea5e9', '#f59e0b', '#8b5cf6', '#14b8a6', '#f97316', '#64748b'];

function playerColor(index) {
    return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

// ─── Sound System ────────────────────────────────────────────────────

var Sound = {
    ctx: null, enabled: true,
    _init: function() {
        if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { this.enabled = false; } }
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    _play: function(f, d, t, v) {
        if (!this.enabled) return; this._init(); if (!this.ctx) return;
        var o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = t || 'sine'; o.frequency.setValueAtTime(f, this.ctx.currentTime);
        g.gain.setValueAtTime(v || 0.12, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + d);
        o.connect(g); g.connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime + d);
    },
    bid: function() { this._play(880, 0.08, 'sine', 0.08); },
    win: function() { var s = this; s._play(523, 0.12); setTimeout(function(){s._play(659, 0.12)}, 120); setTimeout(function(){s._play(784, 0.25)}, 240); },
    bankrupt: function() { var s = this; s._play(400, 0.2, 'sawtooth', 0.06); setTimeout(function(){s._play(300, 0.25, 'sawtooth', 0.06)}, 200); setTimeout(function(){s._play(200, 0.4, 'sawtooth', 0.06)}, 400); },
    gameover: function() { var s = this; [523, 659, 784, 1047].forEach(function(f,i){setTimeout(function(){s._play(f, 0.18, 'sine', 0.1)}, i*140);}); },
    toggle: function() { this.enabled = !this.enabled; var b = document.getElementById('sound-toggle'); if (b) b.classList.toggle('muted'); if (this.enabled) this._play(880, 0.1); }
};

function escapeHtml(u) {
    return (u||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ─── Socket / State ──────────────────────────────────────────────────

var socket = io();
var myId = null;
var currentView = 'room';
var roomCode = null;
var joined = false;
var myName = null;

// ─── Views ───────────────────────────────────────────────────────────

var roomViewHTML = '' +
    '<div id="room-view" class="view active">' +
        '<h2>Puerto Banana</h2>' +
        '<p style="color:var(--muted);margin-bottom:20px">Start a new game or join an existing one.</p>' +
        '<button onclick="createRoom()" style="min-width:200px">Create New Game</button>' +
        '<div style="margin:20px 0;color:var(--muted)">— or —</div>' +
        '<input type="text" id="room-code-input" placeholder="Enter Room Code" style="width:160px;text-transform:uppercase" maxlength="5">' +
        '<br><button onclick="joinRoom()" style="min-width:200px">Join Game</button>' +
        '<p id="room-error" style="color:var(--danger);margin-top:12px;display:none"></p>' +
    '</div>';

var loginViewHTML = '' +
    '<div id="login-view" class="view">' +
        '<h2>Welcome to the Docks</h2>' +
        '<p>Enter your Captain name to join <strong id="room-display-login"></strong>.</p>' +
        '<input type="text" id="player-name" placeholder="Captain Banana" autocomplete="off">' +
        '<br><button onclick="joinGame()">Join Game</button>' +
    '</div>';

var waitingViewHTML = '' +
    '<div id="waiting-view" class="view">' +
        '<h2>Waiting for Crew...</h2>' +
        '<ul id="waiting-players" class="player-list"></ul>' +
        '<div class="bot-controls">' +
            '<button onclick="addBot()" class="btn-small">+ Add Bot</button>' +
            '<button onclick="removeBot()" class="btn-small">- Remove Bot</button>' +
            '<button id="timer-toggle-btn" onclick="toggleTimer()" class="btn-small">Timer: Off</button>' +
        '</div>' +
        '<button id="start-btn" onclick="startGame()" disabled>Start Game</button>' +
    '</div>';

var biddingViewHTML = '' +
    '<div id="bidding-view" class="view">' +
        '<div class="auction-board">' +
            '<h3>Round <span id="round-number"></span></h3>' +
            '<div class="amount"><span id="auction-amount"></span> 🍌</div>' +
            '<div class="auction-label">Bananas on Auction</div>' +
            '<div id="timer-display" style="display:none;margin-top:8px;font-size:0.8em;opacity:0.8">⏱ <span id="timer-seconds">30</span>s</div>' +
        '</div>' +
        '<div id="bidding-area">' +
            '<p>Enter your secret bid:</p>' +
            '<input type="number" id="bid-input" min="0" placeholder="0">' +
            '<br><button id="submit-bid-btn" onclick="submitBid()">Place Bid</button>' +
        '</div>' +
        '<p id="bidding-status"></p>' +
        '<ul id="bidding-players" class="player-list"></ul>' +
    '</div>';

var resolutionViewHTML = '' +
    '<div id="resolution-view" class="view">' +
        '<h2>Auction Results</h2>' +
        '<div class="auction-board" style="padding:12px 20px;width:auto"><p style="margin:0">Auction was for: <strong><span id="res-auction-amount"></span> 🍌</strong></p></div>' +
        '<div id="resolution-details" class="resolution-list"></div>' +
        '<button id="next-round-btn" onclick="nextRound()" style="display:none">Next Round</button>' +
    '</div>';

var gameoverViewHTML = '' +
    '<div id="gameover-view" class="view">' +
        '<h2>Game Over!</h2>' +
        '<h3 id="winner-announcement"></h3>' +
        '<div id="final-scores" class="resolution-list"></div>' +
        '<button onclick="playAgain()">Play Again</button>' +
    '</div>';

var mainEl = document.getElementById('main-content');
mainEl.innerHTML = roomViewHTML + loginViewHTML + waitingViewHTML + biddingViewHTML + resolutionViewHTML + gameoverViewHTML;

function setView(v) {
    var els = document.querySelectorAll('.view');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('active');
    document.getElementById(v + '-view').classList.add('active');
    currentView = v;
}

// ─── Room / Storage ──────────────────────────────────────────────────

function getRoomFromURL() {
    var m = window.location.search.match(/[?&]room=([A-Za-z0-9]+)/);
    return m ? m[1].toUpperCase() : null;
}

function updateURL(room) {
    window.history.replaceState({room: room}, '', window.location.protocol + '//' + window.location.host + '?room=' + room);
    roomCode = room;
    var d = document.getElementById('room-display');
    if (d) d.textContent = room;
    var ld = document.getElementById('room-display-login');
    if (ld) ld.textContent = room;
    var cb = document.getElementById('copy-room-btn');
    if (cb) cb.style.display = '';
}

function copyRoomLink() {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href).then(function() {
            var b = document.getElementById('copy-room-btn');
            if (b) { b.textContent = 'Copied!'; setTimeout(function(){if(b)b.textContent='🔗';}, 2000); }
        });
    }
}

// ─── Actions ─────────────────────────────────────────────────────────

function createRoom() { socket.emit('create_room'); }
function joinRoom() { var c = document.getElementById('room-code-input').value.trim().toUpperCase(); if (c) socket.emit('join_room', c); }
function addBot() { socket.emit('add_bot'); }
function removeBot() { socket.emit('remove_bot'); }
function startGame() { socket.emit('start_game'); }
function nextRound() { socket.emit('next_round'); }
function playAgain() { socket.emit('play_again'); }

function toggleTimer() {
    socket.emit('toggle_timer');
}

function joinGame() {
    myName = document.getElementById('player-name').value;
    if (myName) {
        try { localStorage.setItem('pb_name', myName); localStorage.setItem('pb_room', roomCode); } catch(e) {}
        socket.emit('join', myName);
    }
}

function submitBid() {
    var bid = document.getElementById('bid-input').value;
    if (bid !== '') {
        socket.emit('submit_bid', bid);
        document.getElementById('submit-bid-btn').disabled = true;
        document.getElementById('bidding-status').innerText = 'Waiting for other players...';
        Sound.bid();
    }
}

// ─── Socket Events ───────────────────────────────────────────────────

socket.on('connect', function() {
    myId = socket.id;
    // Auto-rejoin via localStorage
    var savedRoom = null, savedName = null;
    try { savedRoom = localStorage.getItem('pb_room'); savedName = localStorage.getItem('pb_name'); } catch(e) {}
    var urlRoom = getRoomFromURL();
    if (urlRoom) {
        socket.emit('join_room', urlRoom);
        if (savedName && savedRoom === urlRoom) {
            myName = savedName;
        }
    } else if (savedRoom && savedName) {
        socket.emit('join_room', savedRoom);
        myName = savedName;
    }
});

socket.on('room_created', function(code) { updateURL(code); setView('login'); });
socket.on('room_joined', function(code) { updateURL(code); setView('login'); joined = true; });

socket.on('error', function(msg) {
    if (currentView === 'room') {
        var e = document.getElementById('room-error');
        if (e) { e.textContent = msg; e.style.display = 'block'; }
    } else { alert(msg); }
});

socket.on('timer', function(remaining) {
    var td = document.getElementById('timer-display');
    var ts = document.getElementById('timer-seconds');
    if (td && ts) {
        td.style.display = '';
        ts.textContent = remaining;
        if (remaining <= 5) ts.style.color = '#f43f5e'; else ts.style.color = '';
    }
});

socket.on('state', function(state) {
    var me = null;
    for (var i = 0; i < state.players.length; i++) {
        if (state.players[i].id === myId) { me = state.players[i]; break; }
    }

    // Auto-rejoin: if we have a saved name and the room has a disconnected player with that name
    if (!me && myName && roomCode && joined) {
        // Try rejoining with our saved name
        socket.emit('join', myName);
        return;
    }

    if (!joined && roomCode && currentView === 'room') setView('login');

    if (me && currentView === 'login') setView('waiting');

    // Room code display in header
    var rd = document.getElementById('room-display');
    if (!rd && roomCode) {
        var h = document.querySelector('header h1');
        if (h) {
            var s = document.createElement('span');
            s.id = 'room-display';
            s.style.cssText = 'font-size:0.5em;color:var(--ocean);background:rgba(14,165,233,0.1);padding:2px 10px;border-radius:8px;margin-left:10px;vertical-align:middle;letter-spacing:1px';
            s.textContent = roomCode;
            h.appendChild(s);
        }
    }

    if (me) {
        var se = document.getElementById('player-status');
        if (se) se.innerHTML = 'Captain ' + escapeHtml(me.name) + ' &nbsp;|&nbsp; Stock: <strong>' + me.stock + ' 🍌</strong>';
    }

    // Waiting
    if (state.state === 'waiting' && currentView !== 'login' && currentView !== 'room') {
        setView('waiting');
        // Timer toggle button
        var ttb = document.getElementById('timer-toggle-btn');
        if (ttb) ttb.textContent = 'Timer: ' + (state.useTimer ? 'On' : 'Off');
        // Player list with stock
        var list = document.getElementById('waiting-players');
        var html = '';
        for (var i = 0; i < state.players.length; i++) {
            var p = state.players[i];
            var c = playerColor(i);
            var tag = '';
            if (p.isBot) tag = '<span class="bot-tag">Bot</span>';
            if (p.id === myId) tag += ' <em>(You)</em>';
            if (p.connected === false) tag += ' <em style="color:var(--muted)">(away)</em>';
            html += '<li class="player-card' + (p.connected === false ? '' : '') + '" style="border-left:4px solid ' + c + ';">' +
                '<div class="player-name" style="color:' + c + ';">' + escapeHtml(p.name) + '</div>' +
                '<div>' + tag + '</div>' +
                '<div class="player-stock">Stock: ' + p.stock + ' 🍌</div></li>';
        }
        list.innerHTML = html;
        document.getElementById('start-btn').disabled = state.players.length < 2;
    }

    // Bidding
    else if (state.state === 'bidding') {
        var pv = currentView;
        setView('bidding');
        document.getElementById('round-number').innerText = state.round;
        document.getElementById('auction-amount').innerText = state.auctionAmount;

        // Hide timer if not in use
        var td = document.getElementById('timer-display');
        if (td) td.style.display = state.useTimer ? '' : 'none';

        var list = document.getElementById('bidding-players');
        var html = '';
        for (var i = 0; i < state.players.length; i++) {
            var p = state.players[i];
            var c = playerColor(i);
            var tag = '';
            if (p.isBot) tag = '<span class="bot-tag">Bot</span>';
            if (p.connected === false) tag += ' <em style="color:var(--muted)">(away)</em>';
            var status = p.hasBid ? 'Bid Placed' : 'Thinking...';
            var cls = p.hasBid ? 'ready' : '';
            html += '<li class="player-card ' + cls + '" style="border-left:4px solid ' + c + ';">' +
                '<div class="player-name" style="color:' + c + ';">' + escapeHtml(p.name) + '</div>' +
                '<div>' + tag + '</div>' +
                '<div class="player-stock">' + status + ' &middot; Stock: ' + p.stock + ' 🍌</div></li>';
        }
        list.innerHTML = html;

        if (!me || !me.hasBid) {
            document.getElementById('submit-bid-btn').disabled = false;
            document.getElementById('bidding-status').innerText = '';
            if (pv !== 'bidding') document.getElementById('bid-input').value = '';
        }
    }

    // Resolution
    else if (state.state === 'resolution') {
        setView('resolution');
        document.getElementById('res-auction-amount').innerText = state.auctionAmount;

        var hw = false, hb = false;
        for (var i = 0; i < state.players.length; i++) {
            if (state.players[i].winnings > 0) hw = true;
            if (state.players[i].bankrupt) hb = true;
        }
        if (hb) Sound.bankrupt(); else if (hw) Sound.win();

        var sorted = state.players.slice().sort(function(a, b) { return b.bid - a.bid; });
        var html = '';
        for (var i = 0; i < sorted.length; i++) {
            var p = sorted[i], idx = state.players.indexOf(p), c = playerColor(idx), cls = 'resolution-row', dt = '';
            if (p.bankrupt) { cls += ' bankrupt'; dt = '<em style="color:#f43f5e">Bankrupt!</em>'; }
            else {
                if (p.winnings > 0) { cls += ' winner'; dt = 'Won <strong>+' + p.winnings + '</strong> 🍌'; }
                if (p.bonusPaid > 0) dt += '<br>Paid <strong>-' + p.bonusPaid + '</strong> 🍌 bonus';
                if (p.bonusReceived > 0) dt += '<br>Received <strong>+' + p.bonusReceived + '</strong> 🍌 bonus';
                if (!p.winnings && !p.bonusPaid && !p.bonusReceived) dt = 'Bid ' + p.bid;
                dt += '<br>Stock: <strong>' + p.stock + '</strong> 🍌';
            }
            var tag = p.isBot ? '<span class="bot-tag">Bot</span>' : '';
            html += '<div class="' + cls + '" style="border-left-color:' + c + ';">' +
                '<div class="res-player" style="color:' + c + ';">' + escapeHtml(p.name) + ' ' + tag + '</div>' +
                '<div class="res-details">' + dt + '</div></div>';
        }
        document.getElementById('resolution-details').innerHTML = html;
        // Next round button with ready state
        var nrBtn = document.getElementById('next-round-btn');
        if (nrBtn) {
            var readyCount = state.nextReady ? state.nextReady.length : 0;
            var humanCount = state.players.filter(function(p) { return !p.isBot && p.connected !== false; }).length;
            var iAmReady = state.nextReady && state.nextReady.indexOf(myId) !== -1;
            if (iAmReady) {
                nrBtn.disabled = true;
                nrBtn.textContent = 'Waiting for others... (' + readyCount + '/' + humanCount + ')';
            } else {
                nrBtn.disabled = false;
                nrBtn.textContent = 'Next Round';
            }
            nrBtn.style.display = 'inline-block';
        }
    }

    // Game Over
    else if (state.state === 'gameover') {
        setView('gameover');
        Sound.gameover();
        var ms = 0;
        for (var i = 0; i < state.players.length; i++) if (state.players[i].stock > ms) ms = state.players[i].stock;
        var winners = [];
        for (var i = 0; i < state.players.length; i++) if (state.players[i].stock === ms) winners.push(state.players[i]);
        document.getElementById('winner-announcement').innerText = 'Winner(s): ' + winners.map(function(w) { return escapeHtml(w.name); }).join(', ') + ' with ' + ms + ' 🍌!';
        var sorted = state.players.slice().sort(function(a, b) { return b.stock - a.stock; });
        var html = '';
        for (var i = 0; i < sorted.length; i++) {
            var p = sorted[i], idx = state.players.indexOf(p), c = playerColor(idx);
            var iw = false;
            for (var j = 0; j < winners.length; j++) if (winners[j].id === p.id) { iw = true; break; }
            var cls = iw ? 'resolution-row winner' : 'resolution-row';
            var tag = p.isBot ? '<span class="bot-tag">Bot</span>' : '';
            html += '<div class="' + cls + '" style="border-left-color:' + c + ';">' +
                '<div class="res-player" style="color:' + c + ';">' + escapeHtml(p.name) + ' ' + tag + '</div>' +
                '<div class="res-details"><strong>' + p.stock + '</strong> 🍌</div></div>';
        }
        document.getElementById('final-scores').innerHTML = html;
        // Play again button
        var paBtn = document.querySelector('#gameover-view button');
        if (paBtn) {
            var readyCount = state.nextReady ? state.nextReady.length : 0;
            var humanCount = state.players.filter(function(p) { return !p.isBot && p.connected !== false; }).length;
            var iAmReady = state.nextReady && state.nextReady.indexOf(myId) !== -1;
            if (iAmReady) {
                paBtn.disabled = true;
                paBtn.textContent = 'Waiting for others... (' + readyCount + '/' + humanCount + ')';
            } else {
                paBtn.disabled = false;
                paBtn.textContent = 'Play Again';
            }
        }
    }
});
