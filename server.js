const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ─── Multi-Game Room System ──────────────────────────────────────────────

const games = new Map();
const socketRooms = new Map(); // socketId → roomCode

const BOT_NAMES = [
    'Salty Steve', 'Barnacle Betty', 'Dock Duncan',
    'Anchor Annie', 'Crabby Carl', 'Mermaid Mia',
    'Skipper Sam', 'One-Eyed Jack'
];

const BOT_ARCHETYPES = [
    () => Math.max(0, Math.floor(Math.random() * (_gAA() + 6))),
    () => Math.floor(Math.random() * Math.max(1, _gAA() / 2 + 1)),
    () => Math.min(_gAA() + 3, Math.floor(_gAA() * (0.6 + Math.random() * 0.6))),
    () => Math.max(1, Math.floor(_gAA() * (0.7 + Math.random() * 0.5))),
    () => {
        if (Math.random() < 0.3) return Math.floor(Math.random() * (_gAA() + 15));
        return Math.floor(Math.random() * (_gAA() + 1));
    }
];

let _currentAA = 0;
function _gAA() { return _currentAA; }

function makeGame() {
    return {
        state: 'waiting',
        players: [],
        auctionAmount: 10,
        round: 1,
        botTimers: {},
        timer: null,
        useTimer: false
    };
}

function getPublicGameState(game) {
    return {
        state: game.state,
        auctionAmount: game.auctionAmount,
        round: game.round,
        useTimer: game.useTimer,
        players: game.players.map(p => ({
            id: p.id,
            name: p.name,
            stock: p.stock,
            hasBid: p.bid !== null,
            bid: game.state === 'resolution' || game.state === 'gameover' ? p.bid : null,
            bankrupt: p.bankrupt,
            winnings: p.winnings,
            bonusPaid: p.bonusPaid,
            bonusReceived: p.bonusReceived,
            isBot: p.isBot || false,
            connected: p.connected !== false
        }))
    };
}

function emitState(roomCode) {
    const game = games.get(roomCode);
    if (game) io.to(roomCode).emit('state', getPublicGameState(game));
}

function roomCode() {
    let code;
    do {
        code = '';
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    } while (games.has(code));
    return code;
}

// ─── Bot System ────────────────────────────────────────────────────────────

function addBot(game, roomCode) {
    if (game.state !== 'waiting') return null;
    const usedNames = new Set(game.players.map(p => p.name));
    const available = BOT_NAMES.filter(n => !usedNames.has(n));
    const name = available.length > 0 ? available[Math.floor(Math.random() * available.length)] : 'Pirate Bot';
    const botId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const archetype = BOT_ARCHETYPES[Math.floor(Math.random() * BOT_ARCHETYPES.length)];
    game.players.push({
        id: botId,
        name: name,
        stock: 10,
        bid: null,
        bankrupt: false,
        winnings: 0,
        bonusPaid: 0,
        bonusReceived: 0,
        isBot: true,
        connected: true,
        archetype: archetype
    });
    emitState(roomCode);
    return botId;
}

function removeBot(game, roomCode) {
    if (game.state !== 'waiting') return false;
    const botIndex = game.players.findLastIndex(p => p.isBot);
    if (botIndex === -1) return false;
    game.players.splice(botIndex, 1);
    emitState(roomCode);
    return true;
}

function submitBotBid(game, roomCode, bot) {
    if (game.state !== 'bidding' || bot.bid !== null) return;
    _currentAA = game.auctionAmount;
    bot.bid = bot.archetype();
    emitState(roomCode);
    checkAllBids(game, roomCode);
}

function triggerBotBids(game, roomCode) {
    Object.values(game.botTimers).forEach(t => clearTimeout(t));
    game.botTimers = {};
    game.players.filter(p => p.isBot).forEach(bot => {
        const delay = 800 + Math.random() * 2800;
        game.botTimers[bot.id] = setTimeout(() => {
            submitBotBid(game, roomCode, bot);
            delete game.botTimers[bot.id];
        }, delay);
    });
}

function clearBotTimers(game) {
    Object.values(game.botTimers).forEach(t => clearTimeout(t));
    game.botTimers = {};
}

// ─── Timer System ─────────────────────────────────────────────────────────

function startBiddingTimer(game, roomCode) {
    clearBiddingTimer(game);
    if (!game.useTimer) return;
    let remaining = 30;
    io.to(roomCode).emit('timer', remaining);
    game.timer = setInterval(() => {
        remaining--;
        io.to(roomCode).emit('timer', remaining);
        if (remaining <= 0) {
            clearBiddingTimer(game);
            // Auto-submit bid 0 for anyone who hasn't bid
            game.players.forEach(p => {
                if (p.bid === null && !p.isBot) {
                    p.bid = 0;
                }
            });
            emitState(roomCode);
            checkAllBids(game, roomCode);
        }
    }, 1000);
}

function clearBiddingTimer(game) {
    if (game.timer) {
        clearInterval(game.timer);
        game.timer = null;
    }
}

// ─── Stale Player Cleanup ─────────────────────────────────────────────────

function cleanupStalePlayers() {
    const now = Date.now();
    for (const [roomCode, game] of games) {
        const toRemove = game.players.filter(p => !p.isBot && p.connected === false && (now - p._disconnectedAt) > 60000);
        if (toRemove.length > 0) {
            game.players = game.players.filter(p => !toRemove.includes(p));
            emitState(roomCode);
        }
    }
}
setInterval(cleanupStalePlayers, 30000);

// ─── Game Logic ────────────────────────────────────────────────────────────

function checkAllBids(game, roomCode) {
    if (game.players.every(p => p.bid !== null)) {
        clearBiddingTimer(game);
        clearBotTimers(game);
        resolveAuction(game);
        emitState(roomCode);
    }
}

function resolveAuction(game) {
    game.players.forEach(p => {
        p.bankrupt = false;
        p.winnings = 0;
        p.bonusPaid = 0;
        p.bonusReceived = 0;
    });

    let playersInAuction = game.players.map(p => p.id);

    while (playersInAuction.length > 0) {
        if (playersInAuction.length === 1) {
            let winnerId = playersInAuction[0];
            let winner = game.players.find(p => p.id === winnerId);
            winner.stock += game.auctionAmount;
            winner.winnings = game.auctionAmount;
            break;
        }

        let bids = playersInAuction.map(id => ({ id, bid: game.players.find(p => p.id === id).bid }));
        let uniqueBids = [...new Set(bids.map(b => b.bid))].sort((a, b) => b - a);

        let highestBid = uniqueBids[0];
        let highestBidders = bids.filter(b => b.bid === highestBid).map(b => b.id);

        if (highestBidders.length > 1) {
            let splitAmount = Math.floor(game.auctionAmount / highestBidders.length);
            for (let id of highestBidders) {
                let p = game.players.find(p => p.id === id);
                p.stock += splitAmount;
                p.winnings = splitAmount;
            }
            break;
        } else {
            let winnerId = highestBidders[0];
            let winner = game.players.find(p => p.id === winnerId);
            let secondHighestBid = uniqueBids.length > 1 ? uniqueBids[1] : 0;
            let bonus = highestBid - secondHighestBid;
            let secondHighestBidders = uniqueBids.length > 1 ? bids.filter(b => b.bid === secondHighestBid).map(b => b.id) : [];

            if (winner.stock + game.auctionAmount >= bonus) {
                winner.stock += game.auctionAmount;
                winner.stock -= bonus;
                winner.winnings = game.auctionAmount;
                winner.bonusPaid = bonus;
                if (secondHighestBidders.length > 0) {
                    let splitBonus = Math.floor(bonus / secondHighestBidders.length);
                    for (let id of secondHighestBidders) {
                        let p = game.players.find(p => p.id === id);
                        p.stock += splitBonus;
                        p.bonusReceived = splitBonus;
                    }
                }
                break;
            } else {
                if (game.players.length !== 2) winner.stock = 0;
                winner.bankrupt = true;
                playersInAuction = playersInAuction.filter(id => id !== winnerId);
            }
        }
    }

    let maxStock = Math.max(...game.players.map(p => p.stock));
    game.state = maxStock >= 200 ? 'gameover' : 'resolution';
}

// ─── Socket Events ─────────────────────────────────────────────────────────

io.on('connection', (socket) => {

    socket.on('create_room', () => {
        const code = roomCode();
        games.set(code, makeGame());
        socket.join(code);
        socketRooms.set(socket.id, code);
        socket.emit('room_created', code);
    });

    socket.on('join_room', (code) => {
        code = (code || '').toUpperCase();
        if (!games.has(code)) {
            socket.emit('error', 'Room not found');
            return;
        }
        socket.join(code);
        socketRooms.set(socket.id, code);
        socket.emit('room_joined', code);
        const game = games.get(code);
        socket.emit('state', getPublicGameState(game));
    });

    function withGame(socket, fn) {
        const roomCode = socketRooms.get(socket.id);
        if (!roomCode) return;
        const game = games.get(roomCode);
        if (!game) return;
        fn(game, roomCode);
    }

    socket.on('join', (name) => {
        withGame(socket, (game, roomCode) => {
            if (game.state !== 'waiting') {
                // Try reconnect — match by name to a disconnected player
                const existing = game.players.find(p => p.name === name && p.connected === false);
                if (existing) {
                    existing.id = socket.id;
                    existing.connected = true;
                    delete existing._disconnectedAt;
                    emitState(roomCode);
                    return;
                }
                socket.emit('error', 'Game already in progress');
                return;
            }
            // Check if name is already taken by a connected player
            if (game.players.find(p => p.name === name && p.connected !== false)) {
                socket.emit('error', 'Name already taken');
                return;
            }
            // Check if reconnecting to an old slot
            const existing = game.players.find(p => p.name === name);
            if (existing) {
                existing.id = socket.id;
                existing.connected = true;
                delete existing._disconnectedAt;
                emitState(roomCode);
                return;
            }
            game.players.push({
                id: socket.id,
                name: name || `Player ${game.players.length + 1}`,
                stock: 10,
                bid: null,
                bankrupt: false,
                winnings: 0,
                bonusPaid: 0,
                bonusReceived: 0,
                isBot: false,
                connected: true
            });
            emitState(roomCode);
        });
    });

    socket.on('add_bot', () => {
        withGame(socket, (game, roomCode) => addBot(game, roomCode));
    });

    socket.on('remove_bot', () => {
        withGame(socket, (game, roomCode) => removeBot(game, roomCode));
    });

    socket.on('toggle_timer', () => {
        withGame(socket, (game, roomCode) => {
            game.useTimer = !game.useTimer;
            emitState(roomCode);
        });
    });

    socket.on('start_game', () => {
        withGame(socket, (game, roomCode) => {
            if (game.state === 'waiting' && game.players.length >= 2) {
                game.state = 'bidding';
                game.auctionAmount = 10;
                game.round = 1;
                game.players.forEach(p => {
                    p.stock = 10;
                    p.bid = null;
                    p.bankrupt = false;
                    p.winnings = 0;
                    p.bonusPaid = 0;
                    p.bonusReceived = 0;
                });
                emitState(roomCode);
                triggerBotBids(game, roomCode);
                startBiddingTimer(game, roomCode);
            }
        });
    });

    socket.on('submit_bid', (bidAmount) => {
        withGame(socket, (game, roomCode) => {
            if (game.state === 'bidding') {
                let player = game.players.find(p => p.id === socket.id);
                if (player && player.bid === null) {
                    player.bid = parseInt(bidAmount, 10);
                    if (isNaN(player.bid) || player.bid < 0) player.bid = 0;
                    emitState(roomCode);
                    // Check if only bots remain — resolve immediately
                    if (game.players.filter(p => !p.isBot).every(p => p.bid !== null)) {
                        clearBiddingTimer(game);
                    }
                    checkAllBids(game, roomCode);
                }
            }
        });
    });

    socket.on('next_round', () => {
        withGame(socket, (game, roomCode) => {
            if (game.state === 'resolution') {
                game.state = 'bidding';
                game.round++;
                game.auctionAmount = Math.max(...game.players.map(p => p.stock));
                game.players.forEach(p => { p.bid = null; });
                emitState(roomCode);
                triggerBotBids(game, roomCode);
                startBiddingTimer(game, roomCode);
            }
        });
    });

    socket.on('play_again', () => {
        withGame(socket, (game, roomCode) => {
            if (game.state === 'gameover' || game.state === 'resolution') {
                clearBiddingTimer(game);
                game.state = 'waiting';
                game.players.forEach(p => {
                    p.stock = 10;
                    p.bid = null;
                });
                emitState(roomCode);
            }
        });
    });

    socket.on('disconnect', () => {
        const roomCode = socketRooms.get(socket.id);
        if (roomCode) {
            const game = games.get(roomCode);
            if (game) {
                const player = game.players.find(p => p.id === socket.id);
                if (player) {
                    if (player.isBot) {
                        game.players = game.players.filter(p => p.id !== socket.id);
                    } else {
                        player.connected = false;
                        player._disconnectedAt = Date.now();
                    }
                }
                // If no humans left, reset game
                if (game.players.filter(p => !p.isBot && p.connected !== false).length === 0 && game.state !== 'waiting') {
                    game.state = 'waiting';
                    clearBiddingTimer(game);
                    clearBotTimers(game);
                    emitState(roomCode);
                } else {
                    emitState(roomCode);
                }
            }
            socketRooms.delete(socket.id);
        }
    });
});

// ─── Startup ────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
