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
    return (CARD_ORDER.indexOf(card.value) * 10) + SUIT_ORDER[card.suit];
}

function sortCards(cards) {
    return cards.sort((a, b) => getCardPower(a) - getCardPower(b));
}

function isConsecutivePairs(cards) {
    const len = cards.length;
    if (len < 4 || len % 2 !== 0) return false; 
    
    const sorted = sortCards([...cards]);
    
    for (let i = 0; i < len; i += 2) {
        if (sorted[i].value !== sorted[i+1].value) return false;
    }
    
    for (let i = 0; i < len - 2; i += 2) {
        const currentIdx = CARD_ORDER.indexOf(sorted[i].value);
        const nextIdx = CARD_ORDER.indexOf(sorted[i+2].value);
        
        if (sorted[i].value === '2' || sorted[i+2].value === '2') return false;
        if (nextIdx !== currentIdx + 1) return false;
    }
    
    return true;
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

    if (isConsecutivePairs(cards)) {
        if (len === 4) return 'double_pair'; 
        if (len === 6) return 'triple_pair'; 
        if (len === 8) return 'quad_pair';   
        return 'consec_pairs';
    }

    // 🛠️ ជួសជុលឡើងវិញ៖ លក្ខខណ្ឌពិនិត្យខ្សែ (Straight) ដែលដាច់កាលពីមុន
    let isStr = true;
    for (let i = 1; i < len; i++) {
        if (CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-1].value) + 1) isStr = false;
        if (sorted[i].value === '2' || sorted[i-1].value === '2') isStr = false; 
    }

    if (isStr && len >= 3) {
        const sameSuit = cards.every(c => c.suit === cards[0].suit);
        if (sameSuit) return 'straight_flush'; 
        return 'straight'; 
    }

    return null;
}

function comparePlay(newCards, oldCards) {
    if (!oldCards || oldCards.length === 0) return true;
    
    const newType = getComboType(newCards);
    const oldType = getComboType(oldCards);
    
    if (!newType) return false; 

    const sortedNew = sortCards([...newCards]);
    const sortedOld = sortCards([...oldCards]);
    
    const newMax = getCardPower(sortedNew[sortedNew.length - 1]);
    const oldMax = getCardPower(sortedOld[sortedOld.length - 1]);

    // ច្បាប់វាយកាត់បៀរ ២ (Single 2)
    if (oldType === 'single' && oldCards[0].value === '2') {
        if (newType === 'triple_pair' || newType === 'quad_pair' || newType === 'bomb') return true;
    }

    // ច្បាប់វាយកាត់បៀរគូ ២ (Pair 2)
    if (oldType === 'pair' && oldCards[0].value === '2') {
        if (newType === 'quad_pair' || newType === 'bomb') return true;
    }

    // ច្បាប់ប៊ុម (Bomb) កាត់ប៊ុម ឬកាត់គូរៀប
    if (oldType === 'bomb') {
        if (newType === 'bomb' && newMax > oldMax) return true;
        if (newType === 'quad_pair') return true;
    }

    // ៣ គូរៀប កាត់គ្នា ឬត្រូវប៊ុមកាត់
    if (oldType === 'triple_pair') {
        if (newType === 'triple_pair' && newMax > oldMax) return true;
        if (newType === 'quad_pair' || newType === 'bomb') return true;
    }

    // ៤ គូរៀប
    if (oldType === 'quad_pair') {
        if (newType === 'quad_pair' && newMax > oldMax) return true;
    }

    // ករណីប្រភេទ Combo ដូចគ្នា និងចំនួនសន្លឹកស្មើគ្នា គឺវាស់កម្លាំងសន្លឹកធំបំផុត
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
        let p = room.players[checkIndex];
        if (p && p.hand.length > 0 && !p.passed) {
            nextIndex = checkIndex;
            found = true;
            break;
        }
    }
    if (found) {
        room.currentTurnIndex = nextIndex;
    }
}

function handleTurnAndRoundStatus(room) {
    // ១. រកមើលចំនួនអ្នកលេងដែលមានបៀរ និងមិនទាន់បាន Pass ក្នុងជុំនេះ
    const activePlayersInRound = room.players.filter(p => p.hand.length > 0 && !p.passed);
    
    // ២. ពិនិត្យមើលថាតើអ្នកវាយចុងក្រោយបង្អស់ (Last Player) អស់បៀរពីដៃឬនៅ
    let lastPlayerIdx = room.players.findIndex(p => p.id === room.lastPlayerId);
    const isLastPlayerOut = (lastPlayerIdx !== -1 && room.players[lastPlayerIdx].hand.length === 0);

    // ៣. លក្ខខណ្ឌដាច់ទឹក (Reset ឡើងជុំថ្មី)
    const isRoundOver = isLastPlayerOut ? (activePlayersInRound.length === 0) : (activePlayersInRound.length <= 1);

    if (isRoundOver) {
        // សម្អាតបៀរនៅលើតុរបស់ Server
        room.playedCards = [];
        
        // 🔄 Reset ស្ថានភាពរបស់អ្នកលេងដែលនៅសល់បៀ ឱ្យលែងជាប់ Pass សម្រាប់ជុំថ្មី
        room.players.forEach(p => {
            if (p.hand.length > 0) p.passed = false;
        });

        // 🎯 កំណត់វេនអ្នកចុះបៀរថ្មី
        if (isLastPlayerOut) {
            // បើអ្នកស៊ីផ្តាច់ដាច់បៀរអស់ពីដៃ វេនត្រូវធ្លាក់ទៅលើអ្នកបន្ទាប់ (តាមលំដាប់កៅអី) ដែលនៅមានបៀរក្នុងដៃ
            let nextIndex = (lastPlayerIdx + 1) % room.players.length;
            while (room.players[nextIndex].hand.length === 0) {
                nextIndex = (nextIndex + 1) % room.players.length;
            }
            room.currentTurnIndex = nextIndex;
            // សំខាន់បំផុត៖ ត្រូវប្តូរម្ចាស់បៀរចុងក្រោយទៅឱ្យអ្នកវេនថ្មីនេះ ដើម្បីកុំឱ្យគាំង Logic កាត់បៀរ ២
            room.lastPlayerId = room.players[nextIndex].id;
        } else {
            // បើនៅមានបៀក្នុងដៃ គឺអ្នកស៊ីផ្តាច់នោះឯងជាអ្នកបានវេនចុះមុនគេក្នុងជុំថ្មី
            room.currentTurnIndex = lastPlayerIdx !== -1 ? lastPlayerIdx : room.currentTurnIndex;
        }

        // 📢 ផ្ញើសញ្ញាទៅប្រាប់ទូរសព្ទ/កុំព្យូទ័រទាំងអស់ឱ្យសម្អាតតុ និងបង្ហាញឈ្មោះអ្នកបានវេនថ្មី
        io.to(room.roomId).emit('clearTable', { nextPlayer: room.players[room.currentTurnIndex].name });
        
        // ធ្វើបច្ចុប្បន្នភាព Turn ទៅឱ្យគ្រប់គ្នាបានដឹង
        io.to(room.roomId).emit('turnChanged', { 
            currentTurnIndex: room.currentTurnIndex,
            players: room.players 
        });
    } else {
        // បើមិនទាន់ដាច់ទឹកទេ ហៅ Function រំលងវេនទៅអ្នកបន្ទាប់ធម្មតា
        moveToNextTurn(room);
    }
}

function broadcastRoomList() {
    const list = Object.keys(rooms).map(id => {
        return {
            roomId: id,
            playerCount: rooms[id].players.length,
            status: rooms[id].status,
            hasPassword: rooms[id].password && rooms[id].password !== "" ? true : false
        };
    });
    io.emit('roomList', list);
}

// =================================================================
    // 🎙️ ផ្នែកពេញលេញសម្រាប់ VOICE CHAT (WEBRTC SIGNALING)
    // =================================================================
    
    // ១. ទទួលសញ្ញាសំឡេង (Offer, Answer, ICE Candidate) ពីអ្នកលេងម្នាក់ ហើយបញ្ជូនទៅអ្នកលេងម្នាក់ទៀតចំៗ
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

    // មុខងារជំនួយសម្រាប់ប្រាប់ទៅកាន់អ្នកលេងផ្សេងទៀត (ដាក់ក្រៅ io.on បាន)
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

    // ដំណើរការ Server
    server.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });

    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់នេះទេ!');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

        const isSpectator = room.status === 'playing';

        room.players.push({ 
            id: socket.id, 
            name: playerName || 'Guest', 
            hand: [], 
            passed: false,
            isSpectator: isSpectator,
            rank: null
        });

        socket.join(roomId);
        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator });
        io.to(roomId).emit('updatePlayers', room.players);
        broadcastRoomList();
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        // 🛠️ ពិនិត្យលក្ខខណ្ឌសិទ្ធិចុច៖ 
        // - បើគ្មានអ្នកឈ្នះវគ្គមុន (វគ្គទី១)៖ ទាល់តែម្ចាស់បន្ទប់ (creatorId) ទើបចុចបាន
        // - បើមានអ្នកឈ្នះវគ្គមុន៖ ទាល់តែអ្នកឈ្នះវគ្គមុននោះ (lastWinnerId) ទើបចុចបាន
        if (!room.lastWinnerId) {
            if (room.creatorId !== socket.id) {
                return socket.emit('errorMsg', 'មានតែម្ចាស់បន្ទប់ទេដែលអាចចាប់ផ្ដើមហ្គេមបាន!');
            }
        } else {
            if (room.lastWinnerId !== socket.id) {
                return socket.emit('errorMsg', 'មានតែអ្នកជាប់លេខ ១ ទេដែលអាចចុចចាប់ផ្ដើមវគ្គថ្មីបាន!');
            }
        }

        // សម្អាតទិន្នន័យចាស់ដើម្បីរៀបចំចែកបៀរថ្មី
        room.players.forEach(p => {
            p.isSpectator = false;
            p.hand = [];
            p.passed = false;
            p.rank = null;
        });

        const playerCount = room.players.filter(p => !p.isSpectator).length;
        if (playerCount < 2) {
            return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់!');
        }

        // បង្កើតបៀរ និងលាយបៀរថ្មី
        const deck = shuffleDeck(createDeck());
        room.status = 'playing'; 
        room.playedCards = [];
        room.lastPlayerId = null;
        room.nextRank = 1; 
        
        // ចែកបៀរឱ្យអ្នកលេងម្នាក់ៗ ១៣ សន្លឹក
        room.players.forEach((p, i) => {
            p.hand = sortCards(deck.slice(i * 13, (i + 1) * 13));
            io.to(p.id).emit('dealCards', { hand: p.hand });
        });

        // កំណត់រកអ្នកលេងមុនគេ (Turn ទី១)
        let startingIndex = -1;
        if (room.lastWinnerId) {
            // បើមានអ្នកឈ្នះវគ្គមុន គឺលេខ ១ នោះជាអ្នកលេងមុនគេ
            startingIndex = room.players.findIndex(p => p.id === room.lastWinnerId);
        }
        if (startingIndex === -1) {
            // បើវគ្គដំបូងបង្អស់ គឺអ្នកណាមាន ៣ប៊ិច (3 ♠) ជាអ្នកលេងមុនគេ
            startingIndex = room.players.findIndex(p => p.hand.some(c => c.value === '3' && c.suit === '♠'));
        }
        if (startingIndex === -1) startingIndex = 0;

        room.currentTurnIndex = startingIndex;

        // ផ្ញើទៅកាន់ទូរស័ព្ទ/កុំព្យូទ័រទាំងអស់នៅក្នុងបន្ទប់ឱ្យដឹងថាហ្គេមចាប់ផ្ដើមហើយ
        io.to(roomId).emit('gameStarted', { 
            players: room.players, 
            currentTurnIndex: room.currentTurnIndex,
            lastRoundWinnerId: room.lastWinnerId
        });
        
        broadcastRoomList();
    });

    socket.on('playCard', ({ roomId, cards }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        
        if (!player || player.id !== socket.id) return socket.emit('errorMsg', 'មិនមែនវេនអ្នកទេ');
        if (player.hand.length === 0) return socket.emit('errorMsg', 'អ្នកអស់បៀហើយ មិនអាចចុះបានទៀតទេ!');

        if (getComboType(cards) && comparePlay(cards, room.playedCards)) {
            cards.forEach(c => {
                const idx = player.hand.findIndex(pc => pc.value === c.value && pc.suit === c.suit);
                if (idx !== -1) player.hand.splice(idx, 1);
            });

            room.playedCards = cards;
            room.lastPlayerId = socket.id;
            player.passed = false; 

            if (player.hand.length === 0) {
                player.rank = room.nextRank;
                room.nextRank++;
                
                if (player.rank === 1) {
                    room.lastWinnerId = player.id;
                }
            }

            const remainingActivePlayers = room.players.filter(p => p.hand.length > 0);

            if (remainingActivePlayers.length <= 1) {
                if (remainingActivePlayers.length === 1) {
                    remainingActivePlayers[0].rank = room.nextRank;
                }

                room.status = 'waiting'; 

                const results = room.players.map(p => ({ 
                    id: p.id,
                    name: p.name, 
                    remaining: [...p.hand], 
                    isSpectator: p.hand.length === 0 && p.rank !== null ? false : p.isSpectator,
                    rank: p.rank
                }));

                io.to(roomId).emit('cardPlayed', { 
                    by: player.name, 
                    cards, 
                    nextTurn: room.currentTurnIndex,
                    cardCount: player.hand.length,
                    updatedHands: room.players 
                });

                setTimeout(() => {
                    const finalWinner = room.players.find(p => p.rank === 1);
                    
                    // 🎯 ថែមបន្ទាត់នេះ ដើម្បីឱ្យ Server ចងចាំ ID អ្នកជាប់លេខ ១ សម្រាប់ផ្តល់សិទ្ធិវគ្គក្រោយ
                    room.lastWinnerId = finalWinner ? finalWinner.id : null;

                    io.to(roomId).emit('gameWon', { 
                        winner: finalWinner ? finalWinner.name : 'រកមិនឃើញ', 
                        winnerId: finalWinner ? finalWinner.id : null, 
                        allHands: results 
                    });
                    broadcastRoomList();
                }, 1500);

            } else {
                handleTurnAndRoundStatus(room);

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

    socket.on('passTurn', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return;

        player.passed = true;
        
        io.to(roomId).emit('playerPassed', { 
            name: player.name, 
            id: player.id,
            message: "Pass ❌"
        });
        
        handleTurnAndRoundStatus(room);
        io.to(roomId).emit('turnChanged', { 
            currentTurnIndex: room.currentTurnIndex,
            players: room.players 
        });
    });

    socket.on('leaveRoom', () => {
        for (const id in rooms) {
            const room = rooms[id];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                const wasSpectator = room.players[pIdx].isSpectator;
                room.players.splice(pIdx, 1);
                socket.leave(id); 
                socket.emit('leftRoom'); 
                if (room.players.length === 0) {
                    delete rooms[id]; 
                } else {
                    if (room.creatorId === socket.id) room.creatorId = room.players[0].id; 
                    if (room.status === 'playing' && !wasSpectator && room.currentTurnIndex === pIdx) {
                        handleTurnAndRoundStatus(room);
                        io.to(id).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex });
                    }
                    io.to(id).emit('updatePlayers', room.players);
                }
                broadcastRoomList();
            }
        }
    });

// =================================================================
// 🎙️ VOICE CHAT SYSTEM (WEBRTC PEER-TO-PEER)
// =================================================================
let localStream = null;
let peerConnections = {}; // រក្សាទុកការតភ្ជាប់ជាមួយអ្នកលេងផ្សេងៗ { socketId: RTCPeerConnection }
let isMicMuted = false;

// កំណត់ទម្រង់ទំនាក់ទំនង (ប្រើប្រាស់ Public STUN Server របស់ Google ដោយឥតគិតថ្លៃ)
const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// មុខងារទាមទារបើក Mic ពេលហ្គេមចាប់ផ្តើម
async function initVoiceChat() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        console.log("🎙️ ចាប់ផ្តើមប្រើប្រាស់ម៉ាយក្រូហ្វូនជោគជ័យ");
        
        // ប្រាប់ Server ថាខ្ញុំចង់បានបញ្ជីអ្នកនៅក្នុងបន្ទប់ដើម្បីតភ្ជាប់សំឡេង
        socket.emit('request-voice-peers', currentRoom);
    } catch (err) {
        console.error("❌ មិនអាចបើក Mic បានទេ៖ ", err);
        alert("ដើម្បីនិយាយគ្នាលេងបាន សូមអនុញ្ញាតឱ្យហ្គេមប្រើប្រាស់ Mic របស់អ្នក!");
    }
}

// ទទួលបញ្ជី ID អ្នកលេងចាស់ៗ ដើម្បីបង្កើតការ Call ទៅកាន់ពួកគាត់
socket.on('voice-peers-list', async (peerIds) => {
    for (const peerId of peerIds) {
        createPeerConnection(peerId, true);
    }
});

// ទទួលសញ្ញា Call ចូល ឬឆ្លើយតបពីអ្នកដទៃ
socket.on('voice-signal', async ({ signal, from }) => {
    if (!peerConnections[from]) {
        createPeerConnection(from, false);
    }
    
    const pc = peerConnections[from];
    if (signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        if (signal.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('voice-signal', { roomId: currentRoom, to: from, signal: { sdp: pc.localDescription }, from: myId });
        }
    } else if (signal.ice) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.ice));
    }
});

// បង្កើតការតភ្ជាប់ WebRTC រវាងទូរស័ព្ទយើង និងទូរស័ព្ទដៃគូ
function createPeerConnection(peerId, isInitiator) {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[peerId] = pc;

    // បញ្ជូនសំឡេងរបស់យើងទៅកាន់ដៃគូ
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    // បង្កើតផ្លូវបញ្ជូនទិន្នន័យបណ្តាញ (ICE Candidate)
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('voice-signal', { roomId: currentRoom, to: peerId, signal: { ice: event.candidate }, from: myId });
        }
    };

    // ពេលទទួលបានរលកសំឡេងពីដៃគូ ត្រូវបង្កើតកាសស្តាប់បង្កប់ក្នុងទូរស័ព្ទដើម្បីបន្លឺសំឡេងចេញមក
    pc.ontrack = (event) => {
        let audioEl = document.getElementById(`audio-${peerId}`);
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = `audio-${peerId}`;
            audioEl.autoplay = true;
            document.body.appendChild(audioEl);
        }
        audioEl.srcObject = event.streams[0];
    };

    // បើជាអ្នកចូលថ្មី (Initiator) ត្រូវបង្កើតការ Offer ហៅទៅមុន
    if (isInitiator) {
        pc.onnegotiationneeded = async () => {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('voice-signal', { roomId: currentRoom, to: peerId, signal: { sdp: pc.localDescription }, from: myId });
        };
    }
}

// មុខងារ បិទ/បើក សំឡេងខ្លួនឯង (Mute/Unmute)
function toggleMic() {
    if (!localStream) return alert("មិនទាន់មានការអនុញ្ញាតឱ្យប្រើ Mic ឡើយ!");
    
    isMicMuted = !isMicMuted;
    localStream.getAudioTracks().forEach(track => track.enabled = !isMicMuted);
    
    const micBtn = document.getElementById('micBtn');
    if (isMicMuted) {
        micBtn.innerText = "🔇 Mic: Off";
        micBtn.style.background = "#ef4444"; // ប្តូរពណ៌ក្រហមពេលបិទ
    } else {
        micBtn.innerText = "🎙️ Mic: On";
        micBtn.style.background = "#ea580c"; // ពណ៌ទឹកក្រូចពេលបើក
    }
}

// ✂️ ស្វែងរក និងលុបដុំកូដនេះចោលចេញពី server.js៖
function closeAllVoiceConnections() {
    for (const id in peerConnections) {
        if (peerConnections[id]) peerConnections[id].close(); 
        const audioEl = document.getElementById(`audio-${id}`);
        if (audioEl) audioEl.remove();
    }
    peerConnections = {};
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    isMicMuted = false;
    const micBtn = document.getElementById('globalMicBtn'); 
    if (micBtn) {
        micBtn.innerText = "🎙️ Mic: On";
        micBtn.style.background = "#ea580c";
    }
}


socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        // 🎙️ ថែមបន្ទាត់នេះ៖ ប្រាប់គេឯងឱ្យផ្តាច់ Voice Chat ពីបុគ្គលនេះ
        notifyVoicePeerDisconnect(socket.id);

        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                const player = room.players[playerIndex];
                room.players.splice(playerIndex, 1);
                
                if (room.hostId === socket.id && room.players.length > 0) {
                    room.hostId = room.players[0].id;
                }
                
                io.to(roomId).emit('roomUpdated', room);
                
                if (room.players.length === 0) {
                    delete rooms[roomId];
                }
                break;
            }
        }
    });

server.listen(3000, () => console.log('Server is running on port 3000'));