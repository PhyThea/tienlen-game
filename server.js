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

const tlModule = require('./server_tienlen');
const ktModule = require('./server_kate');

app.use(express.static(__dirname));

// ច្រកផ្លូវផ្លាស់ប្តូរទំព័រលេង
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'main.html')));
app.get('/tienlen', (req, res) => res.sendFile(path.join(__dirname, 'index_tienlen.html')));
app.get('/kate', (req, res) => res.sendFile(path.join(__dirname, 'index_kate.html')));

const tlRooms = {};
const ktRooms = {};

function broadcastRoomLists() {
    const tlList = Object.keys(tlRooms).map(id => ({
        roomId: id, playerCount: tlRooms[id].players.length, status: tlRooms[id].status
    }));
    const ktList = Object.keys(ktRooms).map(id => ({
        roomId: id, playerCount: ktRooms[id].players.length, status: ktRooms[id].status
    }));
    io.emit('tlRoomList', tlList);
    io.emit('ktRoomList', ktList);
}

io.on('connection', (socket) => {
    broadcastRoomLists();

    // Voice Chat Signaling
    socket.on('voice_signal', (data) => {
        io.to(data.target).emit('voice_signal', { sender: socket.id, signal: data.signal });
    });

    // ==========================================
    // ឡូហ្ស៊ិក SOCKET - ទៀនឡេន (TIEN LEN)
    // ==========================================
    socket.on('tl_createRoom', ({ roomId, playerName }) => {
        if (tlRooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        tlRooms[roomId] = {
            roomId, status: 'waiting', creatorId: socket.id,
            players: [{ id: socket.id, name: playerName || 'អ្នកលេង ១', hand: [], passed: false, isSpectator: false, rank: null }],
            currentTurnIndex: 0, playedCards: [], lastPlayerId: null, lastWinnerId: null, nextRank: 1
        };
        socket.join('tl_' + roomId);
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to('tl_' + roomId).emit('updatePlayers', tlRooms[roomId].players);
        broadcastRoomLists();
    });

    socket.on('tl_joinRoom', ({ roomId, playerName }) => {
        const room = tlRooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់!');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

        room.players.push({ id: socket.id, name: playerName || 'ភ្ញៀវ', hand: [], passed: false, isSpectator: room.status === 'playing', rank: null });
        socket.join('tl_' + roomId);
        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator: room.status === 'playing', playedCards: room.playedCards, currentTurnIndex: room.currentTurnIndex });
        io.to('tl_' + roomId).emit('updatePlayers', room.players);
        broadcastRoomLists();
    });

    socket.on('tl_startGame', (roomId) => {
        const room = tlRooms[roomId]; if (!room) return;
        const deck = tlModule.shuffleDeck(tlModule.createDeck());
        room.status = 'playing'; room.playedCards = []; room.nextRank = 1;
        
        room.players.forEach((p, i) => {
            p.hand = tlModule.sortCards(deck.slice(i * 13, (i + 1) * 13));
            p.passed = false; p.rank = null; p.isSpectator = false;
        });

        for (let p of room.players) {
            const reason = tlModule.checkInstantWin(p.hand);
            if (reason) {
                p.rank = 1; room.lastWinnerId = p.id; room.status = 'waiting';
                let rnk = 2; room.players.forEach(pl => { if(pl.id !== p.id) pl.rank = rnk++; });
                io.to('tl_' + roomId).emit('instantWinOccurred', { winnerName: p.name, reason, allHands: room.players });
                return;
            }
        }

        room.players.forEach(p => io.to(p.id).emit('dealCards', { hand: p.hand }));
        let startIdx = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : room.players.findIndex(p => p.hand.some(c => c.value === '3' && c.suit === '♠'));
        room.currentTurnIndex = startIdx === -1 ? 0 : startIdx;
        io.to('tl_' + roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex });
    });

    socket.on('tl_playCard', ({ roomId, cards }) => {
        const room = tlRooms[roomId]; if (!room) return;
        let player = room.players[room.currentTurnIndex]; if (player.id !== socket.id) return;

        if (tlModule.getComboType(cards) && tlModule.comparePlay(cards, room.playedCards)) {
            cards.forEach(c => {
                const idx = player.hand.findIndex(pc => pc.value === c.value && pc.suit === c.suit);
                if (idx !== -1) player.hand.splice(idx, 1);
            });
            room.playedCards = cards; room.lastPlayerId = socket.id;

            if (player.hand.length === 0) {
                player.rank = room.nextRank++;
                if (player.rank === 1) room.lastWinnerId = player.id;
            }

            const active = room.players.filter(p => p.hand.length > 0);
            if (active.length <= 1) {
                if (active.length === 1) active[0].rank = room.nextRank;
                room.status = 'waiting';
                io.to('tl_' + roomId).emit('cardPlayed', { by: player.name, cards, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players });
                io.to('tl_' + roomId).emit('gameWon', { winner: room.players.find(p => p.rank === 1).name, allHands: room.players });
            } else {
                room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
                while (room.players[room.currentTurnIndex].hand.length === 0 || room.players[room.currentTurnIndex].passed) {
                    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
                }
                io.to('tl_' + roomId).emit('cardPlayed', { by: player.name, cards, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players });
            }
        } else {
            socket.emit('errorMsg', 'ចុះបៀមិនត្រូវច្បាប់ ឬតូចជាងបៀនៅលើតុ!');
        }
    });

    socket.on('tl_passTurn', (roomId) => {
        const room = tlRooms[roomId]; if (!room) return;
        const player = room.players[room.currentTurnIndex]; if (player.id !== socket.id) return;
        player.passed = true;
        
        const activeRound = room.players.filter(p => p.hand.length > 0 && !p.passed);
        if (activeRound.length <= 1) {
            room.playedCards = []; room.players.forEach(p => { if (p.hand.length > 0) p.passed = false; });
            const nextIdx = room.players.findIndex(p => p.id === room.lastPlayerId);
            room.currentTurnIndex = nextIdx !== -1 ? nextIdx : room.players.findIndex(p => p.hand.length > 0);
            io.to('tl_' + roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
        } else {
            room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
            while(room.players[room.currentTurnIndex].hand.length === 0 || room.players[room.currentTurnIndex].passed) {
                room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
            }
        }
        io.to('tl_' + roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players });
    });

    // ==========================================
    // ឡូហ្ស៊ិក SOCKET - កាតេ (KA TE)
    // ==========================================
    socket.on('kt_createRoom', ({ roomId, playerName }) => {
        if (ktRooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        ktRooms[roomId] = {
            roomId, status: 'waiting', creatorId: socket.id,
            players: [{ id: socket.id, name: playerName || 'អ្នកលេង ១', hand: [], isSpectator: false, hasCat: false, winRounds: 0 }],
            currentTurnIndex: 0, currentRound: 1, tableCards: [], roundSuit: null, lastWinnerId: null
        };
        socket.join('kt_' + roomId);
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to('kt_' + roomId).emit('updatePlayers', ktRooms[roomId].players);
        broadcastRoomLists();
    });

    socket.on('kt_joinRoom', ({ roomId, playerName }) => {
        const room = ktRooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់!');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

        room.players.push({ id: socket.id, name: playerName || 'ភ្ញៀវ', hand: [], isSpectator: room.status === 'playing', hasCat: false, winRounds: 0 });
        socket.join('kt_' + roomId);
        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator: room.status === 'playing' });
        io.to('kt_' + roomId).emit('updatePlayers', room.players);
        broadcastRoomLists();
    });

    socket.on('kt_startGame', (roomId) => {
        const room = ktRooms[roomId]; if (!room) return;
        const deck = tlModule.shuffleDeck(ktModule.createKateDeck());
        room.status = 'playing'; room.currentRound = 1; room.tableCards = []; room.roundSuit = null;
        
        room.players.forEach((p, i) => {
            p.hand = ktModule.sortKateCards(deck.slice(i * 6, (i + 1) * 6));
            p.isSpectator = false; p.hasCat = false; p.winRounds = 0;
        });

        room.players.forEach(p => io.to(p.id).emit('dealCards', { hand: p.hand }));
        room.currentTurnIndex = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : 0;
        if (room.currentTurnIndex === -1) room.currentTurnIndex = 0;
        
        io.to('kt_' + roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex, currentRound: room.currentRound });
    });

    socket.on('kt_playMove', ({ roomId, action, card }) => {
        const room = ktRooms[roomId]; if (!room) return;
        let player = room.players[room.currentTurnIndex]; if (player.id !== socket.id) return;

        const cardIdx = player.hand.findIndex(c => c.value === card.value && c.suit === card.suit);
        if (cardIdx !== -1) player.hand.splice(cardIdx, 1);

        // គ្រប់គ្រងសកម្មភាពតាមជុំ (១ ដល់ ៦)
        if (room.currentRound <= 4) {
            if (action === 'play') {
                if (room.tableCards.length === 0) room.roundSuit = card.suit;
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'show' });
            } else {
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'fold' });
            }
        } 
        else if (room.currentRound === 5) {
            if (room.tableCards.length === 0) {
                room.roundSuit = card.suit;
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'គប់ទេ' });
            } else {
                const isMatch = (card.suit === room.roundSuit && ktModule.getKatePower(card) > ktModule.getKatePower(room.tableCards[0].card));
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: isMatch ? 'គប់ហើយ' : 'អត់គប់ទេ' });
            }
        } 
        else if (room.currentRound === 6) {
            room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'លទ្ធផលចុងក្រោយ' });
        }

        io.to('kt_' + roomId).emit('moveRecorded', { by: player.name, action, card, tableCards: room.tableCards, round: room.currentRound });

        // រកវេនបន្ទាប់ (រំលងអ្នកដែលងាប់កាតេ/Spectator ចេញ)
        let nextTurn = (room.currentTurnIndex + 1) % room.players.length;
        let checkCount = 0;
        while(room.players[nextTurn].isSpectator && checkCount < room.players.length) {
            nextTurn = (nextTurn + 1) % room.players.length;
            checkCount++;
        }
        room.currentTurnIndex = nextTurn;

        const activePlayers = room.players.filter(p => !p.isSpectator);
        
        // ពេលគ្រប់គ្នាទម្លាក់បៀរចប់ក្នុងជុំនីមួយៗ
        if (room.tableCards.length === activePlayers.length) {
            setTimeout(() => {
                let winMove = null;
                const validMoves = room.tableCards.filter(m => m.action === 'show' || m.action === 'គប់ទេ' || m.action === 'គប់ហើយ' || m.action === 'លទ្ធផលចុងក្រោយ');
                
                // ស្វែងរកបៀរដែលស៊ីក្នុងជុំនោះ
                const matchSuit = validMoves.filter(m => m.card.suit === room.roundSuit);
                if (matchSuit.length > 0) {
                    matchSuit.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card));
                    winMove = matchSuit[0];
                } else if (validMoves.length > 0) {
                    winMove = validMoves[0]; // បើខុសទឹកទាំងអស់ អ្នកចេញមុនគេជាអ្នកស៊ី
                }

                if (winMove) {
                    const winnerPl = room.players.find(p => p.id === winMove.playerId);
                    if(winnerPl) {
                        winnerPl.winRounds++;
                        if(room.currentRound <= 4) winnerPl.hasCat = true;
                        room.lastWinnerId = winnerPl.id;
                        room.currentTurnIndex = room.players.findIndex(p => p.id === winnerPl.id);
                    }
                }

                // ឆែកបញ្ចប់ជុំទី៤ (កាត់អ្នកអត់បានស៊ីសោះ "ងាប់កាតេ")
                if (room.currentRound === 4) {
                    room.players.forEach(p => {
                        if (!p.isSpectator && !p.hasCat) {
                            p.isSpectator = true; 
                        }
                    });
                }

                if (room.currentRound < 6) {
                    room.currentRound++;
                    room.tableCards = []; room.roundSuit = null;
                    
                    // ករណីសល់តែម្នាក់ឯង (អ្នកផ្សេងងាប់កាតេអស់) ឱ្យឈ្នះភ្លាម
                    const survivors = room.players.filter(p => !p.isSpectator);
                    if (survivors.length === 1) {
                        room.status = 'waiting';
                        io.to('kt_' + roomId).emit('gameWon', { winner: survivors[0].name, allHands: room.players });
                    } else {
                        io.to('kt_' + roomId).emit('nextRoundStarted', { currentRound: room.currentRound, winnerName: winMove ? winMove.name : 'គ្មាន', currentTurnIndex: room.currentTurnIndex, players: room.players });
                    }
                } else {
                    // បញ្ចប់ហ្គេមនៅជុំទី៦
                    room.status = 'waiting';
                    const finalWinner = room.players.find(p => p.id === room.lastWinnerId);
                    io.to('kt_' + roomId).emit('gameWon', { winner: finalWinner ? finalWinner.name : 'គ្មានអ្នកឈ្នះ', allHands: room.players });
                }
            }, 1500);
        } else {
            io.to('kt_' + roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players });
        }
    });

    const cleanLeave = (roomId, type) => {
        const roomsObj = type === 'tl' ? tlRooms : ktRooms;
        const room = roomsObj[roomId]; if (!room) return;
        const idx = room.players.findIndex(p => p.id === socket.id);
        if (idx !== -1) {
            room.players.splice(idx, 1);
            if (room.players.length === 0) delete roomsObj[roomId];
            else io.to(type + '_' + roomId).emit('updatePlayers', room.players);
        }
        broadcastRoomLists();
    };

    socket.on('disconnect', () => {
        Object.keys(tlRooms).forEach(id => cleanLeave(id, 'tl'));
        Object.keys(ktRooms).forEach(id => cleanLeave(id, 'kt'));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));