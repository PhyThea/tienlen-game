const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

function createDeck() {
    const suits = ['♠', '♣', '♦', '♥']; // រៀបតាមលំដាប់ខ្លាំង: ប៊ិច ជួង ការ៉ូ មូល
    const values = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
    let deck = [];
    for (let v of values) {
        for (let s of suits) {
            deck.push({ suit: s, value: v });
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
    socket.on('createRoom', ({ roomId, password, playerName }) => {
        if (rooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        
        socket.join(roomId);
        rooms[roomId] = {
            id: roomId,
            players: [{ id: socket.id, name: playerName || 'Player 1', hand: [], active: true }],
            creatorId: socket.id,
            status: 'waiting',
            currentTurnIndex: 0,
            lastPlayed: null,
            passCount: 0
        };
        
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', rooms[roomId].players.map(p => ({name: p.name, id: p.id, cardCount: 0})));
    });

    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'មិនមានបន្ទប់នេះទេ!');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'បន្ទប់ពេញ!');
        
        socket.join(roomId);
        const newPlayer = { id: socket.id, name: playerName || `Player ${room.players.length + 1}`, hand: [], active: true };
        room.players.push(newPlayer);
        
        io.to(roomId).emit('updatePlayers', room.players.map(p => ({name: p.name, id: p.id, cardCount: 0})));
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.creatorId !== socket.id) return;
        
        room.status = 'playing';
        const deck = shuffleDeck(createDeck());
        
        // ចែកបៀ
        room.players.forEach((p, i) => {
            p.hand = deck.slice(i * 13, (i + 1) * 13);
        });

        // រកអ្នកមាន ៣ ជួង (3♣) ដើម្បីឱ្យចេញមុនគេ
        room.currentTurnIndex = room.players.findIndex(p => 
            p.hand.some(c => c.value === '3' && c.suit === '♣')
        );
        if(room.currentTurnIndex === -1) room.currentTurnIndex = 0;

        io.to(roomId).emit('gameStarted', {
            currentTurnIndex: room.currentTurnIndex,
            players: room.players.map(p => ({ id: p.id, name: p.name, cardCount: 13 }))
        });

        room.players.forEach(p => {
            io.to(p.id).emit('dealCards', p.hand);
        });
    });

    socket.on('playCard', ({ roomId, card }) => {
        const room = rooms[roomId];
        if (!room) return;
        
        const player = room.players[room.currentTurnIndex];
        if (player.id !== socket.id) return;

        // ដកបៀរចេញពីដៃ
        player.hand = player.hand.filter(c => !(c.value === card.value && c.suit === card.suit));
        room.lastPlayed = card;
        room.passCount = 0; // Reset pass count ពេលមានអ្នកចេញបៀ

        if (player.hand.length === 0) {
            io.to(roomId).emit('gameWon', { winner: player.name });
            delete rooms[roomId];
            return;
        }

        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        
        io.to(roomId).emit('cardPlayed', {
            card: card,
            nextTurn: room.currentTurnIndex,
            updatedPlayers: room.players.map(p => ({ id: p.id, cardCount: p.hand.length }))
        });
    });

    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        
        room.passCount++;
        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        
        // បើគ្រប់គ្នា Pass អស់ សម្អាតបៀលើតុ
        if (room.passCount >= room.players.length - 1) {
            room.lastPlayed = null;
            room.passCount = 0;
            io.to(roomId).emit('clearTable', { nextTurn: room.currentTurnIndex });
        } else {
            io.to(roomId).emit('turnPassed', { nextTurn: room.currentTurnIndex });
        }
    });
});

server.listen(3000, () => console.log('🚀 Server running on http://localhost:3000'));