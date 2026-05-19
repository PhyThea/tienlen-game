// =================================================================
// server.js (កំណែទម្រង់រួមបញ្ចូលច្បាប់កាត់ពីកូដចាស់ និងប្រព័ន្ធ Voice Chat RAW PCM)
// =================================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // បង្កើនទំហំ Buffer ការពារទិន្នន័យសំឡេងធំ
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

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
    return (CARD_ORDER.indexOf(card.value) * 10) + SUIT_ORDER[card.suit];
}

function sortCards(cards) {
    return cards.sort((a, b) => getCardPower(a) - getCardPower(b));
}

function isConsecutivePairs(cards) {
    const len = cards.length;
    if (len < 4 || len % 2 !== 0) return false;
    const sorted = sortCards([...cards]);

    for (let i = 0; i < len; i += 2) {
        if (sorted[i].value !== sorted[i+1].value) return false;
    }

    for (let i = 0; i < len - 2; i += 2) {
        const currentIdx = CARD_ORDER.indexOf(sorted[i].value);
        const nextIdx = CARD_ORDER.indexOf(sorted[i+2].value);
        
        if (sorted[i].value === '2' || sorted[i+2].value === '2') return false;
        if (nextIdx !== currentIdx + 1) return false;
    }

    return true;
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

    if (isConsecutivePairs(cards)) {
        if (len === 4) return 'double_pair'; 
        if (len === 6) return 'triple_pair'; 
        if (len === 8) return 'quad_pair';   
        return 'consec_pairs';
    }

    let isStr = true;
    for (let i = 1; i < len; i++) {
        if (CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-1].value) + 1) isStr = false;
        if (sorted[i].value === '2' || sorted[i-1].value === '2') isStr = false; 
    }

    if (isStr && len >= 3) {
        const sameSuit = cards.every(c => c.suit === cards[0].suit);
        if (sameSuit) return 'straight_flush'; 
        return 'straight'; 
    }

    return null;
}

function comparePlay(newCards, oldCards) {
    if (!oldCards || oldCards.length === 0) return true;
    
    const newType = getComboType(newCards);
    const oldType = getComboType(oldCards);

    if (!newType) return false; 

    const sortedNew = sortCards([...newCards]);
    const sortedOld = sortCards([...oldCards]);

    const newMax = getCardPower(sortedNew[sortedNew.length - 1]);
    const oldMax = getCardPower(sortedOld[sortedOld.length - 1]);

    if (oldType === 'single' && oldCards[0].value === '2') {
        if (newType === 'triple_pair' || newType === 'quad_pair' || newType === 'bomb') return true;
    }

    if (oldType === 'pair' && oldCards[0].value === '2') {
        if (newType === 'quad_pair' || newType === 'bomb') return true;
    }

    if (oldType === 'bomb') {
        if (newType === 'bomb' && newMax > oldMax) return true;
        if (newType === 'quad_pair') return true;
    }

    if (oldType === 'triple_pair') {
        if (newType === 'triple_pair' && newMax > oldMax) return true;
        if (newType === 'quad_pair' || newType === 'bomb') return true;
    }

    if (oldType === 'quad_pair') {
        if (newType === 'quad_pair' && newMax > oldMax) return true;
    }

    if (newType === oldType && newCards.length === oldCards.length) {
        return newMax > oldMax;
    }

    return false;
}

function moveToNextTurn(room) {
    let originalIndex = room.currentTurnIndex;
    let nextIndex = originalIndex;
    let found = false;
    for (let i = 1; i <= room.players.length; i++) {
        let checkIndex = (originalIndex + i) % room.players.length;
        let p = room.players[checkIndex];
        if (p && p.hand.length > 0 && !p.passed) {
            nextIndex = checkIndex;
            found = true;
            break;
        }
    }
    if (found) {
        room.currentTurnIndex = nextIndex;
    }
}

function handleTurnAndRoundStatus(room) {
    const activePlayersInRound = room.players.filter(p => p.hand.length > 0 && !p.passed);
    let lastPlayerIdx = room.players.findIndex(p => p.id === room.lastPlayerId);
    const isLastPlayerOut = (lastPlayerIdx !== -1 && room.players[lastPlayerIdx].hand.length === 0);
    const isRoundOver = isLastPlayerOut ? (activePlayersInRound.length === 0) : (activePlayersInRound.length <= 1);

    if (isRoundOver) {
        room.playedCards = [];
        room.players.forEach(p => {
            if (p.hand.length > 0) p.passed = false;
        });

        if (isLastPlayerOut) {
            let nextIndex = (lastPlayerIdx + 1) % room.players.length;
            while (room.players[nextIndex].hand.length === 0) {
                nextIndex = (nextIndex + 1) % room.players.length;
            }
            room.currentTurnIndex = nextIndex;
            room.lastPlayerId = room.players[nextIndex].id;
        } else {
            room.currentTurnIndex = lastPlayerIdx !== -1 ? lastPlayerIdx : room.currentTurnIndex;
        }

        io.to(room.roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
        io.to(room.roomId).emit('turnChanged', { 
            currentTurnIndex: room.currentTurnIndex,
            players: room.players 
        });
    } else {
        moveToNextTurn(room);
    }
}

function broadcastRoomList() {
    const list = Object.keys(rooms).map(id => {
        return {
            roomId: id,
            playerCount: rooms[id].players.length,
            status: rooms[id].status,
            hasPassword: rooms[id].password && rooms[id].password !== "" ? true : false
        };
    });
    io.emit('roomList', list);
}

io.on('connection', (socket) => {
    broadcastRoomList();

    socket.on('createRoom', ({ roomId, password, playerName }) => {
        if (rooms[roomId]) {
            return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        }
        
        rooms[roomId] = {
            roomId: roomId,
            players: [{ id: socket.id, name: playerName || 'Player 1', hand: [], passed: false, isSpectator: false, rank: null }],
            creatorId: socket.id,
            status: 'waiting', 
            password: password || "",
            currentTurnIndex: 0,
            playedCards: [],
            lastPlayerId: null,
            lastWinnerId: null,
            nextRank: 1
        };
        
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
        broadcastRoomList();
    });

    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់នេះទេ!');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

        const isSpectator = room.status === 'playing';
        room.players.push({ id: socket.id, name: playerName || 'Guest', hand: [], passed: false, isSpectator: isSpectator, rank: null });
        socket.join(roomId);

        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator, playedCards: room.playedCards, currentTurnIndex: room.currentTurnIndex });
        io.to(roomId).emit('updatePlayers', room.players);
        broadcastRoomList();
    });

    // 🎙️ ទទួលទិន្នន័យសំឡេង Raw PCM រួចបាញ់ចែកចាយភ្លាមៗ
    socket.on('audio_packet', (data) => {
        if (data && data.roomId) {
            socket.to(data.roomId).emit('audio_broadcast', {
                from: socket.id,
                buffer: data.buffer
            });
        }
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        if (!room.lastWinnerId) {
            if (room.creatorId !== socket.id) {
                return socket.emit('errorMsg', 'មានតែម្ចាស់បន្ទប់ទេដែលអាចចាប់ផ្ដើមហ្គេមបាន!');
            }
        } else {
            if (room.lastWinnerId !== socket.id) {
                return socket.emit('errorMsg', 'មានតែអ្នកជាប់លេខ ១ ទេ ដែលអាចចុចចាប់ផ្ដើមវគ្គថ្មីបាន!');
            }
        }

        room.players.forEach(p => {
            p.isSpectator = false;
            p.hand = [];
            p.passed = false;
            p.rank = null;
        });

        const playerCount = room.players.filter(p => !p.isSpectator).length;
        if (playerCount < 2) {
            return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់!');
        }

        const deck = shuffleDeck(createDeck());
        room.status = 'playing';
        room.playedCards = [];
        room.lastPlayerId = null;
        room.nextRank = 1;

        room.players.forEach((p, i) => {
            p.hand = sortCards(deck.slice(i * 13, (i + 1) * 13));
            io.to(p.id).emit('dealCards', { hand: p.hand });
        });

        let startingIndex = -1;
        if (room.lastWinnerId) {
            startingIndex = room.players.findIndex(p => p.id === room.lastWinnerId);
        }

        if (startingIndex === -1) {
            startingIndex = room.players.findIndex(p => p.hand.some(c => c.value === '3' && c.suit === '♠'));
        }
        if (startingIndex === -1) startingIndex = 0;

        room.currentTurnIndex = startingIndex;

        io.to(roomId).emit('gameStarted', { 
            players: room.players.map(p => ({ id: p.id, name: p.name, cardCount: p.hand.length, passed: p.passed, isSpectator: p.isSpectator, rank: p.rank })),
            currentTurnIndex: room.currentTurnIndex,
            lastRoundWinnerId: room.lastWinnerId
        });
        broadcastRoomList();
    });

    socket.on('playCards', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        const playerIdx = room.players.findIndex(p => p.id === socket.id);
        if (playerIdx !== room.currentTurnIndex) return socket.emit('errorMsg', 'មិនមែនជាវេនរបស់អ្នកទេ!');

        const player = room.players[playerIdx];

        const hasAllCards = cards.every(c => player.hand.some(h => h.value === c.value && h.suit === c.suit));
        if (!hasAllCards) return socket.emit('errorMsg', 'សន្លឹកបៀរមិនត្រឹមត្រូវ!');

        const isNewRound = room.playedCards.length === 0;

        if (isNewRound) {
            const isFirstTurnOfGame = Object.values(rooms).some(r => r.roomId === roomId && r.nextRank === 1 && r.players.every(p => p.rank === null));
            if (isFirstTurnOfGame) {
                const hasThreeOfSpades = player.hand.some(c => c.value === '3' && c.suit === '♠');
                if (hasThreeOfSpades) {
                    const playedThreeOfSpades = cards.some(c => c.value === '3' && c.suit === '♠');
                    if (!playedThreeOfSpades) {
                        return socket.emit('errorMsg', 'វគ្គដំបូងបង្អស់ ត្រូវតែចុះសន្លឹកបៀរ ៣ប៊ីច (៣♠) រួមបញ្ចូលផងដែរ!');
                    }
                }
            }
        }

        const type = getComboType(cards);
        if (!type) return socket.emit('errorMsg', 'ការរៀបចំសន្លឹកបៀរចុះនេះមិនត្រូវតាមទម្រង់ច្បាប់ហ្គេមទេ!');

        if (!comparePlay(cards, room.playedCards)) {
            return socket.emit('errorMsg', 'សន្លឹកបៀរនេះមិនអាចស៊ីកាត់សន្លឹកបៀរនៅលើតុបានទេ!');
        }

        player.hand = player.hand.filter(h => !cards.some(c => c.value === h.value && c.suit === h.suit));
        room.playedCards = cards;
        room.lastPlayerId = socket.id;

        socket.emit('playSuccess');
        io.to(roomId).emit('updateTable', { cards: room.playedCards, lastPlayerName: player.name });

        if (player.hand.length === 0) {
            player.rank = room.nextRank;
            room.nextRank++;

            io.to(roomId).emit('showBubbleMessage', { playerId: player.id, message: `🏆 លេខ ${player.rank}!` });

            const remainingActive = room.players.filter(p => p.hand.length > 0 && !p.isSpectator);
            if (remainingActive.length <= 1) {
                if (remainingActive.length === 1) {
                    remainingActive[0].rank = room.nextRank;
                }

                const firstPlacePlayer = room.players.find(p => p.rank === 1);
                room.lastWinnerId = firstPlacePlayer ? firstPlacePlayer.id : room.creatorId;

                room.status = 'waiting';
                io.to(roomId).emit('gameOver', {
                    winner: firstPlacePlayer ? firstPlacePlayer.name : 'Unknown',
                    ranks: room.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        rank: p.rank,
                        isSpectator: p.isSpectator,
                        cardsLeft: p.hand.length,
                        hand: p.hand
                    }))
                });
                
                io.to(roomId).emit('updatePlayers', room.players);
                broadcastRoomList();
                return;
            }
        }

        handleTurnAndRoundStatus(room);
        
        io.to(roomId).emit('updatePlayers', room.players.map(p => ({ id: p.id, name: p.name, cardCount: p.hand.length, passed: p.passed, isSpectator: p.isSpectator, rank: p.rank })));
        io.to(roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
    });

    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        const playerIdx = room.players.findIndex(p => p.id === socket.id);
        if (playerIdx !== room.currentTurnIndex) return socket.emit('errorMsg', 'មិនមែនជាវេនរបស់អ្នកទេ!');

        if (room.playedCards.length === 0) {
            return socket.emit('errorMsg', 'អ្នកជាអ្នកបើកទឹកថ្មី មិនអាចចុចរំលង (Pass) បានឡើយ!');
        }

        room.players[playerIdx].passed = true;
        io.to(roomId).emit('showBubbleMessage', { playerId: socket.id, message: '❌ រំលង (Pass)' });

        handleTurnAndRoundStatus(room);

        io.to(roomId).emit('updatePlayers', room.players.map(p => ({ id: p.id, name: p.name, cardCount: p.hand.length, passed: p.passed, isSpectator: p.isSpectator, rank: p.rank })));
        io.to(roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
    });

    function handlePlayerLeave(socketInstance) {
        const leavingPlayerId = socketInstance.id;
        for (const id in rooms) {
            const room = rooms[id];
            const pIdx = room.players.findIndex(p => p.id === leavingPlayerId);
            
            if (pIdx !== -1) {
                const wasSpectator = room.players[pIdx].isSpectator;
                room.players.splice(pIdx, 1);
                socketInstance.leave(id);

                if (room.players.length === 0) {
                    delete rooms[id];
                } else {
                    if (room.lastWinnerId === leavingPlayerId) {
                        room.lastWinnerId = room.players[0].id;
                    }
                    if (room.creatorId === leavingPlayerId && room.players.length > 0) {
                        room.creatorId = room.players[0].id;
                    }

                    if (room.status === 'playing' && !wasSpectator && room.currentTurnIndex === pIdx) {
                        handleTurnAndRoundStatus(room);
                        io.to(id).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
                    }
                    
                    io.to(id).emit('updatePlayers', room.players);
                    io.to(id).emit('winnerTransferred', { 
                        newWinnerId: room.lastWinnerId,
                        creatorId: room.creatorId
                    });
                }
                broadcastRoomList();
                break;
            }
        }
    }

    socket.on('leaveRoom', () => {
        handlePlayerLeave(socket);
    });

    socket.on('disconnect', () => {
        handlePlayerLeave(socket);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});