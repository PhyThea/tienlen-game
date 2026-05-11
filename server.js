const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

const CARD_ORDER = [
    '3', '4', '5', '6', '7',
    '8', '9', '10', 'J',
    'Q', 'K', 'A', '2'
];

function createDeck() {

    const suits = ['♠', '♥', '♦', '♣'];

    const values = [
        '3', '4', '5', '6', '7',
        '8', '9', '10', 'J',
        'Q', 'K', 'A', '2'
    ];

    const deck = [];

    for (const suit of suits) {

        for (const value of values) {

            deck.push({
                suit,
                value
            });
        }
    }

    return deck;
}

function shuffleDeck(deck) {

    const shuffled = [...deck];

    for (let i = shuffled.length - 1; i > 0; i--) {

        const j = Math.floor(Math.random() * (i + 1));

        [shuffled[i], shuffled[j]] =
        [shuffled[j], shuffled[i]];
    }

    return shuffled;
}

function getCardPower(card) {

    return CARD_ORDER.indexOf(card.value);
}

function sortCards(cards) {

    return cards.sort((a, b) => {

        const valueDiff =
            getCardPower(a) - getCardPower(b);

        if (valueDiff !== 0) return valueDiff;

        return a.suit.localeCompare(b.suit);
    });
}

function isStraight(cards) {

    if (cards.length < 3) return false;

    const sorted = [...cards].sort(
        (a, b) => getCardPower(a) - getCardPower(b)
    );

    for (let i = 1; i < sorted.length; i++) {

        if (
            getCardPower(sorted[i]) !==
            getCardPower(sorted[i - 1]) + 1
        ) {
            return false;
        }
    }

    return true;
}

function getComboType(cards) {

    if (cards.length === 1) {
        return 'single';
    }

    const sameValue =
        cards.every(c => c.value === cards[0].value);

    if (sameValue) {

        if (cards.length === 2) return 'pair';

        if (cards.length === 3) return 'triple';

        if (cards.length === 4) return 'bomb';
    }

    if (isStraight(cards)) {
        return 'straight';
    }

    return null;
}

function isValidPlay(cards) {

    return getComboType(cards) !== null;
}

function comparePlay(newCards, oldCards) {

    if (!oldCards || oldCards.length === 0) {
        return true;
    }

    const newType = getComboType(newCards);

    const oldType = getComboType(oldCards);

    if (newType !== oldType) {
        return false;
    }

    if (newCards.length !== oldCards.length) {
        return false;
    }

    const newMax =
        Math.max(...newCards.map(c => getCardPower(c)));

    const oldMax =
        Math.max(...oldCards.map(c => getCardPower(c)));

    return newMax > oldMax;
}

function nextTurn(room) {

    room.currentTurnIndex =
        (room.currentTurnIndex + 1) %
        room.players.length;
}

io.on('connection', (socket) => {

    console.log('Connected:', socket.id);

    socket.on('createRoom', ({ roomId, password, playerName }) => {

        if (rooms[roomId]) {

            return socket.emit(
                'errorMsg',
                'បន្ទប់នេះមានស្រាប់!'
            );
        }

        socket.join(roomId);

        rooms[roomId] = {

            players: [{
                id: socket.id,
                name: playerName || 'Player 1',
                hand: [],
                passed: false
            }],

            maxPlayers: 4,

            password: password || null,

            creatorId: socket.id,

            status: 'waiting',

            currentTurnIndex: 0,

            playedCards: [],

            winner: null,

            passCount: 0
        };

        socket.emit('roomCreated', {

            roomId,

            playerId: socket.id
        });

        io.to(roomId).emit(
            'updatePlayers',
            rooms[roomId].players
        );

        io.to(roomId).emit(
            'gameStatus',
            '⏳ រង់ចាំអ្នកលេង...'
        );
    });

    socket.on('joinRoom', ({ roomId, password, playerName }) => {

        const room = rooms[roomId];

        if (!room) {

            return socket.emit(
                'errorMsg',
                'បន្ទប់មិនមាន!'
            );
        }

        if (
            room.password &&
            room.password !== password
        ) {

            return socket.emit(
                'errorMsg',
                'Password ខុស!'
            );
        }

        if (room.players.length >= 4) {

            return socket.emit(
                'errorMsg',
                'បន្ទប់ពេញហើយ!'
            );
        }

        if (room.status !== 'waiting') {

            return socket.emit(
                'errorMsg',
                'ហ្គេមកំពុងលេង!'
            );
        }

        socket.join(roomId);

        room.players.push({

            id: socket.id,

            name:
                playerName ||
                `Player ${room.players.length + 1}`,

            hand: [],

            passed: false
        });

        socket.emit('roomJoined', {

            roomId,

            playerId: socket.id
        });

        io.to(roomId).emit(
            'updatePlayers',
            room.players
        );

        io.to(roomId).emit(
            'gameStatus',
            `👤 ${playerName} joined`
        );
    });

    socket.on('startGame', (roomId) => {

        const room = rooms[roomId];

        if (!room) return;

        if (room.creatorId !== socket.id) {

            return socket.emit(
                'errorMsg',
                'មានតែ Host ទេ'
            );
        }

        if (room.players.length < 2) {

            return socket.emit(
                'errorMsg',
                'ត្រូវការ 2 នាក់ឡើង'
            );
        }

        room.status = 'playing';

        const deck =
            shuffleDeck(createDeck());

        room.players.forEach((player, index) => {

            player.hand =
                sortCards(
                    deck.slice(index * 13, (index + 1) * 13)
                );

            player.passed = false;
        });

        room.currentTurnIndex =
            room.players.findIndex(player =>

                player.hand.some(card =>
                    card.value === '3' &&
                    card.suit === '♣'
                )
            );

        if (room.currentTurnIndex === -1) {
            room.currentTurnIndex = 0;
        }

        io.to(roomId).emit('gameStarted', {

            players: room.players.map(player => ({

                id: player.id,

                name: player.name,

                cardCount: player.hand.length
            })),

            currentTurnIndex:
                room.currentTurnIndex
        });

        room.players.forEach(player => {

            io.to(player.id).emit(
                'dealCards',
                {
                    hand: player.hand
                }
            );
        });

        io.to(roomId).emit(
            'gameStatus',
            `🎯 វេន ${room.players[room.currentTurnIndex].name}`
        );
    });

    socket.on('playCard', ({ roomId, cards }) => {

        const room = rooms[roomId];

        if (!room) return;

        if (room.status !== 'playing') return;

        const player =
            room.players.find(
                p => p.id === socket.id
            );

        if (!player) return;

        if (
            room.players[room.currentTurnIndex].id !==
            socket.id
        ) {

            return socket.emit(
                'errorMsg',
                'មិនមែនវេនអ្នក'
            );
        }

        if (!cards || cards.length === 0) {

            return socket.emit(
                'errorMsg',
                'ជ្រើសបៀសិន'
            );
        }

        for (const card of cards) {

            const found =
                player.hand.find(

                    c =>
                        c.value === card.value &&
                        c.suit === card.suit
                );

            if (!found) {

                return socket.emit(
                    'errorMsg',
                    'បៀមិនត្រឹមត្រូវ'
                );
            }
        }

        if (!isValidPlay(cards)) {

            return socket.emit(
                'errorMsg',
                'ចុះមិនត្រូវក្បួន'
            );
        }

        if (
            !comparePlay(cards, room.playedCards)
        ) {

            return socket.emit(
                'errorMsg',
                'បៀតូចជាងគេ'
            );
        }

        cards.forEach(card => {

            const idx =
                player.hand.findIndex(

                    c =>
                        c.value === card.value &&
                        c.suit === card.suit
                );

            if (idx !== -1) {

                player.hand.splice(idx, 1);
            }
        });

        room.playedCards = cards;

        room.passCount = 0;

        room.players.forEach(p => {
            p.passed = false;
        });

        if (player.hand.length === 0) {

            room.winner = player.name;

            io.to(roomId).emit(
                'gameWon',
                {
                    winner: player.name
                }
            );

            return;
        }

        nextTurn(room);

        io.to(roomId).emit(
            'cardPlayed',
            {

                by: player.name,

                cards,

                currentTurnIndex:
                    room.currentTurnIndex,

                updatedHands:
                    room.players.map(p => ({

                        id: p.id,

                        name: p.name,

                        cardCount:
                            p.hand.length
                    }))
            }
        );

        io.to(roomId).emit(
            'gameStatus',
            `🎯 វេន ${room.players[room.currentTurnIndex].name}`
        );
    });

    socket.on('passTurn', (roomId) => {

        const room = rooms[roomId];

        if (!room) return;

        const player =
            room.players.find(
                p => p.id === socket.id
            );

        if (!player) return;

        if (
            room.players[room.currentTurnIndex].id !==
            socket.id
        ) {

            return;
        }

        player.passed = true;

        room.passCount++;

        const activePlayers =
            room.players.filter(p => !p.passed);

        if (activePlayers.length <= 1) {

            room.playedCards = [];

            room.passCount = 0;

            room.players.forEach(p => {
                p.passed = false;
            });

            io.to(roomId).emit(
                'clearTable'
            );
        }

        nextTurn(room);

        io.to(roomId).emit(
            'gameStatus',
            `⏭️ ${player.name} pass`
        );

        io.to(roomId).emit(
            'turnChanged',
            {
                currentTurnIndex:
                    room.currentTurnIndex
            }
        );
    });

    socket.on('disconnect', () => {

        for (const roomId in rooms) {

            const room = rooms[roomId];

            const playerIndex =
                room.players.findIndex(
                    p => p.id === socket.id
                );

            if (playerIndex !== -1) {

                const leftPlayer =
                    room.players[playerIndex];

                room.players.splice(
                    playerIndex,
                    1
                );

                io.to(roomId).emit(
                    'updatePlayers',
                    room.players
                );

                io.to(roomId).emit(
                    'gameStatus',
                    `❌ ${leftPlayer.name} left`
                );

                if (
                    room.players.length === 0
                ) {

                    delete rooms[roomId];
                }

                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

    console.log(
        `Server running on port ${PORT}`
    );
});