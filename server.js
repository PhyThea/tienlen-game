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

function sortCards(cards) {
    return [...cards].sort((a, b) => {
        const idxA = CARD_ORDER.indexOf(a.value);
        const idxB = CARD_ORDER.indexOf(b.value);
        if (idxA !== idxB) return idxA - idxB;
        return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    });
}

function getCardPower(card) {
    const vIdx = CARD_ORDER.indexOf(card.value);
    const sIdx = SUIT_ORDER[card.suit];
    return vIdx * 10 + sIdx;
}

function getHighestCard(cards) {
    if (!cards || cards.length === 0) return null;
    let highest = cards[0];
    for (let i = 1; i < cards.length; i++) {
        if (getCardPower(cards[i]) > getCardPower(highest)) {
            highest = cards[i];
        }
    }
    return highest;
}

function isSequence(cards) {
    if (cards.length < 3) return false;
    const sorted = sortCards(cards);
    
    // ច្បាប់ទៀនឡេន៖ មិនអាចយក ២ មកធ្វើខ្សែ (Sequence) បានទេ
    for (const c of sorted) {
        if (c.value === '2') return false;
    }
    
    for (let i = 0; i < sorted.length - 1; i++) {
        const currIdx = CARD_ORDER.indexOf(sorted[i].value);
        const nextIdx = CARD_ORDER.indexOf(sorted[i+1].value);
        if (nextIdx !== currIdx + 1) return false;
    }
    return true;
}

function analyzeCombo(cards) {
    if (!cards || cards.length === 0) return { type: 'invalid' };
    const len = cards.length;
    const sorted = sortCards(cards);
    const highest = getHighestCard(cards);

    if (len === 1) {
        return { type: 'single', highest };
    }

    if (len === 2) {
        if (sorted[0].value === sorted[1].value) {
            return { type: 'pair', highest };
        }
        return { type: 'invalid' };
    }

    if (len === 3) {
        if (sorted[0].value === sorted[1].value && sorted[1].value === sorted[2].value) {
            return { type: 'triple', highest };
        }
        if (isSequence(sorted)) {
            return { type: 'sequence', length: 3, highest };
        }
        return { type: 'invalid' };
    }

    if (len === 4) {
        if (sorted[0].value === sorted[1].value && 
            sorted[1].value === sorted[2].value && 
            sorted[2].value === sorted[3].value) {
            return { type: 'quad', highest };
        }
    }

    // ឆែកផែអោប ( Pairs Sequence )
    if (len >= 6 && len % 2 === 0) {
        const numPairs = len / 2;
        let isPairsSeq = true;
        let firstPairValIdx = CARD_ORDER.indexOf(sorted[0].value);
        
        // ផែអោបមិនអាចមានលេខ ២ ឡើយ
        for (const c of sorted) {
            if (c.value === '2') {
                isPairsSeq = false;
                break;
            }
        }
        
        if (isPairsSeq) {
            for (let i = 0; i < numPairs; i++) {
                const c1 = sorted[i * 2];
                const c2 = sorted[i * 2 + 1];
                if (c1.value !== c2.value) {
                    isPairsSeq = false;
                    break;
                }
                const currValIdx = CARD_ORDER.indexOf(c1.value);
                if (currValIdx !== firstPairValIdx + i) {
                    isPairsSeq = false;
                    break;
                }
            }
        }
        if (isPairsSeq) {
            return { type: 'pairs_seq', length: numPairs, highest };
        }
    }

    if (isSequence(sorted)) {
        return { type: 'sequence', length: len, highest };
    }

    return { type: 'invalid' };
}

function canPlay(incomingCards, lastCombo) {
    const current = analyzeCombo(incomingCards);
    if (current.type === 'invalid') return false;

    // បើក្ដារទទេ អាចចុះអ្វីក៏បានឱ្យតែត្រឹមត្រូវតាមច្បាប់
    if (!lastCombo || lastCombo.type === 'invalid' || lastCombo.cards.length === 0) {
        return true;
    }

    const last = analyzeCombo(lastCombo.cards);

    // ច្បាប់កាត់ពិសេស (បៀរ ២ ឬ ហាយ)
    if (last.type === 'single' && lastCombo.cards[0].value === '2') {
        if (current.type === 'quad') return true; // ហាយមួយសន្លឹក អាចកាត់បានដោយមេបួន
        if (current.type === 'pairs_seq' && current.length >= 3) return true; // ផែអោប ៣ គូឡើង កាត់ហាយ ១ បាន
    }
    if (last.type === 'pair' && lastCombo.cards[0].value === '2') {
        if (current.type === 'quad') return true; // ហាយមួយគូ អាចកាត់បានដោយមេបួន
        if (current.type === 'pairs_seq' && current.length >= 4) return true; // ផែអោប ៤ គូឡើង កាត់ហាយ ១ គូបាន
    }
    
    // ច្បាប់កាត់បន្តគ្នាលើ Combo ពិសេស
    if (last.type === 'pairs_seq') {
        if (current.type === 'quad') return true; // មេបួន អាចកាត់ផែអោប ៣ គូបាន
        if (current.type === 'pairs_seq') {
            if (current.length > last.length) return true; // គូច្រើនជាង កាត់គូតិចជាងបាន
            if (current.length === last.length && getCardPower(current.highest) > getCardPower(last.highest)) return true;
        }
    }
    if (last.type === 'quad') {
        if (current.type === 'quad' && getCardPower(current.highest) > getCardPower(last.highest)) return true;
        if (current.type === 'pairs_seq' && current.length >= 4) return true; // ផែអោប ៤ គូ កាត់មេបួនបាន
    }

    // ករណីទូទៅ៖ ត្រូវតែដូចប្រភេទ និងមានចំនួនសន្លឹកស្មើគ្នា
    if (current.type !== last.type) return false;

    if (current.type === 'sequence' || current.type === 'pairs_seq') {
        if (current.length !== last.length) return false;
    }

    return getCardPower(current.highest) > getCardPower(last.highest);
}

function hasCard(playerHand, card) {
    return playerHand.some(c => c.suit === card.suit && c.value === card.value);
}

function removeCards(playerHand, cardsToRemove) {
    return playerHand.filter(c => !cardsToRemove.some(r => r.suit === c.suit && r.value === c.value));
}

function handleTurnAndRoundStatus(room) {
    let loops = 0;
    while (loops < room.players.length * 2) {
        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        const nextPlayer = room.players[room.currentTurnIndex];
        if (!nextPlayer.hasPassed && nextPlayer.hand.length > 0 && !nextPlayer.isSpectator) {
            break;
        }
        loops++;
    }

    // ពិនិត្យមើលថាតើមានអ្នកនៅសល់ក្នុងជុំនេះតែម្នាក់ឯងឬទេ (ដើម្បីឡើងមេថ្មី)
    const activeInRound = room.players.filter(p => !p.hasPassed && p.hand.length > 0 && !p.isSpectator);
    if (activeInRound.length <= 1) {
        let roundWinner = activeInRound[0];
        if (!roundWinner) {
            // បើគ្រប់គ្នាអោនអស់ រកអ្នកចុះចុងក្រោយគេ
            const activePlaying = room.players.filter(p => p.hand.length > 0 && !p.isSpectator);
            roundWinner = activePlaying[0] || room.players[0];
        }
        
        room.players.forEach(p => p.hasPassed = false);
        room.lastPlayedCards = [];
        room.lastPlayedUserId = null;
        room.currentTurnIndex = room.players.findIndex(p => p.id === roundWinner.id);
    }
}

function checkGameEnd(room) {
    const playingPlayers = room.players.filter(p => !p.isSpectator);
    const activePlayers = playingPlayers.filter(p => p.hand.length > 0);
    
    if (activePlayers.length <= 1) {
        room.status = 'finished';
        
        // ស្វែងរកអ្នកដែលនៅសល់បៀរក្នុងដៃ ដើម្បីកំណត់ចំណាត់ថ្នាក់ចុងក្រោយ
        if (activePlayers.length === 1) {
            const loser = activePlayers[0];
            loser.rank = playingPlayers.filter(p => p.rank).length + 1;
        }

        const sortedResults = [...playingPlayers].sort((a,b) => (a.rank || 99) - (b.rank || 99));

        io.to(room.id).emit('gameFinished', {
            results: sortedResults.map(p => ({
                id: p.id,
                name: p.name,
                rank: p.rank,
                remainingCards: p.hand
            }))
        });
        
        if (sortedResults.length > 0) {
            room.lastRoundWinnerId = sortedResults[0].id;
        }
    }
}

function broadcastRoomList() {
    const list = Object.values(rooms).map(r => ({
        id: r.id,
        creatorName: r.players.find(p => p.id === r.creatorId)?.name || 'Unknown',
        playerCount: r.players.length,
        status: r.status
    }));
    io.emit('roomList', list);
}

io.on('connection', (socket) => {
    broadcastRoomList();

    socket.on('createRoom', ({ playerName }) => {
        const roomId = 'room_' + Math.random().toString(36).substr(2, 9);
        rooms[roomId] = {
            id: roomId,
            creatorId: socket.id,
            status: 'waiting',
            players: [{ id: socket.id, name: playerName, hand: [], hasPassed: false, isSpectator: false, rank: null }],
            lastPlayedCards: [],
            lastPlayedUserId: null,
            currentTurnIndex: 0,
            lastRoundWinnerId: null
        };
        socket.join(roomId);
        socket.emit('joinedRoom', { roomId, isCreator: true, myId: socket.id });
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
        broadcastRoomList();
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់នេះឡើយ!');
        
        let isSpectator = false;
        if (room.status === 'playing' || room.players.length >= 4) {
            isSpectator = true;
        }

        room.players.push({ id: socket.id, name: playerName, hand: [], hasPassed: false, isSpectator, rank: null });
        socket.join(roomId);
        socket.emit('joinedRoom', { roomId, isCreator: false, myId: socket.id });
        io.to(roomId).emit('updatePlayers', room.players);
        
        if (room.status === 'playing') {
            socket.emit('gameStarted', {
                hand: [],
                currentTurnIndex: room.currentTurnIndex,
                lastPlayedCards: room.lastPlayedCards,
                isSpectator: true
            });
        }
        broadcastRoomList();
    });

    socket.on('startGame', () => {
        const room = Object.values(rooms).find(r => r.creatorId === socket.id);
        if (!room) return;
        
        // កំណត់ឱ្យអ្នកចូលក្រោយ ឬលើសពី៤នាក់ទៅជា Spectator
        room.players.forEach((p, idx) => {
            if (idx < 4) {
                p.isSpectator = false;
                p.hand = [];
                p.hasPassed = false;
                p.rank = null;
            } else {
                p.isSpectator = true;
                p.hand = [];
                p.hasPassed = false;
                p.rank = null;
            }
        });

        const activePlayers = room.players.filter(p => !p.isSpectator);
        if (activePlayers.length < 2) {
            return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់ដើម្បីចាប់ផ្ដើម!');
        }

        let deck = createDeck();
        deck = shuffleDeck(deck);

        const cardsPerPlayer = 13;
        activePlayers.forEach((p, idx) => {
            p.hand = sortCards(deck.slice(idx * cardsPerPlayer, (idx + 1) * cardsPerPlayer));
        });

        room.status = 'playing';
        room.lastPlayedCards = [];
        room.lastPlayedUserId = null;

        // ស្វែងរកអ្នកដែលមានបៀរ ៣ប៊ិច (3♠) ដើម្បីបានវេនចុះមុនគេបង្អស់
        let startingIndex = 0;
        if (room.lastRoundWinnerId) {
            const wIdx = room.players.findIndex(p => p.id === room.lastRoundWinnerId && !p.isSpectator);
            if (wIdx !== -1) startingIndex = wIdx;
        } else {
            let found = false;
            for (let i = 0; i < room.players.length; i++) {
                if (room.players[i].isSpectator) continue;
                if (room.players[i].hand.some(c => c.value === '3' && c.suit === '♠')) {
                    startingIndex = i;
                    found = true;
                    break;
                }
            }
            if (!found) {
                // បើគ្មាន ៣ប៊ិច លើតុទេ រកបៀរណាដែលតូចជាងគេបំផុត
                let lowestPower = 999;
                for (let i = 0; i < room.players.length; i++) {
                    if (room.players[i].isSpectator) continue;
                    if (room.players[i].hand.length > 0) {
                        const pLow = getCardPower(room.players[i].hand[0]);
                        if (pLow < lowestPower) {
                            lowestPower = pLow;
                            startingIndex = i;
                        }
                    }
                }
            }
        }

        room.currentTurnIndex = startingIndex;

        room.players.forEach(p => {
            io.to(p.id).emit('gameStarted', {
                hand: p.hand,
                currentTurnIndex: room.currentTurnIndex,
                lastPlayedCards: room.lastPlayedCards,
                isSpectator: p.isSpectator
            });
        });

        io.to(room.id).emit('updatePlayers', room.players);
        broadcastRoomList();
    });

    // *** បានកែសម្រួល Event ពី 'playCard' ទៅជា 'playCards' ដើម្បីឱ្យត្រូវគ្នាជាមួយ Client ***
    socket.on('playCards', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        const player = room.players[room.currentTurnIndex];
        if (player.id !== socket.id) return socket.emit('errorMsg', "មិនទាន់ដល់វេនរបស់អ្នកឡើយ!");

        // ផ្ទៀងផ្ទាត់បៀរក្នុងដៃ
        for (const c of cards) {
            if (!hasCard(player.hand, c)) {
                return socket.emit('errorMsg', "បៀរជ្រើសរើសមិនត្រឹមត្រូវ!");
            }
        }

        // ប្រសិនបើជាទឹកដំបូងបង្អស់នៃហ្គេម (គ្មានម្ចាស់មុន) ត្រូវតែបង្ខំឱ្យចុះបៀរតូចបំផុត (ដូចជា 3♠)
        const totalRanked = room.players.filter(p => p.rank).length;
        if (!room.lastRoundWinnerId && room.lastPlayedCards.length === 0 && totalRanked === 0) {
            let globalLowestCard = null;
            for (const p of room.players) {
                if (p.isSpectator) continue;
                if (p.hand.length > 0) {
                    if (!globalLowestCard || getCardPower(p.hand[0]) < getCardPower(globalLowestCard)) {
                        globalLowestCard = p.hand[0];
                    }
                }
            }
            if (globalLowestCard) {
                const containsLowest = cards.some(c => c.value === globalLowestCard.value && c.suit === globalLowestCard.suit);
                if (!containsLowest) {
                    return socket.emit('errorMsg', `ទឹកដំបូងត្រូវតែរួមបញ្ចូលបៀរតូចបំផុតគឺ៖ ${globalLowestCard.value}${globalLowestCard.suit}`);
                }
            }
        }

        const lastCombo = { cards: room.lastPlayedCards };
        if (!canPlay(cards, room.lastPlayedUserId ? lastCombo : null)) {
            return socket.emit('errorMsg', "បៀរចុះមិនត្រូវតាមច្បាប់ ឬមិនអាចស៊ីបៀរនៅលើតុបានទេ!");
        }

        // ដំណើរការដកបៀរចេញពីដៃ
        player.hand = removeCards(player.hand, cards);
        room.lastPlayedCards = cards;
        room.lastPlayedUserId = socket.id;

        // ពិនិត្យមើលបើអស់បៀរពីដៃ (ឈ្នះបានចំណាត់ថ្នាក់)
        if (player.hand.length === 0 && !player.rank) {
            const currentRank = room.players.filter(p => p.rank).length + 1;
            player.rank = currentRank;
            io.to(room.id).emit('playerFinished', { id: player.id, name: player.name, rank: currentRank });
        }

        checkGameEnd(room);

        if (room.status === 'playing') {
            handleTurnAndRoundStatus(room);
            io.to(room.id).emit('cardPlayed', {
                cards: room.lastPlayedCards,
                nextTurn: room.currentTurnIndex,
                id: player.id,
                name: player.name,
                roomPlayers: room.players
            });
            socket.emit('updateHand', player.hand);
        }
    });

    socket.on('passTurn', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        const player = room.players[room.currentTurnIndex];
        if (player.id !== socket.id) return socket.emit('errorMsg', "មិនទាន់ដល់វេនរបស់អ្នកឡើយ!");
        
        if (room.lastPlayedCards.length === 0 || room.lastPlayedUserId === null) {
            return socket.emit('errorMsg', "អ្នកជាមេក្ដារ មិនអាចរំលងវេន (Pass) បានឡើយ!");
        }

        player.hasPassed = true;
        handleTurnAndRoundStatus(room);

        io.to(room.id).emit('turnPassed', {
            nextTurn: room.currentTurnIndex,
            id: player.id,
            name: player.name,
            roomPlayers: room.players
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});