const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let game = {
    state: 'waiting', // waiting, bidding, resolution, gameover
    players: [], // { id, name, stock, bid, ready, bankrupt, winnings, bonusPaid, bonusReceived }
    auctionAmount: 10,
    round: 1
};

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
            bonusReceived: p.bonusReceived
        }))
    };
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

io.on('connection', (socket) => {
    socket.on('join', (name) => {
        if (game.state !== 'waiting') {
            socket.emit('error', 'Game already in progress');
            return;
        }
        // Check if name exists or id exists
        if (!game.players.find(p => p.id === socket.id)) {
            game.players.push({
                id: socket.id,
                name: name || `Player ${game.players.length + 1}`,
                stock: 10,
                bid: null,
                bankrupt: false,
                winnings: 0,
                bonusPaid: 0,
                bonusReceived: 0
            });
        }
        io.emit('state', getPublicGameState());
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
        }
    });

    socket.on('submit_bid', (bidAmount) => {
        if (game.state === 'bidding') {
            let player = game.players.find(p => p.id === socket.id);
            if (player && player.bid === null) {
                player.bid = parseInt(bidAmount, 10);
                if (isNaN(player.bid) || player.bid < 0) player.bid = 0;

                io.emit('state', getPublicGameState());

                // Check if all players have bid
                if (game.players.every(p => p.bid !== null)) {
                    resolveAuction();
                    io.emit('state', getPublicGameState());
                }
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
            game.state = 'waiting'; // Reset game if not enough players
        }
        io.emit('state', getPublicGameState());
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
