// =================================================================
// server.js (កំណែទម្រង់លេងរហូតដល់សល់ម្នាក់ចុងក្រោយ - រត់រលូនឥតខ្ចោះ)
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

    if (len === 4) {
        let is2Pair = true;
        if (sorted[0].value !== sorted[1].value) is2Pair = false;
        if (sorted[2].value !== sorted[3].value) is2Pair = false;
        
        const firstValIdx = CARD_ORDER.indexOf(sorted[0].value);
        const secondValIdx = CARD_ORDER.indexOf(sorted[2].value);
        
        if (secondValIdx !== firstValIdx + 1) is2Pair = false;
        if (sorted[2].value === '2') is2Pair = false;

        if (is2Pair) return 'double_pair';
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
    const newMax = getCardPower(sortCards([...newCards]).pop());
    const oldMax = getCardPower(sortCards([...oldCards]).pop());

    if (oldType === 'single' && oldCards[0].value === '2') {
        if (newType === 'double_pair' || newType === 'bomb' || newType === 'quad_pair') return true;
    }

    if (oldType === 'double_pair') {
        if (newType === 'double_pair' && newMax > oldMax) return true;
        if (newType === 'bomb' || newType === 'quad_pair') return true;
    }

    if (newType === oldType && newCards.length === oldCards.length) {
        return newMax > oldMax;
    }

    return false;
}

// មុខងាររួមបញ្ចូលគ្នា៖ ប្ដូរវេន និងពិនិត្យមើលការលាងតុ
function handleTurnAndRoundStatus(room) {
    // គណនាចំនួនអ្នកលេងដែលនៅមានបៀក្នុងដៃ ហើយមិនទាន់ចុច Pass
    const stillPlayingAndNotPassed = room.players.filter(p => !p.isSpectator && p.hand.length > 0 && !p.passed);
    
    // លក្ខខណ្ឌលាងតុ៖ បើសល់អ្នកអាចស៊ីបានតែម្នាក់គត់ ឬគ្មានសោះ
    if (stillPlayingAndNotPassed.length <= 1) {
        room.playedCards = [];
        
        // ឱ្យអ្នកលេងដែលនៅសល់បៀទាំងអស់បាត់ជាប់ Pass ឡើងវិញ
        room.players.forEach(p => {
            if (p.hand.length > 0) p.passed = false;
        });

        // ស្វែងរកអ្នកដែលបានចុះបៀចុងក្រោយគេបង្អស់ឱ្យឡើងមកកាន់តុថ្មី
        let nextWinnerIndex = room.players.findIndex(p => p.id === room.lastPlayerId);
        
        // ប្រសិនបើអ្នកចុះចុងក្រោយគេនោះគាត់អស់បៀរល្មម (ឈ្នះដាច់ជុំ) ត្រូវផ្ទេរវេនទៅឱ្យអ្នកបន្ទាប់ដែលនៅសល់បៀរក្បែរគាត់
        if (nextWinnerIndex === -1 || room.players[nextWinnerIndex].hand.length === 0) {
            let originalIdx = room.currentTurnIndex;
            for (let i = 1; i <= room.players.length; i++) {
                let checkIdx = (originalIdx + i) % room.players.length;
                let checkP = room.players[checkIdx];
                if (checkP && !checkP.isSpectator && checkP.hand.length > 0) {
                    nextWinnerIndex = checkIdx;
                    break;
                }
            }
        }

        room.currentTurnIndex = nextWinnerIndex !== -1 ? nextWinnerIndex : 0;
        io.to(room.roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
    } else {
        // បើមិនទាន់លាងតុទេ ត្រូវរំលងវេនទៅអ្នកបន្ទាប់ដែលមិនទាន់ Pass និងនៅសល់បៀ
        let originalIndex = room.currentTurnIndex;
        let nextIndex = originalIndex;
        let found = false;

        for (let i = 1; i <= room.players.length; i++) {
            let checkIndex = (originalIndex + i) % room.players.length;
            let p = room.players[checkIndex];
            if (p && !p.isSpectator && !p.passed && p.hand.length > 0) {
                nextIndex = checkIndex;
                found = true;
                break;
            }
        }

        if (found) {
            room.currentTurnIndex = nextIndex;
        }
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

        room.players.push({ 
            id: socket.id, 
            name: playerName || 'Guest', 
            hand: [], 
            passed: false,
            isSpectator: isSpectator,
            rank: null
        });

        socket.join(roomId);
        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator });
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

        const playerCount = room.players.length;
        if (playerCount < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់!');

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
            players: room.players, 
            currentTurnIndex: room.currentTurnIndex 
        });
        broadcastRoomList();
    });

// ចុះបៀ (លុបផ្នែកជាន់គ្នា និងជួសជុល Syntax ស្អាតល្អ)
    socket.on('playCard', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        
        if (!player || player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ');
        if (player.isSpectator) return socket.emit('errorMsg', 'អ្នកជាអ្នកមើលរង់ចាំវគ្គក្រោយ មិនអាចចុះបៀបានទេ!');

        // ពិនិត្យថាតើបៀដែលចុះត្រូវតាមក្បួន និងធំជាងបៀនៅលើតុដែរឬទេ
        if (getComboType(cards) && comparePlay(cards, room.playedCards)) {
            // ដកបៀដែលបានលេងចេញពីដៃរបស់អ្នកលេង
            cards.forEach(c => {
                const idx = player.hand.findIndex(pc => pc.value === c.value && pc.suit === c.suit);
                if (idx !== -1) player.hand.splice(idx, 1);
            });

            room.playedCards = cards;
            room.lastPlayerId = socket.id;
            player.passed = false; 

            // ស្វែងរកអ្នកលេងដែលអស់បៀមុនគេ
            const activePlayers = room.players.filter(p => !p.isSpectator);
            const winner = activePlayers.find(p => p.hand.length === 0);

            if (winner) {
                room.status = 'waiting'; 
                room.lastWinnerId = winner.id; // 💾 កត់ត្រាទុក ID អ្នកឈ្នះ ដើម្បីឱ្យគាត់ចុះមុនគេនៅជុំបន្ទាប់

                // 🎯 ចាប់យកទិន្នន័យបៀដែលនៅសល់ក្នុងដៃរបស់គ្រប់គ្នាឱ្យបានច្បាស់លាស់ (ដំណោះស្រាយមិនឱ្យបាត់បៀ)
                const results = room.players.map(p => ({ 
                    id: p.id,
                    name: p.name, 
                    remaining: [...p.hand], // ចម្លងសន្លឹកបៀដែលនៅសល់ពិតប្រាកដមកទុក
                    isSpectator: p.isSpectator 
                }));
                
                // ផ្ញើព្រឹត្តិការណ៍ cardPlayed ទៅតុជុំចុងក្រោយសិន ដើម្បីឱ្យកាតចុងក្រោយលោតបង្ហាញលើតុ
                io.to(roomId).emit('cardPlayed', { 
                    by: player.name, 
                    cards, 
                    nextTurn: room.currentTurnIndex,
                    cardCount: player.hand.length,
                    updatedHands: room.players 
                });

                // រង់ចាំ ១.៥ វិនាទី ទើបបង្ហាញផ្ទាំងលទ្ធផលឈ្នះចាញ់ ដើម្បីកុំឱ្យដាច់អារម្មណ៍លឿនពេក
                setTimeout(() => {
                    io.to(roomId).emit('gameWon', { 
                        winner: winner.name, 
                        winnerId: winner.id, 
                        allHands: results 
                    });
                    broadcastRoomList();
                }, 1500);

            } else {
                // ប្រសិនបើមិនទាន់មានអ្នកឈ្នះទេ ត្រូវប្ដូរវេនទៅអ្នកបន្ទាប់
                moveToNextTurn(room);
                io.to(roomId).emit('cardPlayed', { 
                    by: player.name, 
                    cards, 
                    nextTurn: room.currentTurnIndex,
                    cardCount: player.hand.length,
                    updatedHands: room.players 
                });
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
        
        io.to(roomId).emit('playerPassed', { 
            name: player.name, 
            id: player.id,
            message: "តោះខ្ញុំអត់ស៊ីទេ"
        });
        
        // រត់ Logic ប្ដូរវេន ឬលាងតុ
        handleTurnAndRoundStatus(room);
        io.to(roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
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

server.listen(3000, () => console.log('Server is running on port 3000'));