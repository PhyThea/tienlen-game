const CATTE_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_ORDER = { '♠': 0, '♣': 1, '♦': 2, '♥': 3 };

function getCatteCardPower(card) {
    if (!card) return -1;
    return (CATTE_ORDER.indexOf(card.value) * 10) + SUIT_ORDER[card.suit];
}

function sortCatteCards(cards) {
    return cards.sort((a, b) => getCatteCardPower(a) - getCatteCardPower(b));
}

function determineTrickWinner(trickPlays) {
    if (trickPlays.length === 0) return null;
    const leadCard = trickPlays[0].card;
    let winningPlay = trickPlays[0];

    for (let i = 1; i < trickPlays.length; i++) {
        const play = trickPlays[i];
        if (play.card.suit === leadCard.suit) {
            if (getCatteCardPower(play.card) > getCatteCardPower(winningPlay.card)) {
                winningPlay = play;
            }
        }
    }
    return winningPlay.playerId;
}

module.exports = {
    createCatteDeck: () => {
        const suits = ['♠', '♣', '♦', '♥'];
        const deck = [];
        for (const suit of suits) {
            for (const value of CATTE_ORDER) deck.push({ suit, value });
        }
        return deck;
    },
    sortCatteCards,
    determineTrickWinner
};