// =================================================================
// server.js (កំណែទម្រង់រួមបញ្ចូលគ្នា លេងលើទំព័រតែមួយ និងមានប៊ូតុង Start ដូចដើម)
// =================================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

// --- LOGIC ហ្គេមទៀនឡេន (TIEN LEN LOGIC) ---
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

    let isStr = true;
    for (let i = 1; i < len; i++) {
        if (CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-1].value) + 1) isStr = false;
        if (sorted[i].value === '2') isStr = false; 
    }

    if (isStr && len >= 3) return 'straight'; 
    return null;
}

function comparePlay(newCards, oldCards) {
    if (!oldCards || oldCards.length === 0) return true;
    
    const newType = getComboType(newCards);
    const oldType = getComboType(oldCards);
    if (!newType) return false;

    const newMax = getCardPower(sortCards([...newCards]).pop());
    const oldMax = getCardPower(sortCards([...oldCards]).pop());

    if (oldType === 'single' && oldCards[0].value === '2') {
        if (newType === 'bomb' || newType === 'quad_pair') return true;
    }

    if (oldType === 'bomb') {
        if (newType === 'bomb' && newMax > oldMax) return true;
        if (newType === 'quad_pair') return true;
    }

    if (oldType === 'quad_pair') {
        if (newType === 'quad_pair' && newMax > oldMax) return true;
    }

    if (oldType === 'triple_pair') {
        if (newType === 'triple_pair' && newMax > oldMax) return true;
        if (newType === 'bomb' || newType === 'quad_pair') return true;
    }

    if (newType === oldType && newCards.length === oldCards.length) {
        return newMax > oldMax;
    }

    return false;
}

// --- គ្រប់គ្រងវេនទៀនឡេន ---
function moveToNextActiveTurn(room) {
    let originalIndex = room.currentTurnIndex;
    let nextIndex = originalIndex;
    let found = false;

    for (let i = 1; i <= room.players.length; i++) {
        let checkIndex = (originalIndex + i) % room.players.length;
        let p = room.players[checkIndex];
        if (p && p.hand.length > 0 && !p.passed && !p.isSpectator) {
            nextIndex = checkIndex;
            found = true;
            break;
        }
    }
    if (found) {
        room.currentTurnIndex = nextIndex;
    }
}

function handleTienlenPassAndRound(room) {
    const stillPlayingAndNotPassed = room.players.filter(p => !p.isSpectator && p.hand.length > 0 && !p.passed);
    
    if (stillPlayingAndNotPassed.length <= 1) {
        room.playedCards = [];
        room.players.forEach(p => {
            if (p.hand.length > 0) p.passed = false;
        });

        let nextWinnerIndex = room.players.findIndex(p => p.id === room.lastPlayerId);
        if (nextWinnerIndex === -1 || room.players[nextWinnerIndex].hand.length === 0) {
            let originalIdx = room.currentTurnIndex;
            for (let i = 1; i <= room.players.length; i++) {
                let checkIdx = (originalIdx + i) % room.players.length;
                let checkP = room.players[checkIdx];
                if (checkP && checkP.hand.length > 0 && !checkP.isSpectator) {
                    nextWinnerIndex = checkIdx;
                    break;
                }
            }
        }

        room.currentTurnIndex = nextWinnerIndex !== -1 ? nextWinnerIndex : 0;
        io.to(room.roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
    } else {
        moveToNextActiveTurn(room);
    }
}

// --- Broadcast បញ្ជីបន្ទប់ ---
function broadcastRoomList() {
    const list = Object.keys(rooms).map(id => ({
        roomId: id,
        gameType: rooms[id].gameType,
        playerCount: rooms[id].players.length,
        status: rooms[id].status,
        hasPassword: rooms[id].password && rooms[id].password !== "" ? true : false
    }));
    io.emit('roomList', list);
}

// --- SOCKET CONNECTION ---
io.on('connection', (socket) => {
    broadcastRoomList();

    socket.on('createRoom', ({ roomId, password, playerName, gameType }) => {
        if (rooms[roomId]) {
            return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        }
        
        rooms[roomId] = {
            roomId: roomId,
            gameType: gameType || 'tienlen',
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
        
        const maxPlayers = room.gameType === 'catte' ? 6 : 4;
        if (room.players.length >= maxPlayers) return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

        const isSpectator = room.status === 'playing';

        room.players.push({ 
            id: socket.id, 
            name: playerName || 'Guest', 
            hand: [], 
            passed: false,
            isSpectator: isSpectator,
            rank: null
        });

        socket.join(roomId);
        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator, gameType: room.gameType });
        io.to(roomId).emit('updatePlayers', room.players);
        broadcastRoomList();
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.creatorId !== socket.id) return;

        room.players.forEach(p => {
            p.isSpectator = false;
            p.hand = [];
            p.passed = false;
            p.rank = null;
        });

        if (room.players.length < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់!');

        const deck = shuffleDeck(createDeck());
        room.status = 'playing'; 
        room.playedCards = [];
        room.lastPlayerId = null;
        room.nextRank = 1; 
        
        room.players.forEach((p, i) => {
            p.hand = sortCards(deck.slice(i * 13, (i + 1) * 13));
            io.to(p.id).emit('dealCards', { hand: p.hand, isSpectator: false });
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
            players: room.players, 
            currentTurnIndex: room.currentTurnIndex,
            lastRoundWinnerId: room.lastWinnerId
        });
        broadcastRoomList();
    });

    socket.on('playCard', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        
        if (!player || player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ');

        if (getComboType(cards) && comparePlay(cards, room.playedCards)) {
            cards.forEach(c => {
                const idx = player.hand.findIndex(pc => pc.value === c.value && pc.suit === c.suit);
                if (idx !== -1) player.hand.splice(idx, 1);
            });

            room.playedCards = cards;
            room.lastPlayerId = socket.id;
            player.passed = false; 

            if (player.hand.length === 0) {
                player.rank = room.nextRank;
                room.nextRank++;
                if (player.rank === 1) {
                    room.lastWinnerId = player.id;
                }
            }

            const remainingActivePlayers = room.players.filter(p => !p.isSpectator && p.hand.length > 0);

            if (remainingActivePlayers.length <= 1) {
                if (remainingActivePlayers.length === 1) {
                    remainingActivePlayers[0].rank = room.nextRank;
                }

                room.status = 'waiting'; 

                const results = room.players.map(p => ({ 
                    id: p.id,
                    name: p.name, 
                    remaining: [...p.hand], 
                    rank: p.rank
                }));

                io.to(roomId).emit('cardPlayed', { 
                    by: player.name, 
                    cards, 
                    nextTurn: room.currentTurnIndex,
                    cardCount: player.hand.length
                });

                setTimeout(() => {
                    const finalWinner = room.players.find(p => p.rank === 1);
                    io.to(roomId).emit('gameWon', { 
                        winner: finalWinner ? finalWinner.name : 'Unknown', 
                        winnerId: finalWinner ? finalWinner.id : null, 
                        allHands: results 
                    });
                    broadcastRoomList();
                }, 1000);

            } else {
                handleTienlenPassAndRound(room);
                io.to(roomId).emit('cardPlayed', { 
                    by: player.name, 
                    cards, 
                    nextTurn: room.currentTurnIndex,
                    cardCount: player.hand.length
                });
                io.to(roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
                io.to(roomId).emit('updatePlayers', room.players);
            }
        } else {
            socket.emit('errorMsg', 'ចុះមិនត្រូវក្បួន ឬបៀតូចជាង!');
        }
    });

    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return;

        player.passed = true;
        io.to(roomId).emit('playerPassed', { name: player.name, id: player.id });
        
        handleTienlenPassAndRound(room);
        io.to(roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
        io.to(roomId).emit('updatePlayers', room.players);
    });

    function handleUserLeave(socket) {
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
                        handleTienlenPassAndRound(room);
                    }
                    io.to(id).emit('updatePlayers', room.players);
                }
                broadcastRoomList();
                socket.emit('leftRoom');
                break;
            }
        }
    }

    socket.on('leaveRoom', () => { handleUserLeave(socket); });
    socket.on('disconnect', () => { handleUserLeave(socket); });
});

server.listen(3000, () => console.log('Server running on port 3000'));