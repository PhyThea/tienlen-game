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
    const stillPlayingAndNotPassed = room.players.filter(p => p.hand.length > 0 && !p.passed);
    
    let lastPlayerIdx = room.players.findIndex(p => p.id === room.lastPlayerId);
    const isLastPlayerOut = lastPlayerIdx !== -1 && room.players[lastPlayerIdx].hand.length === 0;

    const isRoundOver = isLastPlayerOut ? (stillPlayingAndNotPassed.length === 0) : (stillPlayingAndNotPassed.length <= 1);

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
        } else {
            room.currentTurnIndex = lastPlayerIdx !== -1 ? lastPlayerIdx : room.currentTurnIndex;
        }

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

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        // ១. ពិនិត្យលក្ខខណ្ឌ៖ បើជាវគ្គដំបូង (មិនទាន់មានអ្នកឈ្នះចាស់) មានតែអ្នកបង្កើតបន្ទប់ (Creator) ទេទើបចុចបាន
        if (!room.lastWinnerId) {
            if (room.creatorId !== socket.id) {
                return socket.emit('errorMsg', 'មានតែមេបន្ទប់ (Host) ទេទើបអាចចាប់ផ្ដើមហ្គេមដំបូងបាន!');
            }
        } 
        // ២. បើមានវគ្គបន្ទាប់ (មានអ្នកឈ្នះចាស់) មានតែអ្នកឈ្នះលេខ ១ វគ្គមុនទេទើបចុចបាន
        else {
            if (room.lastWinnerId !== socket.id) {
                return socket.emit('errorMsg', 'មានតែអ្នកឈ្នះវគ្គមុនទេ ទើបមានសិទ្ធិចាប់ផ្ដើមវគ្គថ្មីបាន!');
            }
        }

        // --- កូដចែកបៀរ និង setup ហ្គេមចាស់របស់អ្នក (ឧទាហរណ៍ខាងក្រោម) ---
        room.status = 'playing';
        // រៀបចំបោកបៀរ ចែកបៀរ និងកំណត់វេនលេង...
        // ...
        
        // ⚠️ ចំណុចសំខាន់៖ ពេល emit 'gameStarted' ត្រូវប្រាកដថាផ្ញើ lastRoundWinnerId ទៅឱ្យ Client ផង
        io.to(roomId).emit('gameStarted', {
            players: room.players,
            currentTurnIndex: room.currentTurnIndex,
            lastRoundWinnerId: room.lastWinnerId // បញ្ជូន variable នេះទៅ Client
        });
        
        broadcastRoomList();
    });
    // server.js (ជំនួសផ្នែក joinRoom និង startGame)

    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់នេះទេ!');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

        const isSpectator = room.status === 'playing';

        const newPlayer = { 
            id: socket.id, 
            name: playerName || 'Guest', 
            hand: [], 
            passed: false,
            isSpectator: isSpectator,
            rank: null
        };

        room.players.push(newPlayer);

        socket.join(roomId);
        
        // ផ្ញើទិន្នន័យត្រឡប់ទៅអ្នកលេងថ្មី
        socket.emit('roomJoined', { 
            roomId, 
            playerId: socket.id, 
            isSpectator,
            // បន្ថែម៖ ផ្ញើស្ថានភាពបច្ចុប្បន្នរបស់បន្ទប់
            currentTurnIndex: room.currentTurnIndex,
            playedCards: room.playedCards,
            lastPlayerId: room.lastPlayerId,
            status: room.status
        });

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
            // ផ្ញើបៀទៅកាន់អ្នកលេងម្នាក់ៗ
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

        // ផ្ញើសញ្ញាចាប់ផ្តើមហ្គេមទៅគ្រប់គ្នា
        io.to(roomId).emit('gameStarted', { 
            players: room.players, 
            currentTurnIndex: room.currentTurnIndex,
            lastRoundWinnerId: room.lastWinnerId,
            playedCards: [] // ប្រាកដថាតុទទេនៅពេលចាប់ផ្តើម
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
                let lastTurnIdx = room.currentTurnIndex;
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