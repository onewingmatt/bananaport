
function escapeHtml(unsafe) {
    return (unsafe || '').toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

const socket = io();

// Views
const views = {
    login: `
        <div id="login-view" class="view active">
            <h2>Welcome to the Docks</h2>
            <p>Enter your Captain name to join.</p>
            <input type="text" id="player-name" placeholder="Captain Banana">
            <button onclick="joinGame()">Join Game</button>
        </div>
    `,
    waiting: `
        <div id="waiting-view" class="view">
            <h2>Waiting for Players...</h2>
            <ul id="waiting-players" class="player-list"></ul>
            <div class="bot-controls">
                <button onclick="addBot()" class="btn-small">+ Add Bot</button>
                <button onclick="removeBot()" class="btn-small btn-secondary">- Remove Bot</button>
            </div>
            <button id="start-btn" onclick="startGame()" disabled>Start Game</button>
        </div>
    `,
    bidding: `
        <div id="bidding-view" class="view">
            <div class="auction-board">
                <h3>Round <span id="round-number"></span></h3>
                <p>Bananas on Auction: <strong><span id="auction-amount"></span> 🍌</strong></p>
            </div>
            <div id="bidding-area">
                <p>Enter your secret bid:</p>
                <input type="number" id="bid-input" min="0" placeholder="0">
                <button id="submit-bid-btn" onclick="submitBid()">Place Bid</button>
            </div>
            <p id="bidding-status"></p>
            <ul id="bidding-players" class="player-list"></ul>
        </div>
    `,
    resolution: `
        <div id="resolution-view" class="view">
            <h2>Auction Results</h2>
            <div class="auction-board">
                <p>Auction was for: <strong><span id="res-auction-amount"></span> 🍌</strong></p>
            </div>
            <div id="resolution-details"></div>
            <button id="next-round-btn" onclick="nextRound()" style="display:none;">Next Round</button>
        </div>
    `,
    gameover: `
        <div id="gameover-view" class="view">
            <h2>Game Over!</h2>
            <h3 id="winner-announcement"></h3>
            <div id="final-scores"></div>
            <button onclick="playAgain()">Play Again</button>
        </div>
    `
};

let myId = null;
let currentView = 'login';

document.getElementById('main-content').innerHTML = Object.values(views).join('');

function setView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewName + '-view').classList.add('active');
    currentView = viewName;
}

// Actions
function joinGame() {
    const name = document.getElementById('player-name').value;
    if (name) {
        socket.emit('join', name);
    }
}

function addBot() {
    socket.emit('add_bot');
}

function removeBot() {
    socket.emit('remove_bot');
}

function startGame() {
    socket.emit('start_game');
}

function submitBid() {
    const bid = document.getElementById('bid-input').value;
    if (bid !== '') {
        socket.emit('submit_bid', bid);
        document.getElementById('submit-bid-btn').disabled = true;
        document.getElementById('bidding-status').innerText = 'Waiting for other players...';
    }
}

function nextRound() {
    socket.emit('next_round');
}

function playAgain() {
    socket.emit('play_again');
}

// Socket Events
socket.on('connect', () => {
    myId = socket.id;
});

socket.on('error', (msg) => {
    alert(msg);
});

socket.on('state', (state) => {
    // Update player status footer
    const me = state.players.find(p => p.id === myId);
    if (me) {
        document.getElementById('player-status').innerHTML =
            'Captain ' + escapeHtml(me.name) + ' | Stock: <strong>' + me.stock + ' 🍌</strong>';

        // Hide login if joined
        if (currentView === 'login') {
            setView('waiting');
        }
    }

    if (state.state === 'waiting' && currentView !== 'login') {
        setView('waiting');
        const list = document.getElementById('waiting-players');
        list.innerHTML = state.players.map(function(p) {
            var tag = '';
            if (p.isBot) tag = '<span class="bot-tag">Bot</span>';
            if (p.id === myId) tag += ' <em>(You)</em>';
            return '<li class="player-card"><strong>' + escapeHtml(p.name) + '</strong> ' + tag + '</li>';
        }).join('');
        document.getElementById('start-btn').disabled = state.players.length < 2;
    }
    else if (state.state === 'bidding') {
        setView('bidding');
        document.getElementById('round-number').innerText = state.round;
        document.getElementById('auction-amount').innerText = state.auctionAmount;

        const list = document.getElementById('bidding-players');
        list.innerHTML = state.players.map(function(p) {
            var tag = '';
            if (p.isBot) tag = '<span class="bot-tag">Bot</span>';
            var status = p.hasBid ? 'Bid Placed' : 'Thinking...';
            return '<li class="player-card ' + (p.hasBid ? 'ready' : '') + '">' +
                '<strong>' + escapeHtml(p.name) + '</strong> ' + tag + '<br>' + status + '</li>';
        }).join('');

        if (!me || !me.hasBid) {
            document.getElementById('submit-bid-btn').disabled = false;
            document.getElementById('bidding-status').innerText = '';
            if (currentView !== 'bidding') {
                document.getElementById('bid-input').value = '';
            }
        }
    }
    else if (state.state === 'resolution') {
        setView('resolution');
        document.getElementById('res-auction-amount').innerText = state.auctionAmount;

        var detailsHtml = '';
        var sorted = state.players.slice().sort(function(a,b) { return b.bid - a.bid; });
        for (var i = 0; i < sorted.length; i++) {
            var p = sorted[i];
            var clz = 'resolution-card';
            if (p.winnings > 0) clz += ' winner';
            if (p.bankrupt) clz += ' bankrupt';
            detailsHtml += '<div class="' + clz + '">';
            detailsHtml += '<strong>' + escapeHtml(p.name) + '</strong>';
            if (p.isBot) detailsHtml += ' <span class="bot-tag">Bot</span>';
            detailsHtml += ' bid ' + p.bid + '.<br>';
            if (p.bankrupt) {
                detailsHtml += '<em>Went bankrupt trying to pay bonuses! Lost all stock.</em>';
            } else {
                if (p.winnings > 0) detailsHtml += 'Won ' + p.winnings + ' 🍌.<br>';
                if (p.bonusPaid > 0) detailsHtml += 'Paid ' + p.bonusPaid + ' 🍌 in bonuses.<br>';
                if (p.bonusReceived > 0) detailsHtml += 'Received ' + p.bonusReceived + ' 🍌 as a bonus.<br>';
                detailsHtml += 'New Stock: ' + p.stock + ' 🍌';
            }
            detailsHtml += '</div>';
        }
        document.getElementById('resolution-details').innerHTML = detailsHtml;
        document.getElementById('next-round-btn').style.display = 'inline-block';
    }
    else if (state.state === 'gameover') {
        setView('gameover');
        var maxStock = 0;
        for (var i = 0; i < state.players.length; i++) {
            if (state.players[i].stock > maxStock) maxStock = state.players[i].stock;
        }
        var winners = state.players.filter(function(p) { return p.stock === maxStock; });

        document.getElementById('winner-announcement').innerText =
            'Winner(s): ' + winners.map(function(w) { return escapeHtml(w.name); }).join(', ') + ' with ' + maxStock + ' 🍌!';

        var scoresHtml = '';
        var sortedScores = state.players.slice().sort(function(a,b) { return b.stock - a.stock; });
        for (var i = 0; i < sortedScores.length; i++) {
            var p = sortedScores[i];
            var wCls = (winners.indexOf(p) !== -1) ? ' winner' : '';
            scoresHtml += '<div class="resolution-card' + wCls + '">' +
                '<strong>' + escapeHtml(p.name) + '</strong>' +
                (p.isBot ? ' <span class="bot-tag">Bot</span>' : '') + ': ' + p.stock + ' 🍌</div>';
        }
        document.getElementById('final-scores').innerHTML = scoresHtml;
    }
});
