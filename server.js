const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

const CARD_ORDER = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const CATTE_ORDER = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']; // អាត់ (A) ធំជាងគេក្នុងកាតេ
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

function getCardPower(card, gameType = 'tienlen') {
    if (gameType === 'catte') {
        return (CATTE_ORDER.indexOf(card.value) * 10) + SUIT_ORDER[card.suit];
    }
    return (CARD_ORDER.indexOf(card.value) * 10) + SUIT_ORDER[card.suit];
}

function sortCards(cards, gameType = 'tienlen') {
    return cards.sort((a, b) => getCardPower(a, gameType) - getCardPower(b, gameType));
}

// --- មុខងារសម្រាប់ TIEN LEN ---
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
    if (isStr && len >= 3) return 'straight'; 
    return null;
}

function comparePlay(newCards, oldCards) {
    if (!oldCards || oldCards.length === 0) return true;
    const newType = getComboType(newCards);
    const oldType = getComboType(oldCards);
    const newMax = getCardPower(sortCards([...newCards], 'tienlen').pop(), 'tienlen');
    const oldMax = getCardPower(sortCards([...oldCards], 'tienlen').pop(), 'tienlen');

    if (oldType === 'single' && oldCards[0].value === '2') {
        if (newType === 'bomb' || newType === 'quad_pair') return true;
    }
    if (oldType === 'bomb') {
        if (newType === 'bomb' && newMax > oldMax) return true;
        if (newType === 'quad_pair') return true;
    }
    if (oldType === 'quad_pair' && newType === 'quad_pair' && newMax > oldMax) return true;
    if (oldType === 'triple_pair' && newType === 'triple_pair' && newMax > oldMax) return true;
    if (newType === oldType && newCards.length === oldCards.length) return newMax > oldMax;
    return false;
}

// --- មុខងារគ្រប់គ្រង TURN និង ROUND ---
function moveToNextTurn(room) {
    let originalIndex = room.currentTurnIndex;
    let nextIndex = originalIndex;
    let found = false;

    for (let i = 1; i <= room.players.length; i++) {
        let checkIndex = (originalIndex + i) % room.players.length;
        let p = room.players[checkIndex];
        if (room.gameType === 'catte') {
            // សម្រាប់កាតេ: ត្រូវតែមានបៀក្នុងដៃ និងមិនទាន់លេងក្នុងជុំនេះ
            if (p && p.hand.length > 0 && !room.roundPlayedThisTurn.includes(p.id)) {
                nextIndex = checkIndex;
                found = true;
                break;
            }
        } else {
            // សម្រាប់លេងទៀនឡេន
            if (p && p.hand.length > 0 && !p.passed) {
                nextIndex = checkIndex;
                found = true;
                break;
            }
        }
    }
    if (found) room.currentTurnIndex = nextIndex;
    return found;
}

function handleTurnAndRoundStatus(room) {
    if (room.gameType === 'catte') {
        // ពិនិត្យមើលថាតើអ្នកលេងទាំងអស់បានលេងក្នុងជុំ (ទឹក) នេះរួចរាល់ហើយឬនៅ
        const playersWithCards = room.players.filter(p => p.hand.length > 0);
        const allPlayed = playersWithCards.every(p => room.roundPlayedThisTurn.includes(p.id));

        if (allPlayed) {
            // បញ្ចប់មួយទឹក: ស្វែងរកអ្នកឈ្នះទឹកនេះ (បៀធំជាងគេ និងត្រូវមេ)
            let winCard = room.playedCards[0];
            let winPlayerId = room.roundPlayedThisTurn[0];

            for (let i = 1; i < room.playedCards.length; i++) {
                let currentCard = room.playedCards[i];
                let currentPlayerId = room.roundPlayedThisTurn[i];
                
                // លក្ខខណ្ឌស៊ី៖ ត្រូវតែមានមេដូចគ្នា និងមានកម្លាំងធំជាង
                if (currentCard.suit === winCard.suit && getCardPower(currentCard, 'catte') > getCardPower(winCard, 'catte')) {
                    winCard = currentCard;
                    winPlayerId = currentPlayerId;
                }
            }

            // កត់ត្រាទុកថាអ្នកណាឈ្នះទឹកនេះ
            room.catteRoundWinners.push(winPlayerId);
            room.lastPlayerId = winPlayerId;

            // សម្អាតទិន្នន័យជុំចាស់
            room.playedCards = [];
            room.roundPlayedThisTurn = [];

            // ផ្ដល់វេនទៅអ្នកឈ្នះទឹកដើម្បីកាត់ទឹកបន្ទាប់
            let nextWinnerIndex = room.players.findIndex(p => p.id === winPlayerId);
            room.currentTurnIndex = nextWinnerIndex !== -1 ? nextWinnerIndex : 0;

            // ពិនិត្យមើលទឹកទី ៤ ដើម្បីកាត់អ្នកគ្មានទឹកចោល (បើរលីងដៃ)
            room.catteRoundCount++;
            if (room.catteRoundCount === 4) {
                room.players.forEach(p => {
                    const hasWonARound = room.catteRoundWinners.includes(p.id);
                    if (!hasWonARound) p.hand = []; // ងាប់ទឹក (គ្មានសិទ្ធិលេងទឹក ៥, ៦)
                });
            }

            // ពិនិត្យមើលការបញ្ចប់ហ្គេម (លេងគ្រប់ ៦ ទឹក ឬសល់តែម្នាក់)
            const remainingActive = room.players.filter(p => p.hand.length > 0);
            if (room.catteRoundCount >= 6 || remainingActive.length <= 1) {
                endCatteGame(room, winPlayerId);
            } else {
                io.to(room.roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
            }
        } else {
            moveToNextTurn(room);
        }
    } else {
        // ប្រព័ន្ធគ្រប់គ្រងវេនទៀនឡេន (ដដែល)
        const stillPlayingAndNotPassed = room.players.filter(p => p.hand.length > 0 && !p.passed);
        if (stillPlayingAndNotPassed.length <= 1) {
            room.playedCards = [];
            room.players.forEach(p => { if (p.hand.length > 0) p.passed = false; });
            let nextWinnerIndex = room.players.findIndex(p => p.id === room.lastPlayerId);
            if (nextWinnerIndex === -1 || room.players[nextWinnerIndex].hand.length === 0) {
                let originalIdx = room.currentTurnIndex;
                for (let i = 1; i <= room.players.length; i++) {
                    let checkIdx = (originalIdx + i) % room.players.length;
                    let checkP = room.players[checkIdx];
                    if (checkP && checkP.hand.length > 0) { nextWinnerIndex = checkIdx; break; }
                }
            }
            room.currentTurnIndex = nextWinnerIndex !== -1 ? nextWinnerIndex : 0;
            io.to(room.roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
        } else {
            moveToNextTurn(room);
        }
    }
}

function endCatteGame(room, finalWinnerId) {
    room.status = 'waiting';
    room.lastWinnerId = finalWinnerId;
    
    room.players.forEach(p => {
        if (p.id === finalWinnerId) p.rank = 1;
        else p.rank = 2;
    });

    const results = room.players.map(p => ({
        id: p.id,
        name: p.name,
        remaining: [...p.hand],
        isSpectator: p.isSpectator,
        rank: p.rank
    }));

    const finalWinner = room.players.find(p => p.id === finalWinnerId);
    io.to(room.roomId).emit('gameWon', { 
        winner: finalWinner ? finalWinner.name : 'រកមិនឃើញ', 
        winnerId: finalWinnerId, 
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
            gameType: rooms[id].gameType || 'tienlen',
            hasPassword: rooms[id].password && rooms[id].password !== "" ? true : false
        };
    });
    io.emit('roomList', list);
}

io.on('connection', (socket) => {
    broadcastRoomList();

    socket.on('createRoom', ({ roomId, password, playerName, gameType }) => {
        if (rooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        
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
            nextRank: 1,
            // សម្រាប់ Catte
            catteRoundCount: 0,
            catteRoundWinners: [],
            roundPlayedThisTurn: []
        };
        
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
        broadcastRoomList();
    });

    // ស្វែងរក socket.on('joinRoom', ...) នៅក្នុង server.js រួចជំនួសដោយកូដនេះ៖
    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់នេះទេ!');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');
        
        const maxPlayers = room.gameType === 'catte' ? 6 : 4;
        
        // បើហ្គេមកំពុងលេង អនុញ្ញាតឱ្យចូលមើល (Spectator) មិនគិតពីចំនួន Max Players ឡើយ
        const isSpectator = room.status === 'playing';
        if (!isSpectator && room.players.length >= maxPlayers) {
            return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');
        }

        room.players.push({ id: socket.id, name: playerName || 'Guest', hand: [], passed: false, isSpectator, rank: null });

        socket.join(roomId);
        
        // ផ្ញើទិន្នន័យបន្ថែម currentTableCards ទៅកាន់ Client ថ្មី
        socket.emit('roomJoined', { 
            roomId, 
            playerId: socket.id, 
            isSpectator,
            currentTableCards: room.playedCards, // បៀរនៅលើតុបច្ចុប្បន្ន
            gameType: room.gameType
        });

        // ប្រាប់អ្នករាល់គ្នាក្នុងបន្ទប់ រួមទាំងអ្នកមកមើលថ្មីឱ្យធ្វើបច្ចុប្បន្នភាពបញ្ជីអ្នកលេង
        io.to(roomId).emit('updatePlayers', room.players);
        
        // បើសិនជាហ្គេមកំពុងដំណើរការ ត្រូវផ្ញើព្រឹត្តិការណ៍ gameStarted ទៅកាន់អ្នកមើល ដើម្បីទាញ UI ហ្គេមឡើងមក
        if (isSpectator) {
            socket.emit('gameStarted', {
                players: room.players,
                currentTurnIndex: room.currentTurnIndex,
                gameType: room.gameType
            });
        }

        broadcastRoomList();
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.creatorId !== socket.id) return;

        room.players.forEach(p => { p.isSpectator = false; p.hand = []; p.passed = false; p.rank = null; });
        if (room.players.length < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់!');

        const deck = shuffleDeck(createDeck());
        room.status = 'playing'; 
        room.playedCards = [];
        room.lastPlayerId = null;
        room.nextRank = 1;
        room.catteRoundCount = 0;
        room.catteRoundWinners = [];
        room.roundPlayedThisTurn = [];
        
        const cardsPerPlayer = room.gameType === 'catte' ? 6 : 13;
        room.players.forEach((p, i) => {
            p.hand = sortCards(deck.slice(i * cardsPerPlayer, (i + 1) * cardsPerPlayer), room.gameType);
            io.to(p.id).emit('dealCards', { hand: p.hand });
        });

        let startingIndex = -1;
        if (room.lastWinnerId) {
            startingIndex = room.players.findIndex(p => p.id === room.lastWinnerId);
        }
        if (startingIndex === -1 && room.gameType === 'tienlen') {
            startingIndex = room.players.findIndex(p => p.hand.some(c => c.value === '3' && c.suit === '♠'));
        }
        if (startingIndex === -1) startingIndex = 0;
        room.currentTurnIndex = startingIndex;

        io.to(roomId).emit('gameStarted', { 
            players: room.players, 
            currentTurnIndex: room.currentTurnIndex,
            lastRoundWinnerId: room.lastWinnerId,
            gameType: room.gameType
        });
        broadcastRoomList();
    });

    socket.on('playCard', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        
        if (!player || player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ');
        if (cards.length !== 1 && room.gameType === 'catte') return socket.emit('errorMsg', 'ហ្គេមកាតេអនុញ្ញាតឱ្យចុះបៀរម្ដងបានតែ ១សន្លឹកប៉ុណ្ណោះ!');

        if (room.gameType === 'catte') {
            // --- ច្បាប់ហ្គេមកាតេ (Catte) ---
            const playedCard = cards[0];
            const isLeadCard = room.playedCards.length === 0; // បៀរកាត់ទឹកដំបូងគេ

            let isValid = false;
            if (isLeadCard) {
                isValid = true; // អ្នកដំបូងចង់ចុះបៀរអ្វីក៏បាន
            } else {
                const leadCard = room.playedCards[0];
                // ពិនិត្យមើលថាអ្នកលេងមានបៀរមេ (Suit) ដូចគ្នា ហើយធំជាង ឬអត់
                const hasBetterCard = player.hand.some(c => c.suit === leadCard.suit && getCardPower(c, 'catte') > getCardPower(leadCard, 'catte'));
                
                if (hasBetterCard) {
                    if (playedCard.suit === leadCard.suit && getCardPower(playedCard, 'catte') > getCardPower(leadCard, 'catte')) {
                        isValid = true; // ស៊ីទឹក
                    } else {
                        return socket.emit('errorMsg', 'អ្នកមានបៀរធំជាងនៅលើតុ ត្រូវតែលេងបៀរនោះ (លេងតាមមេ)!');
                    }
                } else {
                    isValid = true; // គ្មានបៀរស៊ីទេ ត្រូវ "កប់បៀរ" (ចោលបៀរណាមួយក៏បាន)
                }
            }

            if (isValid) {
                // ដកបៀរចេញពីដៃ
                const idx = player.hand.findIndex(pc => pc.value === playedCard.value && pc.suit === playedCard.suit);
                if (idx !== -1) player.hand.splice(idx, 1);

                room.playedCards.push(playedCard);
                room.roundPlayedThisTurn.push(player.id);

                handleTurnAndRoundStatus(room);

                io.to(roomId).emit('cardPlayed', { 
                    by: player.name, 
                    cards: [playedCard], 
                    nextTurn: room.currentTurnIndex,
                    cardCount: player.hand.length,
                    updatedHands: room.players 
                });
            }
        } else {
            // --- ច្បាប់ហ្គេមទៀនឡេន (Tien Len) ---
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
                    if (player.rank === 1) room.lastWinnerId = player.id;
                }

                const remainingActivePlayers = room.players.filter(p => p.hand.length > 0);
                if (remainingActivePlayers.length <= 1) {
                    if (remainingActivePlayers.length === 1) remainingActivePlayers[0].rank = room.nextRank;
                    room.status = 'waiting'; 

                    const results = room.players.map(p => ({ 
                        id: p.id, name: p.name, remaining: [...p.hand], 
                        isSpectator: p.hand.length === 0 && p.rank !== null ? false : p.isSpectator, rank: p.rank
                    }));

                    io.to(roomId).emit('cardPlayed', { 
                        by: player.name, cards, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players 
                    });

                    setTimeout(() => {
                        const finalWinner = room.players.find(p => p.rank === 1);
                        io.to(roomId).emit('gameWon', { winner: finalWinner ? finalWinner.name : 'រកមិនឃើញ', winnerId: finalWinner ? finalWinner.id : null, allHands: results });
                        broadcastRoomList();
                    }, 1500);
                } else {
                    handleTurnAndRoundStatus(room);
                    io.to(roomId).emit('cardPlayed', { 
                        by: player.name, cards, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players 
                    });
                }
            } else {
                socket.emit('errorMsg', 'ចុះមិនត្រូវក្បួន ឬបៀតូចជាង!');
            }
        }
    });

    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.gameType === 'catte') return socket.emit('errorMsg', 'ហ្គេមកាតេមិនអាចរំលង (Pass) បានឡើយ ត្រូវតែទម្លាក់បៀរ!');
        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return;

        player.passed = true;
        io.to(roomId).emit('playerPassed', { name: player.name, id: player.id, message: "Pass ❌" });
        
        handleTurnAndRoundStatus(room);
        io.to(roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
    });

    // មុខងារ Leave / Disconnect រក្សាទុកដដែល...
    socket.on('leaveRoom', () => {
        for (const id in rooms) {
            const room = rooms[id];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                const wasSpectator = room.players[pIdx].isSpectator;
                room.players.splice(pIdx, 1);
                socket.leave(id); 
                socket.emit('leftRoom'); 
                if (room.players.length === 0) { delete rooms[id]; } else {
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
                if (room.players.length === 0) { delete rooms[id]; } else {
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