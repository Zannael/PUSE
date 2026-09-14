import speciesBaseStats from './speciesBaseStats.json' with { type: 'json' };

const HIDDEN_POWER_TYPES = [
    'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel',
    'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark',
];

function normalizeStats(stats = {}) {
    return {
        HP: Number(stats.HP ?? 0),
        Atk: Number(stats.Atk ?? 0),
        Def: Number(stats.Def ?? 0),
        Spe: Number(stats.Spe ?? stats.Spd ?? 0),
        SpA: Number(stats.SpA ?? 0),
        SpD: Number(stats.SpD ?? 0),
    };
}

function natureModifier(natureId, statKey) {
    const incDec = [
        [null, null], ['atk', 'def'], ['atk', 'spe'], ['atk', 'spa'], ['atk', 'spd'],
        ['def', 'atk'], [null, null], ['def', 'spe'], ['def', 'spa'], ['def', 'spd'],
        ['spe', 'atk'], ['spe', 'def'], [null, null], ['spe', 'spa'], ['spe', 'spd'],
        ['spa', 'atk'], ['spa', 'def'], ['spa', 'spe'], [null, null], ['spa', 'spd'],
        ['spd', 'atk'], ['spd', 'def'], ['spd', 'spe'], ['spd', 'spa'], [null, null],
    ];
    const [increased, decreased] = incDec[((Number(natureId) % 25) + 25) % 25] || [null, null];
    if (statKey === increased) return 1.1;
    if (statKey === decreased) return 0.9;
    return 1;
}

function calculateHp(base, iv, ev, level) {
    return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
}

function calculateOther(base, iv, ev, level, modifier) {
    const neutral = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5;
    return Math.floor(neutral * modifier);
}

export function calculateBattleStats({ speciesId, level, natureId, ivs, evs }) {
    const base = speciesBaseStats?.[String(speciesId)];
    const resolvedLevel = Number(level);
    if (!base || !Number.isFinite(resolvedLevel) || resolvedLevel < 1) return null;

    const resolvedIvs = normalizeStats(ivs);
    const resolvedEvs = normalizeStats(evs);
    return {
        HP: calculateHp(Number(base.hp), resolvedIvs.HP, resolvedEvs.HP, resolvedLevel),
        Atk: calculateOther(Number(base.atk), resolvedIvs.Atk, resolvedEvs.Atk, resolvedLevel, natureModifier(natureId, 'atk')),
        Def: calculateOther(Number(base.def), resolvedIvs.Def, resolvedEvs.Def, resolvedLevel, natureModifier(natureId, 'def')),
        SpA: calculateOther(Number(base.spa), resolvedIvs.SpA, resolvedEvs.SpA, resolvedLevel, natureModifier(natureId, 'spa')),
        SpD: calculateOther(Number(base.spd), resolvedIvs.SpD, resolvedEvs.SpD, resolvedLevel, natureModifier(natureId, 'spd')),
        Spe: calculateOther(Number(base.spe), resolvedIvs.Spe, resolvedEvs.Spe, resolvedLevel, natureModifier(natureId, 'spe')),
    };
}

export function calculateHiddenPowerType(ivs = {}) {
    const values = normalizeStats(ivs);
    const parity = (values.HP & 1)
        + (2 * (values.Atk & 1))
        + (4 * (values.Def & 1))
        + (8 * (values.Spe & 1))
        + (16 * (values.SpA & 1))
        + (32 * (values.SpD & 1));
    return HIDDEN_POWER_TYPES[Math.floor((parity * 15) / 63)] || null;
}

export function calculateBattlePreview(input) {
    return {
        battle_stats: calculateBattleStats(input),
        hidden_power_type: calculateHiddenPowerType(input?.ivs),
    };
}
