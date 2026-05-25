// =================================================================
// server.js (កំណែទម្រង់ពេញលេញ - រួមបញ្ចូល ទៀនឡេន និង កាតេ ព្រមទាំងមាន Console)
// =================================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingTimeout: 60000, 
    pingInterval: 25000 
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});
app.get('/tienlen', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/kate', (req, res) => {
    res.sendFile(path.join(__dirname, 'index_kate.html'));
});

// ផ្ទុកទិន្នន័យបន្ទប់ហ្គេមដាច់ដោយឡែកពីគ្នា
const rooms = {};   // សម្រាប់ Tien Len
const ktRooms = {}; // សម្រាប់ Ka Te

// ==========================================
// ផ្នែកទិន្នន័យរួម និងជំនួយសម្រាប់បៀរ
// ==========================================
const CARD_ORDER = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUIT_ORDER = { '♠': 0, '♣': 1, '♦': 2, '♥': 3 };

const KATE_ORDER = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const KATE_SUITS = ['♠', '♣', '♦', '♥'];

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

function createKateDeck() {
    const deck = [];
    for (const suit of KATE_SUITS) {
        for (const value of KATE_ORDER) {
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

function getKatePower(card) {
    return KATE_ORDER.indexOf(card.value);
}

function sortCards(cards) {
    return cards.sort((a, b) => getCardPower(a) - getCardPower(b));
}

function sortKateCards(cards) {
    return cards.sort((a, b) => KATE_ORDER.indexOf(a.value) - KATE_ORDER.indexOf(b.value));
}

// ==========================================
// LOGIC ច្បាប់ហ្គេម ទៀនឡេន (TIEN LEN)
// ==========================================
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

function checkInstantWin(hand) {
    if (!hand || hand.length !== 13) return null;
    const sorted = sortCards([...hand]);

    let isDragonStraight = true;
    for (let i = 0; i < 12; i++) {
        if (CARD_ORDER.indexOf(sorted[i+1].value) !== CARD_ORDER.indexOf(sorted[i].value) + 1) {
            isDragonStraight = false;
            break;
        }
    }
    if (isDragonStraight) return "បៀមួយទឹកខ្សែនាគ (ស៊ុយដាច់)!";

    const isRed = (card) => card.suit === '♦' || card.suit === '♥';
    const isBlack = (card) => card.suit === '♠' || card.suit === '♣';
    if (hand.every(isRed) || hand.every(isBlack)) return "បៀមួយពណ៌ (ស៊ុយដាច់)!";

    let pairCount = 0;
    let i = 0;
    while (i < 12) {
        if (sorted[i].value === sorted[i+1].value) {
            pairCount++; i += 2; 
        } else { i++; }
    }
    if (pairCount >= 6) return "បៀមាន ៦ គូ (ស៊ុយដាច់)!";

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
        if (p && p.hand.length > 0 && !p.passed && !p.isSpectator) {
            nextIndex = checkIndex;
            found = true;
            break;
        }
    }
    if (found) room.currentTurnIndex = nextIndex;
}

function handleTurnAndRoundStatus(room) {
    const activePlayersInRound = room.players.filter(p => p.hand.length > 0 && !p.passed && !p.isSpectator);
    let lastPlayerIdx = room.players.findIndex(p => p.id === room.lastPlayerId);
    const isLastPlayerOut = (lastPlayerIdx !== -1 && room.players[lastPlayerIdx].hand.length === 0);
    const isRoundOver = isLastPlayerOut ? (activePlayersInRound.length === 0) : (activePlayersInRound.length <= 1);

    if (isRoundOver) {
        room.playedCards = [];
        room.players.forEach(p => { if (p.hand.length > 0) p.passed = false; });

        if (isLastPlayerOut) {
            let nextIndex = (lastPlayerIdx + 1) % room.players.length;
            while (room.players[nextIndex].hand.length === 0 || room.players[nextIndex].isSpectator) {
                nextIndex = (nextIndex + 1) % room.players.length;
            }
            room.currentTurnIndex = nextIndex;
            room.lastPlayerId = room.players[nextIndex].id;
        } else {
            room.currentTurnIndex = lastPlayerIdx !== -1 ? lastPlayerIdx : room.currentTurnIndex;
        }
        io.to(room.roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
    } else {
        moveToNextTurn(room);
    }
}

function broadcastRoomList() {
    const tlList = Object.keys(rooms).map(id => ({
        roomId: id, playerCount: rooms[id].players.length, status: rooms[id].status, hasPassword: !!rooms[id].password
    }));
    io.emit('roomList', tlList);

    const ktList = Object.keys(ktRooms).map(id => ({
        roomId: id, playerCount: ktRooms[id].players.length, status: ktRooms[id].status, hasPassword: !!ktRooms[id].password
    }));
    io.emit('ktRoomList', ktList);
}

// ==========================================
// ប្រព័ន្ធតភ្ជាប់ SOCKET.IO (CORE LOBBY & VOICE)
// ==========================================
io.on('connection', (socket) => {
    console.log(`[CONNECTED] សមាជិកថ្មីបានភ្ជាប់មកកាន់ Server ID: ${socket.id}`);
    broadcastRoomList();

    socket.on('voice_signal', (data) => {
        io.to(data.target).emit('voice_signal', { sender: socket.id, signal: data.signal });
    });

    // ------------------------------------------
    // EVENTS សម្រាប់ ទៀនឡេន (TIEN LEN)
    // ------------------------------------------
    socket.on('createRoom', ({ roomId, password, playerName }) => {
        if (rooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        
        rooms[roomId] = {
            roomId, password: password || "", status: 'waiting', creatorId: socket.id,
            players: [{ id: socket.id, name: playerName || 'Player 1', hand: [], passed: false, isSpectator: false, rank: null }],
            currentTurnIndex: 0, playedCards: [], lastPlayerId: null, lastWinnerId: null, nextRank: 1
        };
        socket.join(roomId);
        console.log(`[TIEN LEN] បន្ទប់ ${roomId} ត្រូវបានបង្កើតឡើងដោយ ${playerName}`);
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
        socket.to(roomId).emit('voice_user_joined', { id: socket.id });
        room.players.forEach(p => socket.emit('voice_initiate_peer', { target: p.id }));

        room.players.push({ id: socket.id, name: playerName || 'Guest', hand: [], passed: false, isSpectator, rank: null });
        socket.join(roomId);
        console.log(`[TIEN LEN] ${playerName} បានចូលរួមបន្ទប់ ${roomId}`);

        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator, playedCards: room.playedCards, currentTurnIndex: room.currentTurnIndex });
        io.to(roomId).emit('updatePlayers', room.players);
        broadcastRoomList();
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId]; if (!room) return;
        if (room.lastWinnerId ? room.lastWinnerId !== socket.id : room.creatorId !== socket.id) {
            return socket.emit('errorMsg', 'អ្នកគ្មានសិទ្ធិចុចចាប់ផ្ដើមឡើយ!');
        }

        room.players.forEach(p => { p.isSpectator = false; p.hand = []; p.passed = false; p.rank = null; });
        const activePlayers = room.players.filter(p => !p.isSpectator);
        if (activePlayers.length < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់!');

        console.log(`[TIEN LEN] ហ្គេមកំពុងចាប់ផ្ដើមនៅក្នុងបន្ទប់: ${roomId}`);
        const deck = shuffleDeck(createDeck());
        room.status = 'playing'; room.playedCards = []; room.lastPlayerId = null; room.nextRank = 1;
        room.players.forEach((p, i) => p.hand = sortCards(deck.slice(i * 13, (i + 1) * 13)));

        // ពិនិត្យឈ្នះស៊ុយដាច់
        let instantWinner = null; let winReason = "";
        for (let p of activePlayers) {
            const reason = checkInstantWin(p.hand);
            if (reason) { instantWinner = p; winReason = reason; break; }
        }

        if (instantWinner) {
            console.log(`[TIEN LEN] ឈ្នះស៊ុយដាច់បានទៅលើ៖ ${instantWinner.name}`);
            instantWinner.rank = 1; room.lastWinnerId = instantWinner.id;
            let currRank = 2;
            room.players.forEach(p => { if (p.id !== instantWinner.id) p.rank = currRank++; });
            room.status = 'waiting';

            const results = room.players.map(p => ({ id: p.id, name: p.name, remaining: [...p.hand], isSpectator: p.isSpectator, rank: p.rank }));
            io.to(roomId).emit('instantWinOccurred', { winnerName: instantWinner.name, reason: winReason, allHands: results });
            broadcastRoomList();
            return;
        }

        room.players.forEach(p => io.to(p.id).emit('dealCards', { hand: p.hand }));
        let startIdx = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : room.players.findIndex(p => p.hand.some(c => c.value === '3' && c.suit === '♠'));
        if (startIdx === -1) startIdx = 0;
        room.currentTurnIndex = startIdx;

        io.to(roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex, lastRoundWinnerId: room.lastWinnerId });
        broadcastRoomList();
    });

    socket.on('playCard', ({ roomId, cards }) => {
        const room = rooms[roomId]; if (!room) return;
        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ');

        if (getComboType(cards) && comparePlay(cards, room.playedCards)) {
            cards.forEach(c => {
                const idx = player.hand.findIndex(pc => pc.value === c.value && pc.suit === c.suit);
                if (idx !== -1) player.hand.splice(idx, 1);
            });

            console.log(`[TIEN LEN] ${player.name} បានចុះបៀរ៖`, cards.map(c => c.value + c.suit).join(', '));
            room.playedCards = cards; room.lastPlayerId = socket.id; player.passed = false;
            let isDoubleWin = false;

            if (player.hand.length === 0) {
                player.rank = room.nextRank++;
                if (player.rank === 1) {
                    room.lastWinnerId = player.id;
                    const opponents = room.players.filter(p => !p.isSpectator && p.id !== player.id);
                    if (opponents.every(opp => opp.hand.length === 13)) {
                        isDoubleWin = true;
                        opponents.forEach(opp => opp.rank = room.nextRank++);
                    }
                }
            }

            const activeRem = room.players.filter(p => p.hand.length > 0 && !p.isSpectator);
            if (activeRem.length <= 1 || isDoubleWin) {
                if (activeRem.length === 1 && !isDoubleWin) activeRem[0].rank = room.nextRank;
                room.status = 'waiting';

                const results = room.players.map(p => ({
                    id: p.id, name: p.name, remaining: [...p.hand], isSpectator: p.isSpectator, rank: p.rank, isDoubleLeaved: isDoubleWin && p.id !== player.id
                }));

                io.to(roomId).emit('cardPlayed', { by: player.name, cards, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players });
                setTimeout(() => {
                    const finalWinner = room.players.find(p => p.rank === 1);
                    room.lastWinnerId = finalWinner ? finalWinner.id : null;
                    io.to(roomId).emit('gameWon', { winner: finalWinner ? finalWinner.name : 'រកមិនឃើញ', winnerId: room.lastWinnerId, allHands: results, isDoubleWin });
                    broadcastRoomList();
                }, 1500);
            } else {
                handleTurnAndRoundStatus(room);
                io.to(roomId).emit('cardPlayed', { by: player.name, cards, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players });
            }
        } else {
            socket.emit('errorMsg', 'ចុះមិនត្រូវក្បួន ឬបៀតូចជាង!');
        }
    });

    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId]; if (!room) return;
        const player = room.players[room.currentTurnIndex]; if (!player || player.id !== socket.id) return;

        player.passed = true;
        console.log(`[TIEN LEN] ${player.name} ចុច Pass រំលងវេន`);
        io.to(roomId).emit('playerPassed', { name: player.name, id: player.id });
        
        handleTurnAndRoundStatus(room);
        io.to(roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players });
    });

    socket.on('leaveRoom', () => {
        handlePlayerExit(socket, 'leaveRoom');
    });

    socket.on('disconnect', () => {
        console.log(`[DISCONNECTED] សមាជិកបានដាច់ការតភ្ជាប់ ID: ${socket.id}`);
        handlePlayerExit(socket, 'disconnect');
    });

    // =================================================================
    // EVENTS សម្រាប់ កាតេ (KA TE) - កូដថ្មី ដំណើរការឥតមាន Bug
    // =================================================================
    socket.on('kt_createRoom', ({ roomId, password, playerName }) => {
        if (ktRooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        ktRooms[roomId] = {
            roomId, password: password || "", status: 'waiting', creatorId: socket.id,
            players: [{ id: socket.id, name: playerName || 'អ្នកលេង ១', hand: [], isSpectator: false, hasCat: false, winRounds: 0, finalWinner: false }],
            currentTurnIndex: 0, currentRound: 1, tableCards: [], roundSuit: null, lastWinnerId: null
        };
        socket.join('kt_' + roomId);
        console.log(`[KA TE] បន្ទប់ ${roomId} ត្រូវបានបង្កើតឡើងដោយ ${playerName}`);
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to('kt_' + roomId).emit('updatePlayers', ktRooms[roomId].players);
        
        io.to('kt_' + roomId).emit('voice_user_joined', socket.id);
        socket.emit('voice_initiate_peer', { target: socket.id });
        broadcastRoomLists();
    });

    socket.on('kt_joinRoom', ({ roomId, password, playerName }) => {
        const room = ktRooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់!');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');
        if (room.players.length >= 4 && room.status !== 'playing') return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

        const isSpectator = (room.status === 'playing' || room.players.length >= 4);
        room.players.push({ id: socket.id, name: playerName || 'ភ្ញៀវ', hand: [], isSpectator, hasCat: false, winRounds: 0, finalWinner: false });
        
        socket.join('kt_' + roomId);
        console.log(`[KA TE] ${playerName} បានចូលរួមបន្ទប់កាតេ ${roomId}`);
        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator });
        io.to('kt_' + roomId).emit('updatePlayers', room.players);
        
        io.to('kt_' + roomId).emit('voice_user_joined', socket.id);
        room.players.forEach(p => { if (p.id !== socket.id) socket.emit('voice_initiate_peer', { target: p.id }); });
        broadcastRoomLists();
    });

    socket.on('kt_startGame', (roomId) => {
        const room = ktRooms[roomId]; if (!room) return;
        const deck = shuffleDeck(createKateDeck());
        room.status = 'playing'; room.currentRound = 1; room.tableCards = []; room.roundSuit = null;
        
        room.players.forEach((p, i) => {
            if (!p.isSpectator) {
                p.hand = sortKateCards(deck.slice(i * 6, (i + 1) * 6));
                p.hasCat = false; p.winRounds = 0; p.finalWinner = false;
            }
        });

        console.log(`[KA TE] ចាប់ផ្ដើមចែកបៀរកាតេនៅក្នុងបន្ទប់: ${roomId}`);
        room.players.forEach(p => { if(!p.isSpectator) io.to(p.id).emit('dealCards', { hand: p.hand }); });
        room.currentTurnIndex = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : room.players.findIndex(p => !p.isSpectator);
        if (room.currentTurnIndex === -1) room.currentTurnIndex = 0;
        
        io.to('kt_' + roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex, currentRound: room.currentRound, lastRoundWinnerId: room.lastWinnerId });
    });

    socket.on('kt_playMove', ({ roomId, action, card }) => {
        const room = ktRooms[roomId]; if (!room) return;
        let player = room.players[room.currentTurnIndex]; if (player.id !== socket.id) return;

        // កាត់សន្លឹកបៀរចេញពីដៃភ្លាមៗ (ដោះស្រាយ Bug បៀរគាំងនៅ ៦សន្លឹក)
        const cardIdx = player.hand.findIndex(c => c.value === card.value && c.suit === card.suit);
        if (cardIdx !== -1) player.hand.splice(cardIdx, 1);

        console.log(`[KA TE] ${player.name} ចុះបៀរជុំទី ${room.currentRound} សកម្មភាព៖ ${action}`);

        if (room.currentRound <= 4) {
            if (action === 'play') {
                if (room.tableCards.length === 0) room.roundSuit = card.suit;
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'ស៊ីបៀរ' });
            } else {
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'ផ្កាប់បៀរ' });
            }
        } 
        else if (room.currentRound === 5) {
            if (room.tableCards.length === 0) {
                room.roundSuit = card.suit;
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'គប់ទេ' });
            } else {
                const targetCard = room.tableCards[0].card;
                const isMatch = (card.suit === room.roundSuit && getKatePower(card) > getKatePower(targetCard));
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: isMatch ? 'គប់ហើយ' : 'អត់គប់ទេ' });
            }
        } 
        else if (room.currentRound === 6) {
            room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'លទ្ធផលចុងក្រោយ' });
        }

        io.to('kt_' + roomId).emit('moveRecorded', { by: player.name, action, card, tableCards: room.tableCards, round: room.currentRound });
        io.to(player.id).emit('dealCards', { hand: player.hand }); 

        // រកវេនបន្ទាប់
        let nextTurn = (room.currentTurnIndex + 1) % room.players.length;
        let attempts = 0;
        while (room.players[nextTurn].isSpectator && attempts < room.players.length) {
            nextTurn = (nextTurn + 1) % room.players.length;
            attempts++;
        }
        room.currentTurnIndex = nextTurn;

        const activePlayers = room.players.filter(p => !p.isSpectator);
        
        // ពេលទម្លាក់គ្រប់គ្នាអស់ក្នុងជុំនីមួយៗ
        if (room.tableCards.length === activePlayers.length) {
            setTimeout(() => {
                let winMove = null;
                
                if (room.currentRound <= 4) {
                    const validMoves = room.tableCards.filter(m => m.action === 'ស៊ីបៀរ' || m.action === 'គប់ទេ');
                    const matchSuit = validMoves.filter(m => m.card.suit === room.roundSuit);
                    if (matchSuit.length > 0) {
                        matchSuit.sort((a,b) => getKatePower(b.card) - getKatePower(a.card));
                        winMove = matchSuit[0];
                    } else if (validMoves.length > 0) {
                        winMove = validMoves[0];
                    }
                } else if (room.currentRound === 5) {
                    const cutters = room.tableCards.filter(m => m.action === 'គប់ហើយ');
                    if (cutters.length > 0) {
                        cutters.sort((a,b) => getKatePower(b.card) - getKatePower(a.card));
                        winMove = cutters[0];
                    } else {
                        winMove = room.tableCards[0]; 
                    }
                } else {
                    winMove = room.tableCards[0];
                }

                if (winMove) {
                    const winnerPl = room.players.find(p => p.id === winMove.playerId);
                    if(winnerPl) {
                        winnerPl.winRounds++;
                        if(room.currentRound <= 4) winnerPl.hasCat = true;
                        room.lastWinnerId = winnerPl.id;
                        room.currentTurnIndex = room.players.findIndex(p => p.id === winnerPl.id);
                        io.to('kt_' + roomId).emit('winnerTransferred', { newWinnerId: room.lastWinnerId, creatorId: room.creatorId });
                    }
                }

                // ចប់ជុំទី៤៖ អ្នកមិនធ្លាប់ស៊ីសោះ ត្រូវងាប់ (Spectator)
                if (room.currentRound === 4) {
                    room.players.forEach(p => { if (!p.isSpectator && !p.hasCat) p.isSpectator = true; });
                }

                if (room.currentRound < 6) {
                    room.currentRound++;
                    room.tableCards = []; room.roundSuit = null;
                    const survivors = room.players.filter(p => !p.isSpectator);
                    
                    if (survivors.length === 1) {
                        room.status = 'waiting'; survivors[0].finalWinner = true;
                        io.to('kt_' + roomId).emit('gameWon', { winner: survivors[0].name, winnerId: survivors[0].id, allHands: room.players });
                    } else {
                        io.to('kt_' + roomId).emit('nextRoundStarted', { currentRound: room.currentRound, winnerName: winMove ? winMove.name : 'គ្មាន', currentTurnIndex: room.currentTurnIndex, players: room.players });
                    }
                } else {
                    room.status = 'waiting';
                    const finalWinner = room.players.find(p => p.id === room.lastWinnerId);
                    if(finalWinner) finalWinner.finalWinner = true;
                    io.to('kt_' + roomId).emit('gameWon', { winner: finalWinner ? finalWinner.name : 'គ្មានអ្នកឈ្នះ', winnerId: room.lastWinnerId, allHands: room.players });
                }
            }, 1500);
        } else {
            io.to('kt_' + roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players });
        }
    });

    socket.on('kt_leaveRoom', (roomId) => {
        handleKatePlayerExit(socket, roomId);
    });
});

// ជំនួយការចាកចេញសម្រាប់ Tien Len
function handlePlayerExit(socket, eventType) {
    for (const id in rooms) {
        const room = rooms[id];
        const pIdx = room.players.findIndex(p => p.id === socket.id);
        if (pIdx !== -1) {
            const leavingPlayerId = socket.id;
            socket.to(id).emit('voice_user_left', { id: socket.id });
            room.players.splice(pIdx, 1);
            if (eventType === 'leaveRoom') socket.leave(id);

            if (room.players.length === 0) {
                delete rooms[id];
            } else {
                if (room.creatorId === leavingPlayerId) room.creatorId = room.players[0].id;
                if (room.lastWinnerId === leavingPlayerId) {
                    const nextP = room.players.find(p => !p.isSpectator);
                    room.lastWinnerId = nextP ? nextP.id : null;
                }
                io.to(id).emit('updatePlayers', room.players);
                io.to(id).emit('winnerTransferred', { newWinnerId: room.lastWinnerId, creatorId: room.creatorId });
            }
            broadcastRoomList();
        }
    }
}

// ជំនួយការចាកចេញសម្រាប់ Ka Te
function handleKatePlayerExit(socket, roomId) {
    const id = roomId || Object.keys(ktRooms).find(k => ktRooms[k].players.some(p => p.id === socket.id));
    if (!id) return;
    const room = ktRooms[id]; if (!room) return;
    const pIdx = room.players.findIndex(p => p.id === socket.id);
    if (pIdx !== -1) {
        room.players.splice(pIdx, 1);
        socket.leave('kt_' + id);
        socket.emit('leftRoom');
        if (room.players.length === 0) {
            delete ktRooms[id];
        } else {
            if (room.creatorId === socket.id) room.creatorId = room.players[0].id;
            io.to('kt_' + id).emit('updatePlayers', room.players);
        }
        broadcastRoomLists();
    }
}

function broadcastRoomLists() {
    const ktList = Object.keys(ktRooms).map(id => ({
        roomId: id, playerCount: ktRooms[id].players.length, status: ktRooms[id].status, hasPassword: !!ktRooms[id].password
    }));
    io.emit('ktRoomList', ktList);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[SERVER RUNNING] ប្រព័ន្ធហ្គេមបៀរដំណើរការលើ Port: ${PORT}`));