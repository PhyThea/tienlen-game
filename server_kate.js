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

app.use(express.static(__dirname));

// កូដត្រង់ចំណុចផ្ដើមទំព័រដំបូង
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html')); // បើកមកឱ្យឃើញទំព័ររើសហ្គេមមុនគេ
});

// បង្កើតផ្លូវដាច់ដោយឡែកសម្រាប់ហៅទំព័រ កាតេ
app.get('/kate', (req, res) => {
    res.sendFile(path.join(__dirname, 'index_kate.html'));
});

const rooms = {};

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
    const activePlayers = room.players.filter(p => !p.isSpectator && p.hand.length >= 0);
    
    if (room.currentSubTurnCount >= activePlayers.length) {
        let winCard = room.playedCards[0];
        let winPlayerId = room.roundActionLog[0].playerId;

        for (let i = 1; i < room.playedCards.length; i++) {
            let c = room.playedCards[i];
            let log = room.roundActionLog[i];
            if (c && winCard && c.suit === winCard.suit && getCardPower(c) > getCardPower(winCard) && !log.isBurned) {
                winCard = c;
                winPlayerId = log.playerId;
            }
        }

        let winnerPlayer = room.players.find(p => p.id === winPlayerId);
        if (winnerPlayer) {
            winnerPlayer.wonRounds.push(room.currentRoundNumber);
            room.lastRoundWinnerId = winPlayerId;
            room.currentTurnIndex = room.players.findIndex(p => p.id === winPlayerId);
        }

        room.currentRoundNumber++;
        room.currentSubTurnCount = 0;
        room.playedCards = [];
        room.roundActionLog = [];

        if (room.currentRoundNumber === 5) {
            room.players.forEach(p => {
                if (!p.isSpectator && p.wonRounds.length === 0) {
                    p.hand = []; 
                }
            });
            
            const survivors = room.players.filter(p => p.hand.length > 0);
            if (survivors.length <= 1) {
                endGameWithWinner(room, survivors[0] ? survivors[0] : winnerPlayer);
                return;
            }
        }

        if (room.currentRoundNumber > 6) {
            let finalWinner = room.players.find(p => p.id === room.lastRoundWinnerId);
            endGameWithWinner(room, finalWinner);
            return;
        }

        io.to(room.roomId).emit('clearTable', { 
            nextPlayer: room.players[room.currentTurnIndex] ? room.players[room.currentTurnIndex].name : "បន្ទាប់",
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
            roundActionLog: [], 
            lastRoundWinnerId: null,
            currentRoundNumber: 1, 
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
        room.players.push({ id: socket.id, name: playerName || 'Guest', hand: [], isSpectator, rank: null, wonRounds: [] });
        socket.join(roomId);

        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator, playedCards: room.playedCards, currentTurnIndex: room.currentTurnIndex });
        io.to(roomId).emit('updatePlayers', room.players);
        broadcastRoomList();
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        room.players.forEach(p => { p.isSpectator = false; p.hand = []; p.rank = null; p.wonRounds = []; });
        const activePlayers = room.players.filter(p => !p.isSpectator);
        if (activePlayers.length < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់!');

        const deck = shuffleDeck(createDeck());
        room.status = 'playing'; 
        room.playedCards = [];
        room.roundActionLog = [];
        room.currentRoundNumber = 1;
        room.currentSubTurnCount = 0;
        
        room.players.forEach((p, i) => {
            p.hand = sortCards(deck.slice(i * 6, (i + 1) * 6));
        });

        room.players.forEach(p => io.to(p.id).emit('dealCards', { hand: p.hand }));

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

        const cardIdx = player.hand.findIndex(c => c.value === card.value && c.suit === card.suit);
        if (cardIdx === -1) return socket.emit('errorMsg', 'រកមិនឃើញបៀរនេះក្នុងដៃឡើយ');
        player.hand.splice(cardIdx, 1);

        let statusMessage = "";
        let finalBurnedStatus = isBurnAction;

        if (room.currentRoundNumber === 5) {
            finalBurnedStatus = false; 
            if (room.playedCards.length === 0) {
                statusMessage = "គប់ទេ";
            } else {
                let leadCard = room.playedCards[0];
                if (card.suit === leadCard.suit && getCardPower(card) > getCardPower(leadCard)) {
                    statusMessage = "គប់ហើយ";
                } else {
                    statusMessage = "អត់គប់ទេ";
                }
            }
        } else {
            statusMessage = isBurnAction ? "ធិបផ្កាប់បៀ ❌" : "ស៊ីបៀរ 🎯";
        }

        room.playedCards.push(card);
        room.roundActionLog.push({ playerId: socket.id, isBurned: finalBurnedStatus });

        io.to(roomId).emit('kaTeCardPlayed', {
            playerId: socket.id,
            by: player.name,
            card: card,
            isBurned: finalBurnedStatus,
            statusMessage: statusMessage,
            roundNumber: room.currentRoundNumber,
            updatedHands: room.players
        });

        handleKaTeRoundStatus(room);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Ka Te Server is running on port ${PORT}`));