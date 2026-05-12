// =================================================================
// server.js (កំណែទម្រង់ពេញលេញ រួមបញ្ចូល ទៀនឡេន និង កាតេ ២-៦នាក់)
// =================================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// ទាញយក Logic ហ្គេមទាំងពីរពី Folder games/
const tienlenLogic = require('./games/tienlenLogic');
const catteLogic = require('./games/catteLogic');

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

// ----------------- ROUTING (ផ្លូវបើកទំព័រ) -----------------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/tienlen', (req, res) => res.sendFile(path.join(__dirname, 'tienlen.html')));
app.get('/catte', (req, res) => res.sendFile(path.join(__dirname, 'catte.html')));

function broadcastRoomList() {
    const list = Object.values(rooms).map(r => ({
        roomId: r.roomId,
        playerCount: r.players.length,
        maxPlayers: r.gameType === 'catte' ? 6 : 4,
        status: r.status,
        hasPassword: r.password !== "",
        gameType: r.gameType
    }));
    io.emit('roomList', list);
}

io.on('connection', (socket) => {
    broadcastRoomList();

    // បង្កើតបន្ទប់ (ថែមលំនាំដើម gameType: 'tienlen')
    socket.on('createRoom', ({ roomId, password, playerName }) => {
        if (!roomId || !playerName) return socket.emit('errorMsg', 'ទិន្នន័យមិនគ្រប់គ្រាន់!');
        if (rooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');

        rooms[roomId] = {
            roomId,
            password: password || "",
            players: [{ id: socket.id, name: playerName, hand: [], passed: false, rank: null, isSpectator: false, catteKakt: 0 }],
            creatorId: socket.id,
            status: 'waiting',
            gameType: 'tienlen', // លំនាំដើម
            currentTurnIndex: 0,
            playedCards: [],
            lastPlayerId: null,
            // សម្រាប់កាតេ
            catteTrickCards: [],
            catteRoundCount: 1
        };

        socket.join(roomId);
        socket.emit('joinedRoom', { roomId, isCreator: true, gameType: 'tienlen' });
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
        broadcastRoomList();
    });

    // ប្តូរប្រភេទហ្គេម (ទៀនឡេន ឬ កាតេ)
    socket.on('changeGameType', ({ roomId, gameType }) => {
        const room = rooms[roomId];
        if (room && room.creatorId === socket.id && room.status === 'waiting') {
            room.gameType = gameType;
            io.to(roomId).emit('gameTypeChanged', gameType);
            broadcastRoomList();
        }
    });

    // ចូលរួមបន្ទប់ (កាតេអនុញ្ញាត ៦នាក់, ទៀនឡេន ៤នាក់)
    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់នេះទេ!');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដបន្ទប់មិនត្រឹមត្រូវទេ!');

        const maxPlayers = room.gameType === 'catte' ? 6 : 4;
        const activePlayers = room.players.filter(p => !p.isSpectator);

        let isSpectator = false;
        if (room.status === 'playing' || activePlayers.length >= maxPlayers) {
            isSpectator = true;
        }

        room.players.push({ id: socket.id, name: playerName, hand: [], passed: false, rank: null, isSpectator, catteKakt: 0 });
        
        socket.join(roomId);
        socket.emit('joinedRoom', { roomId, isCreator: (room.creatorId === socket.id), gameType: room.gameType });
        io.to(roomId).emit('updatePlayers', room.players);
        
        // បើហ្គេមកំពុងលេង ផ្ញើស្ថានភាពតុឱ្យ Spectator មើលដែរ
        if (room.status === 'playing') {
            if (room.gameType === 'tienlen') {
                socket.emit('cardPlayed', { by: room.lastPlayerId, cards: room.playedCards, nextTurn: room.currentTurnIndex, updatedHands: room.players });
            } else {
                socket.emit('catteUpdateState', { currentTurnIndex: room.currentTurnIndex, trickCards: room.catteTrickCards, roundCount: room.catteRoundCount, players: room.players });
            }
        }
        broadcastRoomList();
    });

    // ចាប់ផ្តើមហ្គេម
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.creatorId !== socket.id) return;

        const activePlayers = room.players.filter(p => !p.isSpectator);
        if (activePlayers.length < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់!');

        const deck = shuffleDeck(createDeck());
        room.status = 'playing';

        const cardsToDeal = room.gameType === 'catte' ? 6 : 13;

        let pIdx = 0;
        room.players.forEach(p => {
            if (!p.isSpectator) {
                p.hand = deck.slice(pIdx * cardsToDeal, (pIdx + 1) * cardsToDeal);
                p.passed = false;
                p.rank = null;
                p.catteKakt = 0;
                pIdx++;
                // តម្រៀបបៀរក្នុងដៃឱ្យស្អាតរៀងៗខ្លួន
                if (room.gameType === 'catte') {
                    p.hand = catteLogic.sortCatteCards(p.hand);
                } else {
                    p.hand = tienlenLogic.sortCards(p.hand);
                }
            } else {
                p.hand = [];
            }
        });

        room.currentTurnIndex = room.players.findIndex(p => !p.isSpectator);
        room.playedCards = [];
        room.lastPlayerId = null;
        room.catteTrickCards = [];
        room.catteRoundCount = 1;

        // បញ្ជាឱ្យ Client ទាំងអស់ប្តូរទំព័រទៅតាមប្រភេទហ្គេម
        io.to(roomId).emit('goToGamePage', { gameType: room.gameType, roomId });
        broadcastRoomList();

        // ចែកបៀរដាច់ដោយឡែកពីគ្នាដើម្បីសុវត្ថិភាព (មិនឱ្យឃើញបៀរគ្នា)
        setTimeout(() => {
            room.players.forEach(p => {
                io.to(p.id).emit('dealCards', { hand: p.hand, isSpectator: p.isSpectator });
            });
            // ផ្ញើស្ថានភាពដំបូងទៅកាន់ទំព័រថ្មី
            if (room.gameType === 'tienlen') {
                io.to(roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex });
            } else {
                io.to(roomId).emit('catteUpdateState', {
                    currentTurnIndex: room.currentTurnIndex,
                    trickCards: room.catteTrickCards,
                    roundCount: room.catteRoundCount,
                    players: room.players.map(pl => ({ id: pl.id, name: pl.name, cardCount: pl.hand.length, catteKakt: pl.catteKakt }))
                });
            }
        }, 800);
    });

    // ================= [ LOGIC ហ្គេមទៀនឡេន ] =================
    socket.on('playCard', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing' || room.gameType !== 'tienlen') return;

        const player = room.players[room.currentTurnIndex];
        if (player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ!');

        // ឆែកមើលថាតើអ្នកលេងមានបៀរទាំងនោះពិតមែនឬអត់
        const hasCards = cards.every(c => player.hand.some(hc => hc.value === c.value && hc.suit === c.suit));
        if (!hasCards) return socket.emit('errorMsg', 'បៀរមិនត្រឹមត្រូវ!');

        // ឆែកជាមួយ Logic ទៀនឡេនដាច់ដោយឡែក
        if (!tienlenLogic.comparePlay(cards, room.playedCards)) {
            return socket.emit('errorMsg', 'ចុះខុសក្បួន ឬបៀរតូចជាងនៅលើតុ!');
        }

        // ដកបៀរចេញពីដៃ
        player.hand = player.hand.filter(hc => !cards.some(c => c.value === hc.value && c.suit === hc.suit));
        room.playedCards = cards;
        room.lastPlayerId = player.id;

        // បើអស់បៀរពីដៃ ផ្តល់ចំណាត់ថ្នាក់ (Rank)
        if (player.hand.length === 0 && !player.rank) {
            const currentRanked = room.players.filter(p => p.rank).length;
            player.rank = currentRanked + 1;
            io.to(roomId).emit('playerFinished', { name: player.name, rank: player.rank });
        }

        // ពិនិត្យបញ្ចប់ហ្គេម (សល់តែម្នាក់មិនទាន់អស់បៀរ)
        const activeLeft = room.players.filter(p => !p.isSpectator && p.hand.length > 0);
        if (activeLeft.length <= 1) {
            if (activeLeft.length === 1) {
                const lastRank = room.players.filter(p => !p.isSpectator).length;
                activeLeft[0].rank = lastRank;
            }
            room.status = 'waiting';
            io.to(roomId).emit('gameWon', { winner: room.players.find(p => p.rank === 1).name, allHands: room.players });
            broadcastRoomList();
            return;
        }

        // ស្វែងរកអ្នកបន្ទាប់
        moveToNextActiveTurn(room);

        io.to(roomId).emit('cardPlayed', { by: player.id, cards: room.playedCards, nextTurn: room.currentTurnIndex, updatedHands: room.players });
        io.to(player.id).emit('dealCards', { hand: player.hand, isSpectator: player.isSpectator });
    });

    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing' || room.gameType !== 'tienlen') return;

        const player = room.players[room.currentTurnIndex];
        if (player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ!');
        if (room.playedCards.length === 0) return socket.emit('errorMsg', 'អ្នកបើកទឹកមិនអាចរំលងបានទេ!');

        player.passed = true;
        io.to(roomId).emit('playerPassed', { name: player.name });

        handleTienlenPassAndRound(room);
    });

    // ================= [ LOGIC ហ្គេមកាតេ ] =================
    socket.on('cattePlayCard', ({ roomId, card, isFold }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing' || room.gameType !== 'catte') return;

        const player = room.players[room.currentTurnIndex];
        if (player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ!');

        // ដកបៀរចេញពីដៃ
        player.hand = player.hand.filter(c => !(c.value === card.value && c.suit === card.suit));

        // ដាក់ចូលតុ
        room.catteTrickCards.push({ playerId: player.id, playerName: player.name, card, isFold });

        // ទៅអ្នកបន្ទាប់ដែលមានសិទ្ធិលេង (មិនមែន Spectator និងមិនទាន់ងាប់បៀរ)
        moveToNextCattePlayer(room);

        // បើគ្រប់គ្នាក្នុងជុំចុះម្នាក់មួយសន្លឹកអស់ហើយ (គិតតែអ្នកលេងសកម្ម)
        const activePlayersInGame = room.players.filter(p => !p.isSpectator && (room.catteRoundCount <= 4 || p.catteKakt > 0));
        
        if (room.catteTrickCards.length === activePlayersInGame.length) {
            // ស្វែងរក ID អ្នកឈ្នះទឹកនេះពី Logic
            const winnerId = catteLogic.determineTrickWinner(room.catteTrickCards);
            const finalWinnerId = winnerId || room.catteTrickCards[0].playerId; // បើផ្កាប់ទាំងអស់ ឱ្យអ្នកបើកទឹកឈ្នះ

            const winnerPlayer = room.players.find(p => p.id === finalWinnerId);
            winnerPlayer.catteKakt += 1;

            // អ្នកឈ្នះទឹកនេះ ក្លាយជាអ្នកបើកទឹកជុំបន្ទាប់
            room.currentTurnIndex = room.players.findIndex(p => p.id === finalWinnerId);

            io.to(roomId).emit('catteTrickEnd', { trickResult: room.catteTrickCards, winnerName: winnerPlayer.name });

            room.catteTrickCards = [];
            room.catteRoundCount += 1;

            // ចប់ទឹកទី ៤៖ ឆែករកអ្នក "ឡៅ/ងាប់បៀរ" (អ្នកអត់កក់សោះ ត្រូវដកហូតបៀរចេញ)
            if (room.catteRoundCount === 5) {
                room.players.forEach(p => {
                    if (!p.isSpectator && p.catteKakt === 0) {
                        p.hand = []; // ងាប់បៀរ
                    }
                });
                // ករណីអ្នកឈ្នះទឹកទី៤ ងាប់បៀរ (អត់អាចទៅរួចទេ តែការពារ) បើគាំង ឱ្យមេបន្ទប់បើកទឹក៥
                if (winnerPlayer.catteKakt === 0) {
                    moveToNextCattePlayer(room);
                }
            }

            // បើលើសពីទឹកទី ៦ គឺបញ្ចប់ហ្គេម (អ្នកឈ្នះទឹកទី៦ ជាមេឈ្នះលុយរួម)
            if (room.catteRoundCount > 6) {
                room.status = 'waiting';
                io.to(roomId).emit('catteGameEnd', { winner: winnerPlayer.name, players: room.players });
                broadcastRoomList();
                return;
            }
        }

        // ផ្ញើបច្ចុប្បន្នភាពទៅកាន់ Client រៀងៗខ្លួន
        io.to(roomId).emit('catteUpdateState', {
            currentTurnIndex: room.currentTurnIndex,
            trickCards: room.catteTrickCards,
            roundCount: room.catteRoundCount,
            players: room.players.map(pl => ({ id: pl.id, name: pl.name, cardCount: pl.hand.length, catteKakt: pl.catteKakt }))
        });
        io.to(player.id).emit('dealCards', { hand: player.hand, isSpectator: player.isSpectator });
    });

    // --- មុខងារជំនួយក្នុងបន្ទប់លេង (Helpers) ---
    function moveToNextActiveTurn(room) {
        do {
            room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        } while (room.players[room.currentTurnIndex].isSpectator || room.players[room.currentTurnIndex].passed || room.players[room.currentTurnIndex].hand.length === 0);
    }

    function moveToNextCattePlayer(room) {
        let attempts = 0;
        do {
            room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
            attempts++;
            const p = room.players[room.currentTurnIndex];
            // ទឹកទី ៥-៦ លេងបានតែអ្នកមាន "កក់" ប៉ុណ្ណោះ
            const canPlayCatte = !p.isSpectator && (room.catteRoundCount <= 4 || p.catteKakt > 0);
            if (canPlayCatte) break;
        } while (attempts < room.players.length);
    }

    function handleTienlenPassAndRound(room) {
        const activeNotPassed = room.players.filter(p => !p.isSpectator && !p.passed && p.hand.length > 0);
        
        if (activeNotPassed.length <= 1) {
            // ដាច់ទឹក! ឱ្យអ្នកមិនទាន់ Pass ចុងក្រោយគេបើកទឹកថ្មី
            let nextPlayerIndex = room.players.findIndex(p => !p.isSpectator && !p.passed && p.hand.length > 0);
            if (nextPlayerIndex === -1) {
                nextPlayerIndex = room.players.findIndex(p => p.id === room.lastPlayerId);
            }
            
            room.currentTurnIndex = nextPlayerIndex;
            room.playedCards = [];
            room.players.forEach(p => p.passed = false); // លុបស្ថានភាព Pass ចោលទាំងអស់

            io.to(room.roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
        } else {
            moveToNextActiveTurn(room);
        }
        io.to(room.roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
        io.to(room.roomId).emit('updatePlayers', room.players);
    }

    // --- ចាកចេញពីបន្ទប់ / Disconnect ---
    socket.on('leaveRoom', () => {
        handleUserLeave(socket);
    });

    socket.on('disconnect', () => {
        handleUserLeave(socket);
    });
});

function handleUserLeave(socket) {
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
                
                if (room.status === 'playing' && !wasSpectator && room.gameType === 'tienlen' && room.currentTurnIndex === pIdx) {
                    handleTienlenPassAndRound(room);
                }
                io.to(id).emit('updatePlayers', room.players);
            }
            broadcastRoomList();
            socket.emit('leftRoom');
            break;
        }
    }
}

server.listen(3000, () => console.log('🚀 Server running on port 3000'));