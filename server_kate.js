// កាតេលំដាប់កម្លាំងបៀ៖ A ធំជាងគេ បន្ទាប់មក K, Q, J, 10... ដល់ 2 តូចជាងគេ
const KATE_ORDER = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const KATE_SUITS = ['♠', '♣', '♦', '♥'];

function createKateDeck() {
    const deck = [];
    for (const suit of KATE_SUITS) {
        for (const value of KATE_ORDER) {
            deck.push({ suit, value });
        }
    }
    return deck;
}

function sortKateCards(cards) {
    return cards.sort((a, b) => KATE_ORDER.indexOf(a.value) - KATE_ORDER.indexOf(b.value));
}

function getKatePower(card) {
    return KATE_ORDER.indexOf(card.value);
}

module.exports = { createKateDeck, sortKateCards, getKatePower };