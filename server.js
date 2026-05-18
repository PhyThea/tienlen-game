// =================================================================
// server.js (កំណែទម្រង់រួមបញ្ចូលច្បាប់កាត់ផែអោប និងហាយ - រត់រលូនឥតខ្ចោះ)
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
    const vIdx = CARD_ORDER.indexOf(card.value);
    const sIdx = SUIT_ORDER[card.suit];
    return vIdx * 10 + sIdx;
}

function sortHand(hand) {
    return hand.sort((a, b) => getCardPower(a) - getCardPower(b));
}

// មុខងារជំនួយសម្រាប់ Voice Chat ដើម្បីប្រាប់ដៃគូឱ្យផ្តាច់ទំនាក់ទំនង
function notifyVoicePeerDisconnect(socketId) {
    for (const roomId in rooms) {
        const room = rooms[roomId];
        const isPlayerInRoom = room.players.some(p => p.id === socketId);
        if (isPlayerInRoom) {
            room.players.forEach(p => {
                if (p.id !== socketId) {
                    io.to(p.id).emit('voice-peer-disconnected', socketId);
                }
            });
        }
    }
}

// -----------------------------------------------------------------
// ច្បាប់ហ្គេម ទៀនឡេន (Tien Len Rules Validator)
// -----------------------------------------------------------------
function analyzeCombination(cards) {
    if (!cards || cards.length === 0) return { type: 'invalid' };
    const len = cards.length;
    
    // តម្រៀបសន្លឹកបៀពីតូចទៅធំជាមុនសិន
    const sorted = [...cards].sort((a,b) => getCardPower(a) - getCardPower(b));
    const highestCard = sorted[len - 1];

    // ១. សន្លឹកទោល (Single)
    if (len === 1) {
        return { type: 'single', highestCard, isTwo: (sorted[0].value === '2') };
    }

    // ២. គូ (Pair)
    if (len === 2) {
        if (sorted[0].value === sorted[1].value) {
            return { type: 'pair', highestCard, isTwo: (sorted[0].value === '2') };
        }
        return { type: 'invalid' };
    }

    // ៣. បីសន្លឹកដូចគ្នា (Triple / Three of a Kind)
    if (len === 3) {
        if (sorted[0].value === sorted[1].value && sorted[1].value === sorted[2].value) {
            return { type: 'triple', highestCard };
        }
    }

    // ៤. បួនសន្លឹកដូចគ្នា (Four of a Kind / ហាយ)
    if (len === 4) {
        if (sorted[0].value === sorted[1].value && 
            sorted[1].value === sorted[2].value && 
            sorted[2].value === sorted[3].value) {
            return { type: 'four_of_a_kind', highestCard };
        }
    }

    // ៥. ពិនិត្យមើល គូជាប់គ្នា (Sequence of Pairs - បីគូជាប់គ្នា ឬបួនគូជាប់គ្នា)
    if (len >= 6 && len % 2 === 0) {
        let isPairsSeq = true;
        const pairsCount = len / 2;
        const pairValues = [];

        for (let i = 0; i < len; i += 2) {
            if (sorted[i].value !== sorted[i+1].value) {
                isPairsSeq = false;
                break;
            }
            pairValues.push(sorted[i].value);
        }

        if (isPairsSeq) {
            // មិនអនុញ្ញាតឱ្យមានមេ ២ នៅក្នុងគូជាប់គ្នាឡើយ
            if (pairValues.includes('2')) {
                isPairsSeq = false;
            } else {
                // ពិនិត្យភាពជាប់គ្នាតាមលំដាប់ CARD_ORDER
                let orderValid = true;
                for (let i = 0; i < pairValues.length - 1; i++) {
                    const idx1 = CARD_ORDER.indexOf(pairValues[i]);
                    const idx2 = CARD_ORDER.indexOf(pairValues[i+1]);
                    if (idx2 !== idx1 + 1) {
                        orderValid = false;
                        break;
                    }
                }
                if (orderValid) {
                    if (pairsCount === 3) return { type: 'three_pairs_seq', highestCard };
                    if (pairsCount === 4) return { type: 'four_pairs_seq', highestCard };
                }
            }
        }
    }

    // ៦. ពិនិត្យមើល ស្រប/ខ្សែជាប់គ្នា (Straight / Sequence) - ចាប់ពី ៣ សន្លឹកឡើងទៅ (មិនរាប់មេ ២)
    let isStraight = true;
    for (let i = 0; i < len; i++) {
        if (sorted[i].value === '2') {
            isStraight = false;
            break;
        }
    }
    if (isStraight && len >= 3) {
        for (let i = 0; i < len - 1; i++) {
            const idx1 = CARD_ORDER.indexOf(sorted[i].value);
            const idx2 = CARD_ORDER.indexOf(sorted[i+1].value);
            if (idx2 !== idx1 + 1) {
                isStraight = false;
                break;
            }
        }
        if (isStraight) return { type: 'straight', len, highestCard };
    }

    return { type: 'invalid' };
}

function isValidMove(lastCombo, newCards) {
    const newCombo = analyzeCombination(newCards);
    if (newCombo.type === 'invalid') return false;

    // ប្រសិនបើជាអ្នកផ្តើមជុំថ្មី (មិនទាន់មានបៀនៅលើក្តារ)
    if (!lastCombo || lastCombo.type === 'invalid') return true;

    // លក្ខខណ្ឌកាត់បៀ (បៀពិសេសសម្រាប់វាយបង្ក្រាប មេ ២ ឬបៀពិសេសផ្សេងទៀត)
    
    // ក) ករណីបៀនៅលើក្តារជា មេ ២ ទោល (Single Two)
    if (lastCombo.type === 'single' && lastCombo.isTwo) {
        // បីគូជាប់គ្នា, បួនគូជាប់គ្នា, និង ហាយ អាចកាត់មេ ២ ទោលបាន
        if (newCombo.type === 'three_pairs_seq' || 
            newCombo.type === 'four_pairs_seq' || 
            newCombo.type === 'four_of_a_kind') {
            return true;
        }
    }

    // ខ) ករណីបៀនៅលើក្តារជា មេ ២ មួយគូ (Pair of Twos)
    if (lastCombo.type === 'pair' && lastCombo.isTwo) {
        // បួនគូជាប់គ្នា និង ហាយ អាចកាត់មេ ២ មួយគូបាន
        if (newCombo.type === 'four_pairs_seq' || newCombo.type === 'four_of_a_kind') {
            return true;
        }
    }

    // គ) ករណីបៀនៅលើក្តារជា បីគូជាប់គ្នា (Three Pairs Sequence)
    if (lastCombo.type === 'three_pairs_seq') {
        // ហាយ និង បួនគូជាប់គ្នា អាចកាត់បីគូជាប់គ្នាបាន
        if (newCombo.type === 'four_of_a_kind' || newCombo.type === 'four_pairs_seq') {
            return true;
        }
    }

    // ឃ) ករណីបៀនៅលើក្តារជា ហាយ (Four of a Kind)
    if (lastCombo.type === 'four_of_a_kind') {
        // បួនគូជាប់គ្នា អាចកាត់ហាយបាន
        if (newCombo.type === 'four_pairs_seq') return true;
    }

    // លក្ខខណ្ឌទូទៅ៖ បៀវាយចេញក្រោយត្រូវតែមានប្រភេទ (Type) ដូចគ្នា និងទំហំសន្លឹកបៀធំជាង
    if (newCombo.type !== lastCombo.type) return false;

    // បើជាប្រភេទខ្សែ (Straight) ប្រវែងសន្លឹកបៀត្រូវតែស្មើគ្នា
    if (newCombo.type === 'straight' && newCombo.len !== lastCombo.len) return false;

    // ប្រៀបធៀបគ្រាប់បៀធំបំផុត (Highest Card Power)
    return getCardPower(newCombo.highestCard) > getCardPower(lastCombo.highestCard);
}

// -----------------------------------------------------------------
// ការគ្រប់គ្រងព្រឹត្តិការណ៍ចម្បងរបស់ Socket.io
// -----------------------------------------------------------------
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // 🎙️ មុខងារតភ្ជាប់ និងបញ្ជូនសញ្ញាសំឡេង (Voice Chat System) ស្ថិតក្នុងប្លុក Connection
    socket.on('voice-signal', ({ roomId, to, signal, from }) => {
        io.to(to).emit('voice-signal', { signal, from });
    });

    socket.on('request-voice-peers', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            const peerIds = room.players.filter(p => p.id !== socket.id).map(p => p.id);
            socket.emit('voice-peers-list', peerIds);
        }
    });

    // ចូលរួមបន្ទប់លេង (Join Room)
    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        if (!roomId || !playerName) return;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                password: password || '',
                players: [],
                status: 'waiting', // waiting, playing, ended
                deck: [],
                lastCombo: null,
                lastMovePlayerId: null,
                currentTurnIdx: 0,
                passedPlayers: [], // រក្សាទុក ID អ្នកលេងដែលចុច Skip/Pass ក្នុងជុំនេះ
                winnerOrder: []     // លំដាប់អ្នកឈ្នះលេខ ១, លេខ ២...
            };
        }

        const room = rooms[roomId];

        if (room.status === 'playing') {
            socket.emit('errorMsg', 'ហ្គេមកំពុងដំណើរការ មិនអាចចូលបានទេ!');
            return;
        }

        if (room.players.length >= 4) {
            socket.emit('errorMsg', 'បន្ទប់នេះពេញហើយ! (អតិបរមា ៤ នាក់)');
            return;
        }

        if (room.password !== '' && room.password !== password) {
            socket.emit('errorMsg', 'លេខកូដសម្ងាត់បន្ទប់មិនត្រឹមត្រូវឡើយ!');
            return;
        }

        // បង្កើតទិន្នន័យអ្នកលេងថ្មី
        const newPlayer = {
            id: socket.id,
            name: playerName,
            hand: [],
            isPassed: false,
            rank: null // សម្រាប់រក្សាទុកចំណាត់ថ្នាក់ពេលហ្គេមបញ្ចប់
        };

        if (room.players.length === 0) {
            room.hostId = socket.id; // អ្នកបង្កើតបន្ទប់ជាមេបន្ទប់ (Host)
        }

        room.players.push(newPlayer);
        socket.join(roomId);

        // 🎙️ ជម្រុញឱ្យអ្នកនៅក្នុងបន្ទប់ស្រាប់ដឹងថាមានសមាជិកថ្មីចូលដើម្បីតភ្ជាប់ Voice Chat
        room.players.forEach(p => {
            if (p.id !== socket.id) {
                io.to(p.id).emit('voice-peer-joined', socket.id);
            }
        });

        io.to(roomId).emit('roomUpdated', room);
    });

    // ចាប់ផ្តើមហ្គេម (Start Game)
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.hostId !== socket.id || room.status === 'playing') return;
        if (room.players.length < 2) {
            socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់ ទើបអាចលេងបាន!');
            return;
        }

        // ១. បង្កើតបៀ និងចែកបៀ
        let deck = createDeck();
        deck = shuffleDeck(deck);

        room.status = 'playing';
        room.lastCombo = null;
        room.lastMovePlayerId = null;
        room.passedPlayers = [];
        room.winnerOrder = [];

        // ចែកបៀឱ្យម្នាក់ៗ ១៣ សន្លឹក
        room.players.forEach(p => {
            p.hand = sortHand(deck.splice(0, 13));
            p.isPassed = false;
            p.rank = null;
        });

        // ២. ស្វែងរកអ្នកលេងដែលមានបៀ ៣ ជួង (3 of Spades ♠) ដើម្បីឱ្យដើរមុនគេបង្អស់
        let starterIdx = 0;
        let foundStarter = false;
        for (let i = 0; i < room.players.length; i++) {
            const has3Spades = room.players[i].hand.some(c => c.value === '3' && c.suit === '♠');
            if (has3Spades) {
                starterIdx = i;
                foundStarter = true;
                break;
            }
        }

        // បើគ្មាន ៣ ជួងទេ (ឧទាហរណ៍លេង ២ នាក់ ចែកបៀមិនអស់) គឺឱ្យអ្នកលេងទី ១ ដើរមុន
        room.currentTurnIdx = starterIdx;

        io.to(roomId).emit('gameStarted', room);
    });

    // លេងបៀចេញ / វាយបៀ (Play Cards)
    socket.on('playCards', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        const currentPlayer = room.players[room.currentTurnIdx];
        if (currentPlayer.id !== socket.id) return;

        // ពិនិត្យមើលថាតើអ្នកលេងពិតជាមានសន្លឹកបៀទាំងនេះក្នុងដៃមែនឬអត់
        const hasAllCards = cards.every(c => currentPlayer.hand.some(h => h.value === c.value && h.suit === c.suit));
        if (!hasAllCards) {
            socket.emit('errorMsg', 'សន្លឹកបៀមិនត្រឹមត្រូវ ឬមិនមាននៅក្នុងដៃឡើយ!');
            return;
        }

        // ករណីពិសេស៖ ជុំដំបូងបង្អស់នៃហ្គេម ត្រូវតែមានសន្លឹកបៀ ៣ ជួង (3♠) ចេញមកជាមួយដាច់ខាត
        const isFirstMoveOfGame = (room.lastCombo === null && room.winnerOrder.length === 0 && room.passedPlayers.length === 0);
        if (isFirstMoveOfGame) {
            const has3SpadesInRoom = room.players.some(p => p.hand.some(c => c.value === '3' && c.suit === '♠'));
            if (has3SpadesInRoom) {
                const includes3Spades = cards.some(c => c.value === '3' && c.suit === '♠');
                if (!includes3Spades) {
                    socket.emit('errorMsg', 'ការវាយបៀលើកដំបូងបង្អស់ ត្រូវតែរួមបញ្ចូលសន្លឹកបៀ ៣ ជួង (3 ♠)!');
                    return;
                }
            }
        }

        // ពិនិត្យភាពត្រឹមត្រូវតាមច្បាប់ទៀនឡេន
        if (!isValidMove(room.lastCombo, cards)) {
            socket.emit('errorMsg', 'បៀវាយចេញមិនត្រឹមត្រូវតាមច្បាប់ ឬមិនអាចកាត់បៀនៅលើក្តារបានឡើយ!');
            return;
        }

        // ធ្វើបច្ចុប្បន្នភាពទិន្នន័យ៖ ដកបៀចេញពីដៃ
        currentPlayer.hand = currentPlayer.hand.filter(h => !cards.some(c => c.value === h.value && c.suit === h.suit));
        
        room.lastCombo = analyzeCombination(cards);
        room.lastMovePlayerId = currentPlayer.id;

        // ករណីអ្នកលេងអស់បៀពីដៃ (ឈ្នះ)
        if (currentPlayer.hand.length === 0 && !room.winnerOrder.includes(currentPlayer.id)) {
            room.winnerOrder.push(currentPlayer.id);
            currentPlayer.rank = room.winnerOrder.length; // លេខ ១, លេខ ២...
            io.to(roomId).emit('playerFinished', { playerName: currentPlayer.name, rank: currentPlayer.rank });
        }

        // ពិនិត្យលក្ខខណ្ឌបញ្ចប់ហ្គេម៖ បើនៅសល់អ្នកលេងតែម្នាក់មិនទាន់អស់បៀ គឺបញ្ចប់ហ្គេមភ្លាម
        const activePlayersCount = room.players.filter(p => p.hand.length > 0).length;
        if (activePlayersCount <= 1) {
            // ចាត់ថ្នាក់អ្នកដែលនៅសល់ចុងក្រោយគេបង្អស់
            room.players.forEach(p => {
                if (p.hand.length > 0) {
                    room.winnerOrder.push(p.id);
                    p.rank = room.winnerOrder.length;
                }
            });
            room.status = 'ended';
            io.to(roomId).emit('gameEnded', room);
            return;
        }

        // បោះវេនទៅឱ្យអ្នកបន្ទាប់
        moveToNextTurn(room);
        io.to(roomId).emit('gameUpdated', room);
    });

    // រំលងវេន / មិនស៊ី (Skip / Pass)
    socket.on('skipTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        const currentPlayer = room.players[room.currentTurnIdx];
        if (currentPlayer.id !== socket.id) return;

        // មិនអនុញ្ញាតឱ្យ Skip ឡើយ ប្រសិនបើខ្លួនឯងជាអ្នកបើកជុំថ្មី (បៀនៅលើក្តារជារបស់ខ្លួនឯង ឬទើបចាប់ផ្តើម)
        if (!room.lastCombo || room.lastMovePlayerId === currentPlayer.id) {
            socket.emit('errorMsg', 'អ្នកជាអ្នកបើកជុំថ្មី មិនអាចរំលង (Skip) បានឡើយ!');
            return;
        }

        // កំណត់ស្ថានភាពថាបាន Skip
        currentPlayer.isPassed = true;
        if (!room.passedPlayers.includes(currentPlayer.id)) {
            room.passedPlayers.push(currentPlayer.id);
        }

        // ពិនិត្យមើលថាតើអ្នកលេងដែលនៅសល់ (មិនទាន់អស់បៀ) ទាំងអស់បាន Skip អស់ហើយឬនៅ?
        // ប្រសិនបើគ្រប់គ្នាបាន Skip អស់ហើយ នោះអ្នកវាយបៀចុងក្រោយគេបង្អស់នឹងត្រូវបើកជុំថ្មី
        const activePlayersNotPassed = room.players.filter(p => p.hand.length > 0 && !p.isPassed);

        if (activePlayersNotPassed.length <= 1) {
            // កំណត់ឱ្យចាប់ផ្តើមជុំថ្មី (Clear ក្តារបៀចាស់ចោល)
            room.lastCombo = null;
            room.passedPlayers = [];
            room.players.forEach(p => p.isPassed = false);

            // ផ្ទេរវេនទៅឱ្យអ្នកដែលបានវាយបៀចុងក្រោយគេបង្អស់ (បើគាត់ឈ្នះអស់បៀហើយ ផ្ទេរទៅអ្នកបន្ទាប់)
            let lastMoveIdx = room.players.findIndex(p => p.id === room.lastMovePlayerId);
            if (room.players[lastMoveIdx].hand.length === 0) {
                room.currentTurnIdx = lastMoveIdx;
                moveToNextTurn(room);
            } else {
                room.currentTurnIdx = lastMoveIdx;
            }
            room.lastMovePlayerId = null;
        } else {
            // ប្រសិនបើនៅមានអ្នកអាចលេងបន្តបានក្នុងជុំនេះ គឺបោះវេនទៅអ្នកបន្ទាប់ធម្មតា
            moveToNextTurn(room);
        }

        io.to(roomId).emit('gameUpdated', room);
    });

    // មុខងារជំនួយសម្រាប់ប្តូរវេនទៅអ្នកបន្ទាប់ (Move to Next Active Turn)
    function moveToNextTurn(room) {
        let attempts = 0;
        const totalPlayers = room.players.length;

        while (attempts < totalPlayers) {
            room.currentTurnIdx = (room.currentTurnIdx + 1) % totalPlayers;
            const nextPlayer = room.players[room.currentTurnIdx];

            // លក្ខខណ្ឌអាចបន្តវេនបាន៖ ត្រូវតែមានបៀក្នុងដៃ និងមិនទាន់បានចុច Skip ក្នុងជុំនេះ
            if (nextPlayer.hand.length > 0 && !nextPlayer.isPassed) {
                return;
            }
            attempts++;
        }
    }

    // ចាកចេញពីបន្ទប់ (Leave Room)
    socket.on('leaveRoom', () => {
        handlePlayerDisconnect(socket);
    });

    // ដាច់ការតភ្ជាប់ពី Server (Disconnect)
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        // 🎙️ ប្រាប់សមាជិកដទៃឱ្យផ្តាច់ចរន្ត Voice Chat ពីបុគ្គលនេះ
        notifyVoicePeerDisconnect(socket.id);

        handlePlayerDisconnect(socket);
    });
});

// មុខងាររួមសម្រាប់គ្រប់គ្រងពេលអ្នកលេងចាកចេញ ឬដាច់អ៊ីនធឺណិត
function handlePlayerDisconnect(socket) {
    for (const roomId in rooms) {
        const room = rooms[roomId];
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        
        if (playerIndex !== -1) {
            const player = room.players[playerIndex];
            room.players.splice(playerIndex, 1);
            
            // បើអ្នកចាកចេញជាមេបន្ទប់ (Host) ហើយក្នុងបន្ទប់នៅសល់មនុស្ស ត្រូវផ្ទេរសិទ្ធិមេបន្ទប់ទៅអ្នកបន្ទាប់
            if (room.hostId === socket.id && room.players.length > 0) {
                room.hostId = room.players[0].id;
            }
            
            // បើហ្គេមកំពុងលេង ហើ់យមានអ្នកលេងណាម្នាក់លួចចាកចេញពាក់កណ្តាលទី
            if (room.status === 'playing') {
                // ប្រសិនបើនៅសល់មនុស្សតិចជាង ២ នាក់ ត្រូវបង្ខំចិត្តបញ្ឈប់ហ្គេមភ្លាម
                if (room.players.length < 2) {
                    room.status = 'ended';
                    io.to(roomId).emit('errorMsg', `ហ្គេមត្រូវបានបញ្ចប់ ព្រោះអ្នកលេង ${player.name} បានចាកចេញពីហ្គេម!`);
                    io.to(roomId).emit('gameEnded', room);
                } else {
                    // ប្រសិនបើនៅលេងកើត ត្រូវលុប ID ចេញពីបញ្ជី Skip និងផ្ទេរវេនបើចាំបាច់
                    room.passedPlayers = room.passedPlayers.filter(id => id !== socket.id);
                    room.winnerOrder = room.winnerOrder.filter(id => id !== socket.id);
                    
                    if (room.currentTurnIdx >= room.players.length) {
                        room.currentTurnIdx = 0;
                    }
                    io.to(roomId).emit('gameUpdated', room);
                }
            }

            socket.leave(roomId);
            
            // បើសិនជាគ្មានមនុស្សសល់ក្នុងបន្ទប់ទាល់តែសោះ ត្រូវលុបបន្ទប់នោះចោលពី Memory
            if (room.players.length === 0) {
                delete rooms[roomId];
            } else {
                io.to(roomId).emit('roomUpdated', room);
            }
            
            socket.emit('leftRoom');
            break;
        }
    }
}

// ចាប់ផ្តើមដំណើរការ Port Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});