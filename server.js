// =================================================================
// server.js (កំណែទម្រង់ពេញលេញ - រួមបញ្ចូល Voice Chat ចាស់, កាតេ និងទៀនឡេន)
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
    // ಪ್ರព័ន្ធ VOICE CHAT CORE (ដកស្រង់ពីកូដចាស់បង ១០០%)
    // ==========================================
    socket.on('voice_signal', (data) => {
        io.to(data.target).emit('voice_signal', {
            sender: socket.id, 
            signal: data.signal
        });
    });

    // ==========================================
    // ឡូហ្ស៊ិក SERVER - ទៀនឡេន (TIEN LEN)
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
        const room = tlRooms[roomId];
        if (!room) return;
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

        const isSpectator = room.status === 'playing';
        socket.to('tl_' + roomId).emit('voice_user_joined', { id: socket.id });
        room.players.forEach(existingPlayer => {
            socket.emit('voice_initiate_peer', { target: existingPlayer.id });
        });

        room.players.push({ id: socket.id, name: playerName || 'Guest', hand: [], passed: false, isSpectator, rank: null });
        socket.join('tl_' + roomId);
        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator, playedCards: room.playedCards, currentTurnIndex: room.currentTurnIndex });
        io.to('tl_' + roomId).emit('updatePlayers', room.players);
        broadcastRoomLists();
    });

    socket.on('startGame', (roomId) => {
        const room = tlRooms[roomId]; if (!room) return;
        if (room.lastWinnerId ? room.lastWinnerId !== socket.id : room.creatorId !== socket.id) {
            return socket.emit('errorMsg', 'អ្នកគ្មានសិទ្ធិចាប់ផ្ដើមហ្គេមឡើយ!');
        }
        room.players.forEach(p => { p.isSpectator = false; p.hand = []; p.passed = false; p.rank = null; });
        const activePlayers = room.players.filter(p => !p.isSpectator);
        if (activePlayers.length < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់!');

        const deck = tlModule.shuffleDeck(tlModule.createDeck());
        room.status = 'playing'; room.playedCards = []; room.lastPlayerId = null; room.nextRank = 1;
        room.players.forEach((p, i) => p.hand = tlModule.sortCards(deck.slice(i * 13, (i + 1) * 13)));

        let instantWinner = null, winReason = "";
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

        room.players.forEach(p => io.to(p.id).emit('dealCards', { hand: p.hand }));
        let startingIndex = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : room.players.findIndex(p => p.hand.some(c => c.value === '3' && c.suit === '♠'));
        if (startingIndex === -1) startingIndex = 0;
        room.currentTurnIndex = startingIndex;

        io.to('tl_' + roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex, lastRoundWinnerId: room.lastWinnerId });
        broadcastRoomLists();
    });

    socket.on('playCard', ({ roomId, cards }) => {
        const room = tlRooms[roomId]; if (!room) return;
        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ');

        if (tlModule.getComboType(cards) && tlModule.comparePlay(cards, room.playedCards)) {
            cards.forEach(c => {
                const idx = player.hand.findIndex(pc => pc.value === c.value && pc.suit === c.suit);
                if (idx !== -1) player.hand.splice(idx, 1);
            });
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
                    let checkIndex = (originalIndex + i) % room.players.length;
                    let p = room.players[checkIndex];
                    if (p && p.hand.length > 0 && !p.passed) { nextIndex = checkIndex; found = true; break; }
                }
                if (found) room.currentTurnIndex = nextIndex;

                const activePlayersInRound = room.players.filter(p => p.hand.length > 0 && !p.passed);
                let lastPlayerIdx = room.players.findIndex(p => p.id === room.lastPlayerId);
                const isLastPlayerOut = (lastPlayerIdx !== -1 && room.players[lastPlayerIdx].hand.length === 0);
                if (isLastPlayerOut ? (activePlayersInRound.length === 0) : (activePlayersInRound.length <= 1)) {
                    room.playedCards = []; room.players.forEach(p => { if (p.hand.length > 0) p.passed = false; });
                    if (isLastPlayerOut) {
                        let nextIdx = (lastPlayerIdx + 1) % room.players.length;
                        while (room.players[nextIdx].hand.length === 0) { nextIdx = (nextIdx + 1) % room.players.length; }
                        room.currentTurnIndex = nextIdx; room.lastPlayerId = room.players[nextIdx].id;
                    } else { room.currentTurnIndex = lastPlayerIdx !== -1 ? lastPlayerIdx : room.currentTurnIndex; }
                    io.to('tl_' + roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
                }
                io.to('tl_' + roomId).emit('cardPlayed', { by: player.name, cards, nextTurn: room.currentTurnIndex, cardCount: player.hand.length, updatedHands: room.players });
            }
        } else { socket.emit('errorMsg', 'ចុះមិនត្រូវក្បួន ឬបៀតូចជាង!'); }
    });

    socket.on('passTurn', (roomId) => {
        const room = tlRooms[roomId]; if (!room) return;
        const player = room.players[room.currentTurnIndex]; if (!player || player.id !== socket.id) return;
        player.passed = true; io.to('tl_' + roomId).emit('playerPassed', { name: player.name, id: player.id });

        let originalIndex = room.currentTurnIndex, nextIndex = originalIndex, found = false;
        for (let i = 1; i <= room.players.length; i++) {
            let checkIndex = (originalIndex + i) % room.players.length;
            let p = room.players[checkIndex];
            if (p && p.hand.length > 0 && !p.passed) { nextIndex = checkIndex; found = true; break; }
        }
        if (found) room.currentTurnIndex = nextIndex;

        const activePlayersInRound = room.players.filter(p => p.hand.length > 0 && !p.passed);
        let lastPlayerIdx = room.players.findIndex(p => p.id === room.lastPlayerId);
        const isLastPlayerOut = (lastPlayerIdx !== -1 && room.players[lastPlayerIdx].hand.length === 0);
        if (isLastPlayerOut ? (activePlayersInRound.length === 0) : (activePlayersInRound.length <= 1)) {
            room.playedCards = []; room.players.forEach(p => { if (p.hand.length > 0) p.passed = false; });
            if (isLastPlayerOut) {
                let nextIdx = (lastPlayerIdx + 1) % room.players.length;
                while (room.players[nextIdx].hand.length === 0) { nextIdx = (nextIdx + 1) % room.players.length; }
                room.currentTurnIndex = nextIdx; room.lastPlayerId = room.players[nextIdx].id;
            } else { room.currentTurnIndex = lastPlayerIdx !== -1 ? lastPlayerIdx : room.currentTurnIndex; }
            io.to('tl_' + roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
        }
        io.to('tl_' + roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players });
    });

    socket.on('leaveRoom', () => {
        socket.emit('leftRoom');
        cleanLeave(Object.keys(tlRooms).find(id => tlRooms[id].players.some(p => p.id === socket.id)), 'tl');
    });

    // ==========================================
    // ឡូហ្ស៊ិក SERVER - កាតេ (KA TE)
    // ==========================================
    socket.on('kt_createRoom', ({ roomId, password, playerName }) => {
        if (ktRooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        ktRooms[roomId] = {
            roomId, password: password || "", status: 'waiting', creatorId: socket.id,
            players: [{ id: socket.id, name: playerName || 'អ្នកលេង ១', hand: [], isSpectator: false, hasCat: false, winRounds: 0, finalWinner: false, initialHandCopy: [] }],
            currentTurnIndex: 0, currentRound: 1, tableCards: [], roundSuit: null, lastWinnerId: null
        };
        socket.join('kt_' + roomId);
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to('kt_' + roomId).emit('updatePlayers', ktRooms[roomId].players);
        
        socket.to('kt_' + roomId).emit('voice_user_joined', { id: socket.id });
        broadcastRoomLists();
    });

    socket.on('kt_joinRoom', ({ roomId, password, playerName }) => {
        const room = ktRooms[roomId]; if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់!');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');
        if (room.players.length >= 4 && room.status !== 'playing') return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

        const isSpectator = (room.status === 'playing' || room.players.length >= 4);
        socket.to('kt_' + roomId).emit('voice_user_joined', { id: socket.id });
        room.players.forEach(existingPlayer => {
            socket.emit('voice_initiate_peer', { target: existingPlayer.id });
        });

        room.players.push({ id: socket.id, name: playerName || 'ភ្ញៀវ', hand: [], isSpectator, hasCat: false, winRounds: 0, finalWinner: false, initialHandCopy: [] });
        
        socket.join('kt_' + roomId);
        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator });
        io.to('kt_' + roomId).emit('updatePlayers', room.players);
        broadcastRoomLists();
    });

    socket.on('kt_startGame', (roomId) => {
        const room = ktRooms[roomId]; if (!room) return;
        const deck = ktModule.createKateDeck();
        // ប្រើប្រាស់មុខងារ shuffle របស់ tlModule ដូចច្បាប់ដើម
        const shuffled = tlModule.shuffleDeck(deck);
        
        room.status = 'playing'; room.currentRound = 1; room.tableCards = []; room.roundSuit = null;
        
        room.players.forEach((p, i) => {
            if (!p.isSpectator) {
                p.hand = ktModule.sortKateCards(shuffled.slice(i * 6, (i + 1) * 6));
                p.initialHandCopy = [...p.hand]; // រក្សាទុកកូពីបៀរដើមដំបូងដើម្បីបង្ហាញពេលចប់ហ្គេម
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
                const isMatch = (card.suit === room.roundSuit && ktModule.getKatePower(card) > ktModule.getKatePower(targetCard));
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: isMatch ? 'គប់ហើយ' : 'អត់គប់ទេ' });
            }
        } 
        else if (room.currentRound === 6) {
            room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'លទ្ធផលចុងក្រោយ' });
        }

        io.to('kt_' + roomId).emit('moveRecorded', { by: player.name, action, card, tableCards: room.tableCards, round: room.currentRound });
        io.to(player.id).emit('dealCards', { hand: player.hand }); 

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
                
                if (room.currentRound <= 4) {
                    const validMoves = room.tableCards.filter(m => m.action === 'ស៊ីបៀរ' || m.action === 'គប់ទេ');
                    const matchSuit = validMoves.filter(m => m.card.suit === room.roundSuit);
                    if (matchSuit.length > 0) {
                        matchSuit.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card));
                        winMove = matchSuit[0];
                    } else if (validMoves.length > 0) {
                        winMove = validMoves[0];
                    }
                } else if (room.currentRound === 5) {
                    const cutters = room.tableCards.filter(m => m.action === 'គប់ហើយ');
                    if (cutters.length > 0) {
                        cutters.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card));
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
                        room.status = 'waiting'; survivors[0].finalWinner = true;
                        const finalHandsResult = room.players.map(p => ({ name: p.name, initialHandCopy: p.initialHandCopy, winRounds: p.winRounds, finalWinner: p.id === survivors[0].id, isSpectator: p.isSpectator }));
                        io.to('kt_' + roomId).emit('gameWon', { winner: survivors[0].name, winnerId: survivors[0].id, allHands: finalHandsResult });
                    } else {
                        io.to('kt_' + roomId).emit('nextRoundStarted', { currentRound: room.currentRound, winnerName: winMove ? winMove.name : 'គ្មាន', currentTurnIndex: room.currentTurnIndex, players: room.players });
                    }
                } else {
                    room.status = 'waiting';
                    const finalWinner = room.players.find(p => p.id === room.lastWinnerId);
                    if(finalWinner) finalWinner.finalWinner = true;
                    const finalHandsResult = room.players.map(p => ({ name: p.name, initialHandCopy: p.initialHandCopy, winRounds: p.winRounds, finalWinner: p.id === room.lastWinnerId, isSpectator: p.isSpectator }));
                    io.to('kt_' + roomId).emit('gameWon', { winner: finalWinner ? finalWinner.name : 'គ្មានអ្នកឈ្នះ', winnerId: room.lastWinnerId, allHands: finalHandsResult });
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

    // ==========================================
    // មុខងារសម្អាត និងចាកចេញ (Clean Leave Core)
    // ==========================================
    const cleanLeave = (roomId, type) => {
        const roomsObj = type === 'tl' ? tlRooms : ktRooms;
        const room = roomsObj[roomId]; if (!room) return;
        const idx = room.players.findIndex(p => p.id === socket.id);
        if (idx !== -1) {
            const leavingPlayerId = socket.id;
            room.players.splice(idx, 1);
            io.to(type + '_' + roomId).emit('voice_user_left', socket.id);
            
            if (room.players.length === 0) {
                delete roomsObj[roomId];
            } else {
                if (room.creatorId === leavingPlayerId) room.creatorId = room.players[0].id;
                if (room.lastWinnerId === leavingPlayerId) {
                    const nextP = room.players.find(p => !p.isSpectator);
                    room.lastWinnerId = nextP ? nextP.id : null;
                }
                io.to(type + '_' + roomId).emit('updatePlayers', room.players);
                if(type === 'tl') {
                    io.to(type + '_' + roomId).emit('winnerTransferred', { newWinnerId: room.lastWinnerId, creatorId: room.creatorId });
                }
            }
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
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));