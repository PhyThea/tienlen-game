// =================================================================
// server_tienlen.js (ច្បាប់កែសម្រួលពិសេស៖ ២គូរៀបចុះបាន, ការ៉ែកាត់បានតែហាយទោល, ៤គូកាត់បានទាំងទោល/គូ)
// =================================================================

const CARD_ORDER = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUIT_ORDER = { '♠': 0, '♣': 1, '♦': 2, '♥': 3 };

// បង្កើតបៀរ ៥២ សន្លឹក
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

// ក្រឡុកបៀរ
function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// គណនាកម្លាំងសន្លឹកបៀរនីមួយៗ
function getCardPower(card) {
    return (CARD_ORDER.indexOf(card.value) * 10) + SUIT_ORDER[card.suit];
}

// រៀបចំបៀរពីតូចទៅធំ
function sortCards(cards) {
    return cards.sort((a, b) => getCardPower(a) - getCardPower(b));
}

// ពិនិត្យមើលលក្ខខណ្ឌគូរៀប (Consecutive Pairs) ចាប់ពី ២ គូរៀបឡើងទៅ (៤ សន្លឹក)
function isConsecutivePairs(cards) {
    const len = cards.length;
    if (len < 4 || len % 2 !== 0) return false;
    const sorted = sortCards([...cards]);

    // ពិនិត្យមើលថាវាសន្លឹកគូពិតមែនឬទេ
    for (let i = 0; i < len; i += 2) {
        if (sorted[i].value !== sorted[i+1].value) return false;
    }

    // ពិនិត្យមើលលំដាប់លំដោយរៀបគ្នាពីតូចទៅធំ និងមិនឱ្យមានលេខ ២ ឡើយ
    for (let i = 0; i < len - 2; i += 2) {
        const currentIdx = CARD_ORDER.indexOf(sorted[i].value);
        const nextIdx = CARD_ORDER.indexOf(sorted[i+2].value);
        
        if (sorted[i].value === '2' || sorted[i+2].value === '2') return false;
        if (nextIdx !== currentIdx + 1) return false;
    }

    return true;
}

// កំណត់ប្រភេទបៀរដែលបានចុះ (Single, Pair, Triple, Bomb, Straight...)
function getComboType(cards) {
    const len = cards.length;
    if (len === 0) return null;
    if (len === 1) return 'single';
    
    const sorted = sortCards([...cards]);
    const sameValue = cards.every(c => c.value === cards[0].value);

    if (sameValue) {
        if (len === 2) return 'pair';
        if (len === 3) return 'triple'; 
        if (len === 4) return 'bomb';   // ការ៉េ (ប៊ុម)
    }

    if (isConsecutivePairs(cards)) {
        if (len === 4) return 'double_pair'; // 🎯 ២ គូរៀប
        if (len === 6) return 'triple_pair'; // ៣ គូរៀប
        if (len === 8) return 'quad_pair';   // ៤ គូរៀប
        return 'consec_pairs';
    }

    // ពិនិត្យលក្ខខណ្ឌបៀររៀង (Straight) - កែសម្រួលការពារ Bug សន្លឹកជាន់គ្នា
    let isStr = true;
    for (let i = 1; i < len; i++) {
        const prevIdx = CARD_ORDER.indexOf(sorted[i-1].value);
        const currIdx = CARD_ORDER.indexOf(sorted[i].value);
        
        if (currIdx !== prevIdx + 1) isStr = false;
        if (sorted[i].value === '2' || sorted[i-1].value === '2') isStr = false; 
    }

    if (isStr && len >= 3) {
        const sameSuit = cards.every(c => c.suit === cards[0].suit);
        if (sameSuit) return 'straight_flush'; // រៀងប៉ូលីស
        return 'straight'; // រៀងធម្មតា
    }

    return null;
}

// ពិនិត្យមើលលក្ខខណ្ឌឈ្នះស៊ុយដាច់ភ្លាមៗពេលចែកបៀររួច (Instant Win)
function checkInstantWin(hand) {
    if (!hand || hand.length !== 13) return null;
    const sorted = sortCards([...hand]);

    let isDragonStraight = true;
    for (let i = 0; i < 12; i++) {
        if (CARD_ORDER.indexOf(sorted[i+1].value) !== CARD_ORDER.indexOf(sorted[i].value) + 1) {
            isDragonStraight = false;
            break;
        }
    }
    if (isDragonStraight) return "បៀមួយទឹកខ្សែនាគ (ស៊ុយដាច់)!";

    const isRed = (card) => card.suit === '♦' || card.suit === '♥';
    const isBlack = (card) => card.suit === '♠' || card.suit === '♣';
    if (hand.every(isRed) || hand.every(isBlack)) return "បៀមួយពណ៌ (ស៊ុយដាច់)!";

    let pairCount = 0;
    let i = 0;
    while (i < 12) {
        if (sorted[i].value === sorted[i+1].value) {
            pairCount++;
            i += 2; 
        } else {
            i++;
        }
    }
    if (pairCount >= 6) return "បៀមាន ៦ គូ (ស៊ុយដាច់)!";

    const twos = hand.filter(c => c.value === '2');
    if (twos.length === 4) return "ប៊ុមលេខ ២ ទាំងបួន (ស៊ុយដាច់)!";

    return null;
}

// 👑 ប្រៀបធៀបបៀរវាយកាត់តាមច្បាប់ថ្មីដាច់ខាត
function comparePlay(newCards, oldCards) {
    if (!oldCards || oldCards.length === 0) return true;
    
    let newType = getComboType(newCards);
    let oldType = getComboType(oldCards);

    if (!newType) return false; 

    const sortedNew = sortCards([...newCards]);
    const sortedOld = sortCards([...oldCards]);

    const newMax = getCardPower(sortedNew[sortedNew.length - 1]);
    const oldMax = getCardPower(sortedOld[sortedOld.length - 1]);

    // 🚨 ច្បាប់ទី ១៖ ប្រព័ន្ធបៀររៀង (Straight និង Straight Flush)
    if (newCards.length === oldCards.length) {
        if ((newType === 'straight' || newType === 'straight_flush') && (oldType === 'straight' || oldType === 'straight_flush')) {
            if (oldType === 'straight_flush') {
                return newType === 'straight_flush' && newMax > oldMax;
            }
            if (oldType === 'straight') {
                return newMax > oldMax;
            }
        }
    }

    // 🚨 ច្បាប់ទី ២៖ ហាយទោល (Single 2) 
    if (oldType === 'single' && oldCards[0].value === '2') {
        if (newType === 'single' && newCards[0].value === '2' && newMax > oldMax) return true;
        if (newType === 'bomb' || newType === 'quad_pair') return true;
        return false;
    }

    // 🚨 ច្បាប់ទី ៣៖ ហាយគូ (Pair 2)
    if (oldType === 'pair' && oldCards[0].value === '2') {
        if (newType === 'pair' && newCards[0].value === '2' && newMax > oldMax) return true;
        if (newType === 'quad_pair') return true; // มีแต่ 4 คู่ริយបเท่านั้นដដែលកាត់បាន
        return false;
    }

    // 🚨 ច្បាប់ទី ៤៖ ២ គូរៀប (Double Pair)
    if (oldType === 'double_pair') {
        if (newType === 'double_pair' && newMax > oldMax) return true;
        return false;
    }

    // 🚨 ច្បាប់ទី ៥៖ ការ៉េ (Bomb)
    if (oldType === 'bomb') {
        if (newType === 'bomb' && newMax > oldMax) return true;
        if (newType === 'quad_pair') return true; 
        return false;
    }

    // 🚨 ច្បាប់ទី ៦៖ ៣ គូរៀប (Triple Pair)
    if (oldType === 'triple_pair') {
        if (newType === 'triple_pair' && newMax > oldMax) return true;
        return false;
    }

    // 🚨 ច្បាប់ទី ៧៖ ៤ គូរៀប (Quad Pair)
    if (oldType === 'quad_pair') {
        if (newType === 'quad_pair' && newMax > oldMax) return true;
        return false;
    }

    // ករណីប្រភេទ Combo ធម្មតាដូចគ្នាផ្សេងទៀត
    if (newType === oldType && newCards.length === oldCards.length) {
        return newMax > oldMax;
    }

    return false;
}

module.exports = {
    CARD_ORDER,
    SUIT_ORDER,
    createDeck,
    shuffleDeck,
    getCardPower,
    sortCards,
    getComboType,
    checkInstantWin,
    comparePlay
};
