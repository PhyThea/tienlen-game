const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from root directory
app.use(express.static(__dirname));

const rooms = {};

function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
    let deck = [];
    for (let s of suits) {
        for (let v of values) {
            deck.push({ suit: s, value: v });
        }
    }
    return deck;
}

function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

io.on('connection', (socket) => {
    console.log('✅ Connected:', socket.id);
    
    // Create Room
    socket.on('createRoom', ({ roomId, password, playerName }) => {
        if (rooms[roomId]) {
            return socket.emit('errorMsg', 'បន្ទប់នេះមានស្រាប់!');
        }
        
        socket.join(roomId);
        rooms[roomId] = {
            players: [{ id: socket.id, name: playerName || 'Player 1', hand: [] }],
            maxPlayers: 4, 
            password: password || null, 
            creatorId: socket.id,
            status: 'waiting', 
            currentTurnIndex: 0, 
            lastPlayed: null, 
            playedCards: [], 
            winner: null
        };
        
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
        io.to(roomId).emit('gameStatus', '⏳ រង់ចាំអ្នកលេង...');
    });
    
    // Join Room
    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = rooms[roomId];
        if (!room) {
            return socket.emit('errorMsg', 'បន្ទប់នេះមិនមានទេ!');
        }
        if (room.password && room.password !== password) {
            return socket.emit('errorMsg', 'Password មិនត្រឹមត្រូវ!');
        }
        if (room.players.length >= room.maxPlayers) {
            return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');
        }
        if (room.status !== 'waiting') {
            return socket.emit('errorMsg', 'ហ្គេមកំពុងដំណើរការ!');
        }
        
        socket.join(roomId);
        const newPlayer = { 
            id: socket.id, 
            name: playerName || `Player ${room.players.length + 1}`, 
            hand: [] 
        };
        room.players.push(newPlayer);
        
        socket.emit('roomJoined', { roomId, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', room.players);
        io.to(roomId).emit('gameStatus', `👤 ${newPlayer.name} បានចូល...`);
    });
    
    // Start Game
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        if (room.creatorId !== socket.id) {
            return socket.emit('errorMsg', 'តែអ្នកបង្កើតប៉ុណ្ណោះអាច Start!');
        }
        if (room.status !== 'waiting') {
            return socket.emit('errorMsg', 'ហ្គេមចាប់ផ្តើមហើយ!');
        }
        if (room.players.length < 2) {
            return socket.emit('errorMsg', 'ត្រូវការយ៉ាងហោច ២ នាក់!');
        }
        
        room.status = 'playing';
        const deck = shuffleDeck(createDeck());
        
        // Deal cards
        room.players.forEach((p, i) => { 
            p.hand = deck.slice(i * 13, (i + 1) * 13); 
        });
        
        // Find who has 3 of Clubs
        room.currentTurnIndex = room.players.findIndex(p => 
            p.hand.some(c => c.value === '3' && c.suit === '♣')
        );
        if (room.currentTurnIndex === -1) {
            room.currentTurnIndex = 0;
        }
        
        io.to(roomId).emit('gameStarted', { 
            players: room.players.map(p => ({ 
                id: p.id, 
                name: p.name, 
                cardCount: p.hand.length 
            })), 
            currentTurnIndex: room.currentTurnIndex 
        });
        
        // Send hands to each player
        room.players.forEach(p => {
            io.to(p.id).emit('dealCards', { 
                hand: p.hand, 
                isYourTurn: room.players.indexOf(p) === room.currentTurnIndex 
            });
        });
        
        io.to(roomId).emit('gameStatus', `🎮 ចាប់ផ្តើម! វេន: ${room.players[room.currentTurnIndex].name}`);
    });
    
    // Play Card
    socket.on('playCard', ({ roomId, cardValue, cardSuit }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player || room.players.indexOf(player) !== room.currentTurnIndex) {
            return;
        }
        
        const cardIdx = player.hand.findIndex(c => 
            c.value === cardValue && c.suit === cardSuit
        );
        if (cardIdx === -1) return;
        
        const playedCard = player.hand.splice(cardIdx, 1)[0];
        room.lastPlayed = { 
            value: playedCard.value, 
            suit: playedCard.suit, 
            by: player.name 
        };
        
        if (player.hand.length === 0) {
            room.winner = player.name;
            io.to(roomId).emit('gameWon', { winner: player.name });
            return;
        }
        
        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        
        io.to(roomId).emit('cardPlayed', { 
            card: room.lastPlayed, 
            currentTurnIndex: room.currentTurnIndex, 
            updatedHands: room.players.map(p => ({ 
                id: p.id, 
                name: p.name,
                cardCount: p.hand.length 
            })) 
        });
        
        io.to(roomId).emit('gameStatus', `🎯 វេន: ${room.players[room.currentTurnIndex].name}`);
    });
    
    // Disconnect
    socket.on('disconnect', () => {
        for (let id in rooms) {
            const room = rooms[id];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                room.players.splice(pIdx, 1);
                io.to(id).emit('updatePlayers', room.players);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});