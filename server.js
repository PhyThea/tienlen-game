// ===========================
// server.js (UPDATED - Full Version)
// ===========================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();

const server = http.createServer(app);

const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

const CARD_ORDER = [
    '3','4','5','6','7',
    '8','9','10','J',
    'Q','K','A','2'
];

function createDeck(){

    const suits = ['♠','♥','♦','♣'];

    const values = [
        '3','4','5','6','7',
        '8','9','10','J',
        'Q','K','A','2'
    ];

    const deck = [];

    for(const suit of suits){

        for(const value of values){

            deck.push({
                suit,
                value
            });
        }
    }

    return deck;
}

function shuffleDeck(deck){

    const shuffled = [...deck];

    for(let i = shuffled.length - 1; i > 0; i--){

        const j =
            Math.floor(
                Math.random() * (i + 1)
            );

        [shuffled[i], shuffled[j]] =
        [shuffled[j], shuffled[i]];
    }

    return shuffled;
}

function getCardPower(card){

    return CARD_ORDER.indexOf(card.value);
}

function sortCards(cards){

    return cards.sort((a,b)=>

        getCardPower(a) -
        getCardPower(b)
    );
}

function isStraight(cards){

    if(cards.length < 3){

        return false;
    }

    const sorted =
        [...cards].sort((a,b)=>

            getCardPower(a) -
            getCardPower(b)
        );

    for(let i = 1; i < sorted.length; i++){

        if(

            getCardPower(sorted[i]) !==
            getCardPower(sorted[i - 1]) + 1

        ){

            return false;
        }
    }

    return true;
}

// === UPDATED: Add Four Pairs detection ===
function getComboType(cards){

    if(cards.length === 1){

        return 'single';
    }

    const sameValue =
        cards.every(c=>

            c.value === cards[0].value
        );

    if(sameValue){

        if(cards.length === 2){

            return 'pair';
        }

        if(cards.length === 3){

            return 'triple';
        }

        if(cards.length === 4){

            return 'bomb';
        }
    }

    // === NEW: Check for Four Pairs (8 cards, 4 pairs) ===
    if(cards.length === 8){

        const counts = {};

        cards.forEach(c=>{

            counts[c.value] = (counts[c.value] || 0) + 1;
        });

        const values = Object.values(counts);

        if(values.length === 4 && values.every(v => v === 2)){

            return 'four_pairs';
        }
    }

    if(isStraight(cards)){

        return 'straight';
    }

    return null;
}

function isValidPlay(cards){

    return getComboType(cards) !== null;
}

// === UPDATED: Compare logic with special rules ===
function comparePlay(newCards, oldCards){

    if(!oldCards || oldCards.length === 0){

        return true;
    }

    const newType =
        getComboType(newCards);

    const oldType =
        getComboType(oldCards);

    // === SPECIAL RULE 1: Bomb beats Straight ===
    if(newType === 'bomb' && oldType === 'straight'){

        return true;
    }

    // === SPECIAL RULE 2: Four Pairs beats Straight ===
    if(newType === 'four_pairs' && oldType === 'straight'){

        return true;
    }

    // Normal comparison: must be same type and same length
    if(newType !== oldType){

        return false;
    }

    if(newCards.length !== oldCards.length){

        return false;
    }

    const newMax =
        Math.max(
            ...newCards.map(c=>
                getCardPower(c)
            )
        );

    const oldMax =
        Math.max(
            ...oldCards.map(c=>
                getCardPower(c)
            )
        );

    return newMax > oldMax;
}

function nextTurn(room){

    let tries = 0;

    do{

        room.currentTurnIndex =

            (room.currentTurnIndex + 1)
            %
            room.players.length;

        tries++;

    }while(

        room.players[
            room.currentTurnIndex
        ].passed

        &&

        tries < room.players.length
    );
}

// === NEW: Function to start a new round (for auto-restart) ===
function startNewRound(room){

    room.status = 'playing';

    room.winner = null;

    room.playedCards = [];

    room.isFirstMoveOfGame = true; // Reset flag for 3♣ rule

    const deck =
        shuffleDeck(
            createDeck()
        );

    room.players.forEach(
        (player,index)=>{

        player.hand =
            sortCards(

                deck.slice(
                    index * 13,
                    (index + 1) * 13
                )
            );

        player.passed = false;
    });

    // Find player with 3 of Clubs to start
    room.currentTurnIndex =
        room.players.findIndex(player=>

            player.hand.some(card=>

                card.value === '3' &&
                card.suit === '♣'
            )
        );

    if(room.currentTurnIndex === -1){

        room.currentTurnIndex = 0;
    }

    io.to(room.id).emit(
        'gameStarted',
        {

            players:
                room.players.map(p=>({

                id:p.id,

                name:p.name,

                cardCount:
                    p.hand.length
            })),

            currentTurnIndex:
                room.currentTurnIndex
        }
    );

    room.players.forEach(player=>{

        io.to(player.id).emit(
            'dealCards',
            {

                hand:player.hand
            }
        );
    });

    io.to(room.id).emit(
        'gameStatus',

        `🎯 វេន ${
            room.players[
                room.currentTurnIndex
            ].name
        } (មាន 3 កឺ)`
    );
}

io.on('connection',(socket)=>{

    console.log(
        'Connected:',
        socket.id
    );

    // CREATE ROOM

    socket.on(
        'createRoom',
        ({
            roomId,
            password,
            playerName
        })=>{

        if(rooms[roomId]){

            return socket.emit(
                'errorMsg',
                'បន្ទប់នេះមានស្រាប់'
            );
        }

        socket.join(roomId);

        rooms[roomId] = {

            players:[{

                id:socket.id,

                name:
                    playerName ||
                    'Player 1',

                hand:[],

                passed:false
            }],

            creatorId:socket.id, // === Store creator as Host ===

            password:
                password || null,

            maxPlayers:4,

            status:'waiting',

            currentTurnIndex:0,

            playedCards:[],

            winner:null,

            isFirstMoveOfGame:false // === NEW: Flag for 3♣ rule ===
        };

        socket.emit(
            'roomCreated',
            {

                roomId,

                playerId:socket.id
            }
        );

        io.to(roomId).emit(
            'updatePlayers',
            rooms[roomId].players
        );
    });

    // JOIN ROOM

    socket.on(
        'joinRoom',
        ({
            roomId,
            password,
            playerName
        })=>{

        const room = rooms[roomId];

        if(!room){

            return socket.emit(
                'errorMsg',
                'បន្ទប់មិនមាន'
            );
        }

        if(

            room.password &&
            room.password !== password

        ){

            return socket.emit(
                'errorMsg',
                'Password ខុស'
            );
        }

        if(

            room.players.length >=
            room.maxPlayers

        ){

            return socket.emit(
                'errorMsg',
                'បន្ទប់ពេញ'
            );
        }

        if(room.status !== 'waiting'){

            return socket.emit(
                'errorMsg',
                'ហ្គេមចាប់ផ្តើមហើយ'
            );
        }

        socket.join(roomId);

        room.players.push({

            id:socket.id,

            name:
                playerName ||
                `Player ${room.players.length+1}`,

            hand:[],

            passed:false
        });

        socket.emit(
            'roomJoined',
            {

                roomId,

                playerId:socket.id
            }
        );

        io.to(roomId).emit(
            'updatePlayers',
            room.players
        );
    });

    // START GAME - === Only Host can start ===

    socket.on(
        'startGame',
        (roomId)=>{

        const room = rooms[roomId];

        if(!room) return;

        // === CHECK: Only creator can start ===
        if(room.creatorId !== socket.id){

            return socket.emit(
                'errorMsg',
                'មានតែ Host ទេដែលអាចចាប់ផ្តើមហ្គេមបាន'
            );
        }

        if(room.players.length < 2){

            return socket.emit(
                'errorMsg',
                'ត្រូវការ 2 នាក់ឡើង'
            );
        }

        // === Start new round with all logic ===
        startNewRound(room);
    });

    // PLAY CARD - === With 3♣ validation ===

    socket.on(
        'playCard',
        ({
            roomId,
            cards
        })=>{

        const room = rooms[roomId];

        if(!room) return;

        if(room.status !== 'playing'){

            return;
        }

        const player =
            room.players.find(
                p=>p.id === socket.id
            );

        if(!player) return;

        if(

            room.players[
                room.currentTurnIndex
            ].id !== socket.id

        ){

            return socket.emit(
                'errorMsg',
                'មិនមែនវេនអ្នក'
            );
        }

        if(!cards || cards.length === 0){

            return socket.emit(
                'errorMsg',
                'ជ្រើសបៀសិន'
            );
        }

        // Validate cards are in hand
        for(const card of cards){

            const found =
                player.hand.find(c=>

                    c.value === card.value &&
                    c.suit === card.suit
                );

            if(!found){

                return socket.emit(
                    'errorMsg',
                    'បៀមិនត្រឹមត្រូវ'
                );
            }
        }

        // === NEW: 3♣ First Move Rule ===
        if(room.isFirstMoveOfGame){

            const has3Clubs =
                player.hand.some(c=>
                    c.value === '3' && c.suit === '♣'
                );

            const plays3Clubs =
                cards.some(c=>
                    c.value === '3' && c.suit === '♣'
                );

            if(has3Clubs && !plays3Clubs){

                return socket.emit(
                    'errorMsg',
                    'អ្នកមាន 3 កឺ ត្រូវតែចេញ 3 កឺមុនគេ!'
                );
            }
        }

        if(!isValidPlay(cards)){

            return socket.emit(
                'errorMsg',
                'ចុះមិនត្រូវក្បួន'
            );
        }

        if(

            !comparePlay(
                cards,
                room.playedCards
            )

        ){

            return socket.emit(
                'errorMsg',
                'បៀតូចជាង ឬខុសក្បួន'
            );
        }

        // Remove played cards from hand
        cards.forEach(card=>{

            const idx =
                player.hand.findIndex(c=>

                    c.value === card.value &&
                    c.suit === card.suit
                );

            if(idx !== -1){

                player.hand.splice(
                    idx,
                    1
                );
            }
        });

        room.playedCards = cards;

        // Reset passed status when someone plays
        room.players.forEach(p=>{

            if(p.id !== socket.id) p.passed = false;
        });

        // Check for winner
        if(player.hand.length === 0){

            room.winner = player.name;

            io.to(roomId).emit(
                'gameWon',
                {

                    winner:player.name
                }
            );

            // === AUTO RESTART: Start new round after 3 seconds ===
            setTimeout(()=>{

                startNewRound(room);

            }, 3000);

            return;
        }

        // Mark that first move is done
        if(room.isFirstMoveOfGame){

            room.isFirstMoveOfGame = false;
        }

        nextTurn(room);

        io.to(roomId).emit(
            'cardPlayed',
            {

                by:player.name,

                cards,

                currentTurnIndex:
                    room.currentTurnIndex,

                updatedHands:
                    room.players.map(p=>({

                    id:p.id,

                    name:p.name,

                    cardCount:
                        p.hand.length
                }))
            }
        );

        io.to(roomId).emit(
            'gameStatus',

            `🎯 វេន ${
                room.players[
                    room.currentTurnIndex
                ].name
            }`
        );
    });

    // PASS TURN

    socket.on(
        'passTurn',
        (roomId)=>{

        const room = rooms[roomId];

        if(!room) return;

        const player =
            room.players.find(
                p=>p.id === socket.id
            );

        if(!player) return;

        if(

            room.players[
                room.currentTurnIndex
            ].id !== socket.id

        ){

            return;
        }

        // Cannot pass on first move of a round
        if(!room.playedCards || room.playedCards.length === 0){

            return socket.emit(
                'errorMsg',
                'មិនអាច Pass នៅវេនដំបូងបានទេ'
            );
        }

        player.passed = true;

        nextTurn(room);

        const activePlayers =
            room.players.filter(
                p=>!p.passed
            );

        // If only 1 player left active, clear table for new round
        if(activePlayers.length <= 1){

            room.playedCards = [];

            room.players.forEach(p=>{

                p.passed = false;
            });

            io.to(roomId).emit(
                'clearTable'
            );

            io.to(roomId).emit(
                'gameStatus',
                '🔄 ជុំថ្មី! វេន ' +
                room.players[room.currentTurnIndex].name
            );
        }

        io.to(roomId).emit(
            'turnChanged',
            {

                currentTurnIndex:
                    room.currentTurnIndex
            }
        );

        io.to(roomId).emit(
            'gameStatus',

            `⏭️ ${
                player.name
            } pass`
        );
    });

    // DISCONNECT

    socket.on(
        'disconnect',
        ()=>{

        for(const roomId in rooms){

            const room = rooms[roomId];

            const playerIndex =
                room.players.findIndex(
                    p=>p.id === socket.id
                );

            if(playerIndex !== -1){

                const leftPlayer =
                    room.players[playerIndex];

                room.players.splice(
                    playerIndex,
                    1
                );

                io.to(roomId).emit(
                    'updatePlayers',
                    room.players
                );

                io.to(roomId).emit(
                    'gameStatus',

                    `❌ ${
                        leftPlayer.name
                    } left`
                );

                if(
                    room.players.length === 0
                ){

                    delete rooms[roomId];
                }

                break;
            }
        }
    });
});

const PORT =
    process.env.PORT || 3000;

server.listen(PORT,()=>{

    console.log(
        `✅ Server running on ${PORT}`
    );
});