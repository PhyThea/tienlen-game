// =================================================================
// server_kate.js (កំណែទម្រង់កែសម្រួលច្បាប់ ឡងសងគូទ តាមការណែនាំពិតប្រាកដ)
// =================================================================

module.exports = (io, ktRooms, broadcastRoomLists, tlModule, ktModule) => {

    io.on('connection', (socket) => {

        // ព្រឹត្តិការណ៍៖ បង្កើតបន្ទប់លេងកាតេ (Create Room)
        socket.on('kt_createRoom', ({ roomId, password, playerName }) => {
            if (ktRooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
            ktRooms[roomId] = {
                roomId, password: password || "", status: 'waiting', creatorId: socket.id,
                players: [{ id: socket.id, name: playerName || 'អ្នកលេង ១', hand: [], isSpectator: false, hasCat: false, winRounds: 0, finalWinner: false, initialHandCopy: [], isTiv: false, validKopRound5: false }],
                currentTurnIndex: 0, currentRound: 1, tableCards: [], roundSuit: null, lastWinnerId: null, finalSuit: null
            };
            socket.join('kt_' + roomId);
            socket.emit('roomCreated', { roomId, playerId: socket.id });
            io.to('kt_' + roomId).emit('updatePlayers', ktRooms[roomId].players);
            
            io.to('kt_' + roomId).emit('voice_users_list', []);
            broadcastRoomLists();
        });

        // ព្រឹត្តិការណ៍៖ ចូលរួមបន្ទប់ (Join Room)
        socket.on('kt_joinRoom', ({ roomId, password, playerName }) => {
            const room = ktRooms[roomId];
            if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់នេះទេ!');
            if (room.status !== 'waiting') return socket.emit('errorMsg', 'ហ្គេមកំពុងលេង មិនអាចចូលបានទេ!');
            if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');
            if (room.players.length >= 6) return socket.emit('errorMsg', 'បន្ទប់នេះពេញហើយ (អតិបរមា ៦ នាក់)!');

            room.players.push({ id: socket.id, name: playerName || ('អ្នកលេង ' + (room.players.length + 1)), hand: [], isSpectator: false, hasCat: false, winRounds: 0, finalWinner: false, initialHandCopy: [], isTiv: false, validKopRound5: false });
            socket.join('kt_' + roomId);
            socket.emit('roomJoined', { roomId, playerId: socket.id });
            io.to('kt_' + roomId).emit('updatePlayers', room.players);
            
            broadcastRoomLists();
        });

        // ព្រឹត្តិការណ៍៖ ចាប់ផ្តើមហ្គេម (Start Game)
        socket.on('kt_startGame', ({ roomId }) => {
            const room = ktRooms[roomId];
            if (!room || room.creatorId !== socket.id) return;
            if (room.players.length < 2) return socket.emit('errorMsg', 'ត្រូវមានអ្នកលេងយ៉ាងតិច ២ នាក់!');

            room.status = 'playing';
            room.currentRound = 1;
            room.tableCards = [];
            room.roundSuit = null;
            room.finalSuit = null;

            const deck = ktModule.createDeck();
            room.players.forEach(p => {
                p.hand = deck.splice(0, 6);
                ktModule.sortHand(p.hand);
                p.initialHandCopy = [...p.hand]; 
                p.winRounds = 0;
                p.finalWinner = false;
                p.isTiv = false;
                p.isSpectator = false;
                p.validKopRound5 = false; // លុបដានចាស់ជុំទី៥ ចេញនៅដើមហ្គេម
                delete p.specialStatus;
            });

            let catPlayerIndex = ktModule.determineFirstTurn(room.players);
            if (catPlayerIndex === -1) catPlayerIndex = 0;
            room.currentTurnIndex = catPlayerIndex;
            room.lastWinnerId = room.players[catPlayerIndex].id;

            io.to('kt_' + roomId).emit('gameStarted', {
                players: room.players,
                currentTurn: room.players[room.currentTurnIndex].id
            });
            broadcastRoomLists();
        });

        // ព្រឹត្តិការណ៍៖ ចេញបៀរ ឬ គប់បៀរ (Play Card)
        socket.on('kt_playCard', ({ roomId, card, isTip }) => {
            const room = ktRooms[roomId];
            if (!room || room.status !== 'playing') return;

            const activePlayers = room.players.filter(p => !p.isSpectator && !p.isTiv);
            const player = room.players[room.currentTurnIndex];
            if (player.id !== socket.id) return;

            if (room.currentRound === 5 && isTip) {
                return socket.emit('errorMsg', 'ជុំទី៥ ជាវគ្គគប់បៀរ មិនអនុញ្ញាតឱ្យធីបទេ!');
            }

            if (isTip) {
                const cardIndex = player.hand.findIndex(c => c.suit === card.suit && c.value === card.value);
                if (cardIndex !== -1) player.hand.splice(cardIndex, 1);
                room.tableCards.push({ playerId: player.id, playerName: player.name, card: card, isTip: true });
            } else {
                const cardIndex = player.hand.findIndex(c => c.suit === card.suit && c.value === card.value);
                if (cardIndex !== -1) player.hand.splice(cardIndex, 1);

                if (room.tableCards.length === 0) {
                    room.roundSuit = card.suit;
                    if (room.currentRound === 5) {
                        room.finalSuit = card.suit; 
                    }
                }
                room.tableCards.push({ playerId: player.id, playerName: player.name, card: card, isTip: false });
            }

            let nextTurnIndex = room.currentTurnIndex;
            do {
                nextTurnIndex = (nextTurnIndex + 1) % room.players.length;
            } while ((room.players[nextTurnIndex].isSpectator || room.players[nextTurnIndex].isTiv) && nextTurnIndex !== room.currentTurnIndex);

            const playedCount = room.tableCards.length;

            if (playedCount === activePlayers.length) {
                setTimeout(() => {
                    let roundWinnerId = room.lastWinnerId; 

                    if (room.currentRound <= 4) {
                        let highestValue = -1;
                        room.tableCards.forEach(tc => {
                            if (!tc.isTip && tc.card.suit === room.roundSuit) {
                                const val = ktModule.getCardValue(tc.card.value);
                                if (val > highestValue) {
                                    highestValue = val;
                                    roundWinnerId = tc.playerId;
                                }
                            }
                        });

                        const winnerPlayer = room.players.find(p => p.id === roundWinnerId);
                        if (winnerPlayer) winnerPlayer.winRounds += 1;
                        room.lastWinnerId = roundWinnerId;

                        if (room.currentRound === 4) {
                            room.players.forEach(p => {
                                if (!p.isSpectator && p.winRounds === 0) {
                                    p.isTiv = true; 
                                }
                            });
                        }

                        room.currentTurnIndex = room.players.findIndex(p => p.id === roundWinnerId);
                        room.currentRound += 1;
                        room.tableCards = [];
                        room.roundSuit = null;

                        io.to('kt_' + roomId).emit('updateTurn', { 
                            currentTurn: room.players[room.currentTurnIndex].id, 
                            tableCards: [],
                            players: room.players 
                        });

                    } else if (room.currentRound === 5) {
                        // ==========================================
                        // វគ្គគប់បៀរ (ជុំទី៥)៖ កត់ត្រាដានអ្នកគប់ត្រូវទឹកមេ
                        // ==========================================
                        let highestValue = -1;
                        let hasValidKop = false;
                        const leaderIdRound5 = room.tableCards[0].playerId; // សម្គាល់មេជុំទី៥

                        room.tableCards.forEach(tc => {
                            // ឆែករកអ្នកណាខ្លះដែលគប់ត្រូវទឹកមេ (មិនរាប់មេខ្លួនឯង)
                            if (tc.playerId !== leaderIdRound5 && !tc.isTip && tc.card.suit === room.finalSuit) {
                                const p = room.players.find(x => x.id === tc.playerId);
                                if (p) p.validKopRound5 = true; // កត់ចំណាំទុកថា គាត់គប់ត្រូវទឹកមេជុំទី៥
                            }

                            if (!tc.isTip && tc.card.suit === room.finalSuit) {
                                const val = ktModule.getCardValue(tc.card.value);
                                if (val > highestValue) {
                                    highestValue = val;
                                    roundWinnerId = tc.playerId;
                                    hasValidKop = true;
                                }
                            }
                        });

                        if (!hasValidKop) {
                            roundWinnerId = room.tableCards[0].playerId; 
                        }
                        room.lastWinnerId = roundWinnerId;

                        room.currentTurnIndex = room.players.findIndex(p => p.id === roundWinnerId);
                        room.currentRound += 1;
                        room.tableCards = [];
                        room.roundSuit = null;

                        io.to('kt_' + roomId).emit('updateTurn', { 
                            currentTurn: room.players[room.currentTurnIndex].id, 
                            tableCards: [],
                            players: room.players 
                        });

                    } else if (room.currentRound === 6) {
                        // ==========================================
                        // វគ្គកាត់សេចក្តីចុងក្រោយ (ជុំទី៦)
                        // ==========================================
                        room.status = 'ended';

                        const leaderRound6 = room.tableCards[0];
                        const leaderCard6 = leaderRound6 ? leaderRound6.card : null;
                        const leaderId = leaderRound6 ? leaderRound6.playerId : room.lastWinnerId;

                        let finalWinnerId = leaderId; 
                        let ngeuyPlayers = []; 

                        if (leaderCard6) {
                            const leaderVal = ktModule.getCardValue(leaderCard6.value);
                            let highestChakKutVal = -1;
                            let highestChakKutPlayerId = null;

                            // រកអ្នកដែលចាក់គូទត្រូវទឹកមេ ហើយមានតម្លៃធំជាងមេ និងធំជាងគេ
                            room.tableCards.forEach(tc => {
                                if (tc.playerId !== leaderId && !tc.isTip) {
                                    if (tc.card.suit === leaderCard6.suit) {
                                        const playerVal = ktModule.getCardValue(tc.card.value);
                                        if (playerVal > leaderVal) {
                                            if (playerVal > highestChakKutVal) {
                                                highestChakKutVal = playerVal;
                                                highestChakKutPlayerId = tc.playerId;
                                            }
                                        }
                                    }
                                }
                            });

                            if (highestChakKutPlayerId) {
                                finalWinnerId = highestChakKutPlayerId; 
                            }

                            // វគ្គកំណត់ស្ថានភាព៖ ឡងសងគូទ ឬ ចាញ់ធម្មតា ឬ ងើយ
                            room.tableCards.forEach(tc => {
                                if (tc.playerId !== leaderId && !tc.isTip) {
                                    const p = room.players.find(x => x.id === tc.playerId);
                                    if (p) {
                                        if (tc.card.suit === leaderCard6.suit) {
                                            if (tc.playerId === finalWinnerId) {
                                                p.specialStatus = "ចាក់គូទត្រូវ";
                                            } else {
                                                // [កែសម្រួលលក្ខខណ្ឌច្បាប់ពិតប្រាកដ]
                                                // លុះត្រាតែជុំទី៥ បានគប់ត្រូវទឹកមេ ទើបជាប់ឈ្មោះថា "ឡងសងគូទ" បើមិនបានគប់ត្រូវទឹកទេ គឺចាញ់ធម្មតា
                                                if (p.validKopRound5) {
                                                    p.specialStatus = "ឡងសងគូទ";
                                                } else {
                                                    p.specialStatus = "ចាញ់ធម្មតា";
                                                }
                                            }
                                        } else {
                                            if (p.winRounds > 0) {
                                                ngeuyPlayers.push(tc.playerId);
                                            }
                                        }
                                    }
                                }
                            });
                        }

                        room.lastWinnerId = finalWinnerId;
                        const finalWinnerPlayer = room.players.find(p => p.id === room.lastWinnerId);
                        if (finalWinnerPlayer) finalWinnerPlayer.finalWinner = true;

                        const finalHandsResult = room.players.map(p => {
                            let pStatus = "";
                            if (p.id === room.lastWinnerId) {
                                pStatus = p.specialStatus === "ចាក់គូទត្រូវ" ? "🎉 ចាក់គូទត្រូវ (ឈ្នះមេ)" : "👑 អ្នកឈ្នះកាតេ";
                            } else if (p.specialStatus === "ឡងសងគូទ") {
                                pStatus = "🤦 ឡងសងគូទ";
                            } else if (p.specialStatus === "ចាញ់ធម្មតា") {
                                pStatus = "❌ ចាញ់គូទមេ (ចាញ់ធម្មតា)";
                            } else if (ngeuyPlayers.includes(p.id)) {
                                pStatus = "😮 ងើយហើយ (មានទឹកឈ្នះតែចាក់ខុសជុំ)";
                            }
                            
                            if (!pStatus) {
                                pStatus = p.isSpectator ? "❌ លង់ (អ្នកមើល)" : (p.isTiv ? "🖐️ ទីវហើយ (អត់បៀរស៊ី)" : "❌ ចាញ់គប់");
                            }
                            return {
                                id: p.id,
                                name: p.name,
                                initialHandCopy: p.initialHandCopy, 
                                winRounds: p.winRounds,
                                finalWinner: p.id === room.lastWinnerId,
                                isSpectator: p.isSpectator,
                                isTiv: p.isTiv,
                                lastCard: p.hand[0] || null, 
                                gameStatus: pStatus
                            };
                        });

                        io.to('kt_' + roomId).emit('gameWon', { 
                            winner: finalWinnerPlayer ? finalWinnerPlayer.name : 'គ្មានអ្នកឈ្នះ', 
                            winnerId: room.lastWinnerId, 
                            allHands: finalHandsResult 
                        });

                        room.tableCards = [];
                        room.roundSuit = null;
                        broadcastRoomLists();
                    }
                }, 1500);
            } else {
                room.currentTurnIndex = nextTurnIndex;
                io.to('kt_' + roomId).emit('updateTurn', { currentTurn: room.players[room.currentTurnIndex].id, tableCards: room.tableCards });
            }
        });

        // ព្រឹត្តិការណ៍៖ បោះបង់ហ្គេម (Reset Game)
        socket.on('kt_resetGame', ({ roomId }) => {
            const room = ktRooms[roomId];
            if (!room || room.creatorId !== socket.id) return;
            room.status = 'waiting';
            room.currentRound = 1;
            room.tableCards = [];
            room.roundSuit = null;
            room.finalSuit = null;
            room.players.forEach(p => {
                p.hand = [];
                p.initialHandCopy = [];
                p.winRounds = 0;
                p.finalWinner = false;
                p.isTiv = false;
                p.isSpectator = false;
                p.validKopRound5 = false;
                delete p.specialStatus;
            });
            io.to('kt_' + roomId).emit('gameReset', room.players);
            broadcastRoomLists();
        });

        // ប្រព័ន្ធ Voice Chat
        socket.on('voice_signal', (data) => {
            io.to(data.target).emit('voice_signal', { sender: socket.id, signal: data.signal });
        });

        socket.on('disconnect', () => {
            for (const roomId in ktRooms) {
                const room = ktRooms[roomId];
                const pIndex = room.players.findIndex(p => p.id === socket.id);
                if (pIndex !== -1) {
                    room.players.splice(pIndex, 1);
                    io.to('kt_' + roomId).emit('voice_user_left', socket.id);
                    if (room.players.length === 0) {
                        delete ktRooms[roomId];
                    } else {
                        if (room.creatorId === socket.id) {
                            room.creatorId = room.players[0].id;
                        }
                        if (room.status === 'playing') {
                            room.status = 'waiting';
                            io.to('kt_' + roomId).emit('errorMsg', 'មានអ្នកលេងចាកចេញ ហ្គេមត្រូវបានបង្កើតឡើងវិញ!');
                            io.to('kt_' + roomId).emit('gameReset', room.players);
                        }
                        io.to('kt_' + roomId).emit('updatePlayers', room.players);
                    }
                    broadcastRoomLists();
                    break;
                }
            }
        });

    });
};