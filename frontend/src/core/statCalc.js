import speciesBaseStats from './speciesBaseStats.json' with { type: 'json' };

function normalizeSpeedStat(stats = {}) {
    const next = { ...stats };
    if (next.Spd !== undefined && next.Spe === undefined) {
        next.Spe = next.Spd;
        delete next.Spd;
    }
    return next;
}

function natureModifier(natureId, statKey) {
    const incDec = {
        0: [null, null],
        1: ['atk', 'def'],
        2: ['atk', 'spe'],
        3: ['atk', 'spa'],
        4: ['atk', 'spd'],
        5: ['def', 'atk'],
        6: [null, null],
        7: ['def', 'spe'],
        8: ['def', 'spa'],
        9: ['def', 'spd'],
        10: ['spe', 'atk'],
        11: ['spe', 'def'],
        12: [null, null],
        13: ['spe', 'spa'],
        14: ['spe', 'spd'],
        15: ['spa', 'atk'],
        16: ['spa', 'def'],
        17: ['spa', 'spe'],
        18: [null, null],
        19: ['spa', 'spd'],
        20: ['spd', 'atk'],
        21: ['spd', 'def'],
        22: ['spd', 'spe'],
        23: ['spd', 'spa'],
        24: [null, null],
    };
    const [inc, dec] = incDec[Number(natureId) % 25] || [null, null];
    if (statKey === inc) {
        return 1.1;
    }
    if (statKey === dec) {
        return 0.9;
    }
    return 1.0;
}

function calcHpStat(base, iv, ev, level) {
    return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
}

function calcOtherStat(base, iv, ev, level, natureMult) {
    const neutral = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5;
    return Math.floor(neutral * natureMult);
}

export function calculateBattleStats({ speciesId, level, natureId, ivs, evs }) {
    const base = speciesBaseStats?.[String(speciesId)];
    const resolvedLevel = Number(level);
    if (!base || !Number.isFinite(resolvedLevel) || resolvedLevel < 1) {
        return null;
    }

    const normalizedIvs = normalizeSpeedStat(ivs || {});
    const normalizedEvs = normalizeSpeedStat(evs || {});
    const resolvedNatureId = Number.isFinite(natureId) ? natureId : 0;

    return {
        HP: calcHpStat(Number(base.hp), normalizedIvs.HP ?? 0, normalizedEvs.HP ?? 0, resolvedLevel),
        Atk: calcOtherStat(Number(base.atk), normalizedIvs.Atk ?? 0, normalizedEvs.Atk ?? 0, resolvedLevel, natureModifier(resolvedNatureId, 'atk')),
        Def: calcOtherStat(Number(base.def), normalizedIvs.Def ?? 0, normalizedEvs.Def ?? 0, resolvedLevel, natureModifier(resolvedNatureId, 'def')),
        SpA: calcOtherStat(Number(base.spa), normalizedIvs.SpA ?? 0, normalizedEvs.SpA ?? 0, resolvedLevel, natureModifier(resolvedNatureId, 'spa')),
        SpD: calcOtherStat(Number(base.spd), normalizedIvs.SpD ?? 0, normalizedEvs.SpD ?? 0, resolvedLevel, natureModifier(resolvedNatureId, 'spd')),
        Spe: calcOtherStat(Number(base.spe), normalizedIvs.Spe ?? 0, normalizedEvs.Spe ?? 0, resolvedLevel, natureModifier(resolvedNatureId, 'spe')),
    };
}

export function getSpeciesBst(speciesId) {
    const base = speciesBaseStats?.[String(speciesId)];
    if (!base) {
        return null;
    }
    return Number(base.hp) + Number(base.atk) + Number(base.def)
        + Number(base.spa) + Number(base.spd) + Number(base.spe);
}
