// =================================================================
// server_kate.js (កំណែទម្រង់ពេញលេញ - ជួសជុលការស៊ីខុសទឹក បំបាត់ Error គាំង និងរួមគ្នាលេងវគ្គថ្មី)
// =================================================================

module.exports = (io, ktRooms, broadcastRoomLists, tlModule, ktModule) => {

    // ==========================================
    // io.on('connection') - ប្រព័ន្ធទទួលការតភ្ជាប់ពីទូរស័ព្ទ/កុំព្យូទ័រ
    // ==========================================
    io.on('connection', (socket) => {

        // ព្រឹត្តិការណ៍៖ បង្កើតបន្ទប់លេងកាតេ (Create Room)
        socket.on('kt_createRoom', ({ roomId, password, playerName }) => {
            if (ktRooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
            ktRooms[roomId] = {
                roomId, password: password || "", status: 'waiting', creatorId: socket.id,
                players: [{ id: socket.id, name: playerName || 'អ្នកលេង ១', hand: [], isSpectator: false, hasCat: false, winRounds: 0, finalWinner: false, initialHandCopy: [] }],
                currentTurnIndex: 0, currentRound: 1, tableCards: [], roundSuit: null, lastWinnerId: null
            };
            socket.join('kt_' + roomId);
            socket.emit('roomCreated', { roomId, playerId: socket.id });
            io.to('kt_' + roomId).emit('updatePlayers', ktRooms[roomId].players);
            
            io.to('kt_' + roomId).emit('voice_user_joined', { id: socket.id });
            broadcastRoomLists();
        });

        // ព្រឹត្តិការណ៍៖ ចូលរួមបន្ទប់លេងកាតេ (Join Room)
        socket.on('kt_joinRoom', ({ roomId, password, playerName }) => {
            const room = ktRooms[roomId];
            if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់!');
            if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');
            if (room.players.length >= 4 && room.status !== 'playing') return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

            const isSpectator = (room.status === 'playing' || room.players.length >= 4);
            
            socket.to('kt_' + roomId).emit('voice_user_joined', { id: socket.id });
            room.players.forEach(p => socket.emit('voice_initiate_peer', { target: p.id }));

            room.players.push({ id: socket.id, name: playerName || 'ភ្ញៀវ', hand: [], isSpectator, hasCat: false, winRounds: 0, finalWinner: false, initialHandCopy: [] });
            
            socket.join('kt_' + roomId);
            socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator });
            io.to('kt_' + roomId).emit('updatePlayers', room.players);
            broadcastRoomLists();
        });

        // ព្រឹត្តិការណ៍៖ ចាប់ផ្ដើមហ្គេមកាតេ (Start Game) - 🛠️ រួមគ្នាលេងវគ្គថ្មី មិនឱ្យ Host លេងម្នាក់ឯង
        socket.on('kt_startGame', (roomId) => {
            const room = ktRooms[roomId]; if (!room) return;
            
            // 🔒 យន្តការគន្លឹះ៖ ប្ដូរគ្រប់គ្នាដែលនៅក្នុងបន្ទប់ (៤នាក់ដំបូង) ឱ្យត្រលប់មកលេងវិញ មិនឱ្យជាប់ធ្វើ Spectator ឡើយ
            room.players.forEach((p, idx) => {
                if (idx < 4) {
                    p.isSpectator = false;
                }
            });

            const activePlayers = room.players.filter(p => !p.isSpectator);
            if (activePlayers.length < 2) return socket.emit('errorMsg', 'ត្រូវការអ្នកលេងយ៉ាងតិច ២ នាក់ ទើបអាចលេងបាន!');

            const deck = tlModule.shuffleDeck(ktModule.createKateDeck());
            room.status = 'playing'; room.currentRound = 1; room.tableCards = []; room.roundSuit = null;
            
            // ចែកបៀរឱ្យតែអ្នកលេងពិតប្រាកដ (Active Players) ប៉ុណ្ណោះ
            activePlayers.forEach((p, i) => {
                p.hand = ktModule.sortKateCards(deck.slice(i * 6, (i + 1) * 6));
                p.initialHandCopy = [...p.hand]; 
                p.hasCat = false; p.winRounds = 0; p.finalWinner = false;
            });

            room.players.forEach(p => { 
                if(!p.isSpectator) {
                    io.to(p.id).emit('dealCards', { hand: p.hand }); 
                }
            });

            room.currentTurnIndex = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : room.players.findIndex(p => !p.isSpectator);
            if (room.currentTurnIndex === -1) room.currentTurnIndex = 0;
            
            io.to('kt_' + roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex, currentRound: room.currentRound, lastRoundWinnerId: room.lastWinnerId });
        });

        // ព្រឹត្តិការណ៍៖ ដំណើរការទម្លាក់បៀរ (Play Move)
        socket.on('kt_playMove', ({ roomId, action, card }) => {
            const room = ktRooms[roomId]; if (!room) return; 
            let player = room.players[room.currentTurnIndex]; if (player.id !== socket.id) return;

            let verifiedAction = '';

            // =================================================================
            // 🔒 របាំងការពារដាច់ខាត៖ ជុំទី ១ ដល់ ទី ៤ (វគ្គដេញទឹកស៊ី)
            // =================================================================
            if (room.currentRound <= 4) {
                if (room.tableCards.length === 0) {
                    room.roundSuit = card.suit;
                    verifiedAction = 'ស៊ីបៀរ';
                } else {
                    if (action === 'eat') { 
                        if (card.suit !== room.roundSuit) {
                            return socket.emit('errorMsg', `ទឹកបៀរមិនត្រឹមត្រូវ! លើតុបច្ចុប្បន្នគឺទឹក [ ${room.roundSuit} ]។ អ្នកមិនអាចចុះស៊ីបានទេ ត្រូវតែជ្រើសរើសចុចប៊ូតុង "🖐️ ផ្កាប់បៀរ (ធីប)" តែមួយគត់!`);
                        }
                        
                        const sameSuitCards = room.tableCards.filter(m => m.card.suit === room.roundSuit && m.action === 'ស៊ីបៀរ');
                        if (sameSuitCards.length > 0) {
                            sameSuitCards.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card));
                            const highestCardOnTable = sameSuitCards[0].card;
                            if (ktModule.getKatePower(card) <= ktModule.getKatePower(highestCardOnTable)) {
                                return socket.emit('errorMsg', `បៀររបស់អ្នកតូចជាងបៀរនៅលើតុ! មិនអាចចុះស៊ីបានទេ ត្រូវតែជ្រើសរើសចុចប៊ូតុង "🖐️ ផ្កាប់បៀរ (ធីប)"!`);
                            }
                        }
                        verifiedAction = 'ស៊ីបៀរ';
                    } else if (action === 'fold') {
                        verifiedAction = 'ធីបហើយ';
                    } else {
                        return socket.emit('errorMsg', `មិនអាចចុះបៀររបៀបនេះបានទេ! ត្រូវតែលេងទឹក [ ${room.roundSuit} ] ឬចុចប៊ូតុង "🖐️ ផ្កាប់បៀរ (ធីប)"!`);
                    }
                }
            } 
            // =================================================================
            // ជុំទី ៥៖ វគ្គគប់បៀរ (បើកសិទ្ធិឱ្យបង្ហាញមុខបៀរទាំងអស់)
            // =================================================================
            else if (room.currentRound === 5) {
                if (room.tableCards.length === 0) {
                    room.roundSuit = card.suit; 
                    verifiedAction = 'គប់ទេ';
                } else {
                    const isMatch = (card.suit === room.roundSuit && ktModule.getKatePower(card) > ktModule.getKatePower(room.tableCards[0].card));
                    verifiedAction = isMatch ? 'គប់ហើយ' : 'អត់គប់ទេ';
                }
            } 
            else if (room.currentRound === 6) { 
                verifiedAction = 'លទ្ធផលចុងក្រោយ';
            }

            // ឆ្លងកាត់របាំងការពារខាងលើរួចរាល់ ទើបចុះទៅក្នុងតុ និងដកបៀរចេញពីដៃ
            room.tableCards.push({ playerId: player.id, name: player.name, card, action: verifiedAction });

            const cardIdx = player.hand.findIndex(c => c.value === card.value && c.suit === card.suit); 
            if (cardIdx !== -1) player.hand.splice(cardIdx, 1);

            io.to('kt_' + roomId).emit('moveRecorded', { by: player.name, action: verifiedAction, card, tableCards: room.tableCards, round: room.currentRound });
            io.to(player.id).emit('dealCards', { hand: player.hand }); 

            let nextTurn = (room.currentTurnIndex + 1) % room.players.length; let attempts = 0;
            while (room.players[nextTurn].isSpectator && attempts < room.players.length) { nextTurn = (nextTurn + 1) % room.players.length; attempts++; }
            room.currentTurnIndex = nextTurn;
            
            // ពិនិត្យមើលនៅពេលគ្រប់គ្នាបានទម្លាក់បៀរគ្រប់ៗគ្នាប្រចាំជុំ
            if (room.tableCards.length === room.players.filter(p => !p.isSpectator).length) {
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

                    if (room.currentRound === 4) { 
                        room.players.forEach(p => { if (!p.isSpectator && !p.hasCat) p.isSpectator = true; }); 
                    }

                    // បើជុំទី ១ ដល់ ៤ គឺបន្តទៅជុំបន្ទាប់ធម្មតា
                    if (room.currentRound < 5) {
                        room.currentRound++; 
                        room.tableCards = []; 
                        room.roundSuit = null; 
                        const survivors = room.players.filter(p => !p.isSpectator);
                        
                        if (survivors.length === 1) {
                            room.status = 'waiting'; 
                            survivors[0].finalWinner = true;
                            const finalHandsResult = room.players.map(p => ({ name: p.name, initialHandCopy: p.initialHandCopy, winRounds: p.winRounds, finalWinner: p.id === survivors[0].id, isSpectator: p.isSpectator, lastCard: p.hand[0], status: 'ឈ្នះផ្តាច់' }));
                            io.to('kt_' + roomId).emit('gameWon', { winner: survivors[0].name, winnerId: survivors[0].id, allHands: finalHandsResult });
                        } else { 
                            io.to('kt_' + roomId).emit('nextRoundStarted', { currentRound: room.currentRound, winnerName: winMove ? winMove.name : 'គ្មាន', currentTurnIndex: room.currentTurnIndex, players: room.players }); 
                        }
                    } 
                    // 🏆 វគ្គគណនា "កាត់ឡង សងគូទ" ស្វ័យប្រវត្តនៅជុំទី ៥ (Game Over)
                    else { 
                        room.status = 'waiting';
                        const finalSuit = room.roundSuit;
                        
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

                        if (songKoutPlayer && songKoutPlayer.id !== round5Winner.id) {
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
                                pStatus = p.isSpectator ? "❌ លង់ (ចាញ់)" : "❌ ចាញ់គប់";
                            }
                            return {
                                id: p.id,
                                name: p.name,
                                initialHandCopy: p.initialHandCopy, 
                                winRounds: p.winRounds,
                                finalWinner: p.id === room.lastWinnerId,
                                isSpectator: p.isSpectator,
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
            } else { 
                io.to('kt_' + roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players }); 
            }
        });

    });
};