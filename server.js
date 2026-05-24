// =================================================================
// server.js (កំណែទម្រង់ពេញលេញ - រួមបញ្ចូល Voice Chat, ច្បាប់ចាស់, ស៊ីដាច់ និងឈ្នះឌុប)
// =================================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingTimeout: 60000, // បង្កើនពេលវេលារង់ចាំរហូតដល់ 60 វិនាទី
    pingInterval: 25000 // ផ្ញើការសាកសួរ (Ping) រៀងរាល់ 25 វិនាទី
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

// អនុញ្ញាតឱ្យគិតគូរៀបចាប់ពី ៤ សន្លឹកឡើងទៅ (២ គូរៀប)
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

    // ស្គាល់ទាំង ២គូរៀប, ៣គូរៀប និង ៤គូរៀប
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

// 🛠️ មុខងារបន្ថែម៖ ពិនិត្យមើលលក្ខខណ្ឌបៀពិសេស (ឈ្នះស៊ុយ / ស៊ីសាច់ភ្លាមៗពេលចែកបៀ)
function checkInstantWin(hand) {
    if (!hand || hand.length !== 13) return null;
    const sorted = sortCards([...hand]);

    // ១. ករណីបៀមួយទឹកខ្សែនាគ (Straight ១៣ សន្លឹកពីលេខ ៣ ដល់ អាត់)
    let isDragonStraight = true;
    for (let i = 0; i < 12; i++) {
        if (CARD_ORDER.indexOf(sorted[i+1].value) !== CARD_ORDER.indexOf(sorted[i].value) + 1) {
            isDragonStraight = false;
            break;
        }
    }
    if (isDragonStraight) return "បៀមួយទឹកខ្សែនាគ (ស៊ុយដាច់)!";

    // ២. ករណីបៀសន្លឹកពណ៌ដូចគ្នាទាំងអស់ (ខ្មៅទាំងអស់ ឬ ក្រហមទាំងអស់)
    const isRed = (card) => card.suit === '♦' || card.suit === '♥';
    const isBlack = (card) => card.suit === '♠' || card.suit === '♣';
    if (hand.every(isRed) || hand.every(isBlack)) return "បៀមួយពណ៌ (ស៊ុយដាច់)!";

    // ៣. ករណីបៀមាន ៦ គូ (ឬច្រើនជាង)
    let pairCount = 0;
    let i = 0;
    while (i < 12) {
        if (sorted[i].value === sorted[i+1].value) {
            pairCount++;
            i += 2; 
        } else {
            i++;
        }
    }
    if (pairCount >= 6) return "បៀមាន ៦ គូ (ស៊ុយដាច់)!";

    // ៤. ករណីបៀមាន ២ ចំនួន ៤សន្លឹក (ប៊ុមលេខ ២)
    const twos = hand.filter(c => c.value === '2');
    if (twos.length === 4) return "ប៊ុមលេខ ២ ទាំងបួន (ស៊ុយដាច់)!";

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

    // ច្បាប់វាយកាត់បៀរ ២ ទោល (Single 2)
    if (oldType === 'single' && oldCards[0].value === '2') {
        if (newType === 'triple_pair' || newType === 'quad_pair' || newType === 'bomb') return true;
    }

    // ច្បាប់វាយកាត់បៀរគូ ២ (Pair 2) អនុញ្ញាតឱ្យ Bomb ស៊ីកាត់បាន
    if (oldType === 'pair' && oldCards[0].value === '2') {
        if (newType === 'quad_pair' || newType === 'bomb') return true;
    }

    // ច្បាប់ប៊ុម (Bomb) កាត់ប៊ុម ឬកាត់គូរៀប
    if (oldType === 'bomb') {
        if (newType === 'bomb' && newMax > oldMax) return true;
        if (newType === 'quad_pair') return true;
    }

    // ៣ គូណាត់ កាត់គ្នា ឬត្រូវប៊ុមកាត់
    if (oldType === 'triple_pair') {
        if (newType === 'triple_pair' && newMax > oldMax) return true;
        if (newType === 'quad_pair' || newType === 'bomb') return true;
    }

    // ៤ គូណាត់
    if (oldType === 'quad_pair') {
        if (newType === 'quad_pair' && newMax > oldMax) return true;
    }

    // ករណីប្រភេទ Combo ដូចគ្នា និងចំនួនសន្លឹកស្មើគ្នា គឺវាស់កម្លាំងសន្លឹកធំបំផុត
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

    socket.on('voice_signal', (data) => {
        io.to(data.target).emit('voice_signal', {
            sender: socket.id, 
            signal: data.signal
        });
    });

    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = rooms[roomId];
        if (!room) return; 
        
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

        const isSpectator = room.status === 'playing';

        socket.to(roomId).emit('voice_user_joined', { id: socket.id });

        room.players.forEach(existingPlayer => {
            socket.emit('voice_initiate_peer', { target: existingPlayer.id });
        });

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

        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
        broadcastRoomList();
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

        const activePlayers = room.players.filter(p => !p.isSpectator);
        if (activePlayers.length < 2) {
            return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់!');
        }

        const deck = shuffleDeck(createDeck());
        room.status = 'playing'; 
        room.playedCards = [];
        room.lastPlayerId = null;
        room.nextRank = 1; 
        
        room.players.forEach((p, i) => {
            p.hand = sortCards(deck.slice(i * 13, (i + 1) * 13));
        });

        // 🛠️ ច្បាប់បន្ថែម៖ ឆែករកមើលករណីមានអ្នក «ឈ្នះស៊ុយ / ស៊ីសាច់ភ្លាមៗ» ពេលចែកបៀរួច
        let instantWinner = null;
        let winReason = "";
        for (let p of activePlayers) {
            const reason = checkInstantWin(p.hand);
            if (reason) {
                instantWinner = p;
                winReason = reason;
                break;
            }
        }

        if (instantWinner) {
            instantWinner.rank = 1;
            room.lastWinnerId = instantWinner.id;
            let currentRank = 2;
            
            room.players.forEach(p => {
                if (!p.isSpectator && p.id !== instantWinner.id) {
                    p.rank = currentRank++;
                }
            });

            room.status = 'waiting';
            const results = room.players.map(p => ({ 
                id: p.id,
                name: p.name, 
                remaining: [...p.hand], 
                isSpectator: p.isSpectator,
                rank: p.rank
            }));

            io.to(roomId).emit('instantWinOccurred', {
                winnerName: instantWinner.name,
                reason: winReason,
                allHands: results
            });
            broadcastRoomList();
            return;
        }

        // បើគ្មានអ្នកឈ្នះស៊ុយទេ គឺផ្ញើបៀរទៅឱ្យលេងធម្មតា
        room.players.forEach((p) => {
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

            let isDoubleWin = false; // សញ្ញាសម្គាល់ការឈ្នះឌុប

            if (player.hand.length === 0) {
                player.rank = room.nextRank;
                room.nextRank++;
                
                if (player.rank === 1) {
                    room.lastWinnerId = player.id;
                    
                    // 🛠️ ច្បាប់បន្ថែម៖ ឆែករកករណីឈ្នះ «ឌុប» (អ្នកផ្សេងទៀតទាំងអស់សល់បៀ ១៣ សន្លឹកពេញ)
                    const opponents = room.players.filter(p => !p.isSpectator && p.id !== player.id);
                    const isAllOpponentsFullHand = opponents.every(p => p.hand.length === 13);
                    
                    if (isAllOpponentsFullHand) {
                        isDoubleWin = true;
                        opponents.forEach(opp => {
                            opp.rank = room.nextRank;
                            room.nextRank++;
                        });
                    }
                }
            }

            const remainingActivePlayers = room.players.filter(p => p.hand.length > 0);

            if (remainingActivePlayers.length <= 1 || isDoubleWin) {
                if (remainingActivePlayers.length === 1 && !isDoubleWin) {
                    remainingActivePlayers[0].rank = room.nextRank;
                }

                room.status = 'waiting'; 
 
                const results = room.players.map(p => ({ 
                    id: p.id,
                    name: p.name, 
                    remaining: [...p.hand], 
                    isSpectator: p.hand.length === 0 && p.rank !== null ? false : p.isSpectator,
                    rank: p.rank,
                    isDoubleLeaved: isDoubleWin && p.id !== player.id
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
                    room.lastWinnerId = finalWinner ? finalWinner.id : null;

                    io.to(roomId).emit('gameWon', { 
                        winner: finalWinner ? finalWinner.name : 'រកមិនឃើញ', 
                        winnerId: finalWinner ? finalWinner.id : null, 
                        allHands: results,
                        isDoubleWin: isDoubleWin
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

        player.passed = true;
        
        io.to(roomId).emit('playerPassed', { 
            name: player.name, 
            id: player.id,
            message: "Pass ❌ "
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
                const leavingPlayerId = socket.id;
                
                socket.to(id).emit('voice_user_left', { id: socket.id });

                room.players.splice(pIdx, 1);
                socket.leave(id); 
                socket.emit('leftRoom'); 

                if (room.players.length === 0) {
                    delete rooms[id]; 
                } else {
                    if (room.lastWinnerId === leavingPlayerId) {
                        const nextEligiblePlayer = room.players.find(p => !p.isSpectator);
                        if (nextEligiblePlayer) {
                            room.lastWinnerId = nextEligiblePlayer.id;
                            if (room.status !== 'playing') {
                                room.creatorId = nextEligiblePlayer.id;
                            }
                        } else {
                            room.lastWinnerId = null;
                        }
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
    });

    socket.on('disconnect', () => {
        for (const id in rooms) {
            const room = rooms[id];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            
            if (pIdx !== -1) {
                const wasSpectator = room.players[pIdx].isSpectator;
                const leavingPlayerId = socket.id;

                socket.to(id).emit('voice_user_left', { id: socket.id });

                room.players.splice(pIdx, 1);
                
                if (room.players.length === 0) {
                    delete rooms[id]; 
                } else {
                    if (room.lastWinnerId === leavingPlayerId) {
                        const nextEligiblePlayer = room.players.find(p => !p.isSpectator);
                        if (nextEligiblePlayer) {
                            room.lastWinnerId = nextEligiblePlayer.id;
                            if (room.status !== 'playing') {
                                room.creatorId = nextEligiblePlayer.id;
                            }
                        } else {
                            room.lastWinnerId = null;
                        }
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
    });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));