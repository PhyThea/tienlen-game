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
    return (CARD_ORDER.indexOf(card.value) * 10) + SUIT_ORDER[card.suit];
}

function sortCards(cards) {
    return cards.sort((a, b) => getCardPower(a) - getCardPower(b));
}

// មុខងារជំនួយ៖ ពិនិត្យមើលថាតើបៀរជា "ផែអោប" (គូស៊េរីជាប់គ្នា) ឬអត់?
function isConsecutivePairs(cards) {
    const len = cards.length;
    if (len < 4 || len % 2 !== 0) return false; // យ៉ាងហោចណាស់ ២ផែ (៤សន្លឹក) ឡើងទៅ
    
    const sorted = sortCards([...cards]);
    
    // ១. ពិនិត្យមើលថាវាជាគូៗពិតមែនឬអត់
    for (let i = 0; i < len; i += 2) {
        if (sorted[i].value !== sorted[i+1].value) return false;
    }
    
    // ២. ពិនិត្យមើលថាតើតម្លៃគូនីមួយៗវាជាប់គ្នា ឬអត់
    for (let i = 0; i < len - 2; i += 2) {
        const currentIdx = CARD_ORDER.indexOf(sorted[i].value);
        const nextIdx = CARD_ORDER.indexOf(sorted[i+2].value);
        
        if (sorted[i].value === '2' || sorted[i+2].value === '2') return false;
        if (nextIdx !== currentIdx + 1) return false;
    }
    
    return true;
}

// ✅ បានកែសម្រួល៖ មុខងារពិនិត្យប្រភេទបៀរឱ្យត្រឹមត្រូវ ១០០%
function getComboType(cards) {
    const len = cards.length;
    if (len === 0) return null;
    if (len === 1) return 'single';
    
    const sorted = sortCards([...cards]);
    const sameValue = cards.every(c => c.value === cards[0].value);
    
    if (sameValue) {
        if (len === 2) return 'pair';
        if (len === 3) return 'triple'; // កូយ
        if (len === 4) return 'bomb';   // ការ៉េ
    }

    // ឆែកមើល ផែអោបជាប់គ្នា (២ផែ, ៣ផែ, ៤ផែ...)
    if (isConsecutivePairs(cards)) {
        if (len === 4) return 'double_pair'; // ២ ផែអោប
        if (len === 6) return 'triple_pair'; // ៣ ផែអោប
        if (len === 8) return 'quad_pair';   // ៤ ផែអោប
        return 'consec_pairs';
    }

    // ឆែកខ្សែ (Straight / ឡៅ) តែក្នុងករណីមានបៀរចាប់ពី ៣ សន្លឹកឡើងទៅប៉ុណ្ណោះ
    if (len >= 3) {
        let isStr = true;
        for (let i = 1; i < len; i++) {
            if (CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-1].value) + 1) isStr = false;
            if (sorted[i].value === '2') isStr = false; // លេខ ២ មិនអាចចូលខ្សែបានទេ
        }
        if (isStr) {
            const sameSuit = cards.every(c => c.suit === cards[0].suit);
            if (sameSuit) return 'straight_flush'; 
            return 'straight'; 
        }
    }

    return null;
}

// ✅ បានកែសម្រួល៖ មុខងារប្រៀបធៀបបៀរលេងនៅលើតុ
function comparePlay(newCards, oldCards) {
    const newType = getComboType(newCards);
    if (!newType) return false; // បៀរថ្មីមិនត្រូវក្បួនច្បាប់

    // បើតុទំនេរ គឺអាចចុះបានទាំងអស់ឱ្យតែត្រូវតាមក្បួនបៀរដែលឆែកខាងលើរួច
    if (!oldCards || oldCards.length === 0) return true;
    
    const oldType = getComboType(oldCards);
    const newMax = getCardPower(sortCards([...newCards]).pop());
    const oldMax = getCardPower(sortCards([...oldCards]).pop());

    // =================================================================
    // 👑 ច្បាប់ពិសេស៖ ការកាត់ហាយ (Chop Rules) 👑
    // =================================================================

    // ១. បើនៅលើតុជាបៀរ ហាយទោល (សន្លឹក ២ មួយសន្លឹក)
    if (oldType === 'single' && oldCards[0].value === '2') {
        if (newType === 'triple_pair' || newType === 'quad_pair' || newType === 'bomb') return true;
    }

    // ២. បើនៅលើតុជាបៀរ គូហាយ (សន្លឹក ២ មួយគូ)
    if (oldType === 'pair' && oldCards[0].value === '2') {
        if (newType === 'quad_pair' || newType === 'bomb') return true;
    }

    // ៣. បើនៅលើតុជា ការ៉េ (Bomb)
    if (oldType === 'bomb') {
        if (newType === 'bomb' && newMax > oldMax) return true;
        if (newType === 'quad_pair') return true;
    }

    // ៤. បើនៅលើតុជា ៣ផែជាប់គ្នា (Triple Pair)
    if (oldType === 'triple_pair') {
        if (newType === 'triple_pair' && newMax > oldMax) return true;
        if (newType === 'quad_pair' || newType === 'bomb') return true;
    }

    // ៥. បើនៅលើតុជា ៤ផែជាប់គ្នា (Quad Pair)
    if (oldType === 'quad_pair') {
        if (newType === 'quad_pair' && newMax > oldMax) return true;
    }

    // =================================================================
    // ករណីលេងធម្មតា (ប្រភេទក្បាច់ដូចគ្នា និងចំនួនសន្លឹកស្មើគ្នា)
    // =================================================================
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
    const stillPlayingAndNotPassed = room.players.filter(p => p.hand.length > 0 && !p.passed);
    
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
                if (checkP && checkP.hand.length > 0) {
                    nextWinnerIndex = checkIdx;
                    break;
                }
            }
        }

        room.currentTurnIndex = nextWinnerIndex !== -1 ? nextWinnerIndex : 0;
        io.to(room.roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
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
        if (player.hand.length === 0) return socket.emit('errorMsg', 'អ្នកអស់បៀហើយ មិនអាចចុះបានទៀតទេ!');

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

            const remainingActivePlayers = room.players.filter(p => p.hand.length > 0);

            if (remainingActivePlayers.length <= 1) {
                if (remainingActivePlayers.length === 1) {
                    remainingActivePlayers[0].rank = room.nextRank;
                }

                room.status = 'waiting'; 

                const results = room.players.map(p => ({ 
                    id: p.id,
                    name: p.name, 
                    remaining: [...p.hand], 
                    isSpectator: p.hand.length === 0 && p.rank !== null ? false : p.isSpectator,
                    rank: p.rank
                }));

                io.to(roomId).emit('cardPlayed', { 
                    by: player.name, 
                    cards, 
                    nextTurn: room.currentTurnIndex,
                    cardCount: player.hand.length,
                    updatedHands: room.players 
                });

                setTimeout(() => {
                    const finalWinner = room.players.find(p => p.rank === 1);
                    io.to(roomId).emit('gameWon', { 
                        winner: finalWinner ? finalWinner.name : 'រកមិនឃើញ', 
                        winnerId: finalWinner ? finalWinner.id : null, 
                        allHands: results 
                    });
                    broadcastRoomList();
                }, 1500);

            } else {
                handleTurnAndRoundStatus(room);

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

        if (room.playedCards.length === 0 || room.lastPlayerId === socket.id) {
            return socket.emit('errorMsg', 'អ្នកជាម្ចាស់បៀរលើតុ មិនអាចចុចរំលង (Pass) បានឡើយ! សូមចុះបៀរថ្មី។');
        }

        player.passed = true;
        
        io.to(roomId).emit('playerPassed', { 
            name: player.name, 
            id: player.id,
            message: "Pass ❌"
        });
        
        handleTurnAndRoundStatus(room);
        
        io.to(roomId).emit('turnChanged', { 
            currentTurnIndex: room.currentTurnIndex,
            players: room.players
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

server.listen(3000, () => console.log('Server is running on port 3000'));