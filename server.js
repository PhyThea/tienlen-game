// ===========================
// server.js (IMPROVED VERSION)
// ===========================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// ===========================
// GAME STATE
// ===========================
const rooms = {};

// card order
const CARD_ORDER = [
  '3','4','5','6','7','8','9','10','J','Q','K','A','2'
];

const SUIT_ORDER = ['♠','♣','♦','♥'];

// type ranking (IMPORTANT FIX)
const TYPE_RANK = {
  single: 1,
  pair: 2,
  straight: 3,
  triple: 4,
  four_pairs: 5,
  bomb: 6
};

// ===========================
// DECK
// ===========================
function createDeck() {
  const suits = ['♠','♥','♦','♣'];
  const values = CARD_ORDER;

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

// ===========================
// CARD HELPERS
// ===========================
function getCardRank(card) {
  return (
    CARD_ORDER.indexOf(card.value) * 10 +
    SUIT_ORDER.indexOf(card.suit)
  );
}

function sortCards(cards) {
  return cards.sort((a, b) => getCardRank(a) - getCardRank(b));
}

// ===========================
// COMBO DETECTION
// ===========================
function isStraight(cards) {
  if (cards.length < 3) return false;

  const sorted = [...cards].sort(
    (a, b) =>
      CARD_ORDER.indexOf(a.value) -
      CARD_ORDER.indexOf(b.value)
  );

  for (let i = 1; i < sorted.length; i++) {
    if (
      CARD_ORDER.indexOf(sorted[i].value) !==
      CARD_ORDER.indexOf(sorted[i - 1].value) + 1
    ) {
      return false;
    }
  }

  return true;
}

function getComboType(cards) {
  if (!cards.length) return null;

  if (cards.length === 1) return 'single';

  const sameValue = cards.every(
    c => c.value === cards[0].value
  );

  if (sameValue) {
    if (cards.length === 2) return 'pair';
    if (cards.length === 3) return 'triple';
    if (cards.length === 4) return 'bomb';
  }

  if (cards.length === 8) {
    const counts = {};
    cards.forEach(c => {
      counts[c.value] = (counts[c.value] || 0) + 1;
    });

    const values = Object.values(counts);

    if (values.length === 4 && values.every(v => v === 2)) {
      return 'four_pairs';
    }
  }

  if (isStraight(cards)) return 'straight';

  return null;
}

function isValidPlay(cards) {
  return !!getComboType(cards);
}

// ===========================
// COMPARE LOGIC (FIXED)
// ===========================
function comparePlay(newCards, oldCards) {
  if (!oldCards || oldCards.length === 0) return true;

  const newType = getComboType(newCards);
  const oldType = getComboType(oldCards);

  const newRank = TYPE_RANK[newType] || 0;
  const oldRank = TYPE_RANK[oldType] || 0;

  // bomb rule (special)
  if (newType === 'bomb' && oldType !== 'bomb') return true;

  // four pairs special
  if (newType === 'four_pairs' && oldType === 'straight') return true;

  if (newType !== oldType) {
    return newRank > oldRank;
  }

  if (newCards.length !== oldCards.length) return false;

  const newMax = Math.max(...newCards.map(getCardRank));
  const oldMax = Math.max(...oldCards.map(getCardRank));

  return newMax > oldMax;
}

// ===========================
// TURN SYSTEM
// ===========================
function nextTurn(room) {
  if (room.players.length <= 1) return;

  let tries = 0;

  do {
    room.currentTurnIndex =
      (room.currentTurnIndex + 1) % room.players.length;

    tries++;

  } while (
    room.players[room.currentTurnIndex].passed &&
    tries < room.players.length
  );
}

// ===========================
// START NEW ROUND
// ===========================
function startNewRound(room) {
  room.status = 'playing';
  room.winner = null;
  room.playedCards = [];
  room.isFirstMoveOfGame = true;

  const deck = shuffleDeck(createDeck());

  room.players.forEach((player, index) => {
    player.hand = sortCards(
      deck.slice(index * 13, (index + 1) * 13)
    );
    player.passed = false;
  });

  room.currentTurnIndex =
    room.players.findIndex(p =>
      p.hand.some(
        c => c.value === '3' && c.suit === '♣'
      )
    );

  if (room.currentTurnIndex === -1) {
    room.currentTurnIndex = 0;
  }

  io.to(room.id).emit('gameStarted', {
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      cardCount: p.hand.length
    })),
    currentTurnIndex: room.currentTurnIndex
  });

  room.players.forEach(p => {
    io.to(p.id).emit('dealCards', { hand: p.hand });
  });

  io.to(room.id).emit(
    'gameStatus',
    `🎯 វេន ${room.players[room.currentTurnIndex].name}`
  );
}

// ===========================
// SOCKET
// ===========================
io.on('connection', socket => {

  console.log('Connected:', socket.id);

  // CREATE ROOM
  socket.on('createRoom', ({ roomId, password, playerName }) => {

    if (rooms[roomId]) {
      return socket.emit('errorMsg', 'បន្ទប់នេះមានស្រាប់');
    }

    socket.join(roomId);

    rooms[roomId] = {
      id: roomId,
      players: [{
        id: socket.id,
        name: playerName || 'Player 1',
        hand: [],
        passed: false
      }],
      creatorId: socket.id,
      password: password || null,
      maxPlayers: 4,
      status: 'waiting',
      currentTurnIndex: 0,
      playedCards: [],
      winner: null,
      isFirstMoveOfGame: true
    };

    socket.emit('roomCreated', {
      roomId,
      playerId: socket.id
    });

    io.to(roomId).emit(
      'updatePlayers',
      rooms[roomId].players
    );
  });

  // JOIN ROOM
  socket.on('joinRoom', ({ roomId, password, playerName }) => {

    const room = rooms[roomId];
    if (!room) return socket.emit('errorMsg', 'បន្ទប់មិនមាន');

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

    socket.emit('roomJoined', {
      roomId,
      playerId: socket.id
    });

    io.to(roomId).emit('updatePlayers', room.players);
  });

  // START GAME
  socket.on('startGame', roomId => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.creatorId !== socket.id) {
      return socket.emit(
        'errorMsg',
        'មានតែ Host ទេអាចចាប់ផ្តើមបាន'
      );
    }

    if (room.players.length < 2) {
      return socket.emit(
        'errorMsg',
        'ត្រូវការយ៉ាងតិច 2 នាក់'
      );
    }

    startNewRound(room);
  });

  // PLAY CARD
  socket.on('playCard', ({ roomId, cards }) => {

    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    if (room.players[room.currentTurnIndex].id !== socket.id) {
      return socket.emit('errorMsg', 'មិនមែនវេនអ្នក');
    }

    if (!cards || !cards.length) {
      return socket.emit('errorMsg', 'ជ្រើសបៀសិន');
    }

    for (const c of cards) {
      if (!player.hand.find(p => p.value === c.value && p.suit === c.suit)) {
        return socket.emit('errorMsg', 'បៀមិនត្រឹមត្រូវ');
      }
    }

    if (room.isFirstMoveOfGame) {
      const has3C = player.hand.some(c => c.value === '3' && c.suit === '♣');
      const plays3C = cards.some(c => c.value === '3' && c.suit === '♣');

      if (has3C && !plays3C) {
        return socket.emit('errorMsg', 'ត្រូវចេញ 3♣ មុន');
      }
    }

    if (!isValidPlay(cards)) {
      return socket.emit('errorMsg', 'ក្បួនមិនត្រឹមត្រូវ');
    }

    if (!comparePlay(cards, room.playedCards)) {
      return socket.emit('errorMsg', 'បៀតូចជាង');
    }

    cards.forEach(c => {
      const idx = player.hand.findIndex(
        p => p.value === c.value && p.suit === c.suit
      );
      if (idx !== -1) player.hand.splice(idx, 1);
    });

    room.playedCards = cards;

    room.players.forEach(p => {
      if (p.id !== socket.id) p.passed = false;
    });

    if (player.hand.length === 0) {
      io.to(roomId).emit('gameWon', { winner: player.name });

      setTimeout(() => startNewRound(room), 4000);
      return;
    }

    room.isFirstMoveOfGame = false;

    nextTurn(room);

    io.to(roomId).emit('cardPlayed', {
      by: player.name,
      cards,
      currentTurnIndex: room.currentTurnIndex
    });
  });

  // PASS
  socket.on('passTurn', roomId => {

    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    if (room.players[room.currentTurnIndex].id !== socket.id) return;

    if (!room.playedCards.length) {
      return socket.emit('errorMsg', 'មិនអាច pass វេនដំបូង');
    }

    player.passed = true;

    nextTurn(room);

    const active = room.players.filter(p => !p.passed);

    if (active.length <= 1) {
      room.playedCards = [];
      room.players.forEach(p => (p.passed = false));

      io.to(roomId).emit('clearTable');
    }

    io.to(roomId).emit('turnChanged', {
      currentTurnIndex: room.currentTurnIndex
    });
  });

  // DISCONNECT
  socket.on('disconnect', () => {

    for (const roomId in rooms) {
      const room = rooms[roomId];

      const idx = room.players.findIndex(p => p.id === socket.id);

      if (idx !== -1) {
        const left = room.players[idx].name;

        room.players.splice(idx, 1);

        io.to(roomId).emit('updatePlayers', room.players);

        io.to(roomId).emit('gameStatus', `${left} left`);

        if (!room.players.length) delete rooms[roomId];

        break;
      }
    }
  });

});

// ===========================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`✅ Server running on ${PORT}`);
});