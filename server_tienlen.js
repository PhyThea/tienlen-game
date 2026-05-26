// =================================================================
// server_tienlen.js (ច្បាប់លេង ទៀនឡេន ពេញលេញ - មិនឱ្យបាត់មុខងារ)
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

    for (let i = 0; i < len; i += 2) {
        if (sorted[i].value !== sorted[i+1].value) return false;
    }

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
        if (len === 4) return 'bomb';   
    }

    if (isConsecutivePairs(cards)) {
        if (len === 4) return 'double_pair'; 
        if (len === 6) return 'triple_pair'; 
        if (len === 8) return 'quad_pair';   
        return 'consec_pairs';
    }

    let isStr = true;
    for (let i = 1; i < len; i++) {
        if (CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-1].value) + 1) isStr = false;
        if (sorted[i].value === '2' || sorted[i-1].value === '2') isStr = false; 
    }

    // 🚨 កែសម្រួល៖ ឲ្យប្រព័ន្ធស្គាល់ថា 'straight_flush' (រៀងប៉ូលីស) ក៏ជា 'straight' (រៀង) មួយប្រភេទដែរ
    if (isStr && len >= 3) {
        const sameSuit = cards.every(c => c.suit === cards[0].suit);
        if (sameSuit) return 'straight_flush'; 
        return 'straight'; 
    }

    return null;
}

// ពិនិត្យមើលលក្ខខណ្ឌឈ្នះស៊ុយដាច់ភ្លាមៗពេលចែកបៀររួច (Instant Win)
function checkInstantWin(hand) {
    if (!hand || hand.length !== 13) return null;
    const sorted = sortCards([...hand]);

    // ១. ករណីខ្សែនាគ (Straight ១៣ សន្លឹកពីលេខ ៣ ដល់ អាត់)
    let isDragonStraight = true;
    for (let i = 0; i < 12; i++) {
        if (CARD_ORDER.indexOf(sorted[i+1].value) !== CARD_ORDER.indexOf(sorted[i].value) + 1) {
            isDragonStraight = false;
            break;
        }
    }
    if (isDragonStraight) return "បៀមួយទឹកខ្សែនាគ (ស៊ុយដាច់)!";

    // ២. ករណីបៀសន្លឹកពណ៌ដូចគ្នាទាំងអស់ (ខ្មៅទាំងអស់ ឬ ក្រហមទាំងអស់)
    const isRed = (card) => card.suit === '♦' || card.suit === '♥';
    const isBlack = (card) => card.suit === '♠' || card.suit === '♣';
    if (hand.every(isRed) || hand.every(isBlack)) return "បៀមួយពណ៌ (ស៊ុយដាច់)!";

    // ៣. ករណីបៀមាន ៦ គូ
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

    // ៤. ករណីបៀមាន អាត់២ ទាំងបួនសន្លឹក (ប៊ុមលេខ ២)
    const twos = hand.filter(c => c.value === '2');
    if (twos.length === 4) return "ប៊ុមលេខ ២ ទាំងបួន (ស៊ុយដាច់)!";

    return null;
}

// ប្រៀបធៀបបៀរដែលចុះថ្មី ជាមួយនឹងបៀរនៅលើតុ (ច្បាប់វាយកាត់បៀរ ២)
function comparePlay(newCards, oldCards) {
    if (!oldCards || oldCards.length === 0) return true;
    
    let newType = getComboType(newCards);
    let oldType = getComboType(oldCards);

    if (!newType) return false; 

    // 🚨 ជួសជុល៖ បើបៀរនៅលើតុ ឬបៀរចុះថ្មីជា "រៀងប៉ូលីស" (straight_flush) 
    // គឺយើងចាត់ទុកវាជាប្រភេទ "រៀង" (straight) ដូចគ្នា ដើម្បីអាចឱ្យវាយវាស់កម្លាំងគ្នាបានធម្មតា
    if (newType === 'straight_flush') newType = 'straight';
    if (oldType === 'straight_flush') oldType = 'straight';

    const sortedNew = sortCards([...newCards]);
    const sortedOld = sortCards([...oldCards]);

    const newMax = getCardPower(sortedNew[sortedNew.length - 1]);
    const oldMax = getCardPower(sortedOld[sortedOld.length - 1]);

    // ច្បាប់វាយកាត់បៀរ ២ ទោល (Single 2) -> អាចកាត់បានដោយ ៣គូរៀប, ៤គូរៀប ឬ ប៊ុម (Bomb)
    if (oldType === 'single' && oldCards[0].value === '2') {
        if (newType === 'triple_pair' || newType === 'quad_pair' || newType === 'bomb') return true;
    }

    // ច្បាប់វាយកាត់បៀរគូ ២ (Pair 2) -> អាចកាត់បានដោយ ៤គូរៀប ឬ ប៊ុម (Bomb)
    if (oldType === 'pair' && oldCards[0].value === '2') {
        if (newType === 'quad_pair' || newType === 'bomb') return true;
    }

    // ច្បាប់ប៊ុម (Bomb) កាត់ប៊ុម ឬកាត់គូរៀប
    if (oldType === 'bomb') {
        if (newType === 'bomb' && newMax > oldMax) return true;
        if (newType === 'quad_pair') return true;
    }

    // ៣ គូរៀប កាត់គ្នា ឬត្រូវប៊ុម/៤គូរៀប កាត់
    if (oldType === 'triple_pair') {
        if (newType === 'triple_pair' && newMax > oldMax) return true;
        if (newType === 'quad_pair' || newType === 'bomb') return true;
    }

    // ៤ គូរៀប កាត់ ៤គូរៀប ធំជាង
    if (oldType === 'quad_pair') {
        if (newType === 'quad_pair' && newMax > oldMax) return true;
    }

    // ករណីប្រភេទ Combo ដូចគ្នា (រួមទាំង រៀង ផ្ដួល រៀងប៉ូលីស) និងចំនួនសន្លឹកស្មើគ្នា គឺវាស់កម្លាំងសន្លឹកធំបំផុត
    if (newType === oldType && newCards.length === oldCards.length) {
        return newMax > oldMax;
    }

    return false;
}
module.exports = {
    CARD_ORDER,
    SUIT_ORDER,
    createDeck,
    shuffleDeck, // 🛠️ ថែមមុខងារនេះចូល ដើម្បីកុំឱ្យហ្គេមកាតេ Crash ពេលចាប់ផ្ដើម
    getCardPower,
    sortCards,
    getComboType,
    checkInstantWin,
    comparePlay
};