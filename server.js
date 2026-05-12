// =================================================================
// server.js (កំណែគាំទ្រ Tien Len & Cate ២-៦ នាក់)
// =================================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname));

const rooms = {};
const CARD_ORDER = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUIT_ORDER = { '♠': 0, '♣': 1, '♦': 2, '♥': 3 };

// កំណត់ច្បាប់តាមម៉ូដហ្គេម
const GAME_CONFIG = {
    tienlen: { cardsPerPlayer: 13, maxPlayers: 4, name: 'ទៀនឡេន' },
    cate:    { cardsPerPlayer: 6,  maxPlayers: 6, name: 'កាតេ' }
};

function createDeck() {
    const suits = ['♠', '♣', '♦', '♥'];
    const deck = [];
    for (const suit of suits) {
        for (const value of CARD_ORDER) {
            deck.push({ suit, value });
        }
    }
    return deck;
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function getCardPower(card) {
    return (CARD_ORDER.indexOf(card.value) * 10) + SUIT_ORDER[card.suit];
}

function sortCards(cards) {
    return [...cards].sort((a, b) => getCardPower(a) - getCardPower(b));
}

function getComboType(cards) {
    const len = cards.length;
    if (len === 0) return null;
    if (len === 1) return 'single';
    
    const sorted = sortCards([...cards]);
    const sameValue = cards.every(c => c.value === cards[0].value);

    if (sameValue) {
        if (len === 2) return 'pair';
        if (len === 3) return 'triple'; 
        if (len === 4) return 'bomb';   
    }

    // ឆែក ៣ផែ / ៤ផែ ជាប់គ្នា (សម្រាប់ Tien Len)
    if (len === 6) {
        let is3Pair = true;
        for (let i = 0; i < 6; i += 2) {
            if (sorted[i].value !== sorted[i+1].value) is3Pair = false;
            if (i > 0 && CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-2].value) + 1) is3Pair = false;
        }
        if (sorted[4].value === '2') is3Pair = false;
        if (is3Pair) return 'triple_pair';
    }

    if (len === 8) {
        let is4Pair = true;
        for (let i = 0; i < 8; i += 2) {
            if (sorted[i].value !== sorted[i+1].value) is4Pair = false;
            if (i > 0 && CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-2].value) + 1) is4Pair = false;
        }
        if (sorted[6].value === '2') is4Pair = false;
        if (is4Pair) return 'quad_pair';
    }

    // ឆែកខ្សែ (Straight / Straight Flush)
    let isStr = true;
    for (let i = 1; i < len; i++) {
        if (CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-1].value) + 1) isStr = false;
        if (sorted[i].value === '2') isStr = false; 
    }
    if (isStr && len >= 3) {
        const sameSuit = cards.every(c => c.suit === cards[0].suit);
        return sameSuit ? 'straight_flush' : 'straight';
    }

    return null;
}

function comparePlay(newCards, oldCards, gameMode) {
    if (!oldCards || oldCards.length === 0) return true;
    
    const newType = getComboType(newCards);
    const oldType = getComboType(oldCards);
    const newMax = getCardPower(sortCards(newCards).pop());
    const oldMax = getCardPower(sortCards(oldCards).pop());

    // ច្បាប់ Cate គឺសាមញ្ញជាង៖ ត្រូវប្រភេទដូចគ្នា និងធំជាង (លើកលែង Bomb ដែលស៊ីអ្វីៗបាន)
    if (gameMode === 'cate') {
        if (newType === 'bomb' && (oldType !== 'bomb' || newMax > oldMax)) return true;
        if (newType === oldType && newCards.length === oldCards.length) return newMax > oldMax;
        return false;
    }

    // ច្បាប់ Tien Len (ដើម)
    if (oldType === 'single' && oldCards[0].value === '2') {
        if (newType === 'bomb' || newType === 'quad_pair') return true;
    }
    if (oldType === 'bomb') {
        if (newType === 'bomb' && newMax > oldMax) return true;
        if (newType === 'quad_pair') return true;
    }
    if (oldType === 'quad_pair' && newType === 'quad_pair' && newMax > oldMax) return true;
    if (oldType === 'triple_pair' && newType === 'triple_pair' && newMax > oldMax) return true;
    if (newType === oldType && newCards.length === oldCards.length) return newMax > oldMax;

    return false;
}

function moveToNextTurn(room) {
    let nextIndex = room.currentTurnIndex;
    for (let i = 1; i <= room.players.length; i++) {
        let checkIndex = (room.currentTurnIndex + i) % room.players.length;
        let p = room.players[checkIndex];
        if (p && p.hand.length > 0 && !p.passed) {
            nextIndex = checkIndex;
            break;
        }
    }
    room.currentTurnIndex = nextIndex;
}

function handleTurnAndRoundStatus(room) {
    const active = room.players.filter(p => p.hand.length > 0 && !p.passed);
    if (active.length <= 1) {
        room.playedCards = [];
        room.players.forEach(p => { if (p.hand.length > 0) p.passed = false; });
        
        let nextWinnerIndex = room.players.findIndex(p => p.id === room.lastPlayerId);
        if (nextWinnerIndex === -1 || room.players[nextWinnerIndex].hand.length === 0) {
            for (let i = 1; i <= room.players.length; i++) {
                let idx = (room.currentTurnIndex + i) % room.players.length;
                if (room.players[idx].hand.length > 0) { nextWinnerIndex = idx; break; }
            }
        }
        room.currentTurnIndex = nextWinnerIndex !== -1 ? nextWinnerIndex : 0;
        io.to(room.roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
    } else {
        moveToNextTurn(room);
    }
}

function broadcastRoomList() {
    const list = Object.keys(rooms).map(id => ({
        roomId: id,
        playerCount: rooms[id].players.length,
        status: rooms[id].status,
        gameMode: rooms[id].gameMode,
        hasPassword: Boolean(rooms[id].password)
    }));
    io.emit('roomList', list);
}

io.on('connection', (socket) => {
    broadcastRoomList();

    socket.on('createRoom', ({ roomId, password, playerName, gameMode = 'cate' }) => {
        if (rooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        if (!GAME_CONFIG[gameMode]) return socket.emit('errorMsg', 'ម៉ូដហ្គេមមិនត្រឹមត្រូវ!');

        rooms[roomId] = {
            roomId,
            players: [{ id: socket.id, name: playerName || 'Player 1', hand: [], passed: false, rank: null }],
            creatorId: socket.id,
            status: 'waiting',
            password: password || "",
            currentTurnIndex: 0,
            playedCards: [],
            lastPlayerId: null,
            lastWinnerId: null,
            nextRank: 1,
            gameMode
        };

        socket.join(roomId);
        socket.emit('roomCreated', { roomId, playerId: socket.id, gameMode });
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
        broadcastRoomList();
    });

    socket.on('joinRoom', ({ roomId, password, playerName, gameMode }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់!');
        if (room.gameMode !== gameMode) return socket.emit('errorMsg', 'ម៉ូដហ្គេមមិនត្រូវគ្នា!');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដមិនត្រឹមត្រូវ!');
        if (room.players.length >= GAME_CONFIG[gameMode].maxPlayers) return socket.emit('errorMsg', 'បន្ទប់ពេញ!');

        room.players.push({ id: socket.id, name: playerName || 'Guest', hand: [], passed: false, rank: null });
        socket.join(roomId);
        socket.emit('roomJoined', { roomId, playerId: socket.id, gameMode: room.gameMode });
        io.to(roomId).emit('updatePlayers', room.players);
        broadcastRoomList();
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.creatorId !== socket.id) return;
        if (room.players.length < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់!');

        const config = GAME_CONFIG[room.gameMode];
        const totalNeeded = config.cardsPerPlayer * room.players.length;
        let deck = shuffleDeck(createDeck());
        if (deck.length < totalNeeded) {
            // ប្រសិនបើកាតមិនគ្រប់ (ករណីច្បាស់) យកតាមដែលមាន
        }

        room.status = 'playing';
        room.playedCards = [];
        room.lastPlayerId = null;
        room.nextRank = 1;
        room.players.forEach(p => { p.hand = []; p.passed = false; p.rank = null; p.isSpectator = false; });

        room.players.forEach((p, i) => {
            p.hand = sortCards(deck.slice(i * config.cardsPerPlayer, (i + 1) * config.cardsPerPlayer));
            io.to(p.id).emit('dealCards', { hand: p.hand, playerCount: room.players.length });
        });

        let startingIndex = room.players.findIndex(p => p.hand.some(c => c.value === '3' && c.suit === '♠'));
        if (startingIndex === -1) startingIndex = 0;
        room.currentTurnIndex = startingIndex;

        io.to(roomId).emit('gameStarted', { players: room.players, currentTurnIndex: startingIndex, gameMode: room.gameMode });
        broadcastRoomList();
    });

    socket.on('playCard', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ');
        if (player.hand.length === 0) return socket.emit('errorMsg', 'អស់បៀរហើយ!');

        if (getComboType(cards) && comparePlay(cards, room.playedCards, room.gameMode)) {
            cards.forEach(c => {
                const idx = player.hand.findIndex(pc => pc.value === c.value && pc.suit === c.suit);
                if (idx !== -1) player.hand.splice(idx, 1);
            });

            room.playedCards = cards;
            room.lastPlayerId = socket.id;
            player.passed = false;

            if (player.hand.length === 0) {
                player.rank = room.nextRank++;
                if (player.rank === 1) room.lastWinnerId = player.id;
            }

            const active = room.players.filter(p => p.hand.length > 0);
            if (active.length <= 1) {
                if (active.length === 1) active[0].rank = room.nextRank;
                room.status = 'waiting';
                io.to(roomId).emit('cardPlayed', { by: player.name, cards, cardCount: player.hand.length, updatedHands: room.players, gameOver: true });
                setTimeout(() => {
                    const winner = room.players.find(p => p.rank === 1);
                    io.to(roomId).emit('gameWon', { winner: winner?.name || 'N/A', results: room.players });
                    broadcastRoomList();
                }, 1500);
            } else {
                handleTurnAndRoundStatus(room);
                io.to(roomId).emit('cardPlayed', { by: player.name, cards, nextTurn: room.players[room.currentTurnIndex].name, cardCount: player.hand.length, updatedHands: room.players, gameOver: false });
            }
        } else {
            socket.emit('errorMsg', 'ចុះមិនត្រូវក្បួន ឬតូចជាង!');
        }
    });

    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return;

        player.passed = true;
        io.to(roomId).emit('playerPassed', { name: player.name, id: player.id });
        handleTurnAndRoundStatus(room);
        io.to(roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, nextPlayer: room.players[room.currentTurnIndex].name });
    });

    socket.on('leaveRoom', () => {
        for (const id in rooms) {
            const room = rooms[id];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                room.players.splice(pIdx, 1);
                socket.leave(id);
                socket.emit('leftRoom');
                if (room.players.length === 0) delete rooms[id];
                else {
                    if (room.creatorId === socket.id) room.creatorId = room.players[0].id;
                    if (room.status === 'playing' && room.currentTurnIndex === pIdx) {
                        handleTurnAndRoundStatus(room);
                        io.to(id).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, nextPlayer: room.players[room.currentTurnIndex].name });
                    }
                    io.to(id).emit('updatePlayers', room.players);
                }
                broadcastRoomList();
            }
        }
    });

    socket.on('disconnect', () => {
        socket.emit('leaveRoom');
    });
});

server.listen(3000, () => console.log('🚀 Server running on port 3000'));