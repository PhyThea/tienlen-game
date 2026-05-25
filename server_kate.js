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

        // =================================================================
        // 🛠️ ដាក់កំហិតច្បាប់ស៊ីបៀរ៖ ជុំទី ១ ដល់ ទី ៤ (វគ្គដេញទឹក និងស៊ីបៀរ)
        // =================================================================
        if (room.currentRound <= 4) {
            if (room.tableCards.length === 0) {
                // អ្នកចេញបៀរដំបូងគេក្នុងជុំ ត្រូវតែប្រើ action === 'play' (ស៊ីបៀរ) និងកំណត់ទឹក (Suit)
                if (action !== 'play') return socket.emit('errorMsg', 'សន្លឹកដំបូងបង្អស់ត្រូវតែចុះស៊ីបៀរ!');
                room.roundSuit = card.suit;
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'ស៊ីបៀរ' });
            } else {
                // អ្នកវេនបន្ទាប់៖ 
                if (action === 'play') {
                    // បើចុចប៊ូតុង "ស៊ីបៀរ" តែទឹកបៀរមិនត្រូវគ្នា (ខុស Suit) -> បដិសេធ មិនឱ្យចុះដាច់ខាត!
                    if (card.suit !== room.roundSuit) {
                        return socket.emit('errorMsg', 'ទឹកបៀរមិនត្រឹមត្រូវ! ត្រូវតែលេងទឹក ' + room.roundSuit + ' ឬជ្រើសរើសចុចប៊ូតុង ផ្កាប់បៀរ (ធីប)។');
                    }
                    // ពិនិត្យមើលបៀរដែលធំជាងគេនៅលើតុបច្ចុប្បន្នដែលមានទឹកដូចគ្នា
                    const sameSuitCards = room.tableCards.filter(m => m.card.suit === room.roundSuit && m.action === 'ស៊ីបៀរ');
                    if (sameSuitCards.length > 0) {
                        sameSuitCards.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card));
                        const highestCardOnTable = sameSuitCards[0].card;
                        // បើទឹកត្រូវ តែសន្លឹកបៀរតូចជាងគេនៅលើតុ -> មិនឱ្យចុះដូចគ្នា
                        if (ktModule.getKatePower(card) <= ktModule.getKatePower(highestCardOnTable)) {
                            return socket.emit('errorMsg', 'បៀររបស់អ្នកតូចជាងបៀរនៅលើតុ! មិនអាចស៊ីបានទេ ត្រូវតែជ្រើសរើសចុចប៊ូតុង ផ្កាប់បៀរ (ធីប)។');
                        }
                    }
                    room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'ស៊ីបៀរ' });
                } else {
                    // លុះត្រាតែអ្នកលេងចុចប៊ូតុង "ផ្កាប់បៀរ (ធីប)" (action !== 'play') ទើបប្រព័ន្ធអនុញ្ញាតឱ្យផ្កាប់បៀរធ្លាក់សន្លឹកបាន
                    room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'ធីបហើយ' });
                }
            }
        } 
        // =================================================================
        // ជុំទី ៥៖ វគ្គគប់បៀរ (អនុញ្ញាតឱ្យបង្ហាញមុខបៀរ ទោះចាក់ខុសទឹក ឬត្រូវទឹក)
        // =================================================================
        else if (room.currentRound === 5) {
            if (room.tableCards.length === 0) {
                room.roundSuit = card.suit; 
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'គប់ទេ' });
            } else {
                const isMatch = (card.suit === room.roundSuit && ktModule.getKatePower(card) > ktModule.getKatePower(room.tableCards[0].card));
                room.tableCards.push({ playerId: player.id, name: player.name, card, action: isMatch ? 'គប់ហើយ' : 'អត់គប់ទេ' });
            }
        } 
        // =================================================================
        // ជុំទី ៦៖ បង្ហាញលទ្ធផលចុងក្រោយ
        // =================================================================
        else if (room.currentRound === 6) { 
            room.tableCards.push({ playerId: player.id, name: player.name, card, action: 'លទ្ធផលចុងក្រោយ' }); 
        }

        // ដកសន្លឹកបៀរចេញពីដៃរបស់អ្នកលេង (បន្ទាប់ពីឆ្លងកាត់លក្ខខណ្ឌតឹងរឹងខាងលើរួចរាល់)
        const cardIdx = player.hand.findIndex(c => c.value === card.value && c.suit === card.suit); 
        if (cardIdx !== -1) player.hand.splice(cardIdx, 1);

        io.to('kt_' + roomId).emit('moveRecorded', { by: player.name, action, card, tableCards: room.tableCards, round: room.currentRound });
        io.to(player.id).emit('dealCards', { hand: player.hand }); 

        let nextTurn = (room.currentTurnIndex + 1) % room.players.length; let attempts = 0;
        while (room.players[nextTurn].isSpectator && attempts < room.players.length) { nextTurn = (nextTurn + 1) % room.players.length; attempts++; }
        room.currentTurnIndex = nextTurn;
        
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
                    if (cutters.length > 0) { cutters.sort((a,b) => ktModule.getKatePower(b.card) - ktModule.getKatePower(a.card)); winMove = cutters[0]; } else { winMove = room.tableCards[0]; }
                } else { winMove = room.tableCards[0]; }

                if (winMove) {
                    const winnerPl = room.players.find(p => p.id === winMove.playerId);
                    if(winnerPl) {
                        winnerPl.winRounds++; if(room.currentRound <= 4) winnerPl.hasCat = true; room.lastWinnerId = winnerPl.id; room.currentTurnIndex = room.players.findIndex(p => p.id === winnerPl.id);
                        io.to('kt_' + roomId).emit('winnerTransferred', { newWinnerId: room.lastWinnerId, creatorId: room.creatorId });
                    }
                }
                if (room.currentRound === 4) { room.players.forEach(p => { if (!p.isSpectator && !p.hasCat) p.isSpectator = true; }); }

                if (room.currentRound < 6) {
                    room.currentRound++; room.tableCards = []; room.roundSuit = null; const survivors = room.players.filter(p => !p.isSpectator);
                    if (survivors.length === 1) {
                        room.status = 'waiting'; survivors[0].finalWinner = true;
                        const finalHandsResult = room.players.map(p => ({ name: p.name, initialHandCopy: p.initialHandCopy, winRounds: p.winRounds, finalWinner: p.id === survivors[0].id, isSpectator: p.isSpectator }));
                        io.to('kt_' + roomId).emit('gameWon', { winner: survivors[0].name, winnerId: survivors[0].id, allHands: finalHandsResult });
                    } else { io.to('kt_' + roomId).emit('nextRoundStarted', { currentRound: room.currentRound, winnerName: winMove ? winMove.name : 'គ្មាន', currentTurnIndex: room.currentTurnIndex, players: room.players }); }
                } else {
                    room.status = 'waiting'; const finalWinner = room.players.find(p => p.id === room.lastWinnerId); if(finalWinner) finalWinner.finalWinner = true;
                    const finalHandsResult = room.players.map(p => ({ name: p.name, initialHandCopy: p.initialHandCopy, winRounds: p.winRounds, finalWinner: p.id === room.lastWinnerId, isSpectator: p.isSpectator }));
                    io.to('kt_' + roomId).emit('gameWon', { winner: finalWinner ? finalWinner.name : 'គ្មានអ្នកឈ្នះ', winnerId: room.lastWinnerId, allHands: finalHandsResult });
                }
            }, 1500);
        } else { io.to('kt_' + roomId).emit('turnChanged', { currentTurnIndex: room.currentTurnIndex, players: room.players }); }
    });