const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
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

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('createRoom', ({ roomId, password, playerName }) => {
        if (rooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        
        socket.join(roomId);
        rooms[roomId] = {
            id: roomId,
            players: [{ id: socket.id, name: playerName || 'Player 1', hand: [], passed: false, rank: null, isSpectator: false }],
            creatorId: socket.id,
            status: 'waiting',
            currentTurnIndex: 0,
            lastPlayed: null,
            passCount: 0,
            voicePeers: [socket.id]
        };
        
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
    });

    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'មិនមានបន្ទប់នេះទេ!');
        
        socket.join(roomId);
        let isSpectator = room.status === 'playing' || room.players.filter(p => !p.isSpectator).length >= 4;
        
        const newPlayer = { 
            id: socket.id, 
            name: playerName || `Player ${room.players.length + 1}`, 
            hand: [], 
            passed: false,
            rank: null,
            isSpectator: isSpectator
        };
        
        room.players.push(newPlayer);
        if (!room.voicePeers) room.voicePeers = [];
        room.voicePeers.push(socket.id);

        socket.emit('roomJoined', roomId);
        io.to(roomId).emit('updatePlayers', room.players);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        
        room.status = 'playing';
        room.lastPlayed = null;
        room.passCount = 0;
        
        const activePlayers = room.players.filter(p => !p.isSpectator);
        activePlayers.forEach(p => {
            p.passed = false;
            p.rank = null;
        });

        const deck = shuffleDeck(createDeck());
        activePlayers.forEach((p, i) => {
            p.hand = deck.slice(i * 13, (i + 1) * 13);
        });

        room.currentTurnIndex = room.players.findIndex(p => 
            p.hand.some(c => c.value === '3' && c.suit === '♠')
        );
        if (room.currentTurnIndex === -1) room.currentTurnIndex = room.players.findIndex(p => !p.isSpectator);

        io.to(roomId).emit('gameStarted', {
            currentTurnIndex: room.currentTurnIndex,
            players: room.players.map(p => ({ id: p.id, name: p.name, cardCount: p.hand.length, passed: p.passed, rank: p.rank, isSpectator: p.isSpectator }))
        });

        room.players.forEach(p => {
            if (!p.isSpectator) io.to(p.id).emit('dealCards', { hand: p.hand });
        });
    });

    socket.on('playCard', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room) return;
        
        const player = room.players[room.currentTurnIndex];
        if (player.id !== socket.id) return;

        // កូដលុបបៀរចេញពីដៃជាក្រុម
        cards.forEach(selectedCard => {
            player.hand = player.hand.filter(c => !(c.value === selectedCard.value && c.suit === selectedCard.suit));
        });

        room.lastPlayed = cards;
        room.passCount = 0;

        // ពិនិត្យមើលអ្នកឈ្នះ
        if (player.hand.length === 0 && !player.rank) {
            const rankCount = room.players.filter(p => p.rank !== null).length + 1;
            player.rank = rankCount;
            io.to(roomId).emit('gameWon', { 
                winner: player.name, 
                winnerId: player.id, 
                allHands: room.players 
            });
            return;
        }

        // ស្វែងរកវេនបន្ទាប់
        do {
            room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        } while (room.players[room.currentTurnIndex].isSpectator || room.players[room.currentTurnIndex].passed || room.players[room.currentTurnIndex].hand.length === 0);

        io.to(roomId).emit('cardPlayed', {
            by: player.name,
            cards: cards,
            nextTurn: room.currentTurnIndex,
            updatedHands: room.players.map(p => ({ id: p.id, name: p.name, cardCount: p.hand.length, passed: p.passed, rank: p.rank, isSpectator: p.isSpectator }))
        });
    });

    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        
        const player = room.players[room.currentTurnIndex];
        player.passed = true;
        room.passCount++;

        io.to(roomId).emit('playerPassed', { name: player.name, id: player.id });

        const activeInRound = room.players.filter(p => !p.isSpectator && p.hand.length > 0 && !p.passed);
        
        if (activeInRound.length <= 1) {
            room.players.forEach(p => p.passed = false);
            room.passCount = 0;
            room.lastPlayed = null;
            
            let nextPlayerIndex = room.players.findIndex(p => p.id === activeInRound[0]?.id);
            if (nextPlayerIndex === -1) nextPlayerIndex = room.currentTurnIndex;
            room.currentTurnIndex = nextPlayerIndex;

            io.to(roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
        } else {
            do {
                room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
            } while (room.players[room.currentTurnIndex].isSpectator || room.players[room.currentTurnIndex].passed || room.players[room.currentTurnIndex].hand.length === 0);
            
            io.to(roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players });
        }
    });

    // --- Voice Chat Events ---
    socket.on('request-voice-peers', (roomId) => {
        const room = rooms[roomId];
        if (room && room.voicePeers) {
            const peers = room.voicePeers.filter(id => id !== socket.id);
            socket.emit('voice-peers-list', peers);
        }
    });

    socket.on('voice-signal', ({ roomId, to, signal, from }) => {
        io.to(to).emit('voice-signal', { signal, from });
    });

    socket.on('leaveRoom', () => {
        handleDisconnect(socket);
    });

    socket.on('disconnect', () => {
        handleDisconnect(socket);
    });
});

function handleDisconnect(socket) {
    for (const roomId in rooms) {
        const room = rooms[roomId];
        if (room.voicePeers) {
            room.voicePeers = room.voicePeers.filter(id => id !== socket.id);
            io.to(roomId).emit('voice-peer-disconnected', socket.id);
        }
        const index = room.players.findIndex(p => p.id === socket.id);
        if (index !== -1) {
            room.players.splice(index, 1);
            if (room.players.length === 0) {
                delete rooms[roomId];
            } else {
                if (room.creatorId === socket.id) room.creatorId = room.players[0].id;
                io.to(roomId).emit('updatePlayers', room.players);
            }
            socket.emit('leftRoom');
            break;
        }
    }
}

server.listen(3000, () => console.log('🚀 Server running on http://localhost:3000'));