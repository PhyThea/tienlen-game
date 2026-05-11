// ===========================
// server.js
// ===========================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

// លំដាប់តម្លៃបៀពីតូចទៅធំ
const CARD_ORDER = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];

// លំដាប់ស៊ីត
const SUIT_ORDER = ['♠', '♣', '♦', '♥'];

function createDeck() {
    const suits = ['♠','♥','♦','♣'];
    const values = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
    const deck = [];
    for (const suit of suits) {
        for (const value of values) {
            deck.push({ suit, value });
        }
    }
    return deck;
}

function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function getCardRank(card) {
    const valIndex = CARD_ORDER.indexOf(card.value);
    const suitIndex = SUIT_ORDER.indexOf(card.suit);
    return valIndex * 10 + suitIndex;
}

function sortCards(cards) {
    return cards.sort((a, b) => getCardRank(a) - getCardRank(b));
}

function isStraight(cards) {
    if (cards.length < 3) return false;
    const sorted = [...cards].sort((a, b) => 
        CARD_ORDER.indexOf(a.value) - CARD_ORDER.indexOf(b.value)
    );
    for (let i = 1; i < sorted.length; i++) {
        if (CARD_ORDER.indexOf(sorted[i].value) !== 
            CARD_ORDER.indexOf(sorted[i - 1].value) + 1) {
            return false;
        }
    }
    return true;
}

function getComboType(cards) {
    if (cards.length === 1) return 'single';
    
    const sameValue = cards.every(c => c.value === cards[0].value);
    if (sameValue) {
        if (cards.length === 2) return 'pair';
        if (cards.length === 3) return 'triple';
        if (cards.length === 4) return 'bomb';
    }

    // 4 គូ (Four Pairs)
    if (cards.length === 8) {
        const counts = {};
        cards.forEach(c => {
            counts[c.value] = (counts[c.value] || 0) + 1;
        });
        const values = Object.values(counts);
        if (values.length === 4 && values.every(v => v === 2)) {
            return 'four_pairs';
        }
    }

    // Straight
    if (isStraight(cards)) return 'straight';

    return null;
}

function isValidPlay(cards) {
    return getComboType(cards) !== null;
}

function comparePlay(newCards, oldCards) {
    if (!oldCards || oldCards.length === 0) return true;

    const newType = getComboType(newCards);
    const oldType = getComboType(oldCards);

    // ការ៉េ និង 4គូ ស៊ីហាយ
    if ((newType === 'bomb' || newType === 'four_pairs') && oldType === 'straight') {
        return true;
    }

    if (newType !== oldType || newCards.length !== oldCards.length) {
        return false;
    }

    const newMax = Math.max(...newCards.map(c => getCardRank(c)));
    const oldMax = Math.max(...oldCards.map(c => getCardRank(c)));

    return newMax > oldMax;
}

// ====================== កែប្រែសំខាន់ ======================
function nextTurn(room) {
    if (room.players.length === 0) return;

    let index = room.currentTurnIndex;
    let tries = 0;

    do {
        index = (index + 1) % room.players.length;
        tries++;
    } while (room.players[index].passed && tries < room.players.length);

    room.currentTurnIndex = index;
}

function startNewRound(room) {
    room.status = 'playing';
    room.winner = null;
    room.playedCards = [];
    room.isFirstMoveOfGame = true;

    const deck = shuffleDeck(createDeck());

    room.players.forEach((player, index) => {
        player.hand = sortCards(deck.slice(index * 13, (index + 1) * 13));
        player.passed = false;
    });

    // រកមនុស្សមាន 3♣
    room.currentTurnIndex = room.players.findIndex(player =>
        player.hand.some(card => card.value === '3' && card.suit === '♣')
    );

    if (room.currentTurnIndex === -1) room.currentTurnIndex = 0;

    io.to(room.id).emit('gameStarted', {
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            cardCount: p.hand.length
        })),
        currentTurnIndex: room.currentTurnIndex
    });

    room.players.forEach(player => {
        io.to(player.id).emit('dealCards', { hand: player.hand });
    });

    io.to(room.id).emit('gameStatus', 
        `🎯 វេន ${room.players[room.currentTurnIndex].name} (មាន 3♣)`
    );
}

// ====================== Socket Events ======================
io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    socket.on('createRoom', ({ roomId, password, playerName }) => {
        if (rooms[roomId]) {
            return socket.emit('errorMsg', 'បន្ទប់នេះមានស្រាប់ហើយ');
        }

        socket.join(roomId);
        rooms[roomId] = {
            id: roomId,
            players: [{
                id: socket.id,
                name: playerName || 'Player 1',
                hand: [],
                passed: false
            }],
            creatorId: socket.id,
            password: password || null,
            maxPlayers: 4,
            status: 'waiting',
            currentTurnIndex: 0,
            playedCards: [],
            winner: null,
            isFirstMoveOfGame: false
        };

        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
    });

    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'បន្ទប់មិនមាន');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'Password ខុស');
        if (room.players.length >= room.maxPlayers) return socket.emit('errorMsg', 'បន្ទប់ពេញ');
        if (room.status !== 'waiting') return socket.emit('errorMsg', 'ហ្គេមកំពុងដំណើរការ');

        socket.join(roomId);
        room.players.push({
            id: socket.id,
            name: playerName || `Player ${room.players.length + 1}`,
            hand: [],
            passed: false
        });

        socket.emit('roomJoined', { roomId, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', room.players);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.creatorId !== socket.id) {
            return socket.emit('errorMsg', 'មានតែ Host ទេដែលអាចចាប់ផ្តើម');
        }
        if (room.players.length < 2) {
            return socket.emit('errorMsg', 'ត្រូវការយ៉ាងតិច 2 នាក់');
        }

        startNewRound(room);
    });

    socket.on('playCard', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        if (room.players[room.currentTurnIndex].id !== socket.id) {
            return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ');
        }

        // Validation
        if (!cards || cards.length === 0) return socket.emit('errorMsg', 'ជ្រើសបៀសិន');
        
        const cardSet = new Set(cards.map(c => `${c.value}${c.suit}`));
        if (cardSet.size !== cards.length) return socket.emit('errorMsg', 'មានបៀស្ទួន');

        for (const card of cards) {
            if (!player.hand.some(c => c.value === card.value && c.suit === card.suit)) {
                return socket.emit('errorMsg', 'បៀមិនត្រឹមត្រូវ');
            }
        }

        // 3♣ ច្បាប់ដំបូង
        if (room.isFirstMoveOfGame) {
            const has3Clubs = player.hand.some(c => c.value === '3' && c.suit === '♣');
            const plays3Clubs = cards.some(c => c.value === '3' && c.suit === '♣');
            if (has3Clubs && !plays3Clubs) {
                return socket.emit('errorMsg', 'អ្នកមាន 3♣ ត្រូវតែចេញមុនគេ!');
            }
        }

        if (!isValidPlay(cards)) return socket.emit('errorMsg', 'ចុះមិនត្រូវក្បួន');
        if (!comparePlay(cards, room.playedCards)) {
            return socket.emit('errorMsg', 'បៀតូចជាង ឬខុសប្រភេទ');
        }

        // ដកបៀ
        for (const card of cards) {
            const idx = player.hand.findIndex(c => c.value === card.value && c.suit === card.suit);
            if (idx !== -1) player.hand.splice(idx, 1);
        }

        room.playedCards = cards;

        // Reset pass
        room.players.forEach(p => {
            if (p.id !== socket.id) p.passed = false;
        });

        // ឈ្នះហ្គេម
        if (player.hand.length === 0) {
            room.winner = player.name;
            io.to(roomId).emit('gameWon', { winner: player.name });

            setTimeout(() => startNewRound(room), 4000);
            return;
        }

        if (room.isFirstMoveOfGame) room.isFirstMoveOfGame = false;

        nextTurn(room);

        io.to(roomId).emit('cardPlayed', {
            by: player.name,
            cards,
            currentTurnIndex: room.currentTurnIndex,
            updatedHands: room.players.map(p => ({
                id: p.id,
                name: p.name,
                cardCount: p.hand.length
            }))
        });

        io.to(roomId).emit('gameStatus', `🎯 វេន ${room.players[room.currentTurnIndex].name}`);
    });

    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || room.players[room.currentTurnIndex].id !== socket.id) return;

        if (!room.playedCards || room.playedCards.length === 0) {
            return socket.emit('errorMsg', 'មិនអាច Pass នៅវេនដំបូងបានទេ');
        }

        player.passed = true;
        nextTurn(room);

        const activePlayers = room.players.filter(p => !p.passed);

        if (activePlayers.length <= 1) {
            room.playedCards = [];
            room.players.forEach(p => p.passed = false);
            io.to(roomId).emit('clearTable');
            io.to(roomId).emit('gameStatus', `🔄 ជុំថ្មី! វេន ${room.players[room.currentTurnIndex].name}`);
        } else {
            io.to(roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
            io.to(roomId).emit('gameStatus', `⏭️ ${player.name} pass`);
        }
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const index = room.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                const leftPlayer = room.players[index];
                room.players.splice(index, 1);

                io.to(roomId).emit('updatePlayers', room.players);
                io.to(roomId).emit('gameStatus', `❌ ${leftPlayer.name} left`);

                if (room.players.length === 0) {
                    delete rooms[roomId];
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});