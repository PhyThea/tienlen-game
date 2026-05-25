// =================================================================
// server_kate.js (កំណែទម្រង់ចុងក្រោយបង្អស់ - ជួសជុល Bug គាំងវេនលេង ៦ នាក់)
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

        // 🔄 ព្រឹត្តិការណ៍ចូលរួមបន្ទប់ កំហិត ៦ នាក់ដាច់ណាត់
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

        // ព្រឹត្តិការណ៍៖ ចាប់ផ្ដើមហ្គេមកាតេ (Start Game)
        socket.on('kt_startGame', (roomId) => {
            const room = ktRooms[roomId]; if (!room) return;
            
            room.players.forEach((p, idx) => {
                if (idx < 6) {
                    p.isSpectator = false;
                    p.isTiv = false;
                } else {
                    p.isSpectator = true; 
                }
            });

            const activePlayers = room.players.filter(p => !p.isSpectator);
            if (activePlayers.length < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់ ទើបអាចលេងបាន!');

            const deck = tlModule.shuffleDeck(ktModule.createKateDeck());
            room.status = 'playing'; room.currentRound = 1; room.tableCards = []; room.roundSuit = null; room.finalSuit = null;
            
            activePlayers.forEach((p, i) => {
                p.hand = ktModule.sortKateCards(deck.slice(i * 6, (i + 1) * 6));
                p.initialHandCopy = [...p.hand]; 
                p.hasCat = false; p.winRounds = 0; p.finalWinner = false; p.isTiv = false;
            });

            room.players.forEach(p => { 
                if(!p.isSpectator) {
                    io.to(p.id).emit('dealCards', { hand: p.hand }); 
                }
            });

            room.currentTurnIndex = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : room.players.findIndex(p => !p.isSpectator);
            if (room.currentTurnIndex === -1) room.currentTurnIndex = 0;
            
            io.to('kt_' + roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex, currentRound: room.currentRound, lastRoundWinnerId: room.lastWinnerId });
            
            broadcastRoomLists();
        });

        // ព្រឹត្តិការណ៍៖ ដំណើរការទម្លាក់បៀរ (Play Move)
        socket.on('kt_playMove', ({ roomId, action, card }) => {
            const room = ktRooms[roomId]; if (!room) return; 
            let player = room.players[room.currentTurnIndex]; if (player.id !== socket.id) return;

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
            // ជុំទី ៥៖ វគ្គគប់បៀរ 
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

            // បញ្ចូលទិន្នន័យបៀរទៅលើតុ
            room.tableCards.push({ playerId: player.id, name: player.name, card, action: verifiedAction });

            const cardIdx = player.hand.findIndex(c => c.value === card.value && c.suit === card.suit); 
            if (cardIdx !== -1) player.hand.splice(cardIdx, 1);

            io.to('kt_' + roomId).emit('moveRecorded', { by: player.name, action: verifiedAction, card, tableCards: room.tableCards, round: room.currentRound });
            io.to(player.id).emit('dealCards', { hand: player.hand }); 

            // 🎯 ចំនួនអ្នកលេងសរុបពិតប្រាកដដែលត្រូវលេងក្នុងជុំនេះ
            const requiredPlayersCount = room.players.filter(p => !p.isSpectator && !(room.currentRound === 5 && p.isTiv)).length;

            // 🛠️ ជួសជុល Logic ស្វែងរកវេនបន្ទាប់ (Next Turn) ការពារការគាំងស្លាប់
            if (room.tableCards.length < requiredPlayersCount) {
                let nextTurn = (room.currentTurnIndex + 1) % room.players.length;
                let attempts = 0;
                
                // លក្ខខណ្ឌស្វែងរក៖ មិនមែន Spectator, មិនមែនអ្នក Tiv, និងមិនទាន់បានទម្លាក់បៀរក្នុងជុំនេះឡើយ
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
                    io.to('kt_' + roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players }); 
                }
            } 
            // ជុំនីមួយៗត្រូវបានបញ្ចប់ (គ្រប់គ្នាបានលេងអស់ហើយ)
            else {
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

                    // ==========================================
                    // 🛠️ ពិនិត្យស្ថានភាព "ទីវ" នៅពេលបញ្ចប់ជុំទី ៤ 
                    // ==========================================
                    if (room.currentRound === 4) { 
                        room.players.forEach(p => { 
                            if (!p.isSpectator && !p.hasCat) {
                                p.isTiv = true; 
                            }
                        }); 
                    }

                    // ==========================================
                    // 🚀 បន្តទៅជុំបន្ទាប់ ឬ បញ្ចប់ហ្គេមផ្ដាច់
                    // ==========================================
                    if (room.currentRound < 5) {
                        room.currentRound++; 
                        room.tableCards = []; 
                        room.roundSuit = null; 
                        
                        const survivors = room.players.filter(p => !p.isSpectator && !p.isTiv);
                        
                        // បើសិនសល់តែម្នាក់ឯង (អ្នកផ្សេងទីវអស់) ឱ្យឈ្នះដាច់តុតែម្ដង
                        if (survivors.length === 1) {
                            room.status = 'waiting'; 
                            survivors[0].finalWinner = true;
                            room.lastWinnerId = survivors[0].id;
                            
                            const finalHandsResult = room.players.map(p => ({
                                id: p.id, name: p.name, initialHandCopy: p.initialHandCopy, winRounds: p.winRounds, finalWinner: p.id === survivors[0].id, isSpectator: p.isSpectator, lastCard: p.hand[0] || null, gameStatus: p.id === survivors[0].id ? '👑 ឈ្នះផ្ដាច់ (ស៊ីដាច់តុ)' : (p.isTiv ? '🖐️ ទីវហើយ (ចាញ់)' : '❌ ចាញ់')
                            }));
                            io.to('kt_' + roomId).emit('gameWon', { winner: survivors[0].name, winnerId: survivors[0].id, allHands: finalHandsResult });
                        } else { 
                            // ផ្ញើទៅកាន់ Client ទាំងព្រម ដោយភ្ជាប់ទិន្នន័យ room.players ដែលបច្ចុប្បន្នភាព "ទីវហើយ" រួចជាស្រេច
                            io.to('kt_' + roomId).emit('nextRoundStarted', { 
                                currentRound: room.currentRound, 
                                winnerName: winMove ? winMove.name : 'គ្មាន', 
                                currentTurnIndex: room.currentTurnIndex, 
                                players: room.players 
                            }); 
                        }
                    }

                    // 🏆 ជុំទី ៥៖ វគ្គគណនា "កាត់ឡង សងគូទ"
                    else { 
                        room.status = 'waiting';
                        const finalSuit = room.finalSuit || room.roundSuit;
                        
                        let songKoutPlayer = null;
                        let maxLastCardPower = -1;

                        room.players.forEach(p => {
                            if (!p.isSpectator && p.hand.length > 0) {
                                const lastCard = p.hand[0]; 
                                if (lastCard.suit === finalSuit) {
                                    const power = ktModule.getKatePower(lastCard);
                                    if (power > maxLastCardPower) {
                                        maxLastCardPower = power;
                                        songKoutPlayer = p;
                                    }
                                }
                            }
                        });

                        let finalWinnerPlayer = null;
                        let resultStatusMap = {};
                        const round5Winner = room.players.find(p => p.id === room.lastWinnerId);

                        if (songKoutPlayer && (songKoutPlayer.id !== round5Winner.id)) {
                            finalWinnerPlayer = songKoutPlayer;
                            room.lastWinnerId = songKoutPlayer.id;
                            
                            resultStatusMap[songKoutPlayer.id] = "👑 ឈ្នះ (សងគូទបានសម្រេច!)";
                            resultStatusMap[round5Winner.id] = "💔 ចាញ់ (ត្រូវគេកាត់ឡងសងគូទ)";
                        } else {
                            finalWinnerPlayer = round5Winner;
                            resultStatusMap[round5Winner.id] = "👑 ឈ្នះ (ស៊ីឡងពេញលេញ)";
                        }

                        if (finalWinnerPlayer) finalWinnerPlayer.finalWinner = true;

                        const finalHandsResult = room.players.map(p => {
                            let pStatus = resultStatusMap[p.id];
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
                        
                        broadcastRoomLists();
                    }
                }, 1500);
            }
        });

    });
};