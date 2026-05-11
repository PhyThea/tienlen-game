// ===========================
// server.js (FINAL FIXED)
// ===========================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

// ===========================
// CARD SETUP
// ===========================
const CARD_ORDER = [
  '3','4','5','6','7','8','9','10','J','Q','K','A','2'
];

const SUIT_ORDER = ['♠','♣','♦','♥'];

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
  for (const s of suits) {
    for (const v of values) {
      deck.push({ suit: s, value: v });
    }
  }
  return deck;
}

function shuffle(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ===========================
// HELPERS
// ===========================
function rank(card) {
  return CARD_ORDER.indexOf(card.value) * 10 +
         SUIT_ORDER.indexOf(card.suit);
}

function sortCards(cards) {
  return cards.sort((a, b) => rank(a) - rank(b));
}

// ===========================
// COMBO
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
    ) return false;
  }

  return true;
}

function getType(cards) {
  if (!cards.length) return null;

  if (cards.length === 1) return 'single';

  const same = cards.every(c => c.value === cards[0].value);

  if (same) {
    if (cards.length === 2) return 'pair';
    if (cards.length === 3) return 'triple';
    if (cards.length === 4) return 'bomb';
  }

  if (cards.length === 8) {
    const count = {};
    cards.forEach(c => count[c.value] = (count[c.value] || 0) + 1);

    const vals = Object.values(count);
    if (vals.length === 4 && vals.every(v => v === 2)) {
      return 'four_pairs';
    }
  }

  if (isStraight(cards)) return 'straight';

  return null;
}

function valid(cards) {
  return !!getType(cards);
}

// ===========================
// COMPARE FIXED
// ===========================
function compare(newC, oldC) {
  if (!oldC || oldC.length === 0) return true;

  const n = getType(newC);
  const o = getType(oldC);

  if (!n || !o) return false;

  const nr = TYPE_RANK[n];
  const or = TYPE_RANK[o];

  if (n === 'bomb' && o !== 'bomb') return true;

  if (n !== o) return nr > or;

  if (newC.length !== oldC.length) return false;

  return Math.max(...newC.map(rank)) >
         Math.max(...oldC.map(rank));
}

// ===========================
// TURN
// ===========================
function next(room) {
  if (room.players.length <= 1) return;

  let tries = 0;

  do {
    room.currentTurnIndex =
      (room.currentTurnIndex + 1) %
      room.players.length;

    tries++;

  } while (
    room.players[room.currentTurnIndex].passed &&
    tries < room.players.length
  );
}

// ===========================
// NEW ROUND
// ===========================
function newRound(room) {
  room.status = 'playing';
  room.playedCards = [];
  room.winner = null;
  room.firstMove = true;

  const deck = shuffle(createDeck());

  room.players.forEach((p, i) => {
    p.hand = sortCards(deck.slice(i * 13, i * 13 + 13));
    p.passed = false;
  });

  room.currentTurnIndex =
    room.players.findIndex(p =>
      p.hand.some(c => c.value === '3' && c.suit === '♣')
    );

  if (room.currentTurnIndex === -1)
    room.currentTurnIndex = 0;

  io.to(room.id).emit('gameStarted', {
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      cardCount: p.hand.length
    })),
    currentTurnIndex: room.currentTurnIndex
  });

  room.players.forEach(p =>
    io.to(p.id).emit('dealCards', { hand: p.hand })
  );
}

// ===========================
// SOCKET
// ===========================
io.on('connection', socket => {

  console.log('connected', socket.id);

  // CREATE
  socket.on('createRoom', ({ roomId, password, name }) => {

    if (rooms[roomId])
      return socket.emit('errorMsg', 'room exists');

    socket.join(roomId);

    rooms[roomId] = {
      id: roomId,
      players: [{
        id: socket.id,
        name: name || 'P1',
        hand: [],
        passed: false
      }],
      creatorId: socket.id,
      password: password || null,
      status: 'waiting',
      currentTurnIndex: 0,
      playedCards: [],
      firstMove: true
    };

    socket.emit('roomCreated', { roomId });
  });

  // JOIN
  socket.on('joinRoom', ({ roomId, name }) => {

    const room = rooms[roomId];
    if (!room) return socket.emit('errorMsg', 'no room');

    socket.join(roomId);

    room.players.push({
      id: socket.id,
      name: name || 'P',
      hand: [],
      passed: false
    });

    io.to(roomId).emit('updatePlayers', room.players);
  });

  // START
  socket.on('startGame', roomId => {

    const room = rooms[roomId];
    if (!room) return;

    if (room.creatorId !== socket.id)
      return socket.emit('errorMsg', 'not host');

    newRound(room);
  });

  // ===========================
  // PLAY CARD (FIXED CORE)
  // ===========================
  socket.on('playCard', ({ roomId, cards }) => {

    const room = rooms[roomId];
    if (!room) return socket.emit('errorMsg', 'no room');

    if (room.status !== 'playing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // TURN CHECK
    if (room.players[room.currentTurnIndex].id !== socket.id)
      return socket.emit('errorMsg', 'not your turn');

    if (!cards?.length)
      return socket.emit('errorMsg', 'no cards');

    // NORMALIZE (IMPORTANT FIX)
    cards = cards.map(c => ({
      value: c.value,
      suit: c.suit
    }));

    // VALIDATE OWN CARDS
    for (const c of cards) {
      if (!player.hand.find(p => p.value === c.value && p.suit === c.suit))
        return socket.emit('errorMsg', 'invalid card');
    }

    // FIRST MOVE RULE (3♣)
    if (room.firstMove) {
      const has3 = player.hand.some(c => c.value === '3' && c.suit === '♣');
      const plays3 = cards.some(c => c.value === '3' && c.suit === '♣');

      if (has3 && !plays3)
        return socket.emit('errorMsg', 'must play 3♣');
    }

    if (!valid(cards))
      return socket.emit('errorMsg', 'invalid combo');

    if (!compare(cards, room.playedCards))
      return socket.emit('errorMsg', 'too weak');

    // REMOVE CARDS
    cards.forEach(c => {
      const i = player.hand.findIndex(p => p.value === c.value && p.suit === c.suit);
      if (i !== -1) player.hand.splice(i, 1);
    });

    room.playedCards = cards;

    room.players.forEach(p => {
      if (p.id !== socket.id) p.passed = false;
    });

    // WIN
    if (player.hand.length === 0) {
      io.to(roomId).emit('gameWon', { winner: player.name });

      setTimeout(() => newRound(room), 3000);
      return;
    }

    room.firstMove = false;

    next(room);

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

    if (room.players[room.currentTurnIndex].id !== socket.id)
      return;

    if (!room.playedCards.length)
      return socket.emit('errorMsg', 'cannot pass first turn');

    player.passed = true;

    next(room);

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

});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log('running on', PORT);
});