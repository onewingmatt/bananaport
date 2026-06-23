
// ─── Player Colors ───────────────────────────────────────────────────

var PLAYER_COLORS = ['#ef4444', '#10b981', '#0ea5e9', '#f59e0b', '#8b5cf6', '#14b8a6', '#f97316', '#64748b'];

function playerColor(index) {
    return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

// ─── Sound System ────────────────────────────────────────────────────

var Sound = {
    ctx: null,
    enabled: true,
    _init: function() {
        if (!this.ctx) {
            try {
                this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            } catch(e) {
                this.enabled = false;
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    _play: function(freq, duration, type, vol) {
        if (!this.enabled) return;
        this._init();
        if (!this.ctx) return;
        var osc = this.ctx.createOscillator();
        var gain = this.ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol || 0.12, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    },
    bid: function() { this._play(880, 0.08, 'sine', 0.08); },
    win: function() {
        var self = this;
        self._play(523, 0.12, 'sine', 0.1);
        setTimeout(function() { self._play(659, 0.12, 'sine', 0.1); }, 120);
        setTimeout(function() { self._play(784, 0.25, 'sine', 0.1); }, 240);
    },
    bankrupt: function() {
        var self = this;
        self._play(400, 0.2, 'sawtooth', 0.06);
        setTimeout(function() { self._play(300, 0.25, 'sawtooth', 0.06); }, 200);
        setTimeout(function() { self._play(200, 0.4, 'sawtooth', 0.06); }, 400);
    },
    gameover: function() {
        var self = this;
        [523, 659, 784, 1047].forEach(function(f, i) {
            setTimeout(function() { self._play(f, 0.18, 'sine', 0.1); }, i * 140);
        });
    },
    toggle: function() {
        this.enabled = !this.enabled;
        var btn = document.getElementById('sound-toggle');
        if (btn) btn.classList.toggle('muted');
        if (this.enabled) this._play(880, 0.1, 'sine', 0.06);
    }
};

// ─── HTML Escape ─────────────────────────────────────────────────────

function escapeHtml(unsafe) {
    return (unsafe || '').toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ─── Socket ──────────────────────────────────────────────────────────

var socket = io();
var myId = null;
var currentView = 'room';
var playerIndexMap = {};
var roomCode = null;
var joined = false;

// Views
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
        '<input type="text" id="player-name" placeholder="Captain Banana">' +
        '<br><button onclick="joinGame()">Join Game</button>' +
    '</div>';

var waitingViewHTML = '' +
    '<div id="waiting-view" class="view">' +
        '<h2>Waiting for Crew...</h2>' +
        '<ul id="waiting-players" class="player-list"></ul>' +
        '<div class="bot-controls">' +
            '<button onclick="addBot()" class="btn-small">+ Add Bot</button>' +
            '<button onclick="removeBot()" class="btn-small btn-secondary">- Remove Bot</button>' +
        '</div>' +
        '<button id="start-btn" onclick="startGame()" disabled>Start Game</button>' +
    '</div>';

var biddingViewHTML = '' +
    '<div id="bidding-view" class="view">' +
        '<div class="auction-board">' +
            '<h3>Round <span id="round-number"></span></h3>' +
            '<div class="amount"><span id="auction-amount"></span> 🍌</div>' +
            '<div class="auction-label">Bananas on Auction</div>' +
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
        '<div class="auction-board" style="padding:12px 20px;width:auto">' +
            '<p style="margin:0">Auction was for: <strong><span id="res-auction-amount"></span> 🍌</strong></p>' +
        '</div>' +
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

function setView(viewName) {
    var els = document.querySelectorAll('.view');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('active');
    document.getElementById(viewName + '-view').classList.add('active');
    currentView = viewName;
}

// ─── Room Management ─────────────────────────────────────────────────

function getRoomFromURL() {
    var m = window.location.search.match(/[?&]room=([A-Za-z0-9]+)/);
    return m ? m[1].toUpperCase() : null;
}

function updateURL(room) {
    var url = window.location.protocol + '//' + window.location.host + '?room=' + room;
    window.history.replaceState({room: room}, '', url);
    roomCode = room;
    var display = document.getElementById('room-display');
    if (display) display.textContent = room;
    var loginDisplay = document.getElementById('room-display-login');
    if (loginDisplay) loginDisplay.textContent = room;
    var copyBtn = document.getElementById('copy-room-btn');
    if (copyBtn) copyBtn.style.display = '';
}

function copyRoomLink() {
    var url = window.location.href;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function() {
            var btn = document.getElementById('copy-room-btn');
            if (btn) btn.textContent = 'Copied!';
            setTimeout(function() {
                if (btn) btn.textContent = 'Copy Link';
            }, 2000);
        });
    }
}

// ─── Actions ─────────────────────────────────────────────────────────

function createRoom() {
    socket.emit('create_room');
}

function joinRoom() {
    var code = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (code) socket.emit('join_room', code);
}

function joinGame() {
    var name = document.getElementById('player-name').value;
    if (name) socket.emit('join', name);
}

function addBot() { socket.emit('add_bot'); }
function removeBot() { socket.emit('remove_bot'); }
function startGame() { socket.emit('start_game'); }

function submitBid() {
    var bid = document.getElementById('bid-input').value;
    if (bid !== '') {
        socket.emit('submit_bid', bid);
        document.getElementById('submit-bid-btn').disabled = true;
        document.getElementById('bidding-status').innerText = 'Waiting for other players...';
        Sound.bid();
    }
}

function nextRound() { socket.emit('next_round'); }
function playAgain() { socket.emit('play_again'); }

// ─── Socket Events ───────────────────────────────────────────────────

socket.on('connect', function() {
    myId = socket.id;
    var urlRoom = getRoomFromURL();
    if (urlRoom) {
        socket.emit('join_room', urlRoom);
    }
});

socket.on('room_created', function(code) {
    updateURL(code);
    setView('login');
});

socket.on('room_joined', function(code) {
    updateURL(code);
    setView('login');
    joined = true;
});

socket.on('error', function(msg) {
    if (currentView === 'room') {
        var errEl = document.getElementById('room-error');
        if (errEl) {
            errEl.textContent = msg;
            errEl.style.display = 'block';
        }
    } else {
        alert(msg);
    }
});

socket.on('state', function(state) {
    playerIndexMap = {};
    for (var i = 0; i < state.players.length; i++) {
        playerIndexMap[state.players[i].id] = i;
    }

    var me = null;
    for (var i = 0; i < state.players.length; i++) {
        if (state.players[i].id === myId) { me = state.players[i]; break; }
    }

    // If we haven't joined yet and we have a room, show login
    if (!joined && roomCode && currentView === 'room') {
        setView('login');
    }

    if (me && currentView === 'login') {
        setView('waiting');
    }

    // Update room display in header
    var roomDisplay = document.getElementById('room-display');
    if (!roomDisplay && roomCode) {
        var headerEl = document.querySelector('header');
        if (headerEl) {
            var span = document.createElement('span');
            span.id = 'room-display';
            span.style.cssText = 'font-size:0.5em;color:var(--ocean);background:rgba(14,165,233,0.1);padding:2px 10px;border-radius:8px;margin-left:10px;vertical-align:middle;letter-spacing:1px';
            span.textContent = roomCode;
            headerEl.querySelector('h1').appendChild(span);
        }
    }

    if (me) {
        var statusEl = document.getElementById('player-status');
        if (statusEl) {
            statusEl.innerHTML = 'Captain ' + escapeHtml(me.name) +
                ' &nbsp;|&nbsp; Stock: <strong>' + me.stock + ' 🍌</strong>';
        }
    }

    // ── Waiting ──
    if (state.state === 'waiting' && currentView !== 'login' && currentView !== 'room') {
        setView('waiting');
        var list = document.getElementById('waiting-players');
        var html = '';
        for (var i = 0; i < state.players.length; i++) {
            var p = state.players[i];
            var c = playerColor(i);
            var tag = '';
            if (p.isBot) tag = '<span class="bot-tag">Bot</span>';
            if (p.id === myId) tag += ' <em>(You)</em>';
            html += '<li class="player-card" style="border-left:4px solid ' + c + ';">' +
                '<div class="player-name" style="color:' + c + ';">' + escapeHtml(p.name) + '</div>' +
                '<div>' + tag + '</div></li>';
        }
        list.innerHTML = html;
        document.getElementById('start-btn').disabled = state.players.length < 2;
    }

    // ── Bidding ──
    else if (state.state === 'bidding') {
        var prevView = currentView;
        setView('bidding');
        document.getElementById('round-number').innerText = state.round;
        document.getElementById('auction-amount').innerText = state.auctionAmount;

        var list = document.getElementById('bidding-players');
        var html = '';
        for (var i = 0; i < state.players.length; i++) {
            var p = state.players[i];
            var c = playerColor(i);
            var tag = '';
            if (p.isBot) tag = '<span class="bot-tag">Bot</span>';
            var status = p.hasBid ? 'Bid Placed' : 'Thinking...';
            var cls = p.hasBid ? 'ready' : '';
            html += '<li class="player-card ' + cls + '" style="border-left:4px solid ' + c + ';">' +
                '<div class="player-name" style="color:' + c + ';">' + escapeHtml(p.name) + '</div>' +
                '<div>' + tag + '</div>' +
                '<div class="player-stock">' + status + '</div></li>';
        }
        list.innerHTML = html;

        if (!me || !me.hasBid) {
            document.getElementById('submit-bid-btn').disabled = false;
            document.getElementById('bidding-status').innerText = '';
            if (prevView !== 'bidding') {
                document.getElementById('bid-input').value = '';
            }
        }
    }

    // ── Resolution ──
    else if (state.state === 'resolution') {
        setView('resolution');
        document.getElementById('res-auction-amount').innerText = state.auctionAmount;

        var hadWinner = false;
        for (var i = 0; i < state.players.length; i++) {
            if (state.players[i].winnings > 0) { hadWinner = true; break; }
        }
        var hadBankrupt = false;
        for (var i = 0; i < state.players.length; i++) {
            if (state.players[i].bankrupt) { hadBankrupt = true; break; }
        }

        if (hadBankrupt) Sound.bankrupt();
        else if (hadWinner) Sound.win();

        var sorted = state.players.slice().sort(function(a, b) { return b.bid - a.bid; });
        var html = '';
        for (var i = 0; i < sorted.length; i++) {
            var p = sorted[i];
            var idx = state.players.indexOf(p);
            var c = playerColor(idx);
            var cls = 'resolution-row';
            var detailText = '';
            if (p.bankrupt) {
                cls += ' bankrupt';
                detailText = '<em style="color:#f43f5e">Bankrupt!</em>';
            } else {
                if (p.winnings > 0) {
                    cls += ' winner';
                    detailText = 'Won <strong>+' + p.winnings + '</strong> 🍌';
                }
                if (p.bonusPaid > 0) detailText += '<br>Paid <strong>-' + p.bonusPaid + '</strong> 🍌 bonus';
                if (p.bonusReceived > 0) detailText += '<br>Received <strong>+' + p.bonusReceived + '</strong> 🍌 bonus';
                if (!p.winnings && !p.bonusPaid && !p.bonusReceived) detailText = 'Bid ' + p.bid;
                detailText += '<br>Stock: <strong>' + p.stock + '</strong> 🍌';
            }
            var tag = p.isBot ? '<span class="bot-tag">Bot</span>' : '';
            html += '<div class="' + cls + '" style="border-left-color:' + c + ';">' +
                '<div class="res-player" style="color:' + c + ';">' + escapeHtml(p.name) + ' ' + tag + '</div>' +
                '<div class="res-details">' + detailText + '</div></div>';
        }
        document.getElementById('resolution-details').innerHTML = html;
        document.getElementById('next-round-btn').style.display = 'inline-block';
    }

    // ── Game Over ──
    else if (state.state === 'gameover') {
        setView('gameover');
        Sound.gameover();

        var maxStock = 0;
        for (var i = 0; i < state.players.length; i++) {
            if (state.players[i].stock > maxStock) maxStock = state.players[i].stock;
        }
        var winners = [];
        for (var i = 0; i < state.players.length; i++) {
            if (state.players[i].stock === maxStock) winners.push(state.players[i]);
        }

        document.getElementById('winner-announcement').innerText =
            'Winner(s): ' + winners.map(function(w) { return escapeHtml(w.name); }).join(', ') +
            ' with ' + maxStock + ' 🍌!';

        var sorted = state.players.slice().sort(function(a, b) { return b.stock - a.stock; });
        var html = '';
        for (var i = 0; i < sorted.length; i++) {
            var p = sorted[i];
            var idx = state.players.indexOf(p);
            var c = playerColor(idx);
            var isWinner = false;
            for (var j = 0; j < winners.length; j++) {
                if (winners[j].id === p.id) { isWinner = true; break; }
            }
            var cls = isWinner ? 'resolution-row winner' : 'resolution-row';
            var tag = p.isBot ? '<span class="bot-tag">Bot</span>' : '';
            html += '<div class="' + cls + '" style="border-left-color:' + c + ';">' +
                '<div class="res-player" style="color:' + c + ';">' + escapeHtml(p.name) + ' ' + tag + '</div>' +
                '<div class="res-details"><strong>' + p.stock + '</strong> 🍌</div></div>';
        }
        document.getElementById('final-scores').innerHTML = html;
    }
});
