export const BALL_CATALOG = [
    { ball_id: 0, item_id: 1, name: 'Master Ball' },
    { ball_id: 1, item_id: 2, name: 'Ultra Ball' },
    { ball_id: 2, item_id: 3, name: 'Great Ball' },
    { ball_id: 3, item_id: 4, name: 'Poke Ball' },
    { ball_id: 4, item_id: 5, name: 'Safari Ball' },
    { ball_id: 5, item_id: 6, name: 'Net Ball' },
    { ball_id: 6, item_id: 7, name: 'Dive Ball' },
    { ball_id: 7, item_id: 8, name: 'Nest Ball' },
    { ball_id: 8, item_id: 9, name: 'Repeat Ball' },
    { ball_id: 9, item_id: 10, name: 'Timer Ball' },
    { ball_id: 10, item_id: 11, name: 'Luxury Ball' },
    { ball_id: 11, item_id: 12, name: 'Premier Ball' },
    { ball_id: 12, item_id: 60, name: 'Dusk Ball' },
    { ball_id: 13, item_id: 61, name: 'Heal Ball' },
    { ball_id: 14, item_id: 62, name: 'Quick Ball' },
    { ball_id: 15, item_id: 53, name: 'Cherish Ball' },
    { ball_id: 16, item_id: 52, name: 'Park Ball' },
    { ball_id: 17, item_id: 622, name: 'Fast Ball' },
    { ball_id: 18, item_id: 623, name: 'Level Ball' },
    { ball_id: 19, item_id: 624, name: 'Lure Ball' },
    { ball_id: 20, item_id: 625, name: 'Heavy Ball' },
    { ball_id: 21, item_id: 626, name: 'Love Ball' },
    { ball_id: 22, item_id: 627, name: 'Friend Ball' },
    { ball_id: 23, item_id: 628, name: 'Moon Ball' },
    { ball_id: 24, item_id: 629, name: 'Sport Ball' },
    { ball_id: 25, item_id: 630, name: 'Beast Ball' },
    { ball_id: 26, item_id: 631, name: 'Dream Ball' },
];

export const BALL_BY_ID = new Map(BALL_CATALOG.map((entry) => [entry.ball_id, entry]));

export function getBallMeta(ballId) {
    const bid = Number(ballId);
    const meta = BALL_BY_ID.get(bid);
    if (meta) {
        return {
            ball_id: bid,
            ball_item_id: meta.item_id,
            ball_name: meta.name,
        };
    }
    return {
        ball_id: bid,
        ball_item_id: null,
        ball_name: `Unknown Ball #${bid}`,
    };
}

export function getBallsList() {
    return BALL_CATALOG.map((entry) => ({ ...entry }));
}

export function validateBallId(ballId) {
    const bid = Number(ballId);
    if (!Number.isInteger(bid) || !BALL_BY_ID.has(bid)) {
        throw new Error('Invalid ball_id');
    }
    return bid;
}
