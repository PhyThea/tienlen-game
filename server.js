// =================================================================
// server.js (កំណែទម្រង់ពេញលេញ - ដោះស្រាយបញ្ហា Pass និងការកំណត់ឈ្នះចាញ់)
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

// មុខងារពិនិត្យប្រភេទបៀ
function getComboType(cards) {
    const len = cards.length;
    if (len === 0) return null;
    if (len === 1) return 'single';
    
    const sorted = sortCards([...cards]);
    const sameValue = cards.every(c => c.value === cards[0].value);
    
    // ឆែក ផែ, បីសន្លឹកដូចគ្នា (សាម), បួនសន្លឹកដូចគ្នា (ការ៉េ)
    if (sameValue) {
        if (len === 2) return 'pair';
        if (len === 3) return 'triple'; 
        if (len === 4) return 'bomb';   
    }

    // ឆែក ផែ ២ ជាប់គ្នា (២ ជាន់ - ៤ សន្លឹក) ឧទាហរណ៍៖ 3-3-4-4
    if (len === 4) {
        let is2Pair = true;
        if (sorted[0].value !== sorted[1].value) is2Pair = false;
        if (sorted[2].value !== sorted[3].value) is2Pair = false;
        
        const firstValIdx = CARD_ORDER.indexOf(sorted[0].value);
        const secondValIdx = CARD_ORDER.indexOf(sorted[2].value);
        
        if (secondValIdx !== firstValIdx + 1) is2Pair = false;
        if (sorted[2].value === '2') is2Pair = false; // លេខ ២ មិនអាចចូលផែជាន់បានទេ

        if (is2Pair) return 'double_pair';
    }

    // ឆែក ៤ ផែជាប់គ្នា (៤ ជាន់ - ៨ សន្លឹក) 
    if (len === 8) {
        let is4Pair = true;
        for (let i = 0; i < 8; i += 2) {
            if (sorted[i].value !== sorted[i+1].value) is4Pair = false;
            if (i > 0 && CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-2].value) + 1) is4Pair = false;
        }
        if (sorted[6].value === '2') is4Pair = false; // លេខ ២ មិនអាចចូលបានទេ
        if (is4Pair) return 'quad_pair';
    }

    // ឆែកស៊េរី (Straight)
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

// មុខងារប្រៀបធៀបបៀស៊ីគ្នា
function comparePlay(newCards, oldCards) {
    if (!oldCards || oldCards.length === 0) return true;
    
    const newType = getComboType(newCards);
    const oldType = getComboType(oldCards);
    const newMax = getCardPower(sortCards([...newCards]).pop());
    const oldMax = getCardPower(sortCards([...oldCards]).pop());

    // --- ច្បាប់ពិសេសកាត់ស៊ី ---
    
    // ១. ករណីបៀលើតុជា លេខ ២ តែមួយសន្លឹក (Single "2")
    if (oldType === 'single' && oldCards[0].value === '2') {
        if (newType === 'double_pair' || newType === 'bomb' || newType === 'quad_pair') return true;
    }

    // ២. ករណីបៀលើតុជា ផែ ២ ជាន់ (Double Pair)
    if (oldType === 'double_pair') {
        if (newType === 'double_pair' && newMax > oldMax) return true;
        if (newType === 'bomb' || newType === 'quad_pair') return true;
    }

    // --- ច្បាប់ទូទៅ ---
    if (newType === oldType && newCards.length === oldCards.length) {
        return newMax > oldMax;
    }

    return false;
}

function moveToNextTurn(room) {
    let originalIndex = room.currentTurnIndex;
    let nextIndex = originalIndex;
    let found = false;

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
    
    // បង្កើតបន្ទប់
    socket.on('createRoom', ({ roomId, playerName }) => {
        if (rooms[roomId] && rooms[roomId].players.length > 0 && rooms[roomId].status === 'playing') {
            return socket.emit('errorMsg', 'បន្ទប់នេះកំពុងលេងហើយ មិនអាចបង្កើតជាន់បានទេ!');
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
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
    });

    // ចូលរួមបន្ទប់
    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់នេះទេ');
        if (room.status === 'playing') return socket.emit('errorMsg', 'បន្ទប់នេះកំពុងលេង... មិនអាចចូលបានទេ!');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ (អតិបរមា ៤ នាក់)');
        
        room.players.push({ id: socket.id, name: playerName, hand: [], passed: false });
        socket.join(roomId);
        socket.emit('roomJoined', { roomId, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', room.players);
    });

    // ចាប់ផ្ដើមហ្គេម
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.creatorId !== socket.id) return;

        const playerCount = room.players.length;
        if (playerCount < 2) {
            return socket.emit('errorMsg', 'មិនអាចចាប់ផ្ដើមហ្គេមបានទេ! ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់។');
        }
        if (playerCount > 4) {
            return socket.emit('errorMsg', 'មិនអាចចាប់ផ្ដើមហ្គេមបានទេ! ចំនួនអ្នកលេងអតិបរមាគឺ ៤ នាក់។');
        }

        const deck = shuffleDeck(createDeck());
        room.status = 'playing'; 
        room.playedCards = [];
        room.lastPlayerId = null;
        
        room.players.forEach((p, i) => {
            p.hand = sortCards(deck.slice(i * 13, (i + 1) * 13));
            p.passed = false; 
            io.to(p.id).emit('dealCards', { hand: p.hand });
        });

        room.currentTurnIndex = room.players.findIndex(p => 
            p.hand.some(c => c.value === '3' && c.suit === '♠')
        );
        if (room.currentTurnIndex === -1) room.currentTurnIndex = 0;

        io.to(roomId).emit('gameStarted', { 
            players: room.players, 
            currentTurnIndex: room.currentTurnIndex 
        });
    });

    // ចុះបៀ
    socket.on('playCard', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        
        if (!player || player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ');

        if (getComboType(cards) && comparePlay(cards, room.playedCards)) {
            cards.forEach(c => {
                const idx = player.hand.findIndex(pc => pc.value === c.value && pc.suit === c.suit);
                if (idx !== -1) player.hand.splice(idx, 1);
            });

            room.playedCards = cards;
            room.lastPlayerId = socket.id;
            player.passed = false;

            if (player.hand.length === 0) {
                room.status = 'waiting'; 
                const results = room.players.map(p => ({ name: p.name, remaining: p.hand }));
                
                // កែប្រែ៖ បន្ថែម winnerId ទៅឱ្យ Client ងាយស្រួលផ្ទៀងផ្ទាត់ឈ្នះចាញ់ផ្ទាល់ខ្លួន
                io.to(roomId).emit('gameWon', { 
                    winner: player.name, 
                    winnerId: player.id, 
                    allHands: results 
                });
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

    // Pass វេន (កែសម្រួលដើម្បីដោះស្រាយបញ្ហាចុះសេរីឡើងវិញពេលគេ Pass អស់)
    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return;

        player.passed = true;
        const activePlayers = room.players.filter(p => !p.passed && p.hand.length > 0);
        
        // ផ្ញើសារប្រាប់គ្រប់គ្នាថាអ្នកលេងម្នាក់នេះបាន Pass ហើយ
        io.to(roomId).emit('playerPassed', { 
            name: player.name, 
            id: player.id,
            message: "តោះខ្ញុំអត់ស៊ីទេ" 
        });
        
        if (activePlayers.length <= 1) {
            // សម្អាតបៀចាស់ចោលដើម្បីឱ្យចុះបៀរាយ ឬបៀរៀងក៏បាន (ចុះសេរី)
            room.playedCards = []; 
            room.players.forEach(p => p.passed = false); 
            
            let nextWinnerIndex = room.players.findIndex(p => p.id === room.lastPlayerId);
            if (nextWinnerIndex === -1 || room.players[nextWinnerIndex].hand.length === 0) {
                nextWinnerIndex = room.players.findIndex(p => p.hand.length > 0);
            }
            
            room.currentTurnIndex = nextWinnerIndex !== -1 ? nextWinnerIndex : 0;
            const nextPlayerName = room.players[room.currentTurnIndex].name;
            
            io.to(roomId).emit('clearTable', { nextPlayer: nextPlayerName });
            
            // បញ្ជូនកាតទទេ ទៅឱ្យ Client សម្អាតអេក្រង់ និងផ្ដើមសេរី
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

    // ចាកចេញពីបន្ទប់
    socket.on('disconnect', () => {
        for (const id in rooms) {
            const room = rooms[id];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            
            if (pIdx !== -1) {
                room.players.splice(pIdx, 1);
                
                if (room.players.length === 0) {
                    delete rooms[id]; 
                } else {
                    if (room.creatorId === socket.id) {
                        room.creatorId = room.players[0].id;
                    }
                    
                    if (room.status === 'playing' && room.currentTurnIndex === pIdx) {
                        moveToNextTurn(room);
                        io.to(id).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
                    }
                    
                    io.to(id).emit('updatePlayers', room.players);
                }
            }
        }
    });
});

server.listen(3000, () => console.log('Server is running on port 3000'));