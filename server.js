// =================================================================
// server.js (រួមបញ្ចូលគ្នា Tien Len និង Catte រត់រលូនឥតខ្ចោះ)
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

// ច្បាប់លំដាប់កាតេ៖ 2 តូចជាងគេ, A ធំជាងគេ
const CATTE_ORDER = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

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

function getCattePower(card) {
    return CATTE_ORDER.indexOf(card.value);
}

function sortCards(cards, gameMode = 'tienlen') {
    if (gameMode === 'catte') {
        return cards.sort((a, b) => {
            if (SUIT_ORDER[a.suit] !== SUIT_ORDER[b.suit]) {
                return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
            }
            return getCattePower(a) - getCattePower(b);
        });
    }
    return cards.sort((a, b) => getCardPower(a) - getCardPower(b));
}

function getComboType(cards) {
    const len = cards.length;
    if (len === 0) return null;
    if (len === 1) return 'single';
    
    const sorted = sortCards([...cards], 'tienlen');
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
    const newMax = getCardPower(sortCards([...newCards], 'tienlen').pop());
    const oldMax = getCardPower(sortCards([...oldCards], 'tienlen').pop());

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
        
        if (room.gameMode === 'catte') {
            // សម្រាប់កាតេ៖ អ្នកមិនទាន់ងាប់ (មានបៀក្នុងដៃ) ទើបអាចលេងបាន
            if (p && p.hand.length > 0) {
                nextIndex = checkIndex;
                found = true;
                break;
            }
        } else {
            // សម្រាប់លីនលែន
            if (p && p.hand.length > 0 && !p.passed) {
                nextIndex = checkIndex;
                found = true;
                break;
            }
        }
    }
    if (found) {
        room.currentTurnIndex = nextIndex;
    }
}

function handleTurnAndRoundStatus(room) {
    if (room.gameMode === 'catte') {
        room.catteTurnCount++;
        // ចប់មួយជុំ (គ្រប់ចំនួនអ្នកលេងដែលនៅមានបៀរ)
        const activePlayersCount = room.players.filter(p => p.hand.length + p.burnedCards.length + p.wonRoundsCards.length > 0).length;
        
        if (room.catteTurnCount >= activePlayersCount) {
            // រកអ្នកឈ្នះក្នុងជុំនេះ (បៀរវាយចេញធំជាងគេ និងត្រូវទឹក)
            let winPlay = room.catteRoundPlays.reduce((maxPlay, currPlay) => {
                if (!maxPlay) return currPlay;
                if (currPlay.card.suit === maxPlay.card.suit && getCattePower(currPlay.card) > getCattePower(maxPlay.card)) {
                    return currPlay;
                }
                return maxPlay;
            }, null);

            if (winPlay) {
                const winner = room.players.find(p => p.id === winPlay.playerId);
                winner.wonRoundsCards.push(winPlay.card);
                room.lastPlayerId = winner.id;
                room.currentTurnIndex = room.players.findIndex(p => p.id === winner.id);
            }

            room.catteRoundCount++;
            room.catteTurnCount = 0;
            room.catteRoundPlays = [];
            room.playedCards = [];

            // ប្រសិនបើលេងគ្រប់ ៤ ទឹកហើយ
            if (room.catteRoundCount === 4) {
                // អ្នកអត់មានឈ្នះសោះក្នុង ៤ ទឹក ត្រូវងាប់ (Rank ចុងក្រោយ)
                room.players.forEach(p => {
                    if (p.wonRoundsCards.length === 0 && !p.isSpectator) {
                        p.hand = []; // អស់សិទ្ធចូលវគ្គ ៥ ៦
                    }
                });

                const qualifed = room.players.filter(p => p.wonRoundsCards.length > 0);
                if (qualifed.length <= 1) {
                    endCatteGame(room);
                    return;
                }
            }

            // ប្រសិនបើលេងដល់ទឹក ៥ ឬ ៦ (វគ្គខាំ និងផ្កាប់ទម្លាក់)
            if (room.catteRoundCount >= 6) {
                endCatteGame(room);
                return;
            }

            io.to(room.roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
        } else {
            moveToNextTurn(room);
        }
    } else {
        // សម្រាប់ Tien Len
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
}

function endCatteGame(room) {
    room.status = 'waiting';
    // រកអ្នកឈ្នះទឹកទី ៦ ឬអ្នកដែលសល់បៀរធំជាងគេ
    let finalWinner = null;
    
    // តម្រៀបរកអ្នកឈ្នះតាមច្បាប់ Catte
    let activePlayers = room.players.filter(p => !p.isSpectator);
    
    // បើរកអ្នកឈ្នះទឹកចុងក្រោយ (ទឹក៦) ឃើញ
    // ដើម្បីងាយស្រួល នរណាមានសន្លឹកបៀរឈ្នះទឹកចុងក្រោយគេ ឬមាន Rank ល្អជាងគេ
    activePlayers.forEach(p => {
        p.rank = p.wonRoundsCards.length > 0 ? 1 : 4;
    });

    // កំណត់ Winner ច្បាស់លាស់ម្នាក់
    let maxRounds = -1;
    activePlayers.forEach(p => {
        if (p.wonRoundsCards.length > maxRounds) {
            maxRounds = p.wonRoundsCards.length;
            finalWinner = p;
        }
    });

    if (finalWinner) {
        finalWinner.rank = 1;
        room.lastWinnerId = finalWinner.id;
    }

    let rankCounter = 2;
    activePlayers.forEach(p => {
        if (p !== finalWinner) {
            p.rank = rankCounter++;
        }
    });

    const results = room.players.map(p => ({ 
        id: p.id,
        name: p.name, 
        remaining: [...p.hand], 
        isSpectator: p.isSpectator,
        rank: p.rank
    }));

    io.to(room.roomId).emit('gameWon', { 
        winner: finalWinner ? finalWinner.name : 'រកមិនឃើញ', 
        winnerId: finalWinner ? finalWinner.id : null, 
        allHands: results 
    });
    broadcastRoomList();
}

function broadcastRoomList() {
    const list = Object.keys(rooms).map(id => {
        return {
            roomId: id,
            playerCount: rooms[id].players.length,
            status: rooms[id].status,
            gameMode: rooms[id].gameMode,
            hasPassword: rooms[id].password && rooms[id].password !== "" ? true : false
        };
    });
    io.emit('roomList', list);
}

io.on('connection', (socket) => {
    broadcastRoomList();

    socket.on('createRoom', ({ roomId, password, playerName, gameMode }) => {
        if (rooms[roomId]) {
            return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        }
        
        rooms[roomId] = {
            roomId: roomId,
            players: [{ id: socket.id, name: playerName || 'Player 1', hand: [], burnedCards: [], wonRoundsCards: [], passed: false, isSpectator: false, rank: null }],
            creatorId: socket.id,
            status: 'waiting', 
            gameMode: gameMode || 'tienlen', // 'tienlen' ឬ 'catte'
            password: password || "",
            currentTurnIndex: 0,
            playedCards: [],
            lastPlayerId: null,
            lastWinnerId: null,
            nextRank: 1,
            catteRoundCount: 0,
            catteTurnCount: 0,
            catteRoundPlays: []
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
        
        // កាតេលេងបានដល់ ៦ នាក់, ទានលែនបាន ៤ នាក់
        const maxPlayers = room.gameMode === 'catte' ? 6 : 4;
        if (room.players.length >= maxPlayers) return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

        const isSpectator = room.status === 'playing';

        room.players.push({ 
            id: socket.id, 
            name: playerName || 'Guest', 
            hand: [], 
            burnedCards: [],
            wonRoundsCards: [],
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
            p.burnedCards = [];
            p.wonRoundsCards = [];
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
        room.catteRoundCount = 0;
        room.catteTurnCount = 0;
        room.catteRoundPlays = [];
        
        const cardLimit = room.gameMode === 'catte' ? 6 : 13;

        room.players.forEach((p, i) => {
            p.hand = sortCards(deck.slice(i * cardLimit, (i + 1) * cardLimit), room.gameMode);
            io.to(p.id).emit('dealCards', { hand: p.hand });
        });

        let startingIndex = -1;
        if (room.lastWinnerId) {
            startingIndex = room.players.findIndex(p => p.id === room.lastWinnerId);
        }
        if (startingIndex === -1 && room.gameMode === 'tienlen') {
            startingIndex = room.players.findIndex(p => p.hand.some(c => c.value === '3' && c.suit === '♠'));
        }
        if (startingIndex === -1) startingIndex = 0;

        room.currentTurnIndex = startingIndex;

        io.to(roomId).emit('gameStarted', { 
            players: room.players, 
            currentTurnIndex: room.currentTurnIndex,
            lastRoundWinnerId: room.lastWinnerId,
            gameMode: room.gameMode
        });
        broadcastRoomList();
    });

    socket.on('playCard', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        
        if (!player || player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ');
        if (player.hand.length === 0) return socket.emit('errorMsg', 'អ្នកអស់បៀហើយ!');

        if (room.gameMode === 'catte') {
            if (cards.length !== 1) return socket.emit('errorMsg', 'ហ្គេមកាតេអនុញ្ញាតឱ្យចុះបៀរម្ដងបានតែ ១ សន្លឹកប៉ុណ្ណោះ!');
            const targetCard = cards[0];

            // ពិនិត្យលក្ខខណ្ឌស៊ីកាតេ
            let canPlay = false;
            if (room.playedCards.length === 0) {
                canPlay = true; // ដើមទឹកវាយសេរី
            } else {
                const leadCard = room.playedCards[0];
                if (targetCard.suit === leadCard.suit && getCattePower(targetCard) > getCattePower(leadCard)) {
                    canPlay = true; 
                }
            }

            if (!canPlay) {
                return socket.emit('errorMsg', 'មិនអាចចុះបានទេ! ទឹកបៀរមិនត្រូវ ឬតូចជាងបៀរនៅលើតុ។ (សូមប្រើប៊ូតុងធិបផ្កាប់វិញ បើគ្មានបៀរស៊ី)');
            }

            // ដកបៀរចេញពីដៃ
            const idx = player.hand.findIndex(pc => pc.value === targetCard.value && pc.suit === targetCard.suit);
            if (idx !== -1) player.hand.splice(idx, 1);

            room.catteRoundPlays.push({ playerId: player.id, card: targetCard, isBurned: false });
            room.playedCards = [targetCard]; // ក្លាយជាបៀរនាំមុខថ្មីនៅលើតុ

            io.to(roomId).emit('cardPlayed', { 
                by: player.name, 
                cards: [targetCard], 
                nextTurn: room.currentTurnIndex,
                cardCount: player.hand.length,
                updatedHands: room.players 
            });

            handleTurnAndRoundStatus(room);
            io.to(roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });

        } else {
            // ផ្នែកច្បាប់របស់ Tien Len ចាស់ដដែល
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
        }
    });

// មុខងារធិបបៀរផ្កាប់ (សម្រាប់ Catte) - កែសម្រួលថ្មីដើម្បីការពារការច្រឡំដៃ
    socket.on('burnCard', ({ roomId, card }) => {
        const room = rooms[roomId];
        if (!room || room.gameMode !== 'catte') return;
        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return;

        // 💡 លក្ខខណ្ឌបន្ថែម៖ បើតុទទេ (លេងដើមទឹក) ឬ ដល់វេនត្រូវដាក់ទឹកថ្មី គឺមិនអនុញ្ញាតឱ្យធិបផ្កាប់ឡើយ
        const isNewRound = room.playedCards.length === 0;
        if (isNewRound) {
            return socket.emit('errorMsg', 'មិនអាចធិបផ្កាប់បៀរបានទេ! ដល់វេនអ្នកត្រូវបោះបៀរទឹកថ្មីចេញទៅមុខ។');
        }

        const idx = player.hand.findIndex(pc => pc.value === card.value && pc.suit === card.suit);
        if (idx === -1) return socket.emit('errorMsg', 'រកមិនឃើញសន្លឹកបៀរនេះទេ!');

        player.hand.splice(idx, 1);
        player.burnedCards.push(card);

        room.catteRoundPlays.push({ playerId: player.id, card: card, isBurned: true });

        io.to(roomId).emit('playerBurned', { 
            name: player.name, 
            id: player.id,
            cardCount: player.hand.length,
            updatedHands: room.players
        });

        handleTurnAndRoundStatus(room);
        io.to(roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
    });

    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.gameMode === 'catte') return; // Catte គ្មាន Pass ទេ
        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return;

        player.passed = true;
        
        io.to(roomId).emit('playerPassed', { 
            name: player.name, 
            id: player.id,
            message: "តោះខ្ញុំអត់ស៊ីទេ"
        });
        
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