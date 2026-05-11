// ===========================
// server.js (កំណែអាប់ដេតពេញលេញ)
// ===========================

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

// មុខងារពិនិត្យប្រភេទបៀដែលចុះ
function getComboType(cards) {
    const len = cards.length;
    if (len === 1) return 'single';
    
    const sorted = sortCards([...cards]);
    const sameValue = cards.every(c => c.value === cards[0].value);
    
    if (sameValue) {
        if (len === 2) return 'pair';
        if (len === 3) return 'triple'; 
        if (len === 4) return 'bomb';   
    }

    // ៤ ផែស៊ីហាយ (Double Straight Pairs)
    if (len === 8) {
        let is4Pair = true;
        for (let i = 0; i < 8; i += 2) {
            if (sorted[i].value !== sorted[i+1].value) is4Pair = false;
            if (i > 0 && CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-2].value) + 1) is4Pair = false;
        }
        if (is4Pair) return 'quad_pair';
    }

    // ស៊េរី (Straight)
    let isStr = true;
    for (let i = 1; i < len; i++) {
        if (CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-1].value) + 1) isStr = false;
        if (sorted[i].value === '2') isStr = false; // លេខ ២ មិនអាចដាក់ក្នុងស៊េរីបានទេ
    }
    if (isStr && len >= 3) return 'straight';

    return null;
}

function comparePlay(newCards, oldCards) {
    if (!oldCards || oldCards.length === 0) return true;
    
    const newType = getComboType(newCards);
    const oldType = getComboType(oldCards);
    const newMax = getCardPower(sortCards([...newCards]).pop());
    const oldMax = getCardPower(sortCards([...oldCards]).pop());

    // ច្បាប់ពិសេស៖ ការ៉េ ឬ ៤ផែ ស៊ីអាត់ ឬ ស៊ីលេខពីរ
    if (oldType === 'single' && (oldCards[0].value === '2')) {
        if (newType === 'bomb' || newType === 'quad_pair') return true;
    }
    
    // បើបៀការ៉េស៊ីគ្នា
    if (newType === 'bomb' && oldType === 'bomb') return newMax > oldMax;

    if (newType !== oldType || newCards.length !== oldCards.length) return false;
    return newMax > oldMax;
}

io.on('connection', (socket) => {
    
    socket.on('createRoom', ({ roomId, playerName }) => {
        // បើបន្ទប់លែងមានអ្នកលេង (empty) គឺអនុញ្ញាតឱ្យបង្កើតជាន់លេខចាស់បាន
        if (rooms[roomId] && rooms[roomId].players.length > 0) {
            return socket.emit('errorMsg', 'បន្ទប់នេះកំពុងលេង...');
        }
        
        rooms[roomId] = {
            players: [{ id: socket.id, name: playerName || 'Player 1', hand: [], passed: false }],
            creatorId: socket.id,
            status: 'waiting',
            currentTurnIndex: 0,
            playedCards: [],
            lastPlayerId: null // អ្នកចុះបៀចុងក្រោយ (ដើម្បីដឹងថាត្រូវដាច់ជុំឬអត់)
        };
        socket.join(roomId);
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'បន្ទប់មិនមានទេ');
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
        
        room.players.forEach((p, i) => {
            p.hand = sortCards(deck.slice(i * 13, (i + 1) * 13));
            p.passed = false;
            io.to(p.id).emit('dealCards', { hand: p.hand });
        });

        // រកអ្នកមាន ៣ ប៊ិច ដើម្បីឱ្យចាប់ផ្ដើមមុន (តាមច្បាប់ខ្មែរ)
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
        
        if (player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ');

        if (getComboType(cards) && comparePlay(cards, room.playedCards)) {
            // ដកបៀពីដៃ
            cards.forEach(c => {
                const idx = player.hand.findIndex(pc => pc.value === c.value && pc.suit === c.suit);
                player.hand.splice(idx, 1);
            });

            room.playedCards = cards;
            room.lastPlayerId = socket.id;

            if (player.hand.length === 0) {
                const results = room.players.map(p => ({ name: p.name, remaining: p.hand }));
                io.to(roomId).emit('gameWon', { winner: player.name, allHands: results });
                room.status = 'waiting';
            } else {
                // បោះវេនទៅអ្នកបន្ទាប់
                moveToNextTurn(room);
                io.to(roomId).emit('cardPlayed', { 
                    by: player.name, 
                    cards, 
                    nextTurn: room.currentTurnIndex,
                    cardCount: player.hand.length
                });
            }
        } else {
            socket.emit('errorMsg', 'ចុះមិនត្រូវក្បួន!');
        }
    });

    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        if (player.id !== socket.id) return;

        player.passed = true;
        moveToNextTurn(room);
        
        // បើគ្រប់គ្នា Pass អស់ សល់តែម្នាក់ចុងក្រោយ គឺដាច់ជុំ
        const activePlayers = room.players.filter(p => !p.passed);
        if (activePlayers.length === 1) {
            room.playedCards = [];
            room.players.forEach(p => p.passed = false);
            io.to(roomId).emit('clearTable', { nextPlayer: activePlayers[0].name });
        } else {
            io.to(roomId).emit('playerPassed', { name: player.name, nextTurn: room.currentTurnIndex });
        }
    });

    function moveToNextTurn(room) {
        do {
            room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        } while (room.players[room.currentTurnIndex].passed);
    }

    socket.on('disconnect', () => {
        // ... logic លុបបន្ទប់ដូចមុន
    });
});

server.listen(3000, () => console.log('Server is running on port 3000'));