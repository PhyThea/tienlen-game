// =================================================================
// server.js (មជ្ឈមណ្ឌលហ្គេមបៀអនឡាញ - ទៀនឡេន និង កាតេ ពេញលេញ ១០០%)
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

// Routing សម្រាប់ទំព័រនីមួយៗ
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'main.html')));
app.get('/tienlen', (req, res) => res.sendFile(path.join(__dirname, 'index_tienlen.html')));
app.get('/kate', (req, res) => res.sendFile(path.join(__dirname, 'index_kate.html')));

// ទិន្នន័យបន្ទប់ហ្គេមទាំងពីរ
const tlRooms = {};
const ktRooms = {};

// ទាញយក Module ជំនួយរបស់ Tien Len
const tlModule = require('./server_tienlen.js');

// មុខងារជំនួយសម្រាប់ Ka Te Core Logic
const ktModule = {
    createKateDeck: () => {
        const order = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
        const suits = ['♠', '♣', '♦', '♥'];
        const deck = [];
        for (const suit of suits) {
            for (const value of order) { deck.push({ suit, value }); }
        }
        return deck;
    },
    getKatePower: (card) => {
        const order = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
        const suits = { '♠': 0, '♣': 1, '♦': 2, '♥': 3 };
        return (order.indexOf(card.value) * 10) + suits[card.suit];
    },
    sortKateCards: (cards) => {
        return cards.sort((a, b) => ktModule.getKatePower(a) - ktModule.getKatePower(b));
    }
};

// មុខងារចម្លងបញ្ជីបន្ទប់ទៅកាន់ទំព័រ Main Menu
function broadcastRoomLists() {
    const tlList = Object.keys(tlRooms).map(id => ({
        roomId: id, playerCount: tlRooms[id].players.length, status: tlRooms[id].status, hasPassword: !!tlRooms[id].password
    }));
    const ktList = Object.keys(ktRooms).map(id => ({
        roomId: id, playerCount: ktRooms[id].players.length, status: ktRooms[id].status, hasPassword: !!ktRooms[id].password
    }));
    io.emit('tlRoomList', tlList);
    io.emit('ktRoomList', ktList);
}

// -----------------------------------------------------------------
// 🃏 Logic សម្រាប់ហ្គេម ទៀនឡេន (Tien Len Server Logic)
// -----------------------------------------------------------------
function moveToNextTurn(room) {
    let originalIndex = room.currentTurnIndex;
    let nextIndex = originalIndex;
    let found = false;
    for (let i = 1; i <= room.players.length; i++) {
        let checkIndex = (originalIndex + i) % room.players.length;
        let p = room.players[checkIndex];
        if (p && p.hand.length > 0 && !p.passed) {
            nextIndex = checkIndex; found = true; break;
        }
    }
    if (found) room.currentTurnIndex = nextIndex;
}

function handleTurnAndRoundStatus(room) {
    const activePlayersInRound = room.players.filter(p => p.hand.length > 0 && !p.passed);
    let lastPlayerIdx = room.players.findIndex(p => p.id === room.lastPlayerId);
    const isLastPlayerOut = (lastPlayerIdx !== -1 && room.players[lastPlayerIdx].hand.length === 0);
    const isRoundOver = isLastPlayerOut ? (activePlayersInRound.length === 0) : (activePlayersInRound.length <= 1);

    if (isRoundOver) {
        room.playedCards = [];
        room.players.forEach(p => { if (p.hand.length > 0) p.passed = false; });

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
        io.to('tl_' + room.roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
        io.to('tl_' + room.roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players });
    } else {
        moveToNextTurn(room);
    }
}

// -----------------------------------------------------------------
// ប្រព័ន្ធគាំទ្រ Voice Chat & Socket Connections 
// -----------------------------------------------------------------
io.on('connection', (socket) => {
    broadcastRoomLists();

    // បញ្ជូនសញ្ញា Voice Chat (WebRTC Signaling)
    socket.on('voice_signal', (data) => {
        io.to(data.target).emit('voice_signal', { sender: socket.id, signal: data.signal });
    });

    // --- TIEN LEN EVENTS ---
    socket.on('createRoom', ({ roomId, password, playerName }) => {
        if (tlRooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        tlRooms[roomId] = {
            roomId, password: password || "", status: 'waiting', creatorId: socket.id,
            players: [{ id: socket.id, name: playerName || 'Player 1', hand: [], passed: false, isSpectator: false, rank: null }],
            currentTurnIndex: 0, playedCards: [], lastPlayerId: null, lastWinnerId: null, nextRank: 1
        };
        socket.join('tl_' + roomId);
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to('tl_' + roomId).emit('updatePlayers', tlRooms[roomId].players);
        broadcastRoomLists();
    });

    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = tlRooms[roomId]; if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់!');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

        const isSpectator = room.status === 'playing';
        socket.to('tl_' + roomId).emit('voice_user_joined', { id: socket.id });
        room.players.forEach(p => socket.emit('voice_initiate_peer', { target: p.id }));

        room.players.push({ id: socket.id, name: playerName || 'Guest', hand: [], passed: false, isSpectator, rank: null });
        socket.join('tl_' + roomId);
        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator, playedCards: room.playedCards, currentTurnIndex: room.currentTurnIndex });
        io.to('tl_' + roomId).emit('updatePlayers', room.players);
        broadcastRoomLists();
    });

    socket.on('startGame', (roomId) => {
        const room = tlRooms[roomId]; if (!room) return;
        if (!room.lastWinnerId ? room.creatorId !== socket.id : room.lastWinnerId !== socket.id) {
            return socket.emit('errorMsg', 'អ្នកគ្មានសិទ្ធិចាប់ផ្ដើមហ្គេមឡើយ!');
        }

        // 🚨 កែសម្រួល៖ កំណត់ស្ថានភាពអ្នកលេង ៤ នាក់ដំបូងឱ្យទៅជា Active Players និងអ្នកសល់ពីនោះជា Spectators
        room.players.forEach((p, idx) => {
            if (idx < 4) {
                p.isSpectator = false;
                p.hand = [];
                p.passed = false;
                p.rank = null;
            } else {
                p.isSpectator = true;
                p.hand = [];
                p.passed = false;
                p.rank = null;
            }
        });

        // ច្រោះយកតែអ្នកលេងពិតប្រាកដ (Active Players)
        const activePlayers = room.players.filter(p => !p.isSpectator);
        if (activePlayers.length < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់!');

        const deck = tlModule.shuffleDeck(tlModule.createDeck());
        room.status = 'playing'; room.playedCards = []; room.lastPlayerId = null; room.nextRank = 1;

        // 🚨 ជួសជុលចំណុចស្លាប់៖ រត់ឡូប (Loop) ចែកបៀរទៅតាម activePlayers វិញ ធានាលេងបាន ៤ នាក់ពេញៗមាត់
        activePlayers.forEach((p, i) => { 
            p.hand = tlModule.sortCards(deck.slice(i * 13, (i + 1) * 13)); 
        });

        // ឆែកករណីឈ្នះស៊ុយដាច់ភ្លាមៗ
        let instantWinner = null; let winReason = "";
        for (let p of activePlayers) {
            const reason = tlModule.checkInstantWin(p.hand);
            if (reason) { instantWinner = p; winReason = reason; break; }
        }

        if (instantWinner) {
            instantWinner.rank = 1; room.lastWinnerId = instantWinner.id; let currentRank = 2;
            room.players.forEach(p => { if (!p.isSpectator && p.id !== instantWinner.id) p.rank = currentRank++; });
            room.status = 'waiting';
            const results = room.players.map(p => ({ id: p.id, name: p.name, remaining: [...p.hand], isSpectator: p.isSpectator, rank: p.rank }));
            io.to('tl_' + roomId).emit('instantWinOccurred', { winnerName: instantWinner.name, reason: winReason, allHands: results });
            broadcastRoomLists(); return;
        }

        // បញ្ជូនសន្លឹកបៀរទៅឱ្យ Client នីមួយៗ
        room.players.forEach(p => {
            if (!p.isSpectator) io.to(p.id).emit('dealCards', { hand: p.hand });
        });

        let startIdx = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : room.players.findIndex(p => p.hand.some(c => c.value === '3' && c.suit === '♠'));
        room.currentTurnIndex = startIdx === -1 ? 0 : startIdx;

        io.to('tl_' + roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex, lastRoundWinnerId: room.lastWinnerId });
        broadcastRoomLists();
    });

    socket.on('playCard', ({ roomId, cards }) => {
        const room = tlRooms[roomId]; if (!room) return;
        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id || player.hand.length === 0) return;

        if (tlModule.getComboType(cards) && tlModule.comparePlay(cards, room.playedCards)) {
            cards.forEach(c => {
                const idx = player.hand.findIndex(pc => pc.value === c.value && pc.suit === c.suit);
                if (idx !== -1) player.hand.splice(idx, 1);
            });

            room.playedCards = cards; room.lastPlayerId = socket.id; player.passed = false;
            let isDoubleWin = false;

            if (player.hand.length === 0) {
                player.rank = room.nextRank; room.nextRank++;
                if (player.rank === 1) {
                    room.lastWinnerId = player.id;
                    const opponents = room.players.filter(p => !p.isSpectator && p.id !== player.id);
                    if (opponents.every(p => p.hand.length === 13)) {
                        isDoubleWin = true;
                        opponents.forEach(opp => { opp.rank = room.nextRank; room.nextRank++; });
                    }
                }
            }

            const remainingActive = room.players.filter(p => p.hand.length > 0);
            if (remainingActive.length <= 1 || isDoubleWin) {
                if (remainingActive.length === 1 && !isDoubleWin) remainingActive[0].rank = room.nextRank;
                room.status = 'waiting';
                const results = room.players.map(p => ({
                    id: p.id, name: p.name, remaining: [...p.hand], isSpectator: p.hand.length === 0 && p.rank !== null ? false : p.isSpectator, rank: p.rank, isDoubleLeaved: isDoubleWin && p.id !== player.id
                }));

                io.to('tl_' + roomId).emit('cardPlayed', { by: player.name, cards, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players });
                setTimeout(() => {
                    const finalWinner = room.players.find(p => p.rank === 1);
                    room.lastWinnerId = finalWinner ? finalWinner.id : null;
                    io.to('tl_' + roomId).emit('gameWon', { winner: finalWinner ? finalWinner.name : 'រកមិនឃើញ', winnerId: room.lastWinnerId, allHands: results, isDoubleWin });
                    broadcastRoomLists();
                }, 1500);
            } else {
                handleTurnAndRoundStatus(room);
                io.to('tl_' + roomId).emit('cardPlayed', { by: player.name, cards, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players });
            }
        } else {
            socket.emit('errorMsg', 'ចុះមិនត្រូវក្បួន ឬបៀតូចជាង!');
        }
    });

    socket.on('passTurn', (roomId) => {
        const room = tlRooms[roomId]; if (!room) return;
        const player = room.players[room.currentTurnIndex]; if (!player || player.id !== socket.id) return;
        player.passed = true;
        io.to('tl_' + roomId).emit('playerPassed', { name: player.name, id: player.id });
        handleTurnAndRoundStatus(room);
    });

    // មុខងារដោះស្រាយពេលចាកចេញពីបន្ទប់ Tien Len
    socket.on('leaveRoom', () => {
        for (const id in tlRooms) {
            const room = tlRooms[id]; const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                const wasSpectator = room.players[pIdx].isSpectator;
                socket.to('tl_' + id).emit('voice_user_left', { id: socket.id });
                room.players.splice(pIdx, 1); socket.leave('tl_' + id); socket.emit('leftRoom');
                if (room.players.length === 0) { delete tlRooms[id]; } else {
                    if (room.creatorId === socket.id) room.creatorId = room.players[0].id;
                    if (room.status === 'playing' && !wasSpectator && room.currentTurnIndex === pIdx) handleTurnAndRoundStatus(room);
                    io.to('tl_' + id).emit('updatePlayers', room.players);
                    io.to('tl_' + id).emit('winnerTransferred', { newWinnerId: room.lastWinnerId, creatorId: room.creatorId });
                }
                broadcastRoomLists();
            }
        }
    });

    // រួមបញ្ចូលប្រព័ន្ធហ្គេម Ka Te (ទាញចេញពី server_kate.js)
    require('./server_kate.js')(io, ktRooms, broadcastRoomLists, tlModule, ktModule);

    // ពិនិត្យមើលការដាច់ការតភ្ជាប់ (Disconnect)
    socket.on('disconnect', () => {
        // សម្អាតបន្ទប់ Tien Len
        for (const id in tlRooms) {
            const room = tlRooms[id]; const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                const wasSpectator = room.players[pIdx].isSpectator;
                socket.to('tl_' + id).emit('voice_user_left', { id: socket.id });
                room.players.splice(pIdx, 1);
                if (room.players.length === 0) { delete tlRooms[id]; } else {
                    if (room.creatorId === socket.id) room.creatorId = room.players[0].id;
                    if (room.status === 'playing' && !wasSpectator && room.currentTurnIndex === pIdx) handleTurnAndRoundStatus(room);
                    io.to('tl_' + id).emit('updatePlayers', room.players);
                }
            }
        }
        // សម្អាតបន្ទប់ Ka Te
        for (const id in ktRooms) {
            const room = ktRooms[id]; const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                socket.to('kt_' + id).emit('voice_user_left', { id: socket.id });
                room.players.splice(pIdx, 1);
                if (room.players.length === 0) delete ktRooms[id]; else io.to('kt_' + id).emit('updatePlayers', room.players);
            }
        }
        broadcastRoomLists();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`👉 Server is running on port ${PORT}`));