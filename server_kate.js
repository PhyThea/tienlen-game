// =================================================================
// server_kate.js (កូដពេញលេញ ១០០% - កែសម្រួលការបង្ហាញបៀរគូទឱ្យត្រូវលក្ខខណ្ឌមេ និងអ្នកគប់)
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
            
            // 🛠️ Reset ស្ថានភាពទូទៅរបស់អ្នកលេងទាំងអស់ក្នុងបន្ទប់ឡើងវិញមុនចែកបៀរ
            room.players.forEach((p, idx) => {
                p.isTiv = false;       // <--- ធានាសម្អាតស្ថានភាពទីវវគ្គចាស់ចោលដាច់ខាត!
                p.winRounds = 0;       // <--- Reset ចំនួនជុំដែលធ្លាប់ស៊ី
                p.hasCat = false;      // <--- Reset ស្ថានភាពមានកាតេដេញទឹក
                p.finalWinner = false; // <--- Reset ម្ចាស់ពានវគ្គមុន
                
                if (idx < 6) {
                    p.isSpectator = false;
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
                p.hasCat = false; 
                p.winRounds = 0; 
                p.finalWinner = false; 
                p.isTiv = false;       // <--- ធានាថាត្រូវបាន Reset ស្អាតពេលទទួលបៀរថ្មី
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
            // ជុំទី ៥៖ វគ្គគប់បៀរ (កំហិតមិនឱ្យមានការធីប/ផ្កាប់ឡើយ)
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

            // 🛠️ កាត់សន្លឹកបៀរចេញពីដៃភ្លាមៗ ទោះបីជាស៊ីបៀរ គប់បៀរ ឬផ្កាប់បៀរចោលក៏ដោយ
            player.hand.splice(cardIdx, 1);

            // 🛠️ បន្ថែម Logic៖ ត្រួតពិនិត្យ និងបង្ហាញ "ទីវ" ភ្លាមៗនៅក្នុងជុំទី ៤
            if (room.currentRound === 4 && !player.hasCat && verifiedAction === 'ធីបហើយ') {
                player.isTiv = true;
            }

            io.to('kt_' + roomId).emit('moveRecorded', { by: player.name, action: verifiedAction, card, tableCards: room.tableCards, round: room.currentRound });
            io.to(player.id).emit('dealCards', { hand: player.hand }); 

            // 🎯 ចំនួនអ្នកលេងសរុបពិតប្រាកដដែលត្រូវលេងក្នុងជុំនេះ
            const requiredPlayersCount = room.players.filter(p => !p.isSpectator && !(room.currentRound === 5 && p.isTiv)).length;

            // 🛠️ ស្វែងរកវេនបន្ទាប់ (Next Turn) ការពារការគាំងស្លាប់
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
                    // 🛠️ ផ្ញើបច្ចុប្បន្នភាពបញ្ជីឈ្មោះអ្នកលេងដែលមានស្ថានភាព "ទីវហើយ" ទៅឱ្យ Client បង្ហាញភ្លាមៗ
                    io.to('kt_' + roomId).emit('updatePlayers', room.players);
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

                    // វគ្គផ្ទៀងផ្ទាត់ចុងក្រោយពេលចប់ជុំទី ៤ (សម្រាប់អ្នកដែលមិនទាន់ដល់វេនលេង តែដឹងថាអត់មានបៀរស៊ីច្បាស់ណាស់)
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
                                id: p.id, name: p.name, initialHandCopy: p.initialHandCopy, winRounds: p.winRounds, finalWinner: p.id === survivors[0].id, isSpectator: p.isSpectator, 
                                lastCard: p.hand.length > 0 ? p.hand[p.hand.length - 1] : null, // 🛠️ ចាប់យកសន្លឹកចុងក្រោយបង្អស់ (សន្លឹកទី៦)
                                gameStatus: p.id === survivors[0].id ? '👑 ឈ្នះផ្ដាច់ (ស៊ីដាច់តុ)' : (p.isTiv ? '🖐️ ទីវហើយ (ចាញ់)' : '❌ ចាញ់')
                            }));

                            // 🛠️ ហៅមុខងាររាប់ថយក្រោយ ៥ វិនាទី មុនប្រកាសលទ្ធផល (ករណីឈ្នះផ្ដាច់នៅជុំទី៤)
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
                            io.to('kt_' + roomId).emit('nextRoundStarted', { 
                                currentRound: room.currentRound, 
                                winnerName: winMove ? winMove.name : 'គ្មាន', 
                                currentTurnIndex: room.currentTurnIndex, 
                                players: room.players 
                            }); 
                        }
                    }

                    // ==========================================
                    // 🏆 ជុំទី ៥៖ វគ្គគណនា "ចាក់គូទត្រូវហើយ" និង "ឡងសងគូទ"
                    // ==========================================
                    else { 
                        room.status = 'waiting';
                        
                        const round5Winner = room.players.find(p => p.id === room.lastWinnerId); // មេដែលចេញសន្លឹកទី៥
                        const headMove = room.tableCards[0]; // ព័ត៌មានបៀរទី៥របស់មេ
                        
                        const headPlayerId = headMove.playerId;
                        const headPlayer = room.players.find(p => p.id === headPlayerId);
                        // 🛠️ ចាប់យកសន្លឹកចុងក្រោយបង្អស់ក្នុងដៃធ្វើជាបៀរគូទទី៦ ពិតប្រាកដរបស់មេ
                        const headLastCard = headPlayer && headPlayer.hand.length > 0 ? headPlayer.hand[headPlayer.hand.length - 1] : null;

                        let songKoutPlayer = null;
                        let maxLastCardPower = -1;
                        let isLangSongKout = false;

                        // 🛠️ ស្វែងរក "អ្នកគប់តពីមេ" ( action === 'គប់ហើយ' ) នៅក្នុងជុំទី៥
                        // ប្រសិនបើមានច្រើននាក់ គឺយកអ្នកដែលបានគប់សន្លឹកធំជាងគេបង្អស់នៅលើតុមកបង្ហាញ
                        let lastCutterMove = null;
                        const cuttersInRound5 = room.tableCards.filter(m => m.action === 'គប់ហើយ');
                        if (cuttersInRound5.length > 0) {
                            // រៀបលំដាប់បៀរអ្នកគប់ពីធំទៅតូច
                            cuttersInRound5.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card));
                            lastCutterMove = cuttersInRound5[0]; // ចាប់យកអ្នកគប់ដែលធំជាងគេ
                        }

                        // 🎯 Logic ជ្រើសរើសសន្លឹកបៀរគូទបង្ហាញនៅលើតុ (Table Display) តាមសំណូមពរ៖
                        // ជាដំបូង កំណត់លំនាំដើមបង្ហាញគូទមេជានិច្ច
                        let cardToShowOnTable = headLastCard; 
                        let cardOwnerName = headPlayer ? headPlayer.name : "មេ";
                        let isShowingCutter = false;

                        // ប៉ុន្តែបើមាន "អ្នកគប់តពីមេ" វិញ ត្រូវបង្ហាញបៀរគូទ (សន្លឹកទី៦) របស់អ្នកគប់នោះជំនួសវិញភ្លាម!
                        if (lastCutterMove) {
                            const cutterPlayer = room.players.find(p => p.id === lastCutterMove.playerId);
                            if (cutterPlayer && cutterPlayer.hand.length > 0) {
                                cardToShowOnTable = cutterPlayer.hand[cutterPlayer.hand.length - 1]; // បៀរគូទទី៦ របស់អ្នកគប់
                                cardOwnerName = cutterPlayer.name;
                                isShowingCutter = true;
                            }
                        }

                        // 🛠️ [រក្សាទុកដដែល] ពិនិត្យទឹកបៀរគូទ (សន្លឹកទី៦) របស់មេ ដើម្បីកាត់សេចក្តីលទ្ធផលឈ្នះចាញ់តាមច្បាប់ដើម
                        if (headLastCard) {
                            const koutSuit = headLastCard.suit; 
                            const headLastPower = ktModule.getKatePower(headLastCard);
                            
                            room.players.forEach(p => {
                                if (!p.isSpectator && !p.isTiv && p.id !== headPlayerId && p.hand.length > 0) {
                                    const lastCard = p.hand[p.hand.length - 1]; 
                                    
                                    if (lastCard.suit === koutSuit) {
                                        const power = ktModule.getKatePower(lastCard);
                                        
                                        // ក្បួនទី១៖ បើគូទត្រូវទឹកហើយធំជាងគូទមេ គឺចាក់គូទស៊ីមេ
                                        if (power > headLastPower) {
                                            if (power > maxLastCardPower) {
                                                maxLastCardPower = power;
                                                songKoutPlayer = p;
                                                isLangSongKout = false;
                                            }
                                        } 
                                        // ក្បួនទី២៖ បើធ្លាប់ចុចគប់ជុំទី៥ តែគូទតូចជាងគូទមេ (ឡងសងគូទ)
                                        else {
                                            const playedMove = room.tableCards.find(m => m.playerId === p.id);
                                            if (playedMove && playedMove.action === 'គប់ហើយ') {
                                                isLangSongKout = true;
                                            }
                                        }
                                    }
                                }
                            });
                        }

                        // ស្វែងរកអ្នក "ងើយ" (រក្សាទុកច្បាប់ចាស់ដដែល)
                        let ngeuyPlayers = [];
                        const finalSuit = headMove.card.suit; 
                        if (maxLastCardPower !== -1) {
                            room.tableCards.forEach(m => {
                                if (m.action === 'អត់គប់ទេ') {
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
                        }

                        let finalWinnerPlayer = null;
                        let resultStatusMap = {};

                        if (songKoutPlayer) {
                            finalWinnerPlayer = songKoutPlayer;
                            room.lastWinnerId = songKoutPlayer.id;
                            resultStatusMap[songKoutPlayer.id] = "👑 ឈ្នះ (ចាក់គូទត្រូវហើយ)";
                            resultStatusMap[round5Winner.id] = "💔 ចាញ់ (ត្រូវគេចាក់គូទស៊ី)";
                        } else {
                            finalWinnerPlayer = round5Winner;
                            if (isLangSongKout) {
                                resultStatusMap[round5Winner.id] = "👑 ឈ្នះ (ឡងសងគូទពេញលេញ)";
                                room.players.forEach(p => {
                                    const pLastCard = p.hand.length > 0 ? p.hand[p.hand.length - 1] : null;
                                    if(!p.isSpectator && p.id !== round5Winner.id) {
                                        const pm = room.tableCards.find(m => m.playerId === p.id);
                                        if(pm && pm.action === 'គប់ហើយ' && pLastCard && pLastCard.suit === finalSuit) {
                                            resultStatusMap[p.id] = "💔 ឡងសងគូទ (ចាញ់មេ)";
                                        }
                                    }
                                });
                            } else {
                                resultStatusMap[round5Winner.id] = "👑 ឈ្នះ (ស៊ីឡងពេញលេញ)";
                            }
                        }

                        if (finalWinnerPlayer) finalWinnerPlayer.finalWinner = true;

                        // ##########################################
                        // រៀបចំបញ្ជូនស្ថានភាពលទ្ធផលទៅកាន់គ្រប់គ្នា (រក្សាទុកដដែល)
                        // ##########################################
                        const finalHandsResult = room.players.map(p => {
                            let pStatus = resultStatusMap[p.id];
                            
                            if (ngeuyPlayers.includes(p.id)) {
                                pStatus = "😮 ងើយហើយ (មានទឹកឈ្នះតែចាក់ខុសជុំ)";
                            }
                            
                            if (!pStatus) {
                                pStatus = p.isSpectator ? "❌ លង់ (អ្នកមើល)" : (p.isTiv ? "🖐️ ទីវហើយ (អត់បៀរស៊ី)" : "❌ ចាញ់គប់");
                            }
                            return {
                                id: p.id, name: p.name, initialHandCopy: p.initialHandCopy, winRounds: p.winRounds,
                                finalWinner: p.id === room.lastWinnerId, isSpectator: p.isSpectator, isTiv: p.isTiv,
                                lastCard: p.hand.length > 0 ? p.hand[p.hand.length - 1] : null, gameStatus: pStatus
                            };
                        });

                        // 🎯 ផ្ញើព្រឹត្តិការណ៍បង្ហាញសន្លឹកបៀរគូទទី៦ ទៅតុ (បើមានអ្នកគប់ បង្ហាញបៀរអ្នកគប់ បើអត់ទេ បង្ហាញបៀរមេ)
                        io.to('kt_' + roomId).emit('kt_showKoutCard', { 
                            card: cardToShowOnTable, 
                            ownerName: cardOwnerName,
                            isSongKout: isShowingCutter // បើ True វានឹងចេញ Badge ពណ៌លឿងថាជាបៀរអ្នកគប់
                        });

                        // 🛠️ ទុកពេល ២.៥ វិនាទីឱ្យអ្នកលេងមើលបៀរគូទផ្ទៀងផ្ទាត់សិន រួចទើបហៅមុខងាររាប់ថយក្រោយ ៥ វិនាទី
                        setTimeout(() => {
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
                        }, 2500); // ⏳ ពន្យារពេល ២.៥ វិនាទី
                    }
                }, 1500);
            }
        });

    });
};