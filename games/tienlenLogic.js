// =================================================================
// games/tienlenLogic.js (ច្បាប់ហ្គេមទៀនឡេន - ស៊ីកាត់ពិសេស)
// =================================================================

const CARD_ORDER = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUIT_ORDER = { '♠': 0, '♣': 1, '♦': 2, '♥': 3 };

function getCardPower(card) {
    return (CARD_ORDER.indexOf(card.value) * 10) + SUIT_ORDER[card.suit];
}

function sortCards(cards) {
    return cards.sort((a, b) => getCardPower(a) - getCardPower(b));
}

function getComboType(cards) {
    const len = cards.length;
    if (len === 0) return null;
    if (len === 1) return 'single';
    
    const sorted = sortCards([...cards]);
    const sameValue = cards.every(c => c.value === cards[0].value);
    
    if (sameValue) {
        if (len === 2) return 'pair';
        if (len === 3) return 'triple'; 
        if (len === 4) return 'bomb';   // ការ៉េ
    }

    // ឆែក ៣ ផែជាប់គ្នា (៦ សន្លឹក)
    if (len === 6) {
        let is3Pair = true;
        for (let i = 0; i < 6; i += 2) {
            if (sorted[i].value !== sorted[i+1].value) is3Pair = false;
            if (i > 0 && CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-2].value) + 1) is3Pair = false;
        }
        if (sorted[4].value === '2') is3Pair = false; // ផែហាយ (ពីរ) មិនអាចចូលឡូបានទេ
        if (is3Pair) return 'triple_pair';
    }

    // ឆែក ៤ ផែជាប់គ្នា (៨ សន្លឹក)
    if (len === 8) {
        let is4Pair = true;
        for (let i = 0; i < 8; i += 2) {
            if (sorted[i].value !== sorted[i+1].value) is4Pair = false;
            if (i > 0 && CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-2].value) + 1) is4Pair = false;
        }
        if (sorted[6].value === '2') is4Pair = false;
        if (is4Pair) return 'quad_pair';
    }

    // ឆែកខ្សែ (Straight)
    let isStr = true;
    for (let i = 1; i < len; i++) {
        if (CARD_ORDER.indexOf(sorted[i].value) !== CARD_ORDER.indexOf(sorted[i-1].value) + 1) isStr = false;
        if (sorted[i].value === '2') isStr = false; // ហាយ (ពីរ) មិនអាចរត់ចូលខ្សែបានទេ
    }

    if (isStr && len >= 3) {
        const sameSuit = cards.every(c => c.suit === cards[0].suit);
        if (sameSuit) return 'straight_flush'; 
        return 'straight'; 
    }

    return null;
}

function comparePlay(newCards, oldCards) {
    if (!oldCards || oldCards.length === 0) return true;
    
    const newType = getComboType(newCards);
    const oldType = getComboType(oldCards);
    
    if (!newType) return false; // បៀរចុះមកមិនត្រូវក្បួន

    const newMax = getCardPower(sortCards([...newCards]).pop());
    const oldMax = getCardPower(sortCards([...oldCards]).pop());

    // --- ច្បាប់ស៊ីកាត់ពិសេស (Special Cut Rules) ---
    
    // ១. បើនៅលើតុជាបៀរ ហាយ សន្លឹកទោល (Single 2)
    if (oldType === 'single' && oldCards[0].value === '2') {
        // ការ៉េ (bomb) ឬ ៤ផែជាប់គ្នា (quad_pair) អាចកាត់បាន (ឯ ៣ផែជាប់គ្នា កាត់មិនបានទេ)
        if (newType === 'bomb' || newType === 'quad_pair') return true;
    }

    // ២. បើនៅលើតុជា ការ៉េ (Bomb)
    if (oldType === 'bomb') {
        // ការ៉េដែលធំជាង ឬ ៤ផែជាប់គ្នា អាចស៊ីបាន
        if (newType === 'bomb' && newMax > oldMax) return true;
        if (newType === 'quad_pair') return true;
    }

    // ៣. បើនៅលើតុជា ៤ផែជាប់គ្នា (Quad Pair)
    if (oldType === 'quad_pair') {
        // មានតែ ៤ផែជាប់គ្នាដូចគ្នាដែលមេធំជាងទេ ទើបស៊ីបាន
        if (newType === 'quad_pair' && newMax > oldMax) return true;
    }

    // ៤. បើនៅលើតុជា ៣ផែជាប់គ្នា (Triple Pair)
    if (oldType === 'triple_pair') {
        // តាមសំណូមពរ៖ ៣ផែជាប់គ្នា បានតែ ៣ផែជាប់គ្នាដូចគ្នាដែលធំជាងប៉ុណ្ណោះ (មិនអាចកាត់ហាយ ហើយគ្មានអ្វីកាត់វាបាន)
        if (newType === 'triple_pair' && newMax > oldMax) return true;
    }

    // ៥. ករណីបៀរក្បួនដូចគ្នា និងចំនួនសន្លឹកស្មើគ្នា (លេងទូទៅ)
    if (newType === oldType && newCards.length === oldCards.length) {
        return newMax > oldMax;
    }

    return false;
}

module.exports = {
    CARD_ORDER,
    SUIT_ORDER,
    getCardPower,
    sortCards,
    getComboType,
    comparePlay
};