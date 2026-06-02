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
// ⏳ ប្រព័ន្ធ Timer គ្រប់គ្រងការរាប់ថយក្រោយ ១ នាទីអូតូសម្រាប់ ទៀនឡេន
// -----------------------------------------------------------------
function startTienLenTimer(room) {
    if (room.timerInterval) clearInterval(room.timerInterval);
    room.timerSeconds = 60; // ១ នាទី
    io.to('tl_' + room.roomId).emit('tl_timer_update', { seconds: room.timerSeconds, currentTurnIndex: room.currentTurnIndex });

    room.timerInterval = setInterval(() => {
        if (room.status !== 'playing') {
            clearInterval(room.timerInterval);
            return;
        }
        room.timerSeconds--;
        io.to('tl_' + room.roomId).emit('tl_timer_update', { seconds: room.timerSeconds, currentTurnIndex: room.currentTurnIndex });

        if (room.timerSeconds <= 0) {
            clearInterval(room.timerInterval);
            handleTienLenTimeout(room);
        }
    }, 1000);
}

function handleTienLenTimeout(room) {
    const player = room.players[room.currentTurnIndex];
    if (!player || player.hand.length === 0) return;

    // លក្ខខណ្ឌ៖ បើគ្មានបៀនៅលើតុទេ (ត្រូវចេញបៀរមុនគេ) គឺចុះបៀរតូចជាងគេបំផុតចេញទៅអូតូ
    if (!room.playedCards || room.playedCards.length === 0) {
        const sortedHand = tlModule.sortCards([...player.hand]);
        const smallestCard = [sortedHand[0]];

        // ដកបៀរចេញពីដៃអ្នកលេង
        const idx = player.hand.findIndex(pc => pc.value === smallestCard[0].value && pc.suit === smallestCard[0].suit);
        if (idx !== -1) player.hand.splice(idx, 1);

        room.playedCards = smallestCard;
        room.lastPlayerId = player.id;
        player.passed = false;

        if (player.hand.length === 0) {
            player.rank = room.nextRank;
            room.nextRank++;
            if (player.rank === 1) room.lastWinnerId = player.id;
        }

        const playersWithoutRank = room.players.filter(p => !p.isSpectator && p.rank === null);
        if (playersWithoutRank.length <= 1) {
            if (room.timerInterval) clearInterval(room.timerInterval); // [កែតម្រូវ] បញ្ឈប់ Timer ឱ្យដាច់ស្រឡះ
            if (playersWithoutRank.length === 1) playersWithoutRank[0].rank = room.nextRank;
            room.status = 'waiting';
            const results = room.players.map(p => ({
                id: p.id, name: p.name, remaining: [...p.hand], isSpectator: p.isSpectator, rank: p.rank, isDoubleLeaved: false
            }));
            io.to('tl_' + room.roomId).emit('cardPlayed', { by: player.name, cards: smallestCard, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players });
            setTimeout(() => {
                const finalWinner = room.players.find(p => p.rank === 1);
                room.lastWinnerId = finalWinner ? finalWinner.id : null;
                io.to('tl_' + room.roomId).emit('gameWon', { winner: finalWinner ? finalWinner.name : 'រកមិនឃើញ', winnerId: room.lastWinnerId, allHands: results, isDoubleWin: false });
                broadcastRoomLists();
            }, 1500);
        } else {
            handleTurnAndRoundStatus(room);
            io.to('tl_' + room.roomId).emit('cardPlayed', { by: player.name, cards: smallestCard, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players });
            if (room.status === 'playing') startTienLenTimer(room); // [កែតម្រូវ] បន្តដំណើរការ Timer សម្រាប់វេនបន្ទាប់
        }
    } else {
        // បើមានបៀរនៅលើតុស្រាប់ហើយ គឺប្រព័ន្ធចុច Pass ឱ្យតែម្តង
        player.passed = true;
        io.to('tl_' + room.roomId).emit('playerPassed', { name: player.name, id: player.id });
        handleTurnAndRoundStatus(room);
        if (room.status === 'playing') startTienLenTimer(room);
    }
}

// -----------------------------------------------------------------
// 🃏 Logic សម្រាប់ហ្គេម ទៀនឡេន (Tien Len Server Logic)
// -----------------------------------------------------------------
function moveToNextTurn(room) {
    let originalIndex = room.currentTurnIndex;
    let nextIndex = originalIndex;
    let found = false;
    
    // រត់ឆែកមើលអ្នកលេងម្នាក់ៗក្នុងវង់ (អតិបរមា ៤ នាក់)
    for (let i = 1; i <= room.players.length; i++) {
        let checkIndex = (originalIndex + i) % room.players.length;
        let p = room.players[checkIndex];
        
        // 🎯 លក្ខខណ្ឌ៖ ត្រូវតែមិនមែនជា Spectator, មានបៀរក្នុងដៃ និងមិនទាន់បានចុច Pass ក្នុងជុំនេះ
        if (p && !p.isSpectator && p.hand.length > 0 && !p.passed) {
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
    // រាប់ចំនួនអ្នកលេងដែលនៅមានបៀរក្នុងដៃ និងមិនទាន់ Pass
    const activePlayersInRound = room.players.filter(p => !p.isSpectator && p.hand.length > 0 && !p.passed);
    
    let lastPlayerIdx = room.players.findIndex(p => p.id === room.lastPlayerId);
    const isLastPlayerOut = (lastPlayerIdx !== -1 && room.players[lastPlayerIdx].hand.length === 0);
    
    // 🎯 ឆែកមើលថាជុំនេះត្រូវបញ្ចប់ (ដាច់តុ) ឬនៅ
    const isRoundOver = isLastPlayerOut ? (activePlayersInRound.length === 0) : (activePlayersInRound.length <= 1);

    if (isRoundOver) {
        // ១. លុបបៀរនៅលើតុចោល (ឡើងជុំថ្មី)
        room.playedCards = [];
        
        // ២. បើកសិទ្ធិឱ្យអ្នកលេងដែលនៅមានបៀរក្នុងដៃ អាចលេងជុំថ្មីបានវិញ (លុបស្ថានភាព Pass ចេញ)
        room.players.forEach(p => { 
            if (!p.isSpectator && p.hand.length > 0) p.passed = false; 
        });

        // ៣. កំណត់វេនអ្នកដែលត្រូវចុះមុនគេក្នុងជុំថ្មី
        if (isLastPlayerOut) {
            // បើអ្នកស៊ីដាច់វគ្គមុន លេងអស់បៀរពីដៃបាត់ទៅហើយ ត្រូវផ្ទេរសិទ្ធិទៅឱ្យអ្នកបន្ទាប់ (តាមទ្រនិចនាឡិកា) ដែលនៅមានបៀរ
            let nextIndex = (lastPlayerIdx + 1) % room.players.length;
            let loopCount = 0;
            while ((room.players[nextIndex].isSpectator || room.players[nextIndex].hand.length === 0) && loopCount < room.players.length) {
                nextIndex = (nextIndex + 1) % room.players.length;
                loopCount++;
            }
            room.currentTurnIndex = nextIndex;
            room.lastPlayerId = room.players[nextIndex].id;
        } else {
            // បើអ្នកស៊ីដាច់នៅមានបៀរ គឺគាត់ជាអ្នកបានសិទ្ធិឡើងជុំថ្មីមុនគេដដែល
            room.currentTurnIndex = lastPlayerIdx !== -1 ? lastPlayerIdx : room.currentTurnIndex;
        }
        
        // ៤. ផ្សាយដំណឹងទៅកាន់បន្ទប់ (អក្សរត្រូវស៊ីគ្នាជាមួយ Client)
        io.to('tl_' + room.roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
    } else {
        // បើមិនទាន់ដាច់តុទេ គឺរំលងវេនទៅឱ្យអ្នកបន្ទាប់ដែលមិនទាន់ Pass
        moveToNextTurn(room);
    }
    // បញ្ជូន Turn ថ្មីទៅឱ្យរាល់ Client ទាំងអស់ដឹងស្វ័យប្រវត្តិ
    io.to('tl_' + room.roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players });
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

    const isWinnerStillInRoom = room.players.some(p => p.id === room.lastWinnerId);
    if (!isWinnerStillInRoom) { room.lastWinnerId = null; }

    // ឆែកសិទ្ធិ៖ បើគ្មានមេឈ្នះ គឺសិទ្ធិលើអ្នកបង្កើតបន្ទប់ បើមានមេឈ្នះ គឺសិទ្ធិលើមេឈ្នះ
    if (!room.lastWinnerId ? room.creatorId !== socket.id : room.lastWinnerId !== socket.id) {
        return socket.emit('errorMsg', 'អ្នកគ្មានសិទ្ធិចាប់ផ្ដើមហ្គេមឡើយ!');
    }

    // 🎯 ជំរុញឱ្យអ្នកទាំងអស់គ្នាក្នុងបន្ទប់មកលេង (លុបស្ថានភាព Spectator)
    room.players.forEach((p, idx) => {
        if (idx < 4) { // ទៀនឡេនលេងបានអតិបរមា ៤ នាក់
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

    const activePlayers = room.players.filter(p => !p.isSpectator);
    if (activePlayers.length < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់!');

    const deck = tlModule.shuffleDeck(tlModule.createDeck()); //
    room.status = 'playing'; room.playedCards = []; room.lastPlayerId = null; room.nextRank = 1; //

    activePlayers.forEach((p, i) => { 
        p.hand = tlModule.sortCards(deck.slice(i * 13, (i + 1) * 13)); //
    });

    // ផ្ញើបៀរថ្មីទៅឱ្យគ្រប់គ្នាដែលមិនមែនជា Spectator
    room.players.forEach(p => {
        if (!p.isSpectator) io.to(p.id).emit('dealCards', { hand: p.hand });
    });

    let startIdx = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : room.players.findIndex(p => p.hand.some(c => c.value === '3' && c.suit === '♠')); //
    room.currentTurnIndex = startIdx === -1 ? 0 : startIdx; //

    // 📣 ផ្សាយដំណឹងទៅគ្រប់គ្នា (រួមទាំងបញ្ជូនទិន្នន័យ players ថ្មីដែលបានកែប្រែ status រួច)
    io.to('tl_' + roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex, lastRoundWinnerId: room.lastWinnerId });
    startTienLenTimer(room); // ចាប់ផ្តើមរាប់ថយក្រោយ ១ នាទី
    broadcastRoomLists(); //
});

socket.on('playCard', ({ roomId, cards }) => {
        const room = tlRooms[roomId]; if (!room) return;
        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id || player.hand.length === 0) return;

        // ផ្ទៀងផ្ទាត់ប្រភេទបៀរ និងវាយកាត់បៀរនៅលើតុ
        if (tlModule.getComboType(cards) && tlModule.comparePlay(cards, room.playedCards)) {
            // ដកបៀរចេញពីដៃអ្នកលេង
            cards.forEach(c => {
                const idx = player.hand.findIndex(pc => pc.value === c.value && pc.suit === c.suit);
                if (idx !== -1) player.hand.splice(idx, 1);
            });

            room.playedCards = cards; 
            room.lastPlayerId = socket.id; 
            player.passed = false; // ឱ្យតែបានចុះបៀរ គឺសម្គាល់ថាមិនបាន Pass ឡើយ
            let isDoubleWin = false;

            // ឆែកមើលលក្ខខណ្ឌពេលអស់បៀរពីដៃ (ឈ្នះ)
            if (player.hand.length === 0) {
                player.rank = room.nextRank; 
                room.nextRank++;
                
                if (player.rank === 1) {
                    room.lastWinnerId = player.id;
                    const opponents = room.players.filter(p => !p.isSpectator && p.id !== player.id);
                    // ករណីឈ្នះឌុបដាច់តុ (គូប្រកួតសល់ ១៣សន្លឹកគ្រប់គ្នា)
                    if (opponents.every(p => p.hand.length === 13)) {
                        isDoubleWin = true;
                        opponents.forEach(opp => { opp.rank = room.nextRank; room.nextRank++; });
                    }
                }
            }

            // 🎯 ជួសជុលលក្ខខណ្ឌបញ្ចប់ហ្គេម៖ ហ្គេមនឹងបញ្ចប់លុះត្រាតែអ្នកលេងសល់ "លំដាប់ថ្នាក់អត់ទាន់មាន" តិចជាងឬស្មើ ១ នាក់ ឬឈ្នះឌុប
            const playersWithoutRank = room.players.filter(p => !p.isSpectator && p.rank === null);
            
            if (playersWithoutRank.length <= 1 || isDoubleWin) {
                if (room.timerInterval) clearInterval(room.timerInterval); // បញ្ឈប់ Timer
                // ប្រគល់ចំណាត់ថ្នាក់ចុងក្រោយជូនអ្នកដែលនៅសល់បៀរម្នាក់ឯងនោះ
                if (playersWithoutRank.length === 1 && !isDoubleWin) {
                    playersWithoutRank[0].rank = room.nextRank;
                }
                
                room.status = 'waiting';
                const results = room.players.map(p => ({
                    id: p.id, name: p.name, remaining: [...p.hand], 
                    isSpectator: p.isSpectator, rank: p.rank, 
                    isDoubleLeaved: isDoubleWin && p.id !== player.id
                }));

                // បញ្ជូនទិន្នន័យចុះបៀរចុងក្រោយទៅ Clients
                io.to('tl_' + roomId).emit('cardPlayed', { by: player.name, cards, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players });
                
                // បង្ហាញផ្ទាំងលទ្ធផលក្រោយ ១.៥ វិនាទី
                setTimeout(() => {
                    const finalWinner = room.players.find(p => p.rank === 1);
                    room.lastWinnerId = finalWinner ? finalWinner.id : null;
                    io.to('tl_' + roomId).emit('gameWon', { winner: finalWinner ? finalWinner.name : 'រកមិនឃើញ', winnerId: room.lastWinnerId, allHands: results, isDoubleWin });
                    broadcastRoomLists();
                }, 1500);
                
            } else {
                // 🎯 បើហ្គេមមិនទាន់បញ្ចប់ទេ ទើបឱ្យប្រព័ន្ធដំណើរការផ្ទេរវេន ឬឆែកដាច់តុធម្មតា
                handleTurnAndRoundStatus(room);
                io.to('tl_' + roomId).emit('cardPlayed', { by: player.name, cards, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players });
                startTienLenTimer(room); // ដំណើរការ Timer សម្រាប់អ្នកបន្ទាប់
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
        if (room.status === 'playing') startTienLenTimer(room);
    });

    socket.on('leaveRoom', () => {
        for (const id in tlRooms) {
            const room = tlRooms[id]; const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                const wasSpectator = room.players[pIdx].isSpectator;
                socket.to('tl_' + id).emit('voice_user_left', { id: socket.id });
                room.players.splice(pIdx, 1); socket.leave('tl_' + id); socket.emit('leftRoom');
                if (room.players.length === 0) { if (room.timerInterval) clearInterval(room.timerInterval); delete tlRooms[id]; } else {
                    if (room.creatorId === socket.id) room.creatorId = room.players[0].id;
                    if (room.status === 'playing' && !wasSpectator && room.currentTurnIndex === pIdx) {
                        handleTurnAndRoundStatus(room);
                        startTienLenTimer(room);
                    }
                    io.to('tl_' + id).emit('updatePlayers', room.players);
                    io.to('tl_' + id).emit('winnerTransferred', { newWinnerId: room.lastWinnerId, creatorId: room.creatorId });
                }
                broadcastRoomLists();
            }
        }
    });

    require('./server_kate.js')(io, ktRooms, broadcastRoomLists, tlModule, ktModule);

    socket.on('disconnect', () => {
        for (const id in tlRooms) {
            const room = tlRooms[id]; const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                const wasSpectator = room.players[pIdx].isSpectator;
                socket.to('tl_' + id).emit('voice_user_left', { id: socket.id });
                room.players.splice(pIdx, 1);
                if (room.players.length === 0) { if (room.timerInterval) clearInterval(room.timerInterval); delete tlRooms[id]; } else {
                    if (room.creatorId === socket.id) room.creatorId = room.players[0].id;
                    if (room.status === 'playing' && !wasSpectator && room.currentTurnIndex === pIdx) {
                        handleTurnAndRoundStatus(room);
                        startTienLenTimer(room);
                    }
                    io.to('tl_' + id).emit('updatePlayers', room.players);
                }
            }
        }

        for (const id in ktRooms) {
            const room = ktRooms[id]; const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                const wasSpectator = room.players[pIdx].isSpectator;
                socket.to('kt_' + id).emit('voice_user_left', { id: socket.id });
                room.players.splice(pIdx, 1);
                
                if (room.players.length === 0) {
                    if (room.timerInterval) clearInterval(room.timerInterval);
                    delete ktRooms[id]; 
                } else {
                    if (room.creatorId === socket.id) room.creatorId = room.players[0].id;
                    if (room.status === 'playing' && !wasSpectator && room.currentTurnIndex === pIdx) {
                        room.currentTurnIndex = room.currentTurnIndex % room.players.length;
                        io.to('kt_' + id).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players });
                        if (typeof room.startTimer === 'function') room.startTimer();
                    }
                    io.to('kt_' + id).emit('updatePlayers', room.players);
                    io.to('kt_' + id).emit('winnerTransferred', { newWinnerId: room.lastWinnerId, creatorId: room.creatorId });
                }
            }
        }
        broadcastRoomLists();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`👉 Server is running on port ${PORT}`));