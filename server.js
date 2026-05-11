// ===========================
// server.js (Updated & Fixed)
// ===========================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

// លំដាប់បៀពីតូចទៅធំ
const CARD_ORDER = [
    '3', '4', '5', '6', '7',
    '8', '9', '10', 'J',
    'Q', 'K', 'A', '2'
];

// ===========================
// Helper Functions
// ===========================

function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = [
        '3', '4', '5', '6', '7',
        '8', '9', '10', 'J',
        'Q', 'K', 'A', '2'
    ];
    const deck = [];
    for (const suit of suits) {
        for (const value of values) {
            deck.push({ suit, value });
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

function getCardPower(card) {
    return CARD_ORDER.indexOf(card.value);
}

function sortCards(cards) {
    return cards.sort((a, b) => {
        const powerA = getCardPower(a);
        const powerB = getCardPower(b);
        if (powerA !== powerB) return powerA - powerB;
        // Sort by suit if values are equal (optional, for consistency)
        return a.suit.localeCompare(b.suit);
    });
}

// ពិនិត្យមើលថាតើជាបៀអ្វី (Single, Pair, Triple, Straight, etc.)
function getComboType(cards) {
    if (cards.length === 0) return null;
    if (cards.length === 1) return 'single';

    const sorted = [...cards].sort((a, b) => getCardPower(a) - getCardPower(b));
    
    // Check for Same Value combinations (Pair, Triple, Quad/Bomb)
    const allSameValue = cards.every(c => c.value === cards[0].value);
    if (allSameValue) {
        if (cards.length === 2) return 'pair';
        if (cards.length === 3) return 'triple';
        if (cards.length === 4) return 'bomb'; // ការ៉េ
    }

    // Check for Straight (ហាយ) - ត្រូវតែ 3 បៀឡើងទៅ និងជាប់លេខ
    if (cards.length >= 3) {
        let isStraight = true;
        for (let i = 1; i < sorted.length; i++) {
            if (getCardPower(sorted[i]) !== getCardPower(sorted[i - 1]) + 1) {
                isStraight = false;
                break;
            }
        }
        if (isStraight) return 'straight';
    }

    // Check for 4 Pairs (4 គូ) - ត្រូវតែ 8 បៀ
    if (cards.length === 8) {
        // Group by value
        const counts = {};
        cards.forEach(c => {
            counts[c.value] = (counts[c.value] || 0) + 1;
        });
        // Must have exactly 4 distinct values, each appearing twice
        const values = Object.values(counts);
        if (values.length === 4 && values.every(v => v === 2)) {
            return 'four_pairs';
        }
    }

    return null; // Invalid combination
}

function isValidPlay(cards) {
    return getComboType(cards) !== null;
}

// ប្រៀបធៀបបៀថ្មី នឹង បៀចាស់លើតុ
function comparePlay(newCards, oldCards) {
    // បើគ្មានបៀលើតុ (វេនដំបូងនៃជុំ) ចេញបានជានិច្ច (បើត្រូវក្បួន)
    if (!oldCards || oldCards.length === 0) {
        return true;
    }

    const newType = getComboType(newCards);
    const oldType = getComboType(oldCards);

    // ១. ករណីពិសេស: ការ៉េ (Bomb) ស៊ីហាយ (Straight) បាន
    if (newType === 'bomb' && oldType === 'straight') {
        return true;
    }

    // ២. ករណីពិសេស: 4 គូ (Four Pairs) ស៊ីហាយ (Straight) បាន
    if (newType === 'four_pairs' && oldType === 'straight') {
        return true;
    }

    // ៣. ករណីធម្មតា: ត្រូវតែជាបៀប្រភេទដូចគ្នា និងចំនួនបៀស្មើគ្នា
    if (newType !== oldType) {
        return false;
    }
    
    if (newCards.length !== oldCards.length) {
        return false;
    }

    // ៤. ប្រៀបធៀបកម្លាំងបៀ (យកបៀធំបំផុតក្នុងក្រុមមកប្រៀបធៀប)
    const newMax = Math.max(...newCards.map(c => getCardPower(c)));
    const oldMax = Math.max(...oldCards.map(c => getCardPower(c)));

    return newMax > oldMax;
}

function nextTurn(room) {
    let tries = 0;
    do {
        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        tries++;
    } while (room.players[room.currentTurnIndex].passed && tries < room.players.length);
}

// ===========================
// Socket.IO Events
// ===========================

io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    // --- CREATE ROOM ---
    socket.on('createRoom', ({ roomId, password, playerName }) => {
        if (rooms[roomId]) {
            return socket.emit('errorMsg', 'បន្ទប់នេះមានស្រាប់');
        }

        socket.join(roomId);

        rooms[roomId] = {
            players: [{
                id: socket.id,
                name: playerName || 'Player 1',
                hand: [],
                passed: false
            }],
            creatorId: socket.id, // កំណត់អ្នកបង្កើតជា Host
            password: password || null,
            maxPlayers: 4,
            status: 'waiting',
            currentTurnIndex: 0,
            playedCards: [],
            winner: null,
            isFirstMoveOfGame: true // Flag សម្រាប់ត្រួតពិនិត្យ 3 កឺ
        };

        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
    });

    // --- JOIN ROOM ---
    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = rooms[roomId];
        if (!room) {
            return socket.emit('errorMsg', 'បន្ទប់មិនមាន');
        }
        if (room.password && room.password !== password) {
            return socket.emit('errorMsg', 'Password ខុស');
        }
        if (room.players.length >= room.maxPlayers) {
            return socket.emit('errorMsg', 'បន្ទប់ពេញ');
        }
        if (room.status !== 'waiting') {
            return socket.emit('errorMsg', 'ហ្គេមកំពុងដំណើរការ');
        }

        socket.join(roomId);
        room.players.push({
            id: socket.id,
            name: playerName || `Player ${room.players.length + 1}`,
            hand: [],
            passed: false
        });

        socket.emit('roomJoined', { roomId, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', room.players);
    });

    // --- START GAME ---
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        // ត្រួតពិនិត្យថាតើអ្នកចុចជា Host ឬអត់
        if (room.creatorId !== socket.id) {
            return socket.emit('errorMsg', 'មានតែ Host ទេដែលអាចចាប់ផ្តើមហ្គេមបាន');
        }

        if (room.players.length < 2) {
            return socket.emit('errorMsg', 'ត្រូវការយ៉ាងតិច 2 នាក់');
        }

        startNewRound(room);
    });

    // Function ចាប់ផ្តើមជុំថ្មី (ចែកបៀ)
    function startNewRound(room) {
        room.status = 'playing';
        room.winner = null;
        room.playedCards = [];
        room.isFirstMoveOfGame = true; // Reset flag 3 Clubs

        const deck = shuffleDeck(createDeck());

        // ចែកបៀ
        room.players.forEach((player, index) => {
            player.hand = sortCards(deck.slice(index * 13, (index + 1) * 13));
            player.passed = false;
        });

        // រកអ្នកមាន 3 កឺ (3♣)
        let starterIndex = room.players.findIndex(player =>
            player.hand.some(card => card.value === '3' && card.suit === '♣')
        );

        // បើគ្មានអ្នកណាមាន 3 កឺ (ករណីកម្រ) ឬ Error យក Player 0
        if (starterIndex === -1) starterIndex = 0;

        room.currentTurnIndex = starterIndex;

        // ផ្ញើទិន្នន័យទៅ Client
        io.to(room.id).emit('gameStarted', {
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                cardCount: p.hand.length
            })),
            currentTurnIndex: room.currentTurnIndex
        });

        // ផ្ញើបៀជូន từng player (Private)
        room.players.forEach(player => {
            io.to(player.id).emit('dealCards', { hand: player.hand });
        });

        io.to(room.id).emit('gameStatus', `🎯 វេន ${room.players[room.currentTurnIndex].name} (មាន 3 កឺ)`);
    }

    // --- PLAY CARD ---
    socket.on('playCard', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        // ១. ត្រួតពិនិត្យវេន
        if (room.players[room.currentTurnIndex].id !== socket.id) {
            return socket.emit('errorMsg', 'មិនមែនវេនអ្នក');
        }

        if (!cards || cards.length === 0) {
            return socket.emit('errorMsg', 'ជ្រើសបៀសិន');
        }

        // ២. ត្រួតពិនិត្យថាបៀនៅក្នុងដៃមែនទេ
        for (const card of cards) {
            const found = player.hand.find(c => c.value === card.value && c.suit === card.suit);
            if (!found) {
                return socket.emit('errorMsg', 'បៀមិនត្រឹមត្រូវ (មិនមានក្នុងដៃ)');
            }
        }

        // ៣. ត្រួតពិនិត្យក្បួន 3 កឺ (វេនដំបូងបំផុតនៃហ្គេម)
        if (room.isFirstMoveOfGame) {
            // អ្នកលេងនេះត្រូវតែមាន 3 កឺ (ព្រោះយើងបាន Set Turn អោយគាត់ហើយ)
            // ហើយគាត់ត្រូវតែចេញបៀដែលមាន 3 កឺ
            const has3ClubsInHand = player.hand.some(c => c.value === '3' && c.suit === '♣');
            const plays3Clubs = cards.some(c => c.value === '3' && c.suit === '♣');

            if (has3ClubsInHand && !plays3Clubs) {
                return socket.emit('errorMsg', 'អ្នកមាន 3 កឺ ត្រូវតែចេញ 3 កឺមុនគេ!');
            }
        }

        // ៤. ត្រួតពិនិត្យក្បួនបៀ (Valid Combo?)
        if (!isValidPlay(cards)) {
            return socket.emit('errorMsg', 'ចុះមិនត្រូវក្បួន (ឧ. ហាយត្រូវជាប់លេខ)');
        }

        // ៥. ត្រួតពិនិត្យការប្រៀបធៀប (Beat previous cards?)
        if (!comparePlay(cards, room.playedCards)) {
            return socket.emit('errorMsg', 'បៀតូចជាង ឬខុសប្រភេទ');
        }

        // --- ចុះបៀត្រូវ ---

        // លុបបៀចេញពីដៃ
        cards.forEach(card => {
            const idx = player.hand.findIndex(c => c.value === card.value && c.suit === card.suit);
            if (idx !== -1) {
                player.hand.splice(idx, 1);
            }
        });

        room.playedCards = cards;
        
        // បើចេញបៀហើយ អ្នកដទៃត្រូវ Reset ការ Pass (សម្រាប់ជុំបន្ទាប់)
        // ប៉ុន្តែក្នុង Tien Len បើអ្នកដទៃ Pass ហើយ គេនៅតែ Pass រហូតដល់ចប់ជុំ
        // ដូច្នេះយើងមិនទាន់ Reset passed = false ទេ លុះត្រាតែចប់ជុំ (Clear Table)

        // ត្រួតពិនិត្យឈ្នះ
        if (player.hand.length === 0) {
            room.winner = player.name;
            io.to(roomId).emit('gameWon', { winner: player.name });
            
            // Auto Restart Logic: ចាប់ផ្តើមជុំថ្មីភ្លាមៗ
            setTimeout(() => {
                startNewRound(room);
            }, 3000); // Wait 3 seconds before new deal
            
            return;
        }

        // បើមិនមែនវេនដំបូងនៃហ្គេមទៀតទេ
        if (room.isFirstMoveOfGame) {
            room.isFirstMoveOfGame = false;
        }

        nextTurn(room);

        io.to(roomId).emit('cardPlayed', {
            by: player.name,
            cards,
            currentTurnIndex: room.currentTurnIndex,
            updatedHands: room.players.map(p => ({
                id: p.id,
                name: p.name,
                cardCount: p.hand.length
            }))
        });

        io.to(roomId).emit('gameStatus', `🎯 វេន ${room.players[room.currentTurnIndex].name}`);
    });

    // --- PASS TURN ---
    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        if (room.players[room.currentTurnIndex].id !== socket.id) {
            return;
        }

        // មិនអាច Pass បានទេ បើជាវេនដំបូងនៃជុំ (គ្មានបៀលើតុ)
        if (!room.playedCards || room.playedCards.length === 0) {
             return socket.emit('errorMsg', 'មិនអាច Pass នៅវេនដំបូងបានទេ');
        }

        player.passed = true;
        nextTurn(room);

        // ត្រួតពិនិត្យមើលថាតើអ្នកលេងផ្សេងទៀត Pass អស់ឬនៅ?
        const activePlayers = room.players.filter(p => !p.passed);

        // បើសល់តែ 1 នាក់ (ឬគ្មាននាក់ណាសល់ ករណីកម្រ) -> ចប់ជុំ បោសតុ
        if (activePlayers.length <= 1) {
            room.playedCards = [];
            room.players.forEach(p => p.passed = false); // Reset pass status
            
            io.to(roomId).emit('clearTable');
            io.to(roomId).emit('gameStatus', `🔄 ជុំថ្មី! វេន ${room.players[room.currentTurnIndex].name}`);
        } else {
            io.to(roomId).emit('turnChanged', {
                currentTurnIndex: room.currentTurnIndex
            });
            io.to(roomId).emit('gameStatus', `⏭️ ${player.name} pass`);
        }
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);

            if (playerIndex !== -1) {
                const leftPlayer = room.players[playerIndex];
                room.players.splice(playerIndex, 1);
                
                io.to(roomId).emit('updatePlayers', room.players);
                io.to(roomId).emit('gameStatus', `❌ ${leftPlayer.name} left`);

                if (room.players.length === 0) {
                    delete rooms[roomId];
                } else if (room.status === 'playing') {
                    // បើអ្នកលេងចេញពេលកំពុងលេង អាចដាក់ Logic បន្ថែម (ឧ. Auto Pass)
                    // បច្ចុប្បន្នគ្រាន់តែ Notify
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Server running on ${PORT}`);
});