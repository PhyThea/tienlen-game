// =================================================================
// server_kate.js (កំណែទម្រង់ចុងក្រោយ៖ ជួសជុលការ Reset ស្ថានភាពលេងវគ្គថ្មី)
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

        // 🔄 ព្រឹត្តិការណ៍ចូលរួមបន្ទប់ កំហិត ៦ នាក់ដាត់ណាត់
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
            
            // 🛠️ ដំណោះស្រាយ៖ ត្រូវ Reset ស្ថានភាពកាតាឡុករបស់អ្នកលេងទាំងអស់ឱ្យស្អាត (សំខាន់បំផុតកុំឱ្យគាំងវេន)
            room.players.forEach((p, idx) => {
                if (idx < 6) {
                    p.isSpectator = false;
                    p.isTiv = false; // លុបស្ថានភាព "ទីវ" ចោលទាំងអស់ដើម្បីឱ្យលេងវគ្គថ្មីបាន
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

            // កំណត់វេនអ្នកលេងដំបូង
            room.currentTurnIndex = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : room.players.findIndex(p => !p.isSpectator);
            if (room.currentTurnIndex === -1 || room.players[room.currentTurnIndex].isSpectator) {
                room.currentTurnIndex = room.players.findIndex(p => !p.isSpectator);
            }
            
            io.to('kt_' + roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex, currentRound: room.currentRound, lastRoundWinnerId: room.lastWinnerId });
            
            broadcastRoomLists();
        });

        // ព្រឹត្តិការណ៍៖ ដំណើរការទម្លាក់បៀរ (Play Move)
        socket.on('kt_playMove', ({ roomId, action, card }) => {
            const room = ktRooms[roomId]; if (!room) return; 
            let player = room.players[room.currentTurnIndex]; if (player.id !== socket.id) return;

            // 🛠️ ពិនិត្យថាបៀរដែល Client បញ្ជូនមក ពិតជាមាននៅក្នុងដៃអ្នកលេងពិតប្រាកដមែនឬទេ
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
            // 🛠️ ជុំទី ៥៖ វគ្គគប់បៀរ (ដាច់ខាតត្រូវចេញចំហរ និងមិនឱ្យមានការធីប)
            // ==========================================
            else if (room.currentRound === 5) {
                if (player.isTiv) return socket.emit('errorMsg', 'អ្នកបាន "ទីវ" ហើយ មិនអាចលេងក្នុងជុំនេះបានទេ!');

                if (room.tableCards.length === 0) {
                    room.roundSuit = card.suit; 
                    room.finalSuit = card.suit; 
                    verifiedAction = 'គប់ទេ'; // សន្លឹកបើកឆាកដំបូងគេបង្អស់ក្នុងជុំ៥
                } else {
                    const firstMove = room.tableCards[0];
                    // ពិនិត្យថាបៀរដែលទម្លាក់មកមានទឹក (Suit) ដូចសន្លឹកដំបូង និងមានតម្លៃធំជាងសន្លឹកដំបូងដែរឬទេ
                    const isMatch = (card.suit === room.finalSuit && ktModule.getKatePower(card) > ktModule.getKatePower(firstMove.card));
                    
                    // បង្ខំកំណត់ Action ជាការបង្ហាញបៀរចំហរជានិច្ច
                    verifiedAction = isMatch ? 'គប់ហើយ' : 'អត់គប់ទេ';
                }
            }

            // បញ្ចូលទិន្នន័យបៀរទៅលើតុ
            room.tableCards.push({ playerId: player.id, name: player.name, card, action: verifiedAction });

            // កាត់សន្លឹកបៀរចេញពីដៃភ្លាមៗ
            player.hand.splice(cardIdx, 1);

            // ត្រួតពិនិត្យ "ទីវ" ភ្លាមៗនៅក្នុងជុំទី ៤ មុនគេ
            if (room.currentRound === 4 && !player.hasCat) {
                player.isTiv = true;
            }

            io.to('kt_' + roomId).emit('moveRecorded', { by: player.name, action: verifiedAction, card, tableCards: room.tableCards, round: room.currentRound });
            io.to(player.id).emit('dealCards', { hand: player.hand }); 

            // ចំនួនអ្នកលេងសរុបពិតប្រាកដដែលត្រូវលេងក្នុងជុំនេះ
            const requiredPlayersCount = room.players.filter(p => !p.isSpectator && !(room.currentRound === 5 && p.isTiv)).length;

            // ស្វែងរកវេនបន្ទាប់ (Next Turn)
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
            // ជុំនីមួយៗត្រូវបានបញ្ចប់ (គ្រប់គ្នាបានលេងអស់ហើយ)
            else {
                let delayTime = 1500; // ជុំទី ១ ដល់ ៤ ទុក ១.៥ វិនាទីដដែល
                if (room.currentRound === 5) {
                    delayTime = 5000; // ជុំទី ៥ ទុក ៥ វិនាទី
                    io.to('kt_' + roomId).emit('kt_startCountdown', 5); // ឱ្យ client បង្ហាញលេខរាប់ថយក្រោយ
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

                    if (room.currentRound === 4) { 
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
                            io.to('kt_' + roomId).emit('nextRoundStarted', { 
                                currentRound: room.currentRound, 
                                winnerName: winMove ? winMove.name : 'គ្មាន', 
                                currentTurnIndex: room.currentTurnIndex, 
                                players: room.players 
                            }); 
                        }
                    }
                    // ==========================================
                    // 🏆 ជុំទី ៥៖ វគ្គគណនា "កាត់ឡង សងគូទ" និង "ងើយហើយ"
                    // ==========================================
                    else { 
                        room.status = 'waiting';
                        const finalSuit = room.finalSuit || room.roundSuit;
                        
                        let songKoutPlayer = null;
                        let maxLastCardPower = -1;

                        // ១. រកមើលបៀរគូទ (សន្លឹកទី ៦) ដែលធំជាងគេពិតប្រាកដនៅលើតុ
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

                        // ២. ស្វែងរកអ្នក "ងើយ"
                        let ngeuyPlayers = [];
                        room.tableCards.forEach(m => {
                            if (m.action === 'អត់គប់ទេ' || m.action === 'ធីបហើយ') {
                                const thrownCard = m.card; 
                                if (thrownCard.suit === finalSuit) {
                                    const thrownPower = ktModule.getKatePower(thrownCard);
                                    const firstMovePower = ktModule.getKatePower(room.tableCards[0].card);
                                    if (thrownPower > maxLastCardPower && thrownPower > firstMovePower) {
                                        ngeuyPlayers.push(m.playerId);
                                    }
                                }
                            }
                        });

                        let finalWinnerPlayer = null;
                        let resultStatusMap = {};
                        const round5Winner = room.players.find(p => p.id === room.lastWinnerId);

                        if (songKoutPlayer && (songKoutPlayer.id !== round5Winner.id)) {
                            finalWinnerPlayer = songKoutPlayer;
                            room.lastWinnerId = songKoutPlayer.id; // ប្តូរ ID អ្នកឈ្នះពិតប្រាកដទៅឱ្យអ្នកសងគូទ
                            
                            resultStatusMap[songKoutPlayer.id] = "👑 ឈ្នះ (សងគូទបានសម្រេច!)";
                            if(round5Winner) resultStatusMap[round5Winner.id] = "💔 ចាញ់ (ត្រូវគេកាត់ឡងសងគូទ)";
                        } else {
                            finalWinnerPlayer = round5Winner;
                            if(round5Winner) resultStatusMap[round5Winner.id] = "👑 ឈ្នះ (ស៊ីឡងពេញលេញ)";
                        }

                        if (finalWinnerPlayer) finalWinnerPlayer.finalWinner = true;

                        // ៣. រៀបចំបញ្ជូនស្ថានភាពលទ្ធផលទៅកាន់គ្រប់គ្នា
                        const finalHandsResult = room.players.map(p => {
                            let pStatus = resultStatusMap[p.id];
                            
                            if (ngeuyPlayers.includes(p.id)) {
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
                            creatorId: room.creatorId, 
                            allHands: finalHandsResult 
                        });
                        
                        broadcastRoomLists();
                    }
                }, delayTime); 
            }
        });

    });
};