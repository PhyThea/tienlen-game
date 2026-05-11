// =================================================================
// server.js (កំណែទម្រង់ពេញលេញ - ដំណើរការត្រឹមត្រូវ ១០០%)
// =================================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

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

function getCardPower(card) {
    return (CARD_ORDER.indexOf(card.value) * 10) + SUIT_ORDER[card.suit];
}

function sortCards(cards) {
    return cards.sort((a, b) => getCardPower(a) - getCardPower(b));
}

function getComboType(cards) {
    const len = cards.length;
    if (len === 0) return null;
    if (len === 1) return 'single';
    
    const sorted = sortCards([...cards]);
    const sameValue = cards.every(c => c.value === cards[0].value);
    
    if (sameValue) {
        if (len === 2) return 'pair';
        if (len === 3) return 'triple'; 
        if (len === 4) return 'bomb';   
    }

    if (len === 4) {
        let is2Pair = true;
        if (sorted[0].value !== sorted[1].value) is2Pair = false;
        if (sorted[2].value !== sorted[3].value) is2Pair = false;
        
        const firstValIdx = CARD_ORDER.indexOf(sorted[0].value);
        const secondValIdx = CARD_ORDER.indexOf(sorted[2].value);
        
        if (secondValIdx !== firstValIdx + 1) is2Pair = false;
        if (sorted[2].value === '2') is2Pair = false;

        if (is2Pair) return 'double_pair';
    }

    if (len === 8) {
        let is4Pair = true;
        for (let i = 0; i < 8; i += 2) {
            if (sorted[i].value !== sorted[i+1].value) is4Pair = false;
            if (i > 0 && CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-2].value) + 1) is4Pair = false;
        }
        if (sorted[6].value === '2') is4Pair = false;
        if (is4Pair) return 'quad_pair';
    }

    let isStr = true;
    for (let i = 1; i < len; i++) {
        if (CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-1].value) + 1) isStr = false;
        if (sorted[i].value === '2') isStr = false; 
    }

    if (isStr && len >= 3) {
        const sameSuit = cards.every(c => c.suit === cards[0].suit);
        if (sameSuit) return 'straight_flush'; 
        return 'straight'; 
    }

    return null;
}

function comparePlay(newCards, oldCards) {
    if (!oldCards || oldCards.length === 0) return true;
    
    const newType = getComboType(newCards);
    const oldType = getComboType(oldCards);
    const newMax = getCardPower(sortCards([...newCards]).pop());
    const oldMax = getCardPower(sortCards([...oldCards]).pop());

    if (oldType === 'single' && oldCards[0].value === '2') {
        if (newType === 'double_pair' || newType === 'bomb' || newType === 'quad_pair') return true;
    }

    if (oldType === 'double_pair') {
        if (newType === 'double_pair' && newMax > oldMax) return true;
        if (newType === 'bomb' || newType === 'quad_pair') return true;
    }

    if (newType === oldType && newCards.length === oldCards.length) {
        return newMax > oldMax;
    }

    return false;
}

function moveToNextTurn(room) {
    const activePlayers = room.players.filter(p => !p.isSpectator && p.hand.length > 0);
    if (activePlayers.length === 0) return;

    let originalIndex = room.currentTurnIndex;
    let nextIndex = originalIndex;
    let found = false;

    for (let i = 1; i <= room.players.length; i++) {
        let checkIndex = (originalIndex + i) % room.players.length;
        let p = room.players[checkIndex];
        if (p && !p.isSpectator && !p.passed && p.hand.length > 0) {
            nextIndex = checkIndex;
            found = true;
            break;
        }
    }

    if (found) {
        room.currentTurnIndex = nextIndex;
    }
}

function broadcastRoomList() {
    const list = Object.keys(rooms).map(id => {
        return {
            roomId: id,
            playerCount: rooms[id].players.length,
            status: rooms[id].status,
            hasPassword: rooms[id].password && rooms[id].password !== "" ? true : false
        };
    });
    io.emit('roomList', list);
}

io.on('connection', (socket) => {
    broadcastRoomList();

    socket.on('createRoom', ({ roomId, password, playerName }) => {
        if (rooms[roomId]) {
            return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ! សូមបង្កើតលេខបន្ទប់ផ្សេង។');
        }
        
        rooms[roomId] = {
            players: [{ id: socket.id, name: playerName || 'Player 1', hand: [], passed: false, isSpectator: false }],
            creatorId: socket.id,
            status: 'waiting', 
            password: password || "",
            currentTurnIndex: 0,
            playedCards: [],
            lastPlayerId: null,
            lastWinnerId: null
        };
        
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
        broadcastRoomList();
    });

    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់នេះទេ!');
        
        if (room.password && room.password !== password) {
            return socket.emit('errorMsg', 'លេខកូដសម្ងាត់បន្ទប់មិនត្រឹមត្រូវឡើយ!');
        }

        if (room.players.length >= 4) {
            return socket.emit('errorMsg', 'បន្ទប់នេះពេញហើយ (អតិបរមា ៤ នាក់)!');
        }

        const isSpectator = room.status === 'playing';

        room.players.push({ 
            id: socket.id, 
            name: playerName || 'Guest', 
            hand: [], 
            passed: false,
            isSpectator: isSpectator 
        });

        socket.join(roomId);
        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator });
        io.to(roomId).emit('updatePlayers', room.players);
        
        if (isSpectator) {
            socket.emit('cardPlayed', { 
                by: 'System', 
                cards: room.playedCards, 
                nextTurn: room.currentTurnIndex,
                cardCount: 0,
                updatedHands: room.players 
            });
        }
        broadcastRoomList();
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.creatorId !== socket.id) return;

        room.players.forEach(p => {
            p.isSpectator = false;
            p.hand = [];
            p.passed = false;
        });

        const activePlayers = room.players;
        const playerCount = activePlayers.length;

        if (playerCount < 2) {
            return socket.emit('errorMsg', 'មិនអាចលេងបានទេ! ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់។');
        }

        const deck = shuffleDeck(createDeck());
        room.status = 'playing'; 
        room.playedCards = [];
        room.lastPlayerId = null;
        
        activePlayers.forEach((p, i) => {
            p.hand = sortCards(deck.slice(i * 13, (i + 1) * 13));
            io.to(p.id).emit('dealCards', { hand: p.hand });
        });

        let startingIndex = -1;
        if (room.lastWinnerId) {
            startingIndex = activePlayers.findIndex(p => p.id === room.lastWinnerId);
        }

        if (startingIndex === -1) {
            startingIndex = activePlayers.findIndex(p => 
                p.hand.some(c => c.value === '3' && c.suit === '♠')
            );
        }

        if (startingIndex === -1) {
            startingIndex = 0;
        }

        room.currentTurnIndex = startingIndex;

        io.to(roomId).emit('gameStarted', { 
            players: room.players, 
            currentTurnIndex: room.currentTurnIndex 
        });
        broadcastRoomList();
    });

    socket.on('playCard', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        
        if (!player || player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ');
        if (player.isSpectator) return socket.emit('errorMsg', 'អ្នកជាអ្នកមើលរង់ចាំវគ្គក្រោយ មិនអាចចុះបៀបានទេ!');

        if (getComboType(cards) && comparePlay(cards, room.playedCards)) {
            const winningCards = [...cards]; 

            cards.forEach(c => {
                const idx = player.hand.findIndex(pc => pc.value === c.value && pc.suit === c.suit);
                if (idx !== -1) player.hand.splice(idx, 1);
            });

            room.playedCards = cards;
            room.lastPlayerId = socket.id;
            player.passed = false; 

            const activePlayers = room.players.filter(p => !p.isSpectator);
            const winner = activePlayers.find(p => p.hand.length === 0);

            if (winner) {
                room.status = 'waiting'; 
                room.lastWinnerId = winner.id; 

                const results = room.players.map(p => {
                    const isWinner = p.id === winner.id;
                    return { 
                        id: p.id,
                        name: p.name, 
                        remaining: isWinner ? winningCards : p.hand, 
                        isSpectator: p.isSpectator,
                        isWinner: isWinner
                    };
                });
                
                io.to(roomId).emit('gameWon', { 
                    winner: winner.name, 
                    winnerId: winner.id, 
                    allHands: results 
                });
                broadcastRoomList();
            } else {
                moveToNextTurn(room);
                io.to(roomId).emit('cardPlayed', { 
                    by: player.name, 
                    cards, 
                    nextTurn: room.currentTurnIndex,
                    cardCount: player.hand.length,
                    updatedHands: room.players 
                });
            }
        } else {
            socket.emit('errorMsg', 'ចុះមិនត្រូវក្បួន ឬបៀតូចជាង!');
        }
    });

    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return;

        player.passed = true;
        const activePlaying = room.players.filter(p => !p.isSpectator && !p.passed && p.hand.length > 0);
        
        io.to(roomId).emit('playerPassed', { 
            name: player.name, 
            id: player.id,
            message: "តោះខ្ញុំអត់ស៊ីទេ"
        });
        
        if (activePlaying.length <= 1) {
            room.playedCards = []; 
            room.players.forEach(p => p.passed = false); 
            
            let nextWinnerIndex = room.players.findIndex(p => p.id === room.lastPlayerId);
            if (nextWinnerIndex === -1 || room.players[nextWinnerIndex].isSpectator || room.players[nextWinnerIndex].hand.length === 0) {
                nextWinnerIndex = room.players.findIndex(p => !p.isSpectator && p.hand.length > 0);
            }
            
            room.currentTurnIndex = nextWinnerIndex !== -1 ? nextWinnerIndex : 0;
            
            io.to(roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
            io.to(roomId).emit('cardPlayed', { 
                by: 'System', 
                cards: [], 
                nextTurn: room.currentTurnIndex,
                cardCount: room.players[room.currentTurnIndex].hand.length,
                updatedHands: room.players 
            });
        } else {
            moveToNextTurn(room);
            io.to(roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
        }
    });

    socket.on('leaveRoom', () => {
        for (const id in rooms) {
            const room = rooms[id];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            
            if (pIdx !== -1) {
                const wasSpectator = room.players[pIdx].isSpectator;
                room.players.splice(pIdx, 1);
                socket.leave(id); 
                socket.emit('leftRoom'); 
                
                if (room.players.length === 0) {
                    delete rooms[id]; 
                } else {
                    if (room.creatorId === socket.id) {
                        room.creatorId = room.players[0].id; 
                    }
                    if (room.status === 'playing' && !wasSpectator && room.currentTurnIndex === pIdx) {
                        moveToNextTurn(room);
                        io.to(id).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
                    }
                    io.to(id).emit('updatePlayers', room.players);
                }
                broadcastRoomList();
            }
        }
    });

    socket.on('disconnect', () => {
        for (const id in rooms) {
            const room = rooms[id];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            
            if (pIdx !== -1) {
                const wasSpectator = room.players[pIdx].isSpectator;
                room.players.splice(pIdx, 1);
                
                if (room.players.length === 0) {
                    delete rooms[id]; 
                } else {
                    if (room.creatorId === socket.id) {
                        room.creatorId = room.players[0].id;
                    }
                    if (room.status === 'playing' && !wasSpectator && room.currentTurnIndex === pIdx) {
                        moveToNextTurn(room);
                        io.to(id).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
                    }
                    io.to(id).emit('updatePlayers', room.players);
                }
                broadcastRoomList();
            }
        }
    });
});

server.listen(3000, () => console.log('Server is running on port 3000'));