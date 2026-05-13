// =================================================================
// server.js (កំណែទម្រង់រួមបញ្ចូលច្បាប់កាត់ផែអោប និងហាយ - រត់រលូនឥតខ្ចោះ)
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
    const vIdx = CARD_ORDER.indexOf(card.value);
    const sPower = SUIT_ORDER[card.suit];
    return vIdx * 4 + sPower;
}

function sortHand(hand) {
    return hand.sort((a, b) => getCardPower(a) - getCardPower(b));
}

function getCardValueInt(valueStr) {
    return CARD_ORDER.indexOf(valueStr);
}

function isValidMove(cards) {
    if (!cards || cards.length === 0) return false;
    const len = cards.length;

    const sorted = [...cards].sort((a,b) => getCardPower(a) - getCardPower(b));

    if (len === 1) return true;

    if (len === 2) {
        return sorted[0].value === sorted[1].value;
    }

    if (len === 3) {
        return sorted[0].value === sorted[1].value && sorted[1].value === sorted[2].value;
    }

    if (len === 4) {
        return sorted[0].value === sorted[1].value && sorted[1].value === sorted[2].value && sorted[2].value === sorted[3].value;
    }

    let isSequence = true;
    for (let i = 0; i < len - 1; i++) {
        const currV = getCardValueInt(sorted[i].value);
        const nextV = getCardValueInt(sorted[i+1].value);
        if (currV === 12 || nextV === 12) {
            isSequence = false;
            break;
        }
        if (nextV !== currV + 1) {
            isSequence = false;
        }
    }
    if (isSequence && len >= 3) {
        return true;
    }

    if (len >= 6 && len % 2 === 0) {
        let pairsCount = len / 2;
        let isConsecutivePairs = true;
        for (let i = 0; i < pairsCount; i++) {
            const c1 = sorted[i*2];
            const c2 = sorted[i*2 + 1];
            if (c1.value !== c2.value) {
                isConsecutivePairs = false;
                break;
            }
            if (getCardValueInt(c1.value) === 12) {
                isConsecutivePairs = false;
                break;
            }
            if (i > 0) {
                const prevV = getCardValueInt(sorted[(i-1)*2].value);
                const currV = getCardValueInt(c1.value);
                if (currV !== prevV + 1) {
                    isConsecutivePairs = false;
                }
            }
        }
        if (isConsecutivePairs && pairsCount >= 3) {
            return true;
        }
    }

    return false;
}

function getMoveType(cards) {
    const len = cards.length;
    const sorted = [...cards].sort((a,b) => getCardPower(a) - getCardPower(b));

    if (len === 1) return 'single';
    if (len === 2) return 'pair';
    if (len === 3) return 'triple';
    if (len === 4) return 'four_of_a_kind';

    let isSequence = true;
    for (let i = 0; i < len - 1; i++) {
        const currV = getCardValueInt(sorted[i].value);
        const nextV = getCardValueInt(sorted[i+1].value);
        if (nextV !== currV + 1) isSequence = false;
    }
    if (isSequence) return 'sequence';

    return 'consecutive_pairs';
}

function canBeat(newCards, oldCards, oldType) {
    if (!isValidMove(newCards)) return false;
    const newType = getMoveType(newCards);
    const newLen = newCards.length;
    const oldLen = oldCards.length;

    const newSorted = [...newCards].sort((a,b) => getCardPower(a) - getCardPower(b));
    const oldSorted = [...oldCards].sort((a,b) => getCardPower(a) - getCardPower(b));
    const newMax = newSorted[newSorted.length - 1];
    const oldMax = oldSorted[oldSorted.length - 1];

    if (oldType === 'single' && oldMax.value === '2') {
        if (newType === 'four_of_a_kind') return true;
        if (newType === 'consecutive_pairs' && newLen >= 6) return true;
    }

    if (oldType === 'pair' && oldMax.value === '2') {
        if (newType === 'four_of_a_kind') return true;
        if (newType === 'consecutive_pairs' && newLen >= 8) return true;
    }

    if (oldType === 'consecutive_pairs') {
        if (newType === 'four_of_a_kind' && oldLen === 6) return true;
        if (newType === 'consecutive_pairs' && newLen > oldLen) return true;
    }

    if (newType !== oldType || newLen !== oldLen) return false;

    return getCardPower(newMax) > getCardPower(oldMax);
}

function handleTurnAndRoundStatus(room) {
    let attempts = 0;
    let idx = room.currentTurnIndex;
    const total = room.players.length;

    while (attempts < total) {
        idx = (idx + 1) % total;
        attempts++;
        const p = room.players[idx];
        if (!p.isSpectator && p.hand.length > 0 && !p.passed) {
            room.currentTurnIndex = idx;
            return;
        }
    }

    room.players.forEach(p => {
        if (!p.isSpectator && p.hand.length > 0) {
            p.passed = false;
        }
    });

    room.lastPlayedCards = [];
    room.lastPlayedType = null;

    let leadIdx = room.players.findIndex(p => p.id === room.lastPlayerId);
    if (leadIdx !== -1 && !room.players[leadIdx].isSpectator && room.players[leadIdx].hand.length > 0) {
        room.currentTurnIndex = leadIdx;
    } else {
        let fIdx = room.players.findIndex(p => !p.isSpectator && p.hand.length > 0);
        room.currentTurnIndex = fIdx !== -1 ? fIdx : 0;
    }
}

function broadcastRoomList() {
    const list = Object.keys(rooms).map(id => ({
        id,
        creator: rooms[id].players.find(p => p.id === rooms[id].creatorId)?.name || 'Unknown',
        count: rooms[id].players.length,
        status: rooms[id].status
    }));
    io.emit('roomList', list);
}

io.on('connection', (socket) => {
    broadcastRoomList();

    socket.on('getRooms', () => {
        broadcastRoomList();
    });

    socket.on('createRoom', ({ name }) => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomId] = {
            players: [{ id: socket.id, name, hand: [], passed: false, isSpectator: false, rank: null }],
            creatorId: socket.id,
            status: 'waiting',
            lastPlayedCards: [],
            lastPlayedType: null,
            lastPlayerId: null,
            currentTurnIndex: null,
            nextRank: 1,
            lastWinnerId: null
        };
        socket.join(roomId);
        socket.emit('roomCreated', roomId);
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
        broadcastRoomList();
    });

    socket.on('joinRoom', ({ roomId, name }) => {
        const room = rooms[roomId];
        if (!room) {
            socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់នេះទេ!');
            return;
        }
        if (room.players.some(p => p.id === socket.id)) return;

        const isSpectator = room.status === 'playing';
        room.players.push({ id: socket.id, name, hand: [], passed: false, isSpectator, rank: null });
        
        socket.join(roomId);
        socket.emit('joinedRoom', roomId);
        io.to(roomId).emit('updatePlayers', room.players);

        if (room.status === 'playing') {
            socket.emit('gameStarted', {
                hand: [],
                isSpectator: true,
                currentTurnIndex: room.currentTurnIndex,
                lastPlayedCards: room.lastPlayedCards
            });
        }
        broadcastRoomList();
    });

    socket.on('startGame', () => {
        const roomId = Object.keys(rooms).find(id => rooms[id].creatorId === socket.id);
        if (!roomId) return;
        const room = rooms[roomId];
        if (!room || room.status === 'playing') return;

        const activePlayers = room.players.filter(p => !p.isSpectator);
        if (activePlayers.length < 2) {
            socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់ដើម្បីចាប់ផ្ដើម!');
            return;
        }

        let deck = createDeck();
        shuffleDeck(deck);

        room.players.forEach(p => {
            p.hand = [];
            p.passed = false;
            p.rank = null; 
        });
        room.nextRank = 1;

        let activeIdx = 0;
        while (deck.length > 0 && activeIdx < activePlayers.length * 13) {
            const p = activePlayers[activeIdx % activePlayers.length];
            p.hand.push(deck.pop());
            activeIdx++;
        }

        room.players.forEach(p => {
            p.hand = sortHand(p.hand);
        });

        room.status = 'playing';
        room.lastPlayedCards = [];
        room.lastPlayedType = null;
        room.lastPlayerId = null;

        let startTurnIdx = 0;
        if (room.lastWinnerId) {
            const wIdx = room.players.findIndex(p => p.id === room.lastWinnerId && !p.isSpectator);
            if (wIdx !== -1) startTurnIdx = wIdx;
        } else {
            let lowestPower = 999;
            room.players.forEach((p, idx) => {
                if (!p.isSpectator && p.hand.length > 0) {
                    const power = getCardPower(p.hand[0]);
                    if (power < lowestPower) {
                        lowestPower = power;
                        startTurnIdx = idx;
                    }
                }
            });
        }

        room.currentTurnIndex = startTurnIdx;

        room.players.forEach(p => {
            io.to(p.id).emit('gameStarted', {
                hand: p.hand,
                isSpectator: p.isSpectator,
                currentTurnIndex: room.currentTurnIndex,
                lastPlayedCards: room.lastPlayedCards
            });
        });

        io.to(roomId).emit('updatePlayers', room.players.map(p => ({
            id: p.id,
            name: p.name,
            cardCount: p.hand.length,
            passed: p.passed,
            isSpectator: p.isSpectator,
            rank: p.rank
        })));
        broadcastRoomList();
    });

    socket.on('playCard', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return;

        if (!isValidMove(cards)) {
            socket.emit('errorMsg', 'បៀររួមបញ្ចូលគ្នានេះមិនត្រឹមត្រូវទេ!');
            return;
        }

        if (room.lastPlayedCards.length > 0) {
            if (!canBeat(cards, room.lastPlayedCards, room.lastPlayedType)) {
                socket.emit('errorMsg', 'បៀររបស់អ្នកមិនអាចវាយសង្កត់បៀរនៅលើតុបានទេ!');
                return;
            }
        }

        player.hand = player.hand.filter(c => !cards.some(rc => rc.suit === c.suit && rc.value === c.value));

        room.lastPlayedCards = cards;
        room.lastPlayedType = getMoveType(cards);
        room.lastPlayerId = player.id;

        if (player.hand.length === 0) {
            player.rank = room.nextRank;
            room.nextRank++;

            if (player.rank === 1) {
                room.lastWinnerId = player.id;
            }
        }

        const remainingActivePlayers = room.players.filter(p => p.hand.length > 0 && !p.isSpectator);

        if (remainingActivePlayers.length <= 1) {
            if (remainingActivePlayers.length === 1) {
                remainingActivePlayers[0].rank = room.nextRank;
            }

            room.status = 'waiting';

            const results = room.players.map(p => ({
                id: p.id,
                name: p.name,
                remaining: [...p.hand],
                isSpectator: p.isSpectator,
                rank: p.rank
            }));

            io.to(roomId).emit('cardPlayed', {
                by: player.name,
                cards,
                nextTurn: room.currentTurnIndex,
                cardCount: player.hand.length,
                updatedHands: room.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    cardCount: p.hand.length,
                    passed: p.passed,
                    isSpectator: p.isSpectator,
                    rank: p.rank
                }))
            });

            setTimeout(() => {
                const finalWinner = room.players.find(p => p.rank === 1);
                io.to(roomId).emit('gameWon', {
                    winner: finalWinner ? finalWinner.name : 'គ្មានអ្នកឈ្នះ',
                    winnerId: finalWinner ? finalWinner.id : null,
                    allHands: results
                });
                broadcastRoomList();
            }, 2000);

        } else {
            handleTurnAndRoundStatus(room);

            io.to(roomId).emit('cardPlayed', {
                by: player.name,
                cards,
                nextTurn: room.currentTurnIndex,
                cardCount: player.hand.length,
                updatedHands: room.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    cardCount: p.hand.length,
                    passed: p.passed,
                    isSpectator: p.isSpectator,
                    rank: p.rank
                }))
            });
        }
    });

    socket.on('passTurn', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return;

        if (room.lastPlayedCards.length === 0) {
            socket.emit('errorMsg', 'អ្នកមិនអាច Pass បានទេ ព្រោះអ្នកជាអ្នកបើកទឹកដំបូង!');
            return;
        }

        player.passed = true;

        handleTurnAndRoundStatus(room);

        io.to(roomId).emit('turnPassed', {
            by: player.name,
            nextTurn: room.currentTurnIndex,
            updatedHands: room.players.map(p => ({
                id: p.id,
                name: p.name,
                cardCount: p.hand.length,
                passed: p.passed,
                isSpectator: p.isSpectator,
                rank: p.rank
            }))
        });
    });

    socket.on('leaveRoom', () => {
        for (const id in rooms) {
            const room = rooms[id];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                const wasSpectator = room.players[pIdx].isSpectator;
                room.players.splice(pIdx, 1);
                socket.leave(id);
                socket.emit('leftRoom');
                if (room.players.length === 0) {
                    delete rooms[id];
                } else {
                    if (room.creatorId === socket.id) room.creatorId = room.players[0].id;
                    if (room.status === 'playing' && !wasSpectator && room.currentTurnIndex === pIdx) {
                        handleTurnAndRoundStatus(room);
                        io.to(id).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
                    }
                    io.to(id).emit('updatePlayers', room.players);
                }
                broadcastRoomList();
            }
        }
    });

    socket.on('disconnect', () => {
        for (const id in rooms) {
            const room = rooms[id];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                const wasSpectator = room.players[pIdx].isSpectator;
                room.players.splice(pIdx, 1);
                if (room.players.length === 0) {
                    delete rooms[id];
                } else {
                    if (room.creatorId === socket.id) room.creatorId = room.players[0].id;
                    if (room.status === 'playing' && !wasSpectator && room.currentTurnIndex === pIdx) {
                        handleTurnAndRoundStatus(room);
                        io.to(id).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
                    }
                    io.to(id).emit('updatePlayers', room.players);
                }
                broadcastRoomList();
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server executing on port ${PORT}`);
});