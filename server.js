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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'main.html')));
app.get('/tienlen', (req, res) => res.sendFile(path.join(__dirname, 'index_tienlen.html')));
app.get('/kate', (req, res) => res.sendFile(path.join(__dirname, 'index_kate.html')));

const tlRooms = {};
const ktRooms = {};

function getRoomList(roomsObj) {
    return Object.keys(roomsObj).map(id => {
        const r = roomsObj[id];
        return {
            roomId: id,
            playerCount: r.players.length,
            status: r.status,
            hasPassword: !!r.password
        };
    });
}

function broadcastRoomLists() {
    io.emit('tlRoomList', getRoomList(tlRooms));
    io.emit('ktRoomList', getRoomList(ktRooms));
}

io.on('connection', (socket) => {
    broadcastRoomLists();

    // ==========================================
    // ប្រព័ន្ធ VOICE CHAT SIGNALING
    // ==========================================
    socket.on('voice_signal', (data) => {
        io.to(data.target).emit('voice_signal', { sender: socket.id, signal: data.signal });
    });

    // ==========================================
    // ឡូហ្ស៊ិក SERVER - ទៀនឡេន (TIEN LEN)
    // ==========================================
    socket.on('tl_createRoom', ({ roomId, password, playerName }) => {
        if (tlRooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        tlRooms[roomId] = {
            roomId, password, status: 'waiting', creatorId: socket.id,
            players: [{ id: socket.id, name: playerName || 'អ្នកលេង ១', hand: [], passed: false, isSpectator: false, rank: null }],
            currentTurnIndex: 0, playedCards: [], lastPlayerId: null, lastWinnerId: null, nextRank: 1
        };
        socket.join('tl_' + roomId);
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to('tl_' + roomId).emit('updatePlayers', tlRooms[roomId].players);
        
        socket.to('tl_' + roomId).emit('voice_user_joined', socket.id);
        socket.emit('voice_initiate_peer', { target: socket.id });
        broadcastRoomLists();
    });

    socket.on('tl_joinRoom', ({ roomId, password, playerName }) => {
        const room = tlRooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់នេះទេ!');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');
        if (room.players.length >= 4 && room.status !== 'playing') return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

        const isSpectator = (room.status === 'playing' || room.players.length >= 4);
        room.players.push({ id: socket.id, name: playerName || 'ភ្ញៀវ', hand: [], passed: false, isSpectator, rank: null });
        
        socket.join('tl_' + roomId);
        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator, playedCards: room.playedCards, currentTurnIndex: room.currentTurnIndex });
        io.to('tl_' + roomId).emit('updatePlayers', room.players);
        
        io.to('tl_' + roomId).emit('voice_user_joined', socket.id);
        room.players.forEach(p => {
            if (p.id !== socket.id) socket.emit('voice_initiate_peer', { target: p.id });
        });
        broadcastRoomLists();
    });

    socket.on('tl_startGame', (roomId) => {
        const room = tlRooms[roomId]; if (!room) return;
        const deck = tlModule.shuffleDeck(tlModule.createDeck());
        room.status = 'playing'; room.playedCards = []; room.nextRank = 1;
        
        const activePlayers = room.players.filter(p => !p.isSpectator);
        activePlayers.forEach((p, i) => {
            p.hand = tlModule.sortCards(deck.slice(i * 13, (i + 1) * 13));
            p.passed = false; p.rank = null;
        });

        for (let p of activePlayers) {
            const reason = tlModule.checkInstantWin(p.hand);
            if (reason) {
                p.rank = 1; room.lastWinnerId = p.id; room.status = 'waiting';
                let rnk = 2; room.players.forEach(pl => { if(!pl.isSpectator && pl.id !== p.id) pl.rank = rnk++; });
                io.to('tl_' + roomId).emit('instantWinOccurred', { winnerName: p.name, reason, allHands: room.players });
                io.to('tl_' + roomId).emit('winnerTransferred', { newWinnerId: room.lastWinnerId, creatorId: room.creatorId });
                return;
            }
        }

        room.players.forEach(p => { if(!p.isSpectator) io.to(p.id).emit('dealCards', { hand: p.hand }); });
        let startIdx = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : room.players.findIndex(p => p.hand.some(c => c.value === '3' && c.suit === '♠'));
        room.currentTurnIndex = startIdx === -1 ? room.players.findIndex(p => !p.isSpectator) : startIdx;
        
        io.to('tl_' + roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex, lastRoundWinnerId: room.lastWinnerId });
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

            const isFirstWinner = (room.nextRank === 1);

            if (player.hand.length === 0) {
                player.rank = room.nextRank++;
                if (player.rank === 1) {
                    room.lastWinnerId = player.id;
                    io.to('tl_' + roomId).emit('winnerTransferred', { newWinnerId: room.lastWinnerId, creatorId: room.creatorId });
                }
            }

            const active = room.players.filter(p => !p.isSpectator && p.hand.length > 0);
            if (active.length <= 1) {
                if (active.length === 1) active[0].rank = room.nextRank;
                room.status = 'waiting';

                if (isFirstWinner) {
                    room.players.forEach(p => {
                        if (!p.isSpectator && p.id !== player.id && p.hand.length === 13) {
                            p.isDoubleLeaved = true;
                        }
                    });
                }

                io.to('tl_' + roomId).emit('cardPlayed', { by: player.name, cards, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players });
                io.to('tl_' + roomId).emit('gameWon', { winner: player.name, winnerId: player.id, allHands: room.players, isDoubleWin: isFirstWinner && room.players.some(p => p.isDoubleLeaved) });
            } else {
                // ជួសជុល Bug: បន្ថែមលក្ខខណ្ឌបង្ការ Infinite Loop ពេលវាយកាត់បៀ
                let attempts = 0;
                do {
                    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
                    attempts++;
                } while (
                    (room.players[room.currentTurnIndex].isSpectator || 
                     room.players[room.currentTurnIndex].hand.length === 0 || 
                     room.players[room.currentTurnIndex].passed) && attempts < room.players.length
                );

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
        
        io.to('tl_' + roomId).emit('playerPassed', { name: player.name, id: player.id });

        const activeRound = room.players.filter(p => !p.isSpectator && p.hand.length > 0 && !p.passed);
        if (activeRound.length <= 1) {
            room.playedCards = []; room.players.forEach(p => { if (!p.isSpectator && p.hand.length > 0) p.passed = false; });
            const nextIdx = room.players.findIndex(p => p.id === room.lastPlayerId);
            room.currentTurnIndex = nextIdx !== -1 ? nextIdx : room.players.findIndex(p => !p.isSpectator && p.hand.length > 0);
            io.to('tl_' + roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
        } else {
            // ជួសជុល Bug: បន្ថែមលក្ខខណ្ឌបង្ការ Infinite Loop ពេលសមាជិក Pass
            let attempts = 0;
            do {
                room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
                attempts++;
            } while (
                (room.players[room.currentTurnIndex].isSpectator || 
                 room.players[room.currentTurnIndex].hand.length === 0 || 
                 room.players[room.currentTurnIndex].passed) && attempts < room.players.length
            );
        }
        io.to('tl_' + roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players });
    });

    socket.on('tl_leaveRoom', (roomId) => {
        socket.emit('leftRoom');
        cleanLeave(roomId, 'tl');
    });

    // ==========================================
    // ឡូហ្ស៊ិក SERVER - កាតេ (KA TE)
    // ==========================================
    socket.on('kt_createRoom', ({ roomId, password, playerName }) => {
        if (ktRooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        ktRooms[roomId] = {
            roomId, password, status: 'waiting', creatorId: socket.id,
            players: [{ id: socket.id, name: playerName || 'អ្នកលេង ១', hand: [], isSpectator: false, hasCat: false, winRounds: 0, finalWinner: false }],
            currentTurnIndex: 0, currentRound: 1, tableCards: [], roundSuit: null, lastWinnerId: null
        };
        socket.join('kt_' + roomId);
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
        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator });
        io.to('kt_' + roomId).emit('updatePlayers', room.players);
        
        io.to('kt_' + roomId).emit('voice_user_joined', socket.id);
        room.players.forEach(p => {
            if (p.id !== socket.id) socket.emit('voice_initiate_peer', { target: p.id });
        });
        broadcastRoomLists();
    });

    socket.on('kt_startGame', (roomId) => {
        const room = ktRooms[roomId]; if (!room) return;
        const deck = tlModule.shuffleDeck(ktModule.createKateDeck());
        room.status = 'playing'; room.currentRound = 1; room.tableCards = []; room.roundSuit = null;
        
        room.players.forEach((p, i) => {
            if (!p.isSpectator) {
                p.hand = ktModule.sortKateCards(deck.slice(i * 6, (i + 1) * 6));
                p.hasCat = false; p.winRounds = 0; p.finalWinner = false;
            }
        });

        room.players.forEach(p => { if(!p.isSpectator) io.to(p.id).emit('dealCards', { hand: p.hand }); });
        room.currentTurnIndex = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : room.players.findIndex(p => !p.isSpectator);
        if (room.currentTurnIndex === -1) room.currentTurnIndex = 0;
        
        io.to('kt_' + roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex, currentRound: room.currentRound, lastRoundWinnerId: room.lastWinnerId });
    });

    socket.on('kt_playMove', ({ roomId, action, card }) => {
        const room = ktRooms[roomId]; if (!room) return;
        let player = room.players[room.currentTurnIndex]; if (player.id !== socket.id) return;

        const cardIdx = player.hand.findIndex(c => c.value === card.value && c.suit === card.suit);
        if (cardIdx !== -1) player.hand.splice(cardIdx, 1);

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

        let nextTurn = (room.currentTurnIndex + 1) % room.players.length;
        let attempts = 0;
        while (room.players[nextTurn].isSpectator && attempts < room.players.length) {
            nextTurn = (nextTurn + 1) % room.players.length;
            attempts++;
        }
        room.currentTurnIndex = nextTurn;

        const activePlayers = room.players.filter(p => !p.isSpectator);
        
        if (room.tableCards.length === activePlayers.length) {
            setTimeout(() => {
                let winMove = null;
                const validMoves = room.tableCards.filter(m => m.action === 'show' || m.action === 'គប់ទេ' || m.action === 'គប់ហើយ' || m.action === 'លទ្ធផលចុងក្រោយ');
                
                const matchSuit = validMoves.filter(m => m.card.suit === room.roundSuit);
                if (matchSuit.length > 0) {
                    matchSuit.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card));
                    winMove = matchSuit[0];
                } else if (validMoves.length > 0) {
                    winMove = validMoves[0];
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

                if (room.currentRound === 4) {
                    room.players.forEach(p => {
                        if (!p.isSpectator && !p.hasCat) p.isSpectator = true; 
                    });
                }

                if (room.currentRound < 6) {
                    room.currentRound++;
                    room.tableCards = []; room.roundSuit = null;
                    
                    const survivors = room.players.filter(p => !p.isSpectator);
                    if (survivors.length === 1) {
                        room.status = 'waiting';
                        survivors[0].finalWinner = true;
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
        socket.emit('leftRoom');
        cleanLeave(roomId, 'kt');
    });

    const cleanLeave = (roomId, type) => {
        const roomsObj = type === 'tl' ? tlRooms : ktRooms;
        const room = roomsObj[roomId]; if (!room) return;
        const idx = room.players.findIndex(p => p.id === socket.id);
        if (idx !== -1) {
            room.players.splice(idx, 1);
            io.to(type + '_' + roomId).emit('voice_user_left', socket.id);
            if (room.players.length === 0) delete roomsObj[roomId];
            else io.to(type + '_' + roomId).emit('updatePlayers', room.players);
        }
        broadcastRoomLists();
    };

    socket.on('disconnect', () => {
        Object.keys(tlRooms).forEach(id => {
            if (tlRooms[id].players.some(p => p.id === socket.id)) cleanLeave(id, 'tl');
        });
        Object.keys(ktRooms).forEach(id => {
            if (ktRooms[id].players.some(p => p.id === socket.id)) cleanLeave(id, 'kt');
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));