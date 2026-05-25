// ==========================================
    // ឡូហ្ស៊ិក SERVER - កាតេ (KA TE)
    // ==========================================
    socket.on('kt_createRoom', ({ roomId, password, playerName }) => {
        if (ktRooms[roomId]) return socket.emit('errorMsg', 'បន្ទប់នេះមានរួចហើយ!');
        ktRooms[roomId] = {
            roomId, password, status: 'waiting', creatorId: socket.id,
            players: [{ id: socket.id, name: playerName || 'អ្នកលេង ១', hand: [], isSpectator: false, hasCat: false, winRounds: 0, finalWinner: false }],
            currentTurnIndex: 0, currentRound: 1, tableCards: [], roundSuit: null, lastWinnerId: null
        };
        socket.join('kt_' + roomId);
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        io.to('kt_' + roomId).emit('updatePlayers', ktRooms[roomId].players);
        
        io.to('kt_' + roomId).emit('voice_user_joined', socket.id);
        socket.emit('voice_initiate_peer', { target: socket.id });
        broadcastRoomLists();
    });

    socket.on('kt_joinRoom', ({ roomId, password, playerName }) => {
        const room = ktRooms[roomId];
        if (!room) return socket.emit('errorMsg', 'រកមិនឃើញបន្ទប់!');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវ!');
        if (room.players.length >= 4 && room.status !== 'playing') return socket.emit('errorMsg', 'បន្ទប់ពេញហើយ!');

        const isSpectator = (room.status === 'playing' || room.players.length >= 4);
        room.players.push({ id: socket.id, name: playerName || 'ភ្ញៀវ', hand: [], isSpectator, hasCat: false, winRounds: 0, finalWinner: false });
        
        socket.join('kt_' + roomId);
        socket.emit('roomJoined', { roomId, playerId: socket.id, isSpectator });
        io.to('kt_' + roomId).emit('updatePlayers', room.players);
        
        io.to('kt_' + roomId).emit('voice_user_joined', socket.id);
        room.players.forEach(p => {
            if (p.id !== socket.id) socket.emit('voice_initiate_peer', { target: p.id });
        });
        broadcastRoomLists();
    });

    socket.on('kt_startGame', (roomId) => {
        const room = ktRooms[roomId]; if (!room) return;
        const deck = tlModule.shuffleDeck(ktModule.createKateDeck());
        room.status = 'playing'; room.currentRound = 1; room.tableCards = []; room.roundSuit = null;
        
        room.players.forEach((p, i) => {
            if (!p.isSpectator) {
                p.hand = ktModule.sortKateCards(deck.slice(i * 6, (i + 1) * 6));
                p.hasCat = false; p.winRounds = 0; p.finalWinner = false;
            }
        });

        room.players.forEach(p => { if(!p.isSpectator) io.to(p.id).emit('dealCards', { hand: p.hand }); });
        room.currentTurnIndex = room.lastWinnerId ? room.players.findIndex(p => p.id === room.lastWinnerId) : room.players.findIndex(p => !p.isSpectator);
        if (room.currentTurnIndex === -1) room.currentTurnIndex = 0;
        
        io.to('kt_' + roomId).emit('gameStarted', { players: room.players, currentTurnIndex: room.currentTurnIndex, currentRound: room.currentRound, lastRoundWinnerId: room.lastWinnerId });
    });

    socket.on('kt_playMove', ({ roomId, action, card }) => {
        const room = ktRooms[roomId]; if (!room) return;
        let player = room.players[room.currentTurnIndex]; if (player.id !== socket.id) return;

        // 🛠️ ពិនិត្យលក្ខខណ្ឌ៖ បើជុំទី ១ ដល់ ៤ ហើយចុច 'play' (ស៊ីបៀរ) ប៉ុន្តែមិនមែនជាអ្នកចេញបៀរដំបូង
        if (room.currentRound <= 4 && action === 'play' && room.tableCards.length > 0) {
            // ទឹកបៀរដំបូងដែលត្រូវដេញតាម
            if (card.suit !== room.roundSuit) {
                return socket.emit('errorMsg', 'ទឹកបៀរមិនត្រឹមត្រូវ! ត្រូវតែលេងទឹក ' + room.roundSuit + ' ឬជ្រើសរើសផ្កាប់បៀរ (ធីប)។');
            }
            // ពិនិត្យមើលបៀរដែលធំជាងគេនៅលើតុបច្ចុប្បន្នដែលមានទឹកដូចគ្នា
            const sameSuitCards = room.tableCards.filter(m => m.card.suit === room.roundSuit && (m.action === 'ស៊ីបៀរ' || m.action === 'គប់ទេ'));
            if (sameSuitCards.length > 0) {
                sameSuitCards.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card));
                const highestCardOnTable = sameSuitCards[0].card;
                if (ktModule.getKatePower(card) <= ktModule.getKatePower(highestCardOnTable)) {
                    return socket.emit('errorMsg', 'បៀររបស់អ្នកតូចជាងបៀរនៅលើតុ! មិនអាចស៊ីបានទេ ត្រូវតែជ្រើសរើសផ្កាប់បៀរ (ធីប)។');
                }
            }
        }

        // ដកសន្លឹកបៀរចេញពីដៃរបស់អ្នកលេងភ្លាមៗ
        const cardIdx = player.hand.findIndex(c => c.value === card.value && c.suit === card.suit);
        if (cardIdx !== -1) {
            player.hand.splice(cardIdx, 1);
        }

        // រៀបចំសកម្មភាពទៅតាមជុំនីមួយៗ
        if (room.currentRound <= 4) {
            if (action === 'play') {
                if (room.tableCards.length === 0) room.roundSuit = card.suit;
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'ស៊ីបៀរ' });
            } else {
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'ធីបហើយ' }); // ប្តូរពី ផ្កាប់បៀរ ទៅ ធីបហើយ
            }
        } 
        else if (room.currentRound === 5) {
            if (room.tableCards.length === 0) {
                room.roundSuit = card.suit;
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'គប់ទេ' });
            } else {
                // ពិនិត្យមើលថាតើអ្នកបន្ទាប់មានទឹក (Suit) ដូចគ្នា និងធំជាងបៀរនៅលើតុដែរឬទេ
                const targetCard = room.tableCards[0].card;
                const isMatch = (card.suit === room.roundSuit && ktModule.getKatePower(card) > ktModule.getKatePower(targetCard));
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: isMatch ? 'គប់ហើយ' : 'អត់គប់ទេ' });
            }
        } 
        else if (room.currentRound === 6) {
            room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'លទ្ធផលចុងក្រោយ' });
        }

        // ផ្ញើទិន្នន័យបៀរដែលបានចុះទៅកាន់គ្រប់គ្នា
        io.to('kt_' + roomId).emit('moveRecorded', { by: player.name, action, card, tableCards: room.tableCards, round: room.currentRound });
        io.to(player.id).emit('dealCards', { hand: player.hand });

        // គណនាវេនបន្ទាប់
        let nextTurn = (room.currentTurnIndex + 1) % room.players.length;
        let attempts = 0;
        while (room.players[nextTurn].isSpectator && attempts < room.players.length) {
            nextTurn = (nextTurn + 1) % room.players.length;
            attempts++;
        }
        room.currentTurnIndex = nextTurn;

        const activePlayers = room.players.filter(p => !p.isSpectator);
        
        if (room.tableCards.length === activePlayers.length) {
            setTimeout(() => {
                let winMove = null;
                
                if (room.currentRound <= 4) {
                    const validMoves = room.tableCards.filter(m => m.action === 'ស៊ីបៀរ');
                    const matchSuit = validMoves.filter(m => m.card.suit === room.roundSuit);
                    if (matchSuit.length > 0) {
                        matchSuit.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card));
                        winMove = matchSuit[0];
                    } else if (validMoves.length > 0) {
                        winMove = validMoves[0];
                    }
                } else if (room.currentRound === 5) {
                    const cutters = room.tableCards.filter(m => m.action === 'គប់ហើយ');
                    if (cutters.length > 0) {
                        cutters.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card));
                        winMove = cutters[0];
                    } else {
                        winMove = room.tableCards[0];
                    }
                } else {
                    winMove = room.tableCards[0];
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
                        if (!p.isSpectator && !p.hasCat) p.isSpectator = true; 
                    });
                }

                if (room.currentRound < 6) {
                    room.currentRound++;
                    room.tableCards = []; room.roundSuit = null;
                    
                    const survivors = room.players.filter(p => !p.isSpectator);
                    if (survivors.length === 1) {
                        room.status = 'waiting';
                        survivors[0].finalWinner = true;
                        io.to('kt_' + roomId).emit('gameWon', { winner: survivors[0].name, winnerId: survivors[0].id, allHands: room.players });
                    } else {
                        io.to('kt_' + roomId).emit('nextRoundStarted', { currentRound: room.currentRound, winnerName: winMove ? winMove.name : 'គ្មាន', currentTurnIndex: room.currentTurnIndex, players: room.players });
                    }
                } else {
                    room.status = 'waiting';
                    const finalWinner = room.players.find(p => p.id === room.lastWinnerId);
                    if(finalWinner) finalWinner.finalWinner = true;
                    io.to('kt_' + roomId).emit('gameWon', { winner: finalWinner ? finalWinner.name : 'គ្មានអ្នកឈ្នះ', winnerId: room.lastWinnerId, allHands: room.players });
                }
            }, 1500);
        } else {
            io.to('kt_' + roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players });
        }
    });