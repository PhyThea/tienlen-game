// ==========================================
// server.js (កំណែទម្រង់ការពារការគាំងហ្គេម ១០០%)
// ==========================================

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

    if (len === 8) {
        let is4Pair = true;
        for (let i = 0; i < 8; i += 2) {
            if (sorted[i].value !== sorted[i+1].value) is4Pair = false;
            if (i > 0 && CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-2].value) + 1) is4Pair = false;
        }
        if (is4Pair) return 'quad_pair';
    }

    let isStr = true;
    for (let i = 1; i < len; i++) {
        if (CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-1].value) + 1) isStr = false;
        if (sorted[i].value === '2') isStr = false; 
    }

    if (isStr && len >= 3) {
        const sameSuit = cards.every(c => c.suit === cards[0].suit);
        if (sameSuit) {
            return 'straight_flush'; 
        }
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
        if (newType === 'bomb' || newType === 'quad_pair') return true;
    }

    if (newType === oldType && newCards.length === oldCards.length) {
        return newMax > oldMax;
    }

    return false;
}

// មុខងាររុញវេនទៅអ្នកបន្ទាប់ដោយសុវត្ថិភាព (ដោះស្រាយបញ្ហាគាំងវេន)
function moveToNextTurn(room) {
    let originalIndex = room.currentTurnIndex;
    let nextIndex = originalIndex;
    let found = false;

    // ស្វែងរកអ្នកលេងបន្ទាប់ដែលមិនទាន់បាន Pass និងនៅមានបៀក្នុងដៃ
    for (let i = 1; i <= room.players.length; i++) {
        let checkIndex = (originalIndex + i) % room.players.length;
        if (!room.players[checkIndex].passed && room.players[checkIndex].hand.length > 0) {
            nextIndex = checkIndex;
            found = true;
            break;
        }
    }

    if (found) {
        room.currentTurnIndex = nextIndex;
    }
}

io.on('connection', (socket) => {
    
    socket.on('createRoom', ({ roomId, playerName }) => {
        if (rooms[roomId] && rooms[roomId].players.length > 0) {
            return socket.emit('errorMsg', 'បន្ទប់នេះកំពុងលេង...');
        }
        
        rooms[roomId] = {
            players: [{ id: socket.id, name: playerName || 'Player 1', hand: [], passed: false }],
            creatorId: socket.id,
            status: 'waiting',
            currentTurnIndex: 0,
            playedCards: [],
            lastPlayerId: null 
        };
        socket.join(roomId);
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'បន្ទប់ពេញ');
        
        room.players.push({ id: socket.id, name: playerName, hand: [], passed: false });
        socket.join(roomId);
        io.to(roomId).emit('updatePlayers', room.players);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.creatorId !== socket.id) return;

        const deck = shuffleDeck(createDeck());
        room.status = 'playing';
        room.playedCards = [];
        room.lastPlayerId = null;
        
        room.players.forEach((p, i) => {
            p.hand = sortCards(deck.slice(i * 13, (i + 1) * 13));
            p.passed = false; // Reset ស្ថានភាព Pass ទាំងអស់នៅដើមហ្គេម
            io.to(p.id).emit('dealCards', { hand: p.hand });
        });

        room.currentTurnIndex = room.players.findIndex(p => 
            p.hand.some(c => c.value === '3' && c.suit === '♠')
        );
        if (room.currentTurnIndex === -1) room.currentTurnIndex = 0;

        io.to(roomId).emit('gameStarted', { currentTurnIndex: room.currentTurnIndex });
    });

    socket.on('playCard', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        
        if (!player || player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ');

        if (getComboType(cards) && comparePlay(cards, room.playedCards)) {
            // ដកបៀពីដៃ
            cards.forEach(c => {
                const idx = player.hand.findIndex(pc => pc.value === c.value && pc.suit === c.suit);
                if (idx !== -1) player.hand.splice(idx, 1);
            });

            room.playedCards = cards;
            room.lastPlayerId = socket.id;

            // នៅពេលចុះបៀបានសម្រេច ត្រូវ Reset status Pass របស់ខ្លួនឯង (បើមាន)
            player.passed = false;

            if (player.hand.length === 0) {
                // ករណីឈ្នះ៖ ប្រមូលបៀដែលនៅសល់ក្នុងដៃអ្នកដទៃយកទៅបង្ហាញ
                const results = room.players.map(p => ({ name: p.name, remaining: p.hand }));
                io.to(roomId).emit('gameWon', { winner: player.name, allHands: results });
                room.status = 'waiting';
            } else {
                moveToNextTurn(room);
                io.to(roomId).emit('cardPlayed', { 
                    by: player.name, 
                    cards, 
                    nextTurn: room.currentTurnIndex,
                    cardCount: player.hand.length
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

        // កំណត់ថាគាត់បាន Pass
        player.passed = true;
        
        // ពិនិត្យមើលថា តើនៅសល់អ្នកលេងប៉ុន្មាននាក់ទៀតដែលមិនទាន់ Pass និងនៅមានបៀ
        const activePlayers = room.players.filter(p => !p.passed && p.hand.length > 0);
        
        if (activePlayers.length <= 1) {
            // ករណីដាច់ជុំ (គ្រប់គ្នា Pass អស់ សល់តែម្នាក់ចុងក្រោយ)
            room.playedCards = []; // លាងតុ
            room.players.forEach(p => p.passed = false); // ត្រូវ Reset 'passed = false' ឱ្យគ្រប់គ្នាឡើងវិញភ្លាមៗ
            
            // អ្នកលេងចុងក្រោយដែលមិនបាន Pass គឺជាអ្នកបើកទឹកថ្មី
            let nextWinnerIndex = room.players.findIndex(p => p.id === room.lastPlayerId);
            if (nextWinnerIndex === -1 || room.players[nextWinnerIndex].hand.length === 0) {
                // បើគ្មាន ឬអ្នកមុនអស់បៀ ឱ្យអ្នកបន្ទាប់ដែលមិនទាន់អស់បៀចុះជំនួស
                nextWinnerIndex = room.players.findIndex(p => p.hand.length > 0);
            }
            
            room.currentTurnIndex = nextWinnerIndex !== -1 ? nextWinnerIndex : 0;
            const nextPlayerName = room.players[room.currentTurnIndex].name;
            
            io.to(roomId).emit('clearTable', { nextPlayer: nextPlayerName });
            io.to(roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
        } else {
            // បើនៅសល់មនុស្សត្រូវលេងបន្ត គឺប្ដូរវេនធម្មតា
            moveToNextTurn(room);
            io.to(roomId).emit('playerPassed', { name: player.name, nextTurn: room.currentTurnIndex });
        }
    });

    socket.on('disconnect', () => {
        for (const id in rooms) {
            const room = rooms[id];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                room.players.splice(pIdx, 1);
                if (room.players.length === 0) {
                    delete rooms[id]; 
                } else {
                    if (room.creatorId === socket.id) room.creatorId = room.players[0].id;
                    io.to(id).emit('updatePlayers', room.players);
                }
            }
        }
    });
});

server.listen(3000, () => console.log('Server is running on port 3000'));