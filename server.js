// =================================================================
// server.js (កំណែទម្រង់ជួសជុលរួចរាល់ ១០០% - លុបកំហុស Crash ទាំងអស់)
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

// នាំចូលម៉ូឌុលទៀនឡេន
const tlModule = require('./server_tienlen');

// បង្កើត Object ជំនួស ktModule ដោយសរសេរ Logic កាតេផ្ទាល់ខ្លួន ដើម្បីកុំឱ្យ Crash ជាមួយទៀនឡេន
const ktModule = {
    createKateDeck: () => {
        const suits = ['♠', '♣', '♦', '♥'];
        const values = ['A','K','Q','J','10','9','8','7','6','5','4','3','2']; // លំដាប់កាតេ អាត់ធំជាងគេ លេខ២តូចជាងគេ
        const deck = [];
        for (const suit of suits) {
            for (const value of values) { deck.push({ suit, value }); }
        }
        return deck;
    },
    getKatePower: (card) => {
        const order = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']; // ២ តូចបំផុត អាត់ ធំបំផុត
        const suitOrder = { '♠': 0, '♣': 1, '♦': 2, '♥': 3 };
        return (order.indexOf(card.value) * 10) + suitOrder[card.suit];
    },
    sortKateCards: function(cards) {
        return cards.sort((a, b) => this.getKatePower(a) - this.getKatePower(b));
    }
};

app.use(express.static(__dirname));

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'main.html')); });
app.get('/tienlen', (req, res) => { res.sendFile(path.join(__dirname, 'index_tienlen.html')); });
app.get('/kate', (req, res) => { res.sendFile(path.join(__dirname, 'index_kate.html')); });

const tlRooms = {}; 
const ktRooms = {}; 

function getRoomList(roomsObj) {
    return Object.keys(roomsObj).map(id => {
        const r = roomsObj[id];
        return { roomId: id, playerCount: r.players.length, status: r.status, hasPassword: !!r.password };
    });
}

function broadcastRoomLists() {
    io.emit('tlRoomList', getRoomList(tlRooms));
    io.emit('ktRoomList', getRoomList(ktRooms));
    io.emit('roomList', getRoomList(tlRooms)); 
}

// បញ្ជូន ktModule ដែលមានមុខងារកាតេត្រឹមត្រូវទៅឱ្យ server_kate.js
require('./server_kate')(io, ktRooms, broadcastRoomLists, tlModule, ktModule);

io.on('connection', (socket) => {
    broadcastRoomLists();

    socket.on('voice_signal', (data) => {
        io.to(data.target).emit('voice_signal', { sender: socket.id, signal: data.signal });
    });

    // ==========================================
    // EVENTS - ទៀនឡេន (TIEN LEN)
    // ==========================================
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
        const room = tlRooms[roomId]; if (!room) return;
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
        if (room.lastWinnerId ? room.lastWinnerId !== socket.id : room.creatorId !== socket.id) return socket.emit('errorMsg', 'អ្នកគ្មានសិទ្ធិចាប់ផ្ដើមឡើយ!');
        room.players.forEach(p => { p.isSpectator = false; p.hand = []; p.passed = false; p.rank = null; });
        const activePlayers = room.players.filter(p => !p.isSpectator);
        if (activePlayers.length < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់!');

        const deck = tlModule.shuffleDeck(tlModule.createDeck());
        room.status = 'playing'; room.playedCards = []; room.lastPlayerId = null; room.nextRank = 1;
        room.players.forEach((p, i) => p.hand = tlModule.sortCards(deck.slice(i * 13, (i + 1) * 13)));

        let instantWinner = null, winReason = "";
        for (let p of activePlayers) { const reason = tlModule.checkInstantWin(p.hand); if (reason) { instantWinner = p; winReason = reason; break; } }
        if (instantWinner) {
            instantWinner.rank = 1; room.lastWinnerId = instantWinner.id; let currentRank = 2;
            room.players.forEach(p => { if (!p.isSpectator && p.id !== instantWinner.id) p.rank = currentRank++; });
            room.status = 'waiting';
            const results = room.players.map(p => ({ id: p.id, name: p.name, remaining: [...p.hand], isSpectator: p.isSpectator, rank: p.rank }));
            io.to('tl_' + roomId).emit('instantWinOccurred', { winnerName: instantWinner.name, reason: winReason, allHands: results });
            broadcastRoomLists(); return;
        }

        room.players.forEach(p => io.to(p.id).emit('dealCards', { hand: p.hand }));
        let startingIndex = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : room.players.findIndex(p => p.hand.some(c => c.value === '3' && c.suit === '♠'));
        if (startingIndex === -1) startingIndex = 0; room.currentTurnIndex = startingIndex;
        io.to('tl_' + roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex, lastRoundWinnerId: room.lastWinnerId });
        
        // 🛠️ ជួសជុលចំណុច Bug ដ៏ធំ៖ ប្តូរពី broadcastRoundLists ទៅជា broadcastRoomLists
        broadcastRoomLists(); 
    });

    socket.on('playCard', ({ roomId, cards }) => {
        const room = tlRooms[roomId]; if (!room) return; const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ');

        if (tlModule.getComboType(cards) && tlModule.comparePlay(cards, room.playedCards)) {
            cards.forEach(c => { const idx = player.hand.splice(player.hand.findIndex(pc => pc.value === c.value && pc.suit === c.suit), 1); });
            room.playedCards = cards; room.lastPlayerId = socket.id; player.passed = false; let isDoubleWin = false;
            if (player.hand.length === 0) {
                player.rank = room.nextRank++;
                if (player.rank === 1) {
                    room.lastWinnerId = player.id; const opponents = room.players.filter(p => !p.isSpectator && p.id !== player.id);
                    if (opponents.every(opp => opp.hand.length === 13)) { isDoubleWin = true; opponents.forEach(opp => opp.rank = room.nextRank++); }
                }
            }
            const remainingActivePlayers = room.players.filter(p => p.hand.length > 0);
            if (remainingActivePlayers.length <= 1 || isDoubleWin) {
                if (remainingActivePlayers.length === 1 && !isDoubleWin) remainingActivePlayers[0].rank = room.nextRank;
                room.status = 'waiting';
                const results = room.players.map(p => ({ id: p.id, name: p.name, remaining: [...p.hand], isSpectator: p.isSpectator, rank: p.rank, isDoubleLeaved: isDoubleWin && p.id !== player.id }));
                io.to('tl_' + roomId).emit('cardPlayed', { by: player.name, cards, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players });
                setTimeout(() => {
                    const finalWinner = room.players.find(p => p.rank === 1); room.lastWinnerId = finalWinner ? finalWinner.id : null;
                    io.to('tl_' + roomId).emit('gameWon', { winner: finalWinner ? finalWinner.name : 'រកមិនឃើញ', winnerId: room.lastWinnerId, allHands: results, isDoubleWin });
                    broadcastRoomLists();
                }, 1500);
            } else {
                let originalIndex = room.currentTurnIndex, nextIndex = originalIndex, found = false;
                for (let i = 1; i <= room.players.length; i++) {
                    let checkIndex = (originalIndex + i) % room.players.length; let p = room.players[checkIndex];
                    if (p && p.hand.length > 0 && !p.passed) { nextIndex = checkIndex; found = true; break; }
                }
                if (found) room.currentTurnIndex = nextIndex;
                const activePlayersInRound = room.players.filter(p => p.hand.length > 0 && !p.passed); let lastPlayerIdx = room.players.findIndex(p => p.id === room.lastPlayerId);
                if (lastPlayerIdx !== -1 && room.players[lastPlayerIdx].hand.length === 0 ? (activePlayersInRound.length === 0) : (activePlayersInRound.length <= 1)) {
                    room.playedCards = []; room.players.forEach(p => { if (p.hand.length > 0) p.passed = false; });
                    if (lastPlayerIdx !== -1 && room.players[lastPlayerIdx].hand.length === 0) {
                        let nextIdx = (lastPlayerIdx + 1) % room.players.length; while (room.players[nextIdx].hand.length === 0) { nextIdx = (nextIdx + 1) % room.players.length; }
                        room.currentTurnIndex = nextIdx; room.lastPlayerId = room.players[nextIdx].id;
                    } else { room.currentTurnIndex = lastPlayerIdx !== -1 ? lastPlayerIdx : room.currentTurnIndex; }
                    io.to('tl_' + roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
                }
                io.to('tl_' + roomId).emit('cardPlayed', { by: player.name, cards, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players });
            }
        } else { socket.emit('errorMsg', 'ចុះមិនត្រូវក្បួន ឬបៀតូចជាង!'); }
    });

    socket.on('passTurn', (roomId) => {
        const room = tlRooms[roomId]; if (!room) return; const player = room.players[room.currentTurnIndex]; if (!player || player.id !== socket.id) return;
        player.passed = true; io.to('tl_' + roomId).emit('playerPassed', { name: player.name, id: player.id });
        let originalIndex = room.currentTurnIndex, nextIndex = originalIndex, found = false;
        for (let i = 1; i <= room.players.length; i++) {
            let checkIndex = (originalIndex + i) % room.players.length; let p = room.players[checkIndex];
            if (p && p.hand.length > 0 && !p.passed) { nextIndex = checkIndex; found = true; break; }
        }
        if (found) room.currentTurnIndex = nextIndex;
        const activePlayersInRound = room.players.filter(p => p.hand.length > 0 && !p.passed); let lastPlayerIdx = room.players.findIndex(p => p.id === room.lastPlayerId);
        if (lastPlayerIdx !== -1 && room.players[lastPlayerIdx].hand.length === 0 ? (activePlayersInRound.length === 0) : (activePlayersInRound.length <= 1)) {
            room.playedCards = []; room.players.forEach(p => { if (p.hand.length > 0) p.passed = false; });
            if (lastPlayerIdx !== -1 && room.players[lastPlayerIdx].hand.length === 0) {
                let nextIdx = (lastPlayerIdx + 1) % room.players.length; while (room.players[nextIdx].hand.length === 0) { nextIdx = (nextIdx + 1) % room.players.length; }
                room.currentTurnIndex = nextIdx; room.lastPlayerId = room.players[nextIdx].id;
            } else { room.currentTurnIndex = lastPlayerIdx !== -1 ? lastPlayerIdx : room.currentTurnIndex; }
            io.to(roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
        }
        io.to('tl_' + roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players });
    });

    // ==========================================
    // CLEAN ROOM LOGIC
    // ==========================================
    socket.on('kt_leaveRoom', (roomId) => { socket.emit('leftRoom'); cleanLeave(roomId, 'kt'); });
    socket.on('leaveRoom', () => { socket.emit('leftRoom'); cleanLeave(Object.keys(tlRooms).find(id => tlRooms[id].players.some(p => p.id === socket.id)), 'tl'); });

    const cleanLeave = (roomId, type) => {
        const roomsObj = type === 'tl' ? tlRooms : ktRooms; const room = roomsObj[roomId]; if (!room) return;
        const idx = room.players.findIndex(p => p.id === socket.id);
        if (idx !== -1) {
            const leavingPlayerId = socket.id; room.players.splice(idx, 1); io.to(type + '_' + roomId).emit('voice_user_left', socket.id);
            if (room.players.length === 0) { delete roomsObj[roomId]; } else {
                if (room.creatorId === leavingPlayerId) room.creatorId = room.players[0].id;
                if (room.lastWinnerId === leavingPlayerId) { const nextP = room.players.find(p => !p.isSpectator); room.lastWinnerId = nextP ? nextP.id : null; }
                io.to(type + '_' + roomId).emit('updatePlayers', room.players);
            }
        }
        broadcastRoomLists();
    };

    socket.on('disconnect', () => {
        Object.keys(tlRooms).forEach(id => { if (tlRooms[id].players.some(p => p.id === socket.id)) cleanLeave(id, 'tl'); });
        Object.keys(ktRooms).forEach(id => { if (ktRooms[id].players.some(p => p.id === socket.id)) cleanLeave(id, 'kt'); });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));