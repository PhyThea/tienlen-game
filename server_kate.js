// =================================================================
// server_kate.js (កូដកែសម្រួល៖ លេងដោយដៃទាំងជុំទី៥ និងទី៦ - ដកអូតូចេញទាំងស្រុង)
// =================================================================

module.exports = (io, ktRooms, broadcastRoomLists, tlModule, ktModule) => {

    io.on('connection', (socket) => {

        // បង្កើតបន្ទប់លេងកាតេ
        socket.on('kt_createRoom', ({ roomId, password, playerName }) => {
            if (ktRooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
            ktRooms[roomId] = {
                roomId, password: password || "", status: 'waiting', creatorId: socket.id,
                players: [{ id: socket.id, name: playerName || 'អ្នកលេង ១', hand: [], isSpectator: false, hasCat: false, winRounds: 0, finalWinner: false, initialHandCopy: [], isTiv: false }],
                currentTurnIndex: 0, currentRound: 1, tableCards: [], roundSuit: null, lastWinnerId: null, finalSuit: null, round5WinnerId: null
            };
            socket.join('kt_' + roomId);
            socket.emit('roomCreated', { roomId, playerId: socket.id });
            io.to('kt_' + roomId).emit('updatePlayers', ktRooms[roomId].players);
            
            io.to('kt_' + roomId).emit('voice_user_joined', { id: socket.id });
            broadcastRoomLists();
        });

        // ចូលរួមបន្ទប់កាតេ (កំណែទម្រង់ការពារឈ្មោះស្ទួនពេល Rejoin)
        socket.on('kt_joinRoom', ({ roomId, password, playerName }) => {
            const room = ktRooms[roomId];
            if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់!');
            if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');

            // 🎯 ១. ឆែកពិនិត្យមើលថាតើឈ្មោះនេះមាននៅក្នុងបន្ទប់ស្រាប់ហើយឬនៅ (ករណីដាច់អ៊ីនធឺណិតហើយចូលវិញ)
            const existingPlayer = room.players.find(p => p.name === playerName);

            if (existingPlayer) {
                // បើមានឈ្មោះហ្នឹងស្រាប់ គឺគ្រាន់តែបច្ចុប្បន្នភាព Socket ID ថ្មីទៅឱ្យគាត់ជាការស្រេច (មិន Push ថែមទេ)
                existingPlayer.id = socket.id;
                socket.join('kt_' + roomId);
                socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator: existingPlayer.isSpectator });
                
                // ភ្ជាប់សំឡេងឡើងវិញ
                socket.to('kt_' + roomId).emit('voice_user_joined', { id: socket.id });
                room.players.forEach(p => { if(p.id !== socket.id) socket.emit('voice_initiate_peer', { target: p.id }); });

                io.to('kt_' + roomId).emit('updatePlayers', room.players);
                broadcastRoomLists();
                return; // បញ្ឈប់ការរត់ទៅមុខទៀត
            }

            // 🎯 ២. បើជាអ្នកលេងថ្មីពិតប្រាកដ ទើបឆែកលីមីត ៦ នាក់
            if (room.players.length >= 6) return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ (កាតេលីមីតត្រឹម ៦ នាក់)!');

            const isSpectator = (room.status === 'playing'); 
            
            socket.to('kt_' + roomId).emit('voice_user_joined', { id: socket.id });
            room.players.forEach(p => socket.emit('voice_initiate_peer', { target: p.id }));

            // បន្ថែមអ្នកលេងថ្មីចូល Array
            room.players.push({ id: socket.id, name: playerName || 'ភ្ញៀវ', hand: [], isSpectator, hasCat: false, winRounds: 0, finalWinner: false, initialHandCopy: [], isTiv: false });
            
            socket.join('kt_' + roomId);
            socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator });
            io.to('kt_' + roomId).emit('updatePlayers', room.players);
            broadcastRoomLists();
        });

        // ចាប់ផ្ដើមហ្គេម
        socket.on('kt_startGame', (roomId) => {
            const room = ktRooms[roomId]; if (!room) return;
            
            room.players.forEach((p, idx) => {
                p.isTiv = false;       
                p.winRounds = 0;       
                p.hasCat = false;      
                p.finalWinner = false; 
                if (idx < 6) p.isSpectator = false; else p.isSpectator = true; 
            });

            const activePlayers = room.players.filter(p => !p.isSpectator);
            if (activePlayers.length < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់ ទើបអាចលេងបាន!');

            const deck = tlModule.shuffleDeck(ktModule.createKateDeck());
            room.status = 'playing'; room.currentRound = 1; room.tableCards = []; room.roundSuit = null; room.finalSuit = null; room.round5WinnerId = null;
            
            activePlayers.forEach((p, i) => {
                p.hand = ktModule.sortKateCards(deck.slice(i * 6, (i + 1) * 6));
                p.initialHandCopy = [...p.hand]; 
            });

            room.players.forEach(p => { 
                if(!p.isSpectator) io.to(p.id).emit('dealCards', { hand: p.hand }); 
            });

            room.currentTurnIndex = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : room.players.findIndex(p => !p.isSpectator);
            if (room.currentTurnIndex === -1) room.currentTurnIndex = 0;
            
            io.to('kt_' + roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex, currentRound: room.currentRound, lastRoundWinnerId: room.lastWinnerId });
            broadcastRoomLists();
        });

        // ដំណើរការទម្លាក់បៀរដោយដៃ
        socket.on('kt_playMove', ({ roomId, action, card }) => {
            const room = ktRooms[roomId]; if (!room) return; 
            let player = room.players[room.currentTurnIndex]; if (player.id !== socket.id) return;

            const cardIdx = player.hand.findIndex(c => c.value === card.value && c.suit === card.suit);
            if (cardIdx === -1) return socket.emit('errorMsg', 'រកមិនឃើញសន្លឹកបៀរនេះនៅក្នុងដៃរបស់អ្នកឡើយ!');

            let verifiedAction = '';

            // ជុំទី ១ ដល់ ទី ៤
            if (room.currentRound <= 4) {
                if (room.tableCards.length === 0) {
                    room.roundSuit = card.suit;
                    verifiedAction = 'ស៊ីបៀរ';
                } else {
                    if (action === 'eat') { 
                        if (card.suit !== room.roundSuit) return socket.emit('errorMsg', `ទឹកបៀរមិនត្រឹមត្រូវ! ត្រូវតែចុច "🖐️ ផ្កាប់បៀរ (ធីប)"!`);
                        const sameSuitCards = room.tableCards.filter(m => m.action === 'ស៊ីបៀរ' && m.card.suit === room.roundSuit);
                        if (sameSuitCards.length > 0) {
                            sameSuitCards.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card));
                            if (ktModule.getKatePower(card) <= ktModule.getKatePower(sameSuitCards[0].card)) {
                                return socket.emit('errorMsg', `បៀររបស់អ្នកតូចជាងបៀរនៅលើតុ!`);
                            }
                        }
                        verifiedAction = 'ស៊ីបៀរ';
                    } else {
                        verifiedAction = 'ធីបហើយ';
                    }
                }
            } 
            // ជុំទី ៥ (វគ្គគប់បៀរទី៥)
            else if (room.currentRound === 5) {
                if (player.isTiv) return socket.emit('errorMsg', 'អ្នកបាន "ទីវ" ហើយ!');
                if (room.tableCards.length === 0) {
                    room.roundSuit = card.suit; 
                    room.finalSuit = card.suit; 
                    verifiedAction = 'គប់ទេ'; 
                } else {
                    const isMatch = (card.suit === room.finalSuit && ktModule.getKatePower(card) > ktModule.getKatePower(room.tableCards[0].card));
                    verifiedAction = isMatch ? 'គប់ហើយ' : 'អត់គប់ទេ';
                }
            }
            // ជុំទី ៦ (វគ្គទម្លាក់បៀរគូទដោយដៃផ្ទាល់)
            else if (room.currentRound === 6) {
                if (room.tableCards.length === 0) {
                    verifiedAction = 'ចេញគូទមេ'; // បៀរគូទសន្លឹកទី៦ របស់មេ
                } else {
                    // អ្នកលេងផ្សេងទៀតទម្លាក់បៀរគូទតាមវេន
                    if (card.suit === room.tableCards[0].card.suit && ktModule.getKatePower(card) > ktModule.getKatePower(room.tableCards[0].card)) {
                        verifiedAction = 'ចាក់គូទ';
                    } else {
                        verifiedAction = 'អត់គូទស៊ីទេ';
                    }
                }
            }

            room.tableCards.push({ playerId: player.id, name: player.name, card, action: verifiedAction });
            player.hand.splice(cardIdx, 1);

            if (room.currentRound === 4 && !player.hasCat && verifiedAction === 'ធីបហើយ') {
                player.isTiv = true;
            }

            io.to('kt_' + roomId).emit('moveRecorded', { by: player.name, action: verifiedAction, card, tableCards: room.tableCards, round: room.currentRound });
            io.to(player.id).emit('dealCards', { hand: player.hand }); 

            // ចំនួនអ្នកលេងដែលត្រូវលេងក្នុងជុំនេះ
            const requiredPlayersCount = room.players.filter(p => !p.isSpectator && !(room.currentRound >= 5 && p.isTiv)).length;

            if (room.tableCards.length < requiredPlayersCount) {
                let nextTurn = (room.currentTurnIndex + 1) % room.players.length;
                let attempts = 0;
                while (attempts < room.players.length) {
                    let pCheck = room.players[nextTurn];
                    let hasPlayed = room.tableCards.some(m => m.playerId === pCheck.id);
                    if (!pCheck.isSpectator && !(room.currentRound >= 5 && pCheck.isTiv) && !hasPlayed) break;
                    nextTurn = (nextTurn + 1) % room.players.length;
                    attempts++;
                }
                room.currentTurnIndex = nextTurn;
                
                if (room.status === 'playing') {
                    io.to('kt_' + roomId).emit('updatePlayers', room.players);
                    io.to('kt_' + roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players }); 
                }
            } 
            // បញ្ចប់ជុំនីមួយៗ
            else {
                setTimeout(() => {
                    let winMove = null;
                    if (room.currentRound <= 4) {
                        const validMoves = room.tableCards.filter(m => m.action === 'ស៊ីបៀរ' && m.card.suit === room.roundSuit);
                        winMove = validMoves.length > 0 ? validMoves.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card))[0] : room.tableCards[0];
                    } else if (room.currentRound === 5) {
                        const cutters = room.tableCards.filter(m => m.action === 'គប់ហើយ');
                        winMove = cutters.length > 0 ? cutters.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card))[0] : room.tableCards[0];
                    }

                    if (winMove && room.currentRound <= 5) {
                        const winnerPl = room.players.find(p => p.id === winMove.playerId);
                        if(winnerPl) {
                            winnerPl.winRounds++; 
                            if(room.currentRound <= 4) winnerPl.hasCat = true; 
                            room.lastWinnerId = winnerPl.id; 
                            room.currentTurnIndex = room.players.findIndex(p => p.id === winnerPl.id);
                            if (room.currentRound === 5) room.round5WinnerId = winnerPl.id; // រក្សាមេដែលឈ្នះជុំទី៥ ដើម្បីចេញបៀរមុនគេនៅជុំទី៦
                            io.to('kt_' + roomId).emit('winnerTransferred', { newWinnerId: room.lastWinnerId, creatorId: room.creatorId });
                        }
                    }

                    if (room.currentRound === 4) { 
                        room.players.forEach(p => { if (!p.isSpectator && !p.hasCat) p.isTiv = true; }); 
                    }

                    // បន្តទៅជុំបន្ទាប់ (ជុំទី ៥ ឬ ជុំទី ៦)
                    if (room.currentRound < 6) {
                        room.currentRound++; 
                        room.tableCards = []; 
                        room.roundSuit = null; 
                        
                        const survivors = room.players.filter(p => !p.isSpectator && !p.isTiv);
                        if (survivors.length === 1) {
                            room.status = 'waiting'; 
                            survivors[0].finalWinner = true;
                            room.lastWinnerId = survivors[0].id;
                            
                            const finalHandsResult = room.players.map(p => ({
                                id: p.id, name: p.name, initialHandCopy: p.initialHandCopy, winRounds: p.winRounds, finalWinner: p.id === survivors[0].id, isSpectator: p.isSpectator, 
                                lastCard: null, gameStatus: p.id === survivors[0].id ? '👑 ឈ្នះផ្ដាច់ (ស៊ីដាច់តុ)' : '❌ ចាញ់'
                            }));

                            let count = 5;
                            const countdownInterval = setInterval(() => {
                                io.to('kt_' + roomId).emit('gameCountdown', { seconds: count });
                                count--;
                                if (count < 0) {
                                    clearInterval(countdownInterval);
                                    io.to('kt_' + roomId).emit('gameWon', { winner: survivors[0].name, winnerId: survivors[0].id, allHands: finalHandsResult });
                                }
                            }, 1000);
                        } else { 
                            // ប្រសិនបើឡើងទៅជុំទី៦ ត្រូវកំណត់ឱ្យអ្នកឈ្នះជុំទី៥ (មេ) ជាអ្នកចេញបៀរគូទមុនគេ
                            if (room.currentRound === 6 && room.round5WinnerId) {
                                room.currentTurnIndex = room.players.findIndex(p => p.id === room.round5WinnerId);
                            }
                            io.to('kt_' + roomId).emit('nextRoundStarted', { currentRound: room.currentRound, winnerName: winMove ? winMove.name : 'គ្មាន', currentTurnIndex: room.currentTurnIndex, players: room.players }); 
                        }
                    } 
                    // ==========================================
                    // 🏆 គណនាលទ្ធផលចុងក្រោយនៅបញ្ចប់ជុំទី ៦ (កែសម្រួលថ្មី)
                    // ==========================================
                    else { 
                        room.status = 'waiting';
                        
                        const headKoutMove = room.tableCards[0]; // បៀរគូទសន្លឹកទី៦ របស់មេ
                        let songKoutPlayerMove = null;
                        
                        // ស្វែងរកអ្នកដែលបាន "ចាក់គូទ" ធំជាងមេ និងធំជាងគេបង្អស់
                        const validKoutMoves = room.tableCards.filter(m => m.action === 'ចាក់គូទ');
                        if (validKoutMoves.length > 0) {
                            validKoutMoves.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card));
                            songKoutPlayerMove = validKoutMoves[0];
                        }

                        let finalWinnerPlayer = null;
                        let resultStatusMap = {};

                        if (songKoutPlayerMove) {
                            // ករណីមានអ្នកចាក់គូទមេដាច់
                            finalWinnerPlayer = room.players.find(p => p.id === songKoutPlayerMove.playerId);
                            room.lastWinnerId = songKoutPlayerMove.playerId;
                            resultStatusMap[songKoutPlayerMove.playerId] = "👑 ឈ្នះ (ចាក់គូទត្រូវហើយ)";
                            resultStatusMap[headKoutMove.playerId] = "💔 ចាញ់ (ត្រូវគេចាក់គូទស៊ី)";
                        } else {
                            // ករណីគ្មានអ្នកចាក់គូទមេដាច់ទេ (មេឈ្នះ)
                            finalWinnerPlayer = room.players.find(p => p.id === headKoutMove.playerId);
                            room.lastWinnerId = headKoutMove.playerId;
                            
                            // ពិនិត្យមើលលក្ខខណ្ឌ ឡងសងគូទ៖
                            room.players.forEach(p => {
                                if (!p.isSpectator && p.id !== headKoutMove.playerId) {
                                    const pMove6 = room.tableCards.find(m => m.playerId === p.id);
                                    
                                    if (pMove6 && pMove6.action === 'អត់គូទស៊ីទេ' && pMove6.card.suit === headKoutMove.card.suit) {
                                        // 🚨 ផ្លាស់ប្ដូរពាក្យលទ្ធផលចាញ់ឱ្យលោតចំៗតាមការចង់បានរបស់អ្នក
                                        resultStatusMap[p.id] = "💔 ( ឡងសងគូទហើយ )";
                                    }
                                }
                            });
                            
                            // កំណត់ UI បង្ហាញលទ្ធផលជូនមេវិញ
                            if (Object.values(resultStatusMap).includes("💔 ( ឡងសងគូទហើយ )")) {
                                resultStatusMap[headKoutMove.playerId] = "👑 ឈ្នះ (ឡងសងគូទពេញលេញ)";
                            } else {
                                resultStatusMap[headKoutMove.playerId] = "👑 ឈ្នះ (ស៊ីឡងពេញលេញ)";
                            }
                        }

                        if (finalWinnerPlayer) finalWinnerPlayer.finalWinner = true;

                        // រៀបចំទិន្នន័យផ្ញើទៅកាន់ Client ទាំងអស់
                        const finalHandsResult = room.players.map(p => {
                            let pStatus = resultStatusMap[p.id];
                            if (!pStatus) {
                                pStatus = p.isSpectator ? "❌ លង់ (អ្នកមើល)" : (p.isTiv ? "🖐️ ទីវហើយ (អត់បៀរស៊ី)" : "❌ ចាញ់គប់");
                            }
                            const pMove6 = room.tableCards.find(m => m.playerId === p.id);
                            return {
                                id: p.id, name: p.name, initialHandCopy: p.initialHandCopy, winRounds: p.winRounds,
                                finalWinner: p.id === room.lastWinnerId, isSpectator: p.isSpectator, isTiv: p.isTiv,
                                lastCard: pMove6 ? pMove6.card : null, gameStatus: pStatus
                            };
                        });

                        let count = 5;
                        const countdownInterval = setInterval(() => {
                            io.to('kt_' + roomId).emit('gameCountdown', { seconds: count });
                            count--;
                            if (count < 0) {
                                clearInterval(countdownInterval);
                                io.to('kt_' + roomId).emit('gameWon', { 
                                    winner: finalWinnerPlayer ? finalWinnerPlayer.name : 'គ្មានអ្នកឈ្នះ', 
                                    winnerId: room.lastWinnerId, 
                                    allHands: finalHandsResult 
                                });
                                broadcastRoomLists();
                            }
                        }, 1000);
                    }
                }, 1500);
            }
        });

    });
};