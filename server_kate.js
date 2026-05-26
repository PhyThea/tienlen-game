// =================================================================
// server_kate.js (កំណែទម្រង់ពេញលេញ៖ ជួសជុលការបង្ហាញទីវភ្លាមៗ និងច្បាប់គូទស៊ីមេ)
// =================================================================

module.exports = (io, ktRooms, broadcastRoomLists, tlModule, ktModule) => {

    io.on('connection', (socket) => {

        // ព្រឹត្តិការណ៍៖ បង្កើតបន្ទប់លេងកាតេ (Create Room)
        socket.on('kt_createRoom', ({ roomId, password, playerName }) => {
            if (ktRooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
            ktRooms[roomId] = {
                roomId, password: password || "", status: 'waiting', creatorId: socket.id,
                players: [{ id: socket.id, name: playerName || 'អ្នកលេង ១', hand: [], isSpectator: false, hasCat: false, winRounds: 0, finalWinner: false, initialHandCopy: [], isTiv: false }],
                currentTurnIndex: 0, currentRound: 1, tableCards: [], roundSuit: null, lastWinnerId: null, finalSuit: null
            };
            socket.join('kt_' + roomId);
            socket.emit('roomCreated', { roomId, playerId: socket.id });
            io.to('kt_' + roomId).emit('updatePlayers', ktRooms[roomId].players);
            
            io.to('kt_' + roomId).emit('voice_user_joined', { id: socket.id });
            broadcastRoomLists();
        });

        // ព្រឹត្តិការណ៍ចូលរួមបន្ទប់ កំហិត ៦ នាក់
        socket.on('kt_joinRoom', ({ roomId, password, playerName }) => {
            const room = ktRooms[roomId];
            if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់!');
            if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');
            
            if (room.players.length >= 6) return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ (កាតេលីមីតត្រឹម ៦ នាក់)!');

            const isSpectator = (room.status === 'playing'); 
            
            socket.to('kt_' + roomId).emit('voice_user_joined', { id: socket.id });
            room.players.forEach(p => socket.emit('voice_initiate_peer', { target: p.id }));

            room.players.push({ id: socket.id, name: playerName || 'ភ្ញៀវ', hand: [], isSpectator, hasCat: false, winRounds: 0, finalWinner: false, initialHandCopy: [], isTiv: false });
            
            socket.join('kt_' + roomId);
            socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator });
            io.to('kt_' + roomId).emit('updatePlayers', room.players);
            broadcastRoomLists();
        });

        socket.on('kt_startGame', (roomId) => {
            const room = ktRooms[roomId]; if (!room) return;

            const allowedPlayerId = room.lastWinnerId ? room.lastWinnerId : room.creatorId;
            if (socket.id !== allowedPlayerId) {
                return socket.emit('errorMsg', 'មានតែម្ចាស់ជ័យជម្នះវគ្គមុនប៉ុណ្ណោះ ទើបមានសិទ្ធិចាប់ផ្តើមវគ្គថ្មី!');
            }
            room.players.forEach((p, idx) => {
                if (idx < 6) {
                    p.isSpectator = false;
                    p.isTiv = false; 
                } else {
                    p.isSpectator = true; 
                }
                p.hasCat = false;
                p.winRounds = 0;
                p.finalWinner = false;
                p.hand = [];
                p.initialHandCopy = [];
            });

            const activePlayers = room.players.filter(p => !p.isSpectator);
            if (activePlayers.length < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់ ទើបអាចលេងបាន!');

            const deck = tlModule.shuffleDeck(ktModule.createKateDeck());
            room.status = 'playing'; room.currentRound = 1; room.tableCards = []; room.roundSuit = null; room.finalSuit = null;
            
            activePlayers.forEach((p, i) => {
                p.hand = ktModule.sortKateCards(deck.slice(i * 6, (i + 1) * 6));
                p.initialHandCopy = [...p.hand]; 
            });

            room.players.forEach(p => { 
                if(!p.isSpectator) {
                    io.to(p.id).emit('dealCards', { hand: p.hand }); 
                }
            });

            room.currentTurnIndex = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : room.players.findIndex(p => !p.isSpectator);
            if (room.currentTurnIndex === -1 || room.players[room.currentTurnIndex].isSpectator) {
                room.currentTurnIndex = room.players.findIndex(p => !p.isSpectator);
            }
            
            io.to('kt_' + roomId).emit('gameStarted', { 
                players: room.players, 
                currentTurnIndex: room.currentTurnIndex, 
                currentRound: room.currentRound, 
                lastRoundWinnerId: room.lastWinnerId 
            });
            
            broadcastRoomLists();
        });

        // ព្រឹត្តិការណ៍៖ ដំណើរការទម្លាក់បៀរ (Play Move)
        socket.on('kt_playMove', ({ roomId, action, card }) => {
            const room = ktRooms[roomId]; if (!room) return; 
            let player = room.players[room.currentTurnIndex]; if (player.id !== socket.id) return;

            const cardIdx = player.hand.findIndex(c => c.value === card.value && c.suit === card.suit);
            if (cardIdx === -1) return socket.emit('errorMsg', 'រកមិនឃើញសន្លឹកបៀរនេះនៅក្នុងដៃរបស់អ្នកឡើយ!');

            let verifiedAction = '';

            // ==========================================
            // ជុំទី ១ ដល់ ទី ៤ (វគ្គដេញទឹកស៊ី)
            // ==========================================
            if (room.currentRound <= 4) {
                if (room.tableCards.length === 0) {
                    room.roundSuit = card.suit;
                    verifiedAction = 'ស៊ីបៀរ';
                } else {
                    if (action === 'eat') { 
                        if (card.suit !== room.roundSuit) {
                            return socket.emit('errorMsg', `ទឹកបៀរមិនត្រឹមត្រូវ! លើតុបច្ចុប្បន្នគឺទឹក [ ${room.roundSuit} ]។ ត្រូវតែចុច "🖐️ ផ្កាប់បៀរ (ធីប)"!`);
                        }
                        
                        const sameSuitCards = room.tableCards.filter(m => m.action === 'ស៊ីបៀរ' && m.card.suit === room.roundSuit);
                        if (sameSuitCards.length > 0) {
                            sameSuitCards.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card));
                            const highestCardOnTable = sameSuitCards[0].card;
                            if (ktModule.getKatePower(card) <= ktModule.getKatePower(highestCardOnTable)) {
                                return socket.emit('errorMsg', `បៀររបស់អ្នកតូចជាងបៀរនៅលើតុ! ត្រូវតែចុច "🖐️ ផ្កាប់បៀរ (ធីប)"!`);
                            }
                        }
                        verifiedAction = 'ស៊ីបៀរ';
                    } else if (action === 'fold') {
                        verifiedAction = 'ធីបហើយ';
                    }
                }
            } 
            // ==========================================
            // ជុំទី ៥៖ វគ្គគប់បៀរទី៥
            // ==========================================
            else if (room.currentRound === 5) {
                if (player.isTiv) return socket.emit('errorMsg', 'អ្នកបាន "ទីវ" ហើយ មិនអាចលេងក្នុងជុំនេះបានទេ!');

                if (room.tableCards.length === 0) {
                    room.roundSuit = card.suit; 
                    room.finalSuit = card.suit; 
                    verifiedAction = 'គប់ទេ'; 
                } else {
                    const firstMove = room.tableCards[0];
                    const isMatch = (card.suit === room.finalSuit && ktModule.getKatePower(card) > ktModule.getKatePower(firstMove.card));
                    verifiedAction = isMatch ? 'គប់ហើយ' : 'អត់គប់ទេ';
                }
            }

            room.tableCards.push({ playerId: player.id, name: player.name, card, action: verifiedAction });
            player.hand.splice(cardIdx, 1);

            io.to('kt_' + roomId).emit('moveRecorded', { by: player.name, action: verifiedAction, card, tableCards: room.tableCards, round: room.currentRound });
            io.to(player.id).emit('dealCards', { hand: player.hand }); 

            const requiredPlayersCount = room.players.filter(p => !p.isSpectator && !(room.currentRound === 5 && p.isTiv)).length;

            if (room.tableCards.length < requiredPlayersCount) {
                let nextTurn = (room.currentTurnIndex + 1) % room.players.length;
                let attempts = 0;
                
                while (attempts < room.players.length) {
                    let pCheck = room.players[nextTurn];
                    let hasPlayedInThisRound = room.tableCards.some(m => m.playerId === pCheck.id);
                    
                    if (!pCheck.isSpectator && !(room.currentRound === 5 && pCheck.isTiv) && !hasPlayedInThisRound) {
                        break;
                    }
                    nextTurn = (nextTurn + 1) % room.players.length;
                    attempts++;
                }
                room.currentTurnIndex = nextTurn;
                
                if (room.status === 'playing') {
                    io.to('kt_' + roomId).emit('updatePlayers', room.players);
                    io.to('kt_' + roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players }); 
                }
            } 
            else {
                let delayTime = 1500; 
                if (room.currentRound === 5) {
                    delayTime = 5000; 
                    io.to('kt_' + roomId).emit('kt_startCountdown', 5); 
                }

                setTimeout(() => {
                    let winMove = null;
                    if (room.currentRound <= 4) {
                        const validMoves = room.tableCards.filter(m => m.action === 'ស៊ីបៀរ' && m.card.suit === room.roundSuit);
                        if (validMoves.length > 0) {
                            validMoves.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card));
                            winMove = validMoves[0];
                        } else {
                            winMove = room.tableCards[0]; 
                        }
                    } else if (room.currentRound === 5) {
                        const cutters = room.tableCards.filter(m => m.action === 'គប់ហើយ');
                        if (cutters.length > 0) { 
                            cutters.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card)); 
                            winMove = cutters[0]; 
                        } else { 
                            winMove = room.tableCards[0]; 
                        }
                    }

                    if (winMove) {
                        const winnerPl = room.players.find(p => p.id === winMove.playerId);
                        if(winnerPl) {
                            winnerPl.winRounds++; 
                            if(room.currentRound <= 4) winnerPl.hasCat = true; 
                            room.lastWinnerId = winnerPl.id; 
                            room.currentTurnIndex = room.players.findIndex(p => p.id === winnerPl.id);
                            io.to('kt_' + roomId).emit('winnerTransferred', { newWinnerId: room.lastWinnerId, creatorId: room.creatorId });
                        }
                    }

                    // 🛠️ ចំណុចទី ២៖ ឆែកនិងកំណត់ "ទីវ" ភ្លាមៗនៅចុងជុំនីមួយៗ (ចាប់ពីជុំទី១ ដល់ ទី៤)
                    if (room.currentRound <= 4) { 
                        room.players.forEach(p => { 
                            if (!p.isSpectator && !p.hasCat) {
                                p.isTiv = true; 
                            }
                        }); 
                    }

                    if (room.currentRound < 5) {
                        room.currentRound++; 
                        room.tableCards = []; 
                        room.roundSuit = null; 
                        
                        const survivors = room.players.filter(p => !p.isSpectator && !p.isTiv);
                        
                        if (survivors.length === 1) {
                            room.status = 'waiting'; 
                            survivors[0].finalWinner = true;
                            room.lastWinnerId = survivors[0].id;
                            
                            const finalHandsResult = room.players.map(p => ({
                                id: p.id, name: p.name, initialHandCopy: p.initialHandCopy, winRounds: p.winRounds, finalWinner: p.id === survivors[0].id, isSpectator: p.isSpectator, lastCard: p.hand[0] || null, gameStatus: p.id === survivors[0].id ? '👑 ឈ្នះផ្ដាច់ (ស៊ីដាច់តុ)' : (p.isTiv ? '🖐️ ទីវហើយ (ចាញ់)' : '❌ ចាញ់')
                            }));
                            io.to('kt_' + roomId).emit('gameWon', { winner: survivors[0].name, winnerId: survivors[0].id, creatorId: room.creatorId, allHands: finalHandsResult });
                        } else { 
                            // ផ្ញើបច្ចុប្បន្នភាពទៅកាន់ client ដើម្បីអោយឃើញស្ថានភាព "ទីវ" ភ្លាមៗនៅលើតុលេង
                            io.to('kt_' + roomId).emit('nextRoundStarted', { 
                                currentRound: room.currentRound, 
                                winnerName: winMove ? winMove.name : 'គ្មាន', 
                                currentTurnIndex: room.currentTurnIndex, 
                                players: room.players 
                            }); 
                        }
                    }
                    // ==============================================================
                    // 🏆 ជុំទី ៥៖ វគ្គគណនាច្បាប់ ងើយ និង ចាក់គូទស៊ីមេ / ឡងសងគូទ 
                    // ==============================================================
                    else { 
                        room.status = 'waiting';
                        
                        const meMove = room.tableCards[0]; // បៀរទី៥ របស់មេ (អ្នកចេញមុនគេ)
                        const mePlayer = room.players.find(p => p.id === meMove.playerId);
                        const meLastCard = mePlayer ? mePlayer.hand[0] : null; // បៀរទី៦ (បៀរគូទ) របស់មេ

                        let resultStatusMap = {};
                        let ngeuyPlayers = [];
                        let songKoutPlayers = [];
                        let winKoutPlayers = []; // អ្នកដែលចាក់គូទត្រូវហើយធំជាងមេ

                        room.tableCards.forEach((m, idx) => {
                            if (idx === 0) return; // រំលងមេ

                            const targetPlayer = room.players.find(p => p.id === m.playerId);
                            if (targetPlayer && targetPlayer.isTiv) return;

                            const playerLastCard = targetPlayer ? targetPlayer.hand[0] : null; // សន្លឹកទី៦

                            if (meLastCard) {
                                // 🛠️ ច្បាប់ងើយ (រក្សាទុកដដែល)
                                if (m.action === 'អត់គប់ទេ') {
                                    if (m.card.suit === meLastCard.suit && 
                                        ktModule.getKatePower(m.card) > ktModule.getKatePower(meLastCard)) {
                                        ngeuyPlayers.push(m.playerId);
                                    }
                                }
                                // 🛠️ ពិនិត្យសន្លឹកទី៦ (គូទ) ចំពោះអ្នកដែលបានគប់ជុំទី៥
                                else if (m.action === 'គប់ហើយ') {
                                    if (playerLastCard && playerLastCard.suit === meLastCard.suit) {
                                        if (ktModule.getKatePower(playerLastCard) > ktModule.getKatePower(meLastCard)) {
                                            // ចាក់គូទត្រូវហើយធំជាងមេ -> ឈ្នះមេ
                                            winKoutPlayers.push(m.playerId);
                                        } else if (ktModule.getKatePower(playerLastCard) < ktModule.getKatePower(meLastCard)) {
                                            // ត្រូវទឹកគូទមេ តែតូចជាងមេ -> ឡងសងគូទ
                                            songKoutPlayers.push(m.playerId);
                                        }
                                    }
                                }
                            }
                        });

                        // ស្វែងរកម្ចាស់ជ័យជម្នះចុងក្រោយតាមច្បាប់ចាក់គូទ
                        let finalWinnerPlayer = null;
                        
                        if (winKoutPlayers.length > 0) {
                            // បើមានអ្នកចាក់គូទស៊ីមេច្រើននាក់ យកអ្នកមានគូទធំជាងគេបង្អស់
                            winKoutPlayers.sort((a, b) => {
                                const pA = room.players.find(p => p.id === a).hand[0];
                                const pB = room.players.find(p => p.id === b).hand[0];
                                return ktModule.getKatePower(pB) - ktModule.getKatePower(pA);
                            });
                            finalWinnerPlayer = room.players.find(p => p.id === winKoutPlayers[0]);
                        } else {
                            // បើគ្មានអ្នកចាក់គូទស៊ីមេទេ គឺបានទៅលើអ្នកឈ្នះជុំទី៥ ដដែល (មេ ឬ អ្នកគប់ដាច់)
                            finalWinnerPlayer = room.players.find(p => p.id === winMove.playerId);
                        }

                        // កំណត់ Status បង្ហាញលទ្ធផលផ្អែកលើការគណនាខាងលើ
                        room.players.forEach(p => {
                            if (p.isSpectator) {
                                resultStatusMap[p.id] = "❌ លង់ (អ្នកមើល)";
                            } else if (p.isTiv) {
                                resultStatusMap[p.id] = "🖐️ ទីវហើយ (អត់បៀរស៊ី)";
                            } else if (p.id === finalWinnerPlayer.id) {
                                if (winKoutPlayers.includes(p.id)) {
                                    resultStatusMap[p.id] = "👑 ឈ្នះ (ចាក់គូទត្រូវហើយ)";
                                } else {
                                    resultStatusMap[p.id] = "👑 ឈ្នះ (ស៊ីឡងពេញលេញ)";
                                }
                            } else if (ngeuyPlayers.includes(p.id)) {
                                resultStatusMap[p.id] = "😮 ងើយហើយ (បៀរត្រូវឈ្នះបែរជាចោលជុំទី៥)";
                            } else if (songKoutPlayers.includes(p.id)) {
                                resultStatusMap[p.id] = "💔 ឡងសងគូទ (ចាញ់បៀរគូទមេ)";
                            } else if (p.id === meMove.playerId && winKoutPlayers.length > 0) {
                                resultStatusMap[p.id] = "❌ ចាញ់ (ត្រូវគេចាក់គូទស៊ី)";
                            } else {
                                resultStatusMap[p.id] = "❌ ចាញ់គប់";
                            }
                        });

                        finalWinnerPlayer.finalWinner = true;
                        room.lastWinnerId = finalWinnerPlayer.id;

                        const finalHandsResult = room.players.map(p => ({
                            id: p.id,
                            name: p.name,
                            initialHandCopy: p.initialHandCopy, 
                            winRounds: p.winRounds,
                            finalWinner: p.id === room.lastWinnerId,
                            isSpectator: p.isSpectator,
                            isTiv: p.isTiv,
                            lastCard: p.hand[0] || null, 
                            gameStatus: resultStatusMap[p.id]
                        }));

                        io.to('kt_' + roomId).emit('gameWon', { 
                            winner: finalWinnerPlayer.name, 
                            winnerId: room.lastWinnerId, 
                            creatorId: room.creatorId, 
                            allHands: finalHandsResult 
                        });
                        
                        broadcastRoomLists();
                    }
                }, delayTime); 
            }
        });

        // 🚪 ព្រឹត្តិការណ៍ចាកចេញពីបន្ទប់ (Leave Room)
        socket.on('kt_leaveRoom', (roomId) => {
            const room = ktRooms[roomId];
            if (!room) return socket.emit('leftRoom');

            const index = room.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                socket.leave('kt_' + roomId);
                socket.emit('leftRoom');

                io.to('kt_' + roomId).emit('voice_user_left', { id: socket.id });

                if (room.players.length === 0) {
                    delete ktRooms[roomId];
                } else {
                    if (room.creatorId === socket.id) {
                        room.creatorId = room.players[0].id;
                    }
                    io.to('kt_' + roomId).emit('updatePlayers', room.players);
                }
                broadcastRoomLists();
            }
        });

    });
};