// =================================================================
// server.js (កំណែទម្រង់ជួសជុលការចូលបន្ទប់មិនកើត និងរក្សាទុកច្បាប់បៀរចាស់ + Voice ថ្មី)
// =================================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // ការពារទិន្នន័យសំឡេងធំរបស់ Voice Chat
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
        if (p.hand.length > 0 && !p.passed) {
            nextIndex = checkIndex;
            found = true;
            break;
        }
    }

    if (!found) {
        room.players.forEach(p => p.passed = false);
        room.lastPlay = null;
        
        let lastPlayIndex = room.players.findIndex(p => p.id === room.lastPlayPlayerId);
        if (lastPlayIndex !== -1 && room.players[lastPlayIndex].hand.length > 0) {
            room.currentTurnIndex = lastPlayIndex;
        } else {
            for (let i = 0; i < room.players.length; i++) {
                let checkIdx = (room.lastPlayPlayerIdIndex + i) % room.players.length;
                if (room.players[checkIdx].hand.length > 0) {
                    room.currentTurnIndex = checkIdx;
                    break;
                }
            }
        }
    } else {
        room.currentTurnIndex = nextIndex;
    }
}

function handleTurnAndRoundStatus(room) {
    let activePlayersWithCards = room.players.filter(p => p.hand.length > 0 && !p.passed);
    if (activePlayersWithCards.length <= 1) {
        room.players.forEach(p => p.passed = false);
        room.lastPlay = null;
        let nextIdx = room.players.findIndex(p => p.id === room.lastPlayPlayerId);
        if (nextIdx === -1 || room.players[nextIdx].hand.length === 0) {
            nextIdx = room.players.findIndex(p => p.hand.length > 0);
        }
        room.currentTurnIndex = nextIdx !== -1 ? nextIdx : 0;
    } else {
        moveToNextTurn(room);
    }
}

function checkGameEnd(room) {
    let playersWithCards = room.players.filter(p => p.hand.length > 0);
    if (playersWithCards.length <= 1) {
        room.status = 'finished';
        if (playersWithCards.length === 1) {
            playersWithCards[0].rank = room.nextRank;
            room.nextRank++;
        }
        io.to(room.id).emit('gameEnd', room.players);
    }
}

function broadcastRoomList() {
    const list = Object.values(rooms)
        .filter(r => r.status === 'waiting')
        .map(r => ({ id: r.id, playerCount: r.players.length, hasPass: !!r.password }));
    io.emit('roomList', list);
}

// === SOCKET CONNECTION ===
io.on('connection', (socket) => {
    
    // 🎙️ Voice Chat RAW PCM
    socket.on('voiceData', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('audioStream', {
                senderId: socket.id,
                buffer: data.buffer
            });
        }
    });

    // 🛠️ ជួសជុលមុខងារបង្កើតបន្ទប់ (Create Room)
    socket.on('createRoom', (data) => {
        if (!data || !data.roomId) return socket.emit('errorMsg', 'ទិន្នន័យបន្ទប់មិនត្រឹមត្រូវ!');
        const roomId = data.roomId.trim();
        const password = data.password;
        const playerName = data.playerName;

        if (rooms[roomId]) {
            return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        }

        rooms[roomId] = {
            id: roomId,
            password: password || null,
            status: 'waiting',
            players: [],
            lastPlay: null,
            lastPlayPlayerId: null,
            lastPlayPlayerIdIndex: 0,
            currentTurnIndex: 0,
            nextRank: 1,
            creatorId: socket.id,
            lastWinnerId: socket.id
        };

        joinRoomLogic(socket, roomId, playerName);
    });

    // 🛠️ ជួសជុលមុខងារចូលបន្ទប់ (Join Room)
    socket.on('joinRoom', (data) => {
        if (!data || !data.roomId) return socket.emit('errorMsg', 'រកមិនឃើញលេខបន្ទប់ឡើយ!');
        const roomId = data.roomId.trim();
        const password = data.password;
        const playerName = data.playerName;

        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់ឡើយ!');
        if (room.status !== 'waiting') return socket.emit('errorMsg', 'ហ្គេមកំពុងលេង មិនអាចចូលបានទេ!');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ (អតិបរមា ៤ នាក់)!');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');

        joinRoomLogic(socket, roomId, playerName);
    });

    function joinRoomLogic(socket, roomId, playerName) {
        const room = rooms[roomId];
        if (!room) return;

        const newPlayer = {
            id: socket.id,
            name: playerName || `Player_${socket.id.substring(0,4)}`,
            hand: [],
            passed: false,
            rank: null,
            isSpectator: false
        };
        
        room.players.push(newPlayer);
        socket.roomId = roomId;
        socket.join(roomId);

        socket.emit('joinSuccess', { roomId, creatorId: room.creatorId, myId: socket.id });
        io.to(roomId).emit('updatePlayers', room.players);
        broadcastRoomList();
    }

    socket.on('getRoomList', () => {
        broadcastRoomList();
    });

    socket.on('startGame', () => {
        const room = rooms[socket.roomId];
        if (!room || room.creatorId !== socket.id) return;

        room.status = 'playing';
        room.nextRank = 1;
        room.lastPlay = null;
        room.lastPlayPlayerId = null;

        let deck = createDeck();
        shuffleDeck(deck);

        room.players.forEach(p => {
            p.hand = sortCards(deck.splice(0, 13));
            p.passed = false;
            p.rank = null;
            p.isSpectator = false;
        });

        let startingIndex = room.players.findIndex(p => p.id === room.lastWinnerId);
        if (startingIndex === -1) startingIndex = 0;

        let hasThreeSpade = room.players.findIndex(p => p.hand.some(c => c.value === '3' && c.suit === '♠'));
        if (hasThreeSpade !== -1 && room.lastWinnerId === room.creatorId && room.nextRank === 1) {
            startingIndex = hasThreeSpade;
        }

        room.currentTurnIndex = startingIndex;
        io.to(socket.roomId).emit('gameStarted', {
            players: room.players,
            currentTurnIndex: room.currentTurnIndex
        });
        broadcastRoomList();
    });

    socket.on('playCards', (selectedCards) => {
        const room = rooms[socket.roomId];
        if (!room || room.status !== 'playing') return;

        let playerIdx = room.players.findIndex(p => p.id === socket.id);
        if (playerIdx !== room.currentTurnIndex) return socket.emit('errorMsg', 'មិនទាន់ដល់វេនអ្នកទេ!');

        let player = room.players[playerIdx];
        let hasCards = selectedCards.every(sc => player.hand.some(hc => hc.value === sc.value && hc.suit === sc.suit));
        if (!hasCards) return socket.emit('errorMsg', 'ទិន្នន័យបៀរមិនត្រឹមត្រូវ!');

        if (!comparePlay(selectedCards, room.lastPlay)) {
            return socket.emit('errorMsg', 'បៀរចុះមិនត្រូវតាមច្បាប់ ឬខ្សោយជាងបៀរលើតុ!');
        }

        player.hand = player.hand.filter(hc => !selectedCards.some(sc => sc.value === hc.value && sc.suit === hc.suit));
        room.lastPlay = selectedCards;
        room.lastPlayPlayerId = player.id;
        room.lastPlayPlayerIdIndex = playerIdx;

        if (player.hand.length === 0 && !player.rank) {
            player.rank = room.nextRank;
            if (room.nextRank === 1) {
                room.lastWinnerId = player.id;
            }
            room.nextRank++;
        }

        checkGameEnd(room);

        if (room.status === 'playing') {
            handleTurnAndRoundStatus(room);
            io.to(socket.roomId).emit('turnChanged', {
                currentTurnIndex: room.currentTurnIndex,
                lastPlay: room.lastPlay,
                players: room.players
            });
        }
    });

    socket.on('passTurn', () => {
        const room = rooms[socket.roomId];
        if (!room || room.status !== 'playing') return;

        let playerIdx = room.players.findIndex(p => p.id === socket.id);
        if (playerIdx !== room.currentTurnIndex) return socket.emit('errorMsg', 'មិនទាន់ដល់វេនអ្នកទេ!');
        if (!room.lastPlay) return socket.emit('errorMsg', 'មេដៃមិនអាច Pass បានទេ!');

        room.players[playerIdx].passed = true;
        handleTurnAndRoundStatus(room);

        io.to(socket.roomId).emit('turnChanged', {
            currentTurnIndex: room.currentTurnIndex,
            lastPlay: room.lastPlay,
            players: room.players
        });
    });

    function handlePlayerLeave(socketInstance) {
        const id = socketInstance.roomId;
        if (id && rooms[id]) {
            const room = rooms[id];
            const pIdx = room.players.findIndex(p => p.id === socketInstance.id);
            if (pIdx !== -1) {
                const leavingPlayerId = room.players[pIdx].id;
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
    console.log(`Server running on port ${PORT}`);
});