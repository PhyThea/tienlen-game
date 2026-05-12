// =================================================================
// games/catteLogic.js (ច្បាប់ហ្គេមកាតេ ២ ដល់ ៦ នាក់)
// =================================================================

// ក្នុងហ្គេមកាតេ៖ ៣ តូចជាង ៤ ... តូចជាង K តូចជាង A (អាត់ធំដាច់គេ, ពីរតូចជាងគេ)
const CATTE_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_ORDER = { '♠': 0, '♣': 1, '♦': 2, '♥': 3 };

/**
 * គណនាពិន្ទុ/ថាមពលរបស់សន្លឹកបៀរនីមួយៗ
 * @param {Object} card - សន្លឹកបៀរ { value, suit }
 * @returns {number} ថាមពលសន្លឹកបៀរ
 */
function getCatteCardPower(card) {
    if (!card) return -1;
    return (CATTE_ORDER.indexOf(card.value) * 10) + SUIT_ORDER[card.suit];
}

/**
 * រៀបចំលំដាប់បៀរកាតេក្នុងដៃ (ពីតូចទៅធំ)
 * @param {Array} cards - បញ្ជីសន្លឹកបៀរ
 * @returns {Array} បញ្ជីសន្លឹកបៀរដែលតម្រៀបរួច
 */
function sortCatteCards(cards) {
    return cards.sort((a, b) => getCatteCardPower(a) - getCatteCardPower(b));
}

/**
 * ស្វែងរកអ្នកឈ្នះនៅក្នុងទឹកនីមួយៗ (Round Trick)
 * @param {Array} trickPlays - បញ្ជីបៀរដែលបានចុះក្នុងជុំនេះ [{ playerId, playerName, card, isFold }]
 * @returns {string|null} ID របស់អ្នកឈ្នះទឹក (បើកាត់ផ្កាប់ទាំងអស់ នឹងដឹងលទ្ធផលនៅកូដខាងក្រៅ)
 */
function determineTrickWinner(trickPlays) {
    // យកតែបៀរណាដែលបើកបង្ហាញ (មិនផ្កាប់មុខ)
    const openPlays = trickPlays.filter(p => !p.isFold);
    if (openPlays.length === 0) return null;

    // សន្លឹកបៀរដំបូងគេបង្អស់ដែលគេចុះក្នុងជុំនេះ (បៀរបើកទឹក/បៀរមេជុំ)
    const leadCard = trickPlays[0].card;
    let winningPlay = null;

    for (const play of openPlays) {
        // ច្បាប់កាតេ៖ ត្រូវតែទឹក (Suit) ដូចបៀរបើកទឹក ទើបមានសិទ្ធិប្រជែងយកឈ្នះ
        if (play.card.suit === leadCard.suit) {
            if (!winningPlay || getCatteCardPower(play.card) > getCatteCardPower(winningPlay.card)) {
                winningPlay = play;
            }
        }
    }

    return winningPlay ? winningPlay.playerId : null;
}

/**
 * ពិនិត្យមើលលក្ខខណ្ឌពិសេសពេលចែកបៀរភ្លាមឈ្នះភ្លាម (ទំព័រក្រឡាប់ចាក់/ឈ្នះដាច់)
 * ឧទាហរណ៍៖ មានអាត់ទាំង ៤ សន្លឹក, បៀរទឹកដូចគ្នាទាំង ៦ សន្លឹក, ឬបៀរតូចជាង ៩ ទាំង ៦សន្លឹក។ល។
 * @param {Array} cards - បៀរ ៦ សន្លឹកក្នុងដៃ
 * @returns {string|null} ឈ្មោះលក្ខខណ្ឌឈ្នះដាច់ ឬ null បើលេងធម្មតា
 */
function checkCatteInstantWin(cards) {
    if (cards.length !== 6) return null;

    // ១. ឆែករក អាត់ (A) ៤ សន្លឹក
    const aceCount = cards.filter(c => c.value === 'A').length;
    if (aceCount === 4) return "ឈ្នះដាច់ (មានអាត់ ៤ សន្លឹក)";

    // ២. ឆែករកបៀរទឹកដូចគ្នាទាំង ៦ សន្លឹក (ទំព័រទឹក)
    const firstSuit = cards[0].suit;
    const sameSuitAll = cards.every(c => c.suit === firstSuit);
    if (sameSuitAll) return "ឈ្នះដាច់ (បៀរទឹកដូចគ្នាទាំង ៦ សន្លឹក)";

    // ៣. ឆែករកបៀរតូចជាង ៩ ទាំង ៦ សន្លឹក
    const allUnderNine = cards.every(c => CATTE_ORDER.indexOf(c.value) < CATTE_ORDER.indexOf('9'));
    if (allUnderNine) return "ឈ្នះដាច់ (បៀរតូចជាងលេខ ៩ ទាំង ៦ សន្លឹក)";

    return null;
}

module.exports = {
    CATTE_ORDER,
    getCatteCardPower,
    sortCatteCards,
    determineTrickWinner,
    checkCatteInstantWin
};