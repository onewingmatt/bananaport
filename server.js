const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let game = {
    state: 'waiting', // waiting, bidding, resolution, gameover
    players: [], // { id, name, stock, bid, ready, bankrupt, winnings, bonusPaid, bonusReceived, isBot }
    auctionAmount: 10,
    round: 1
};

// ─── Bot System ────────────────────────────────────────────────────────────

const BOT_NAMES = [
    'Salty Steve', 'Barnacle Betty', 'Dock Duncan',
    'Anchor Annie', 'Crabby Carl', 'Mermaid Mia',
    'Skipper Sam', 'One-Eyed Jack'
];

// Bot personality archetypes — each returns a bid
const BOT_ARCHETYPES = [
    // Random — bids anywhere from 0 to auction+5
    () => Math.max(0, Math.floor(Math.random() * (game.auctionAmount + 6))),
    // Cautious — never bids more than half, often low
    () => Math.floor(Math.random() * Math.max(1, game.auctionAmount / 2 + 1)),
    // Aggressive — wants to win, bids high but not stupid
    () => Math.min(game.auctionAmount + 3, Math.floor(game.auctionAmount * (0.6 + Math.random() * 0.6))),
    // Tactical — bids around the auction amount
    () => Math.max(1, Math.floor(game.auctionAmount * (0.7 + Math.random() * 0.5))),
    // Thrill-seeker — sometimes overbids wildly
    () => {
        if (Math.random() < 0.3) return Math.floor(Math.random() * (game.auctionAmount + 15));
        return Math.floor(Math.random() * (game.auctionAmount + 1));
    }
];

let botTimers = {};

function addBot() {
    if (game.state !== 'waiting') return null;
    const botCount = game.players.filter(p => p.isBot).length;
    const name = BOT_NAMES[botCount % BOT_NAMES.length];
    const botId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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
        archetype: BOT_ARCHETYPES[botCount % BOT_ARCHETYPES.length]
    });
    io.emit('state', getPublicGameState());
    return botId;
}

function removeBot() {
    if (game.state !== 'waiting') return false;
    const botIndex = game.players.findLastIndex(p => p.isBot);
    if (botIndex === -1) return false;
    game.players.splice(botIndex, 1);
    io.emit('state', getPublicGameState());
    return true;
}

function submitBotBid(bot) {
    if (game.state !== 'bidding' || bot.bid !== null) return;
    const bid = bot.archetype();
    bot.bid = bid;
    io.emit('state', getPublicGameState());
    checkAllBids();
}

function triggerBotBids() {
    // Clear any lingering timers
    Object.values(botTimers).forEach(t => clearTimeout(t));
    botTimers = {};

    game.players.filter(p => p.isBot).forEach(bot => {
        // Stagger bot bids 1-4 seconds apart so they don't all fire at once
        const delay = 800 + Math.random() * 2800;
        botTimers[bot.id] = setTimeout(() => {
            submitBotBid(bot);
            delete botTimers[bot.id];
        }, delay);
    });
}

function clearBotTimers() {
    Object.values(botTimers).forEach(t => clearTimeout(t));
    botTimers = {};
}

// ─── Game Logic ────────────────────────────────────────────────────────────

function getPublicGameState() {
    return {
        state: game.state,
        auctionAmount: game.auctionAmount,
        round: game.round,
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
            isBot: p.isBot || false
        }))
    };
}

function checkAllBids() {
    if (game.players.every(p => p.bid !== null)) {
        clearBotTimers();
        resolveAuction();
        io.emit('state', getPublicGameState());
    }
}

function resolveAuction() {
    // Reset round results
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
            // Tie for highest, split and no bonus
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
                // Winner can pay
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
                // Winner cannot pay
                if (game.players.length !== 2) {
                    winner.stock = 0;
                }
                winner.bankrupt = true;
                playersInAuction = playersInAuction.filter(id => id !== winnerId);
            }
        }
    }

    // Check game over
    let maxStock = Math.max(...game.players.map(p => p.stock));
    if (maxStock >= 200) {
        game.state = 'gameover';
    } else {
        game.state = 'resolution';
    }
}

// ─── Socket Events ─────────────────────────────────────────────────────────

io.on('connection', (socket) => {
    socket.on('join', (name) => {
        if (game.state !== 'waiting') {
            socket.emit('error', 'Game already in progress');
            return;
        }
        if (!game.players.find(p => p.id === socket.id)) {
            game.players.push({
                id: socket.id,
                name: name || `Player ${game.players.length + 1}`,
                stock: 10,
                bid: null,
                bankrupt: false,
                winnings: 0,
                bonusPaid: 0,
                bonusReceived: 0,
                isBot: false
            });
        }
        io.emit('state', getPublicGameState());
    });

    socket.on('add_bot', () => {
        addBot();
    });

    socket.on('remove_bot', () => {
        removeBot();
    });

    socket.on('start_game', () => {
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
            io.emit('state', getPublicGameState());
            triggerBotBids();
        }
    });

    socket.on('submit_bid', (bidAmount) => {
        if (game.state === 'bidding') {
            let player = game.players.find(p => p.id === socket.id);
            if (player && player.bid === null) {
                player.bid = parseInt(bidAmount, 10);
                if (isNaN(player.bid) || player.bid < 0) player.bid = 0;

                io.emit('state', getPublicGameState());
                checkAllBids();
            }
        }
    });

    socket.on('next_round', () => {
        if (game.state === 'resolution') {
            game.state = 'bidding';
            game.round++;
            game.auctionAmount = Math.max(...game.players.map(p => p.stock));
            game.players.forEach(p => {
                p.bid = null;
            });
            io.emit('state', getPublicGameState());
            triggerBotBids();
        }
    });

    socket.on('play_again', () => {
        if (game.state === 'gameover' || game.state === 'resolution') {
            game.state = 'waiting';
            game.players.forEach(p => {
                p.stock = 10;
                p.bid = null;
            });
            io.emit('state', getPublicGameState());
        }
    });

    socket.on('disconnect', () => {
        game.players = game.players.filter(p => p.id !== socket.id);
        if (game.players.length < 2 && game.state !== 'waiting') {
            game.state = 'waiting';
            clearBotTimers();
        }
        io.emit('state', getPublicGameState());
    });
});

// ─── Startup ────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
