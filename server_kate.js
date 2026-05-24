const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingTimeout: 60000,
    pingInterval: 25000
});

// បើកឱ្យប្រើប្រាស់ឯកសារ Static នៅក្នុង Folder ជាមួយគ្នា
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index_kate.html'));
});

const rooms = {};

// ច្បាប់កាតេ៖ ២ តូចជាងគេ, អាត់ (A) ធំជាងគេបង្អស់
const CARD_ORDER = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
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

function moveToNextTurn(room) {
    let originalIndex = room.currentTurnIndex;
    let nextIndex = originalIndex;
    let found = false;
    for (let i = 1; i <= room.players.length; i++) {
        let checkIndex = (originalIndex + i) % room.players.length;
        let p = room.players[checkIndex];
        // ក្នុងកាតេ អ្នកអស់បៀរមុន ឬអ្នកត្រូវបានកាត់សិទ្ធិ (ដាច់ទឹក) មិនអាចលេងបានទេ
        if (p && p.hand.length > 0 && !p.isSpectator) {
            nextIndex = checkIndex;
            found = true;
            break;
        }
    }
    if (found) room.currentTurnIndex = nextIndex;
}

function handleKaTeRoundStatus(room) {
    room.currentSubTurnCount++;
    
    // បើសិនជាគ្រប់គ្នាលេងបានម្នាក់មួយសន្លឹកហើយ (ចប់មួយជុំតូច)
    const activePlayers = room.players.filter(p => !p.isSpectator);
    if (room.currentSubTurnCount >= activePlayers.length) {
        // ស្វែងរកអ្នកឈ្នះក្នុងជុំនេះ (អ្នកទម្លាក់បៀរត្រូវទឹក និងធំបំផុត)
        let winCard = room.playedCards[0];
        let winPlayerId = room.roundActionLog[0].playerId;

        for (let i = 1; i < room.playedCards.length; i++) {
            let c = room.playedCards[i];
            let log = room.roundActionLog[i];
            if (c.suit === winCard.suit && getCardPower(c) > getCardPower(winCard) && !log.isBurned) {
                winCard = c;
                winPlayerId = log.playerId;
            }
        }

        // កត់ត្រាទុកថាអ្នកណាឈ្នះជុំនេះ
        let winnerPlayer = room.players.find(p => p.id === winPlayerId);
        if (winnerPlayer) {
            winnerPlayer.wonRounds.push(room.currentRoundNumber);
            room.lastRoundWinnerId = winPlayerId;
            room.currentTurnIndex = room.players.findIndex(p => p.id === winPlayerId);
        }

        // ត្រៀមឡើងជុំថ្មី
        room.currentRoundNumber++;
        room.currentSubTurnCount = 0;
        room.playedCards = [];
        room.roundActionLog = [];

        // ឆែកមើលថាតើដល់ជុំទី ៥ ឬនៅ?
        if (room.currentRoundNumber === 5) {
            // អ្នកលេងណាដែលគ្មានឈ្នះសោះក្នុង ៤ ជុំដំបូង ត្រូវដាច់ទឹក (ធ្លាក់)
            room.players.forEach(p => {
                if (!p.isSpectator && p.wonRounds.length === 0) {
                    p.hand = []; // ជម្រុះចេញ
                }
            });
            
            const survivors = room.players.filter(p => p.hand.length > 0);
            if (survivors.length <= 1) {
                // បើសល់តែម្នាក់ គឺឈ្នះដាច់តែម្ដង
                endGameWithWinner(room, survivors[0] ? survivors[0] : winnerPlayer);
                return;
            }
        }

        // ឆែកមើលថាតើចប់ជុំទី ៦ ឬនៅ? (ចប់ហ្គេម)
        if (room.currentRoundNumber > 6) {
            // រកអ្នកឈ្នះចុងក្រោយនៅជុំទី ៦
            let finalWinner = room.players.find(p => p.id === room.lastRoundWinnerId);
            endGameWithWinner(room, finalWinner);
            return;
        }

        io.to(room.roomId).emit('clearTable', { 
            nextPlayer: room.players[room.currentTurnIndex].name,
            roundNumber: room.currentRoundNumber 
        });
    } else {
        moveToNextTurn(room);
    }

    io.to(room.roomId).emit('turnChanged', { 
        currentTurnIndex: room.currentTurnIndex,
        players: room.players,
        roundNumber: room.currentRoundNumber
    });
}

function endGameWithWinner(room, winnerPlayer) {
    room.status = 'waiting';
    let wName = winnerPlayer ? winnerPlayer.name : "រកមិនឃើញ";
    let wId = winnerPlayer ? winnerPlayer.id : null;

    if (winnerPlayer) winnerPlayer.rank = 1;

    let rankCounter = 2;
    room.players.forEach(p => {
        if (!p.isSpectator && p.id !== wId) {
            p.rank = rankCounter++;
        }
    });

    const results = room.players.map(p => ({
        id: p.id,
        name: p.name,
        remaining: [...p.hand],
        isSpectator: p.isSpectator,
        rank: p.rank,
        wonRounds: p.wonRounds
    }));

    io.to(room.roomId).emit('gameWon', {
        winner: wName,
        winnerId: wId,
        allHands: results
    });
    broadcastRoomList();
}

function broadcastRoomList() {
    const list = Object.keys(rooms).map(id => ({
        roomId: id,
        playerCount: rooms[id].players.length,
        status: rooms[id].status,
        hasPassword: rooms[id].password && rooms[id].password !== ""
    }));
    io.emit('roomList', list);
}

io.on('connection', (socket) => {
    broadcastRoomList();

    socket.on('createRoom', ({ roomId, password, playerName }) => {
        if (rooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        
        rooms[roomId] = {
            roomId: roomId,
            players: [{ id: socket.id, name: playerName || 'Player 1', hand: [], isSpectator: false, rank: null, wonRounds: [] }],
            creatorId: socket.id,
            status: 'waiting', 
            password: password || "",
            currentTurnIndex: 0,
            playedCards: [],
            roundActionLog: [], // ទុកចំណាំសកម្មភាពក្នុងជុំនីមួយៗ
            lastRoundWinnerId: null,
            currentRoundNumber: 1, // រាប់ពីជុំទី ១ ដល់ ទី ៦
            currentSubTurnCount: 0
        };
        
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to(roomId).emit('updatePlayers', rooms[roomId].players);
        broadcastRoomList();
    });

    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = rooms[roomId];
        if (!room) return; 
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

        const isSpectator = room.status === 'playing';
        socket.to(roomId).emit('voice_user_joined', { id: socket.id });

        room.players.forEach(ep => socket.emit('voice_initiate_peer', { target: ep.id }));

        room.players.push({ id: socket.id, name: playerName || 'Guest', hand: [], isSpectator, rank: null, wonRounds: [] });
        socket.join(roomId);

        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator, playedCards: room.playedCards, currentTurnIndex: room.currentTurnIndex });
        io.to(roomId).emit('updatePlayers', room.players);
        broadcastRoomList();
    });

    socket.on('voice_signal', (data) => {
        io.to(data.target).emit('voice_signal', { sender: socket.id, signal: data.signal });
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        if (room.lastRoundWinnerId ? room.lastRoundWinnerId !== socket.id : room.creatorId !== socket.id) {
            return socket.emit('errorMsg', 'គ្មានសិទ្ធិចាប់ផ្ដើមហ្គេមទេ!');
        }

        room.players.forEach(p => { p.isSpectator = false; p.hand = []; p.rank = null; p.wonRounds = []; });
        const activePlayers = room.players.filter(p => !p.isSpectator);
        if (activePlayers.length < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់!');

        const deck = shuffleDeck(createDeck());
        room.status = 'playing'; 
        room.playedCards = [];
        room.roundActionLog = [];
        room.currentRoundNumber = 1;
        room.currentSubTurnCount = 0;
        
        // កាតេចែកម្នាក់ៗតែ ៦ សន្លឹកប៉ុណ្ណោះ
        room.players.forEach((p, i) => {
            p.hand = sortCards(deck.slice(i * 6, (i + 1) * 6));
        });

        room.players.forEach(p => io.to(p.id).emit('dealCards', { hand: p.hand }));

        // ជុំដំបូងគេបង្អស់ឱ្យអ្នកឈ្នះវគ្គមុន ឬម្ចាស់បន្ទប់ចេញមុនគេ
        let startingIndex = room.lastRoundWinnerId ? room.players.findIndex(p => p.id === room.lastRoundWinnerId) : 0;
        if (startingIndex === -1) startingIndex = 0;
        room.currentTurnIndex = startingIndex;

        io.to(roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex, currentRoundNumber: room.currentRoundNumber });
        broadcastRoomList();
    });

    socket.on('playKaTeCard', ({ roomId, card, isBurnAction }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ');

        // ដកបៀរចេញពីដៃអ្នកលេង
        const cardIdx = player.hand.findIndex(c => c.value === card.value && c.suit === card.suit);
        if (cardIdx === -1) return socket.emit('errorMsg', 'រកមិនឃើញបៀរនេះក្នុងដៃឡើយ');
        player.hand.splice(cardIdx, 1);

        let statusMessage = "";
        let finalBurnedStatus = isBurnAction;

        // --- លក្ខខណ្ឌពិសេសសម្រាប់ជុំទី ៥ ---
        if (room.currentRoundNumber === 5) {
            // សន្លឹកទី ៥ បង្ហាញឱ្យឃើញជានិច្ច មិនផ្កាប់មុខទេ
            finalBurnedStatus = false; 
            
            // បើក្បាលជុំទី ៥ (អ្នកចេញមុនគេ)
            if (room.playedCards.length === 0) {
                statusMessage = "គប់ទេ";
            } else {
                // អ្នកវេនបន្ទាប់ដេញទឹក
                let leadCard = room.playedCards[0];
                if (card.suit === leadCard.suit && getCardPower(card) > getCardPower(leadCard)) {
                    statusMessage = "គប់ហើយ";
                } else {
                    statusMessage = "អត់គប់ទេ";
                }
            }
        } else {
            // ជុំធម្មតា (១ ដល់ ៤) និងជុំទី ៦
            statusMessage = isBurnAction ? "ធិបផ្កាប់បៀ ❌" : "ស៊ីបៀរ 🎯";
        }

        room.playedCards.push(card);
        room.roundActionLog.push({ playerId: socket.id, isBurned: finalBurnedStatus });

        io.to(roomId).emit('kaTeCardPlayed', {
            by: player.name,
            card: card,
            isBurned: finalBurnedStatus,
            statusMessage: statusMessage,
            roundNumber: room.currentRoundNumber,
            updatedHands: room.players
        });

        handleKaTeRoundStatus(room);
    });

    socket.on('leaveRoom', () => {
        // ... (រក្សាទុក Logic Leave Room ដូចកូដដើមដើម្បីសុវត្ថិភាពទិន្នន័យ) ...
    });
    socket.on('disconnect', () => {
        // ... (រក្សាទុក Logic Disconnect ដូចកូដដើម) ...
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Ka Te Server is running on port ${PORT}`));