// =================================================================
// server.js (កំណែទម្រង់ថ្មី៖ រួមបញ្ចូលច្បាប់ហ្គេម + Voice Chat RAW PCM + ការគ្រប់គ្រង Player ពេញលេញ)
// =================================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // បង្កើនទំហំ Buffer សម្រាប់សំឡេង
});

app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const rooms = {};

// --- ច្បាប់បៀរ (Card Logic) ---
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
    
    // Check pairs
    for (let i = 0; i < len; i += 2) {
        if (sorted[i].value !== sorted[i+1].value) return false;
    }

    // Check consecutive
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

    // Special Rules for beating 2s
    if (oldType === 'single' && oldCards[0].value === '2') {
        if (newType === 'triple_pair' || newType === 'quad_pair' || newType === 'bomb') return true;
    }

    if (oldType === 'pair' && oldCards[0].value === '2') {
        if (newType === 'quad_pair' || newType === 'bomb') return true;
    }

    // Bomb rules
    if (oldType === 'bomb') {
        if (newType === 'bomb' && newMax > oldMax) return true;
        if (newType === 'quad_pair') return true; // Quad pair beats bomb (optional rule, adjust as needed)
        return false;
    }

    // Triple Pair rules
    if (oldType === 'triple_pair') {
        if (newType === 'triple_pair' && newMax > oldMax) return true;
        if (newType === 'quad_pair' || newType === 'bomb') return true;
        return false;
    }

    // Quad Pair rules
    if (oldType === 'quad_pair') {
        if (newType === 'quad_pair' && newMax > oldMax) return true;
        return false;
    }

    // Standard comparison
    if (newType === oldType && newCards.length === oldCards.length) {
        return newMax > oldMax;
    }

    return false;
}

// --- មុខងារគ្រប់គ្រងវេន (Turn Management) ---
function moveToNextTurn(room) {
    let originalIndex = room.currentTurnIndex;
    let nextIndex = originalIndex;
    let found = false;
    
    for (let i = 1; i <= room.players.length; i++) {
        let checkIndex = (originalIndex + i) % room.players.length;
        let p = room.players[checkIndex];
        // រកអ្នកលេងដែលនៅសល់បៀ និងមិនទាន់ Pass
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
    
    // ពិនិត្យមើលថាតើអ្នកចុះចុងក្រោយអស់បៀហើយឬនៅ
    const isLastPlayerOut = (lastPlayerIdx !== -1 && room.players[lastPlayerIdx].hand.length === 0);
    
    // ប្រសិនបើអ្នកចុងក្រោយអស់បៀ ហើយគ្មានអ្នកណាសល់ទៀតទេ -> បញ្ចប់ Round
    // ឬ ប្រសិនបើមានអ្នកសល់តែ ១ នាក់ (អ្នកដទៃ Pass អស់) -> បញ្ចប់ Round
    const isRoundOver = isLastPlayerOut ? (activePlayersInRound.length === 0) : (activePlayersInRound.length <= 1);

    if (isRoundOver) {
        // Reset for new round
        room.playedCards = [];
        room.players.forEach(p => {
            if (p.hand.length > 0) p.passed = false;
        });

        let nextStarterIndex;
        
        if (isLastPlayerOut) {
            // អ្នកដែលអស់បៀមុនគេ បានចុះចុងក្រោយ អ្នកបន្ទាប់ពីគាត់គឺជាអ្នកចាប់ផ្តើម
            nextStarterIndex = (lastPlayerIdx + 1) % room.players.length;
            while (room.players[nextStarterIndex].hand.length === 0) {
                nextStarterIndex = (nextStarterIndex + 1) % room.players.length;
            }
        } else {
            // ករណីអ្នកដទៃ Pass អស់ អ្នកដែលសល់គឺជាអ្នកឈ្នះ Round នេះ ហើយគាត់ចាប់ផ្តើម Round បន្ទាប់
            nextStarterIndex = lastPlayerIdx !== -1 ? lastPlayerIdx : room.currentTurnIndex;
        }

        room.currentTurnIndex = nextStarterIndex;
        room.lastPlayerId = room.players[nextStarterIndex].id; // Set last player to the starter of next round logically or keep null? Usually starter becomes last valid player context.

        io.to(room.roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
        io.to(room.roomId).emit('turnChanged', { 
            currentTurnIndex: room.currentTurnIndex,
            players: room.players 
        });
    } else {
        moveToNextTurn(room);
        io.to(room.roomId).emit('turnChanged', { 
            currentTurnIndex: room.currentTurnIndex 
        });
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

// --- មុខងារគ្រប់គ្រងអ្នកលេងចាកចេញ (Player Leave Logic) ---
function handlePlayerLeave(socketInstance) {
    const leavingPlayerId = socketInstance.id;
    for (const id in rooms) {
        const room = rooms[id];
        const pIdx = room.players.findIndex(p => p.id === leavingPlayerId);
        
        if (pIdx !== -1) {
            const wasSpectator = room.players[pIdx].isSpectator;
            room.players.splice(pIdx, 1);
            socketInstance.leave(id);

            // ប្រសិនបើបន្ទប់ទទេ លុបបន្ទប់ចោល
            if (room.players.length === 0) {
                delete rooms[id];
            } else {
                // ផ្ទេរសិទ្ធិ Last Winner ប្រសិនបើអ្នកឈ្នះចាកចេញ
                if (room.lastWinnerId === leavingPlayerId) {
                    // រកអ្នកលេងដែលមិនមែនជា Spectator ដើម្បីផ្ទេរសិទ្ធិ
                    const nextEligible = room.players.find(p => !p.isSpectator);
                    room.lastWinnerId = nextEligible ? nextEligible.id : room.players[0].id;
                }

                // ផ្ទេរសិទ្ធិ Creator ប្រសិនបើ Host ចាកចេញ
                if (room.creatorId === leavingPlayerId && room.players.length > 0) {
                    room.creatorId = room.players[0].id;
                }

                // ប្រសិនបើហ្គេមកំពុងលេង ហើយអ្នកចាកចេញគឺជាវេនបច្ចុប្បន្ន
                if (room.status === 'playing' && !wasSpectator && room.currentTurnIndex === pIdx) {
                    // ត្រូវកែ Index បន្ទាប់ពី Splice (ព្រោះ Array ខ្លីជាងមុន 1)
                    // ប៉ុន្តែ handleTurnAndRoundStatus នឹងគណនារកអ្នកបន្ទាប់ដោយស្វ័យប្រវត្តិ
                    // យើងគ្រាន់តែត្រូវការ Update ថាវេនបច្ចុប្បន្នគឺអ្នកណា (ដែលបច្ចុប្បន្នវាខុសហើយព្រោះ Index ផ្លាស់ប្តូរ)
                    
                    // កំណត់វេនថ្មី (ប្រសិនបើអ្នកចាកចេញគឺជាវេនចុងក្រោយនៃ Array វេននឹងត្រឡប់ទៅ 0 ឬអ្នកបន្ទាប់)
                    // វិធីល្អបំផុតគឺហៅ handleTurnAndRoundStatus ដើម្បីរកអ្នកបន្ទាប់ដែល Valid
                    handleTurnAndRoundStatus(room);
                }
                
                // ផ្ញើព័ត៌មានបច្ចុប្បន្នភាពទៅ Client
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

// --- Socket.IO Connection ---
io.on('connection', (socket) => {
    broadcastRoomList();

    // 1. Create Room
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

    // 2. Join Room
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

        socket.emit('roomJoined', { 
            roomId, 
            playerId: socket.id, 
            isSpectator, 
            playedCards: room.playedCards, 
            currentTurnIndex: room.currentTurnIndex 
        });
        
        io.to(roomId).emit('updatePlayers', room.players);
        broadcastRoomList();
    });

    // 3. Voice Chat (RAW PCM Relay)
    socket.on('audio_packet', (data) => {
        if (data && data.roomId) {
            // បញ្ជូនសំឡេងទៅអ្នកលេងផ្សេងទៀតក្នុងបន្ទប់ (លើកលែងតែអ្នកផ្ញើ)
            socket.to(data.roomId).emit('audio_broadcast', {
                from: socket.id,
                buffer: data.buffer
            });
        }
    });

    // 4. Start Game
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        // ពិនិត្យសិទ្ធិចាប់ផ្តើមហ្គេម
        if (!room.lastWinnerId) {
            if (room.creatorId !== socket.id) {
                return socket.emit('errorMsg', 'មានតែម្ចាស់បន្ទប់ទេដែលអាចចាប់ផ្ដើមហ្គេមបាន!');
            }
        } else {
            if (room.lastWinnerId !== socket.id) {
                return socket.emit('errorMsg', 'មានតែអ្នកជាប់លេខ ១ ទេ ដែលអាចចុចចាប់ផ្ដើមវគ្គថ្មីបាន!');
            }
        }

        // Reset Players
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

        // Deal Cards
        room.players.forEach((p, i) => {
            p.hand = sortCards(deck.slice(i * 13, (i + 1) * 13));
            io.to(p.id).emit('dealCards', { hand: p.hand });
        });

        // Find Starting Player (3 Spades or Last Winner)
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
            players: room.players.map(p => ({ 
                id: p.id, 
                name: p.name, 
                cardCount: p.hand.length, 
                passed: p.passed, 
                isSpectator: p.isSpectator, 
                rank: p.rank 
            })),
            currentTurnIndex: room.currentTurnIndex,
            lastRoundWinnerId: room.lastWinnerId
        });
        broadcastRoomList();
    });

    // 5. Play Cards
    socket.on('playCards', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        const playerIdx = room.players.findIndex(p => p.id === socket.id);
        if (playerIdx !== room.currentTurnIndex) return socket.emit('errorMsg', 'មិនមែនជាវេនរបស់អ្នកទេ!');

        const player = room.players[playerIdx];

        // Validate Cards in Hand
        const hasAllCards = cards.every(c => player.hand.some(h => h.value === c.value && h.suit === c.suit));
        if (!hasAllCards) return socket.emit('errorMsg', 'សន្លឹកបៀរមិនត្រឹមត្រូវ!');

        const isNewRound = room.playedCards.length === 0;

        // Rule: First turn of game must have 3 Spades
        if (isNewRound) {
            const isFirstTurnOfGame = room.nextRank === 1 && room.players.every(p => p.rank === null);
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

        // Remove cards from hand
        player.hand = player.hand.filter(h => !cards.some(c => c.value === h.value && c.suit === h.suit));
        room.playedCards = cards;
        room.lastPlayerId = socket.id;

        socket.emit('playSuccess');
        io.to(roomId).emit('updateTable', { cards: room.playedCards, lastPlayerName: player.name });

        // Check Win Condition
        if (player.hand.length === 0) {
            player.rank = room.nextRank;
            room.nextRank++;

            io.to(roomId).emit('showBubbleMessage', { playerId: player.id, message: `🏆 លេខ ${player.rank}!` });

            const remainingActive = room.players.filter(p => p.hand.length > 0 && !p.isSpectator);
            
            // If only 1 or 0 players remain with cards
            if (remainingActive.length <= 1) {
                if (remainingActive.length === 1) {
                    remainingActive[0].rank = room.nextRank;
                }

                const firstPlacePlayer = room.players.find(p => p.rank === 1);
                room.lastWinnerId = firstPlacePlayer ? firstPlacePlayer.id : room.creatorId;

                room.status = 'waiting'; // End Game State
                
                io.to(roomId).emit('gameOver', {
                    winner: firstPlacePlayer ? firstPlacePlayer.name : 'Unknown',
                    ranks: room.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        rank: p.rank,
                        isSpectator: p.isSpectator,
                        cardsLeft: p.hand.length,
                        hand: p.hand // Send hand to show results
                    }))
                });
                
                io.to(roomId).emit('updatePlayers', room.players);
                broadcastRoomList();
                return;
            }
        }

        handleTurnAndRoundStatus(room);
        
        io.to(roomId).emit('updatePlayers', room.players.map(p => ({ 
            id: p.id, 
            name: p.name, 
            cardCount: p.hand.length, 
            passed: p.passed, 
            isSpectator: p.isSpectator, 
            rank: p.rank 
        })));
    });

    // 6. Pass Turn
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

        io.to(roomId).emit('updatePlayers', room.players.map(p => ({ 
            id: p.id, 
            name: p.name, 
            cardCount: p.hand.length, 
            passed: p.passed, 
            isSpectator: p.isSpectator, 
            rank: p.rank 
        })));
    });

    // 7. Leave / Disconnect
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