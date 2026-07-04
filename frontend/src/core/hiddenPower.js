const HIDDEN_POWER_TYPES = [
    'Fighting',
    'Flying',
    'Poison',
    'Ground',
    'Rock',
    'Bug',
    'Ghost',
    'Steel',
    'Fire',
    'Water',
    'Grass',
    'Electric',
    'Psychic',
    'Ice',
    'Dragon',
    'Dark',
];

function normalizeSpeedStat(stats = {}) {
    const next = { ...stats };
    if (next.Spd !== undefined && next.Spe === undefined) {
        next.Spe = next.Spd;
        delete next.Spd;
    }
    return next;
}

export function calculateHiddenPowerType(ivs = {}) {
    const normalized = normalizeSpeedStat(ivs);
    const hp = Number(normalized.HP ?? 0) & 1;
    const atk = Number(normalized.Atk ?? 0) & 1;
    const def = Number(normalized.Def ?? 0) & 1;
    const spe = Number(normalized.Spe ?? 0) & 1;
    const spa = Number(normalized.SpA ?? 0) & 1;
    const spd = Number(normalized.SpD ?? 0) & 1;

    const value = hp + (2 * atk) + (4 * def) + (8 * spe) + (16 * spa) + (32 * spd);
    const typeIndex = Math.floor((value * 15) / 63);
    return HIDDEN_POWER_TYPES[typeIndex] || null;
}
