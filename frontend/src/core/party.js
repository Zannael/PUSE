import { ru8, ru16, ru32, wu8, wu16, wu32 } from './binary.js';
import { findActiveSectionById } from './sections.js';
import speciesBaseStats from './speciesBaseStats.json' with { type: 'json' };
import speciesIdentityMeta from './speciesIdentityMeta.json' with { type: 'json' };
import speciesGrowthRates from './speciesGrowthRates.json' with { type: 'json' };
import speciesAbilitiesMeta from './speciesAbilitiesMeta.json' with { type: 'json' };
import abilitiesCatalog from './abilitiesCatalog.json' with { type: 'json' };
import { getMoveBasePpById } from './catalog.js';
import { buildSpeciesFormMeta, getSpeciesFormMeta } from './speciesForms.js';

const TRAINER_SECTION_ID = 1;
const PARTY_COUNT_OFFSET = 0x34;
const PARTY_START_OFFSET = 0x38;
const PARTY_MON_SIZE = 100;

const OFF_PID = 0x00;
const OFF_NICK = 0x08;
const OFF_CHECKSUM = 0x1C;
const OFF_DATA_START = 0x20;
const OFF_LEVEL_VISUAL = 0x54;
const OFF_CURR_HP = 0x56;
const OFF_MAX_HP = 0x58;
const OFF_ATK = 0x5A;
const OFF_DEF = 0x5C;
const OFF_SPE = 0x5E;
const OFF_SPA = 0x60;
const OFF_SPD = 0x62;

const GENDER_THRESHOLD_MALE_ONLY = 0;
const GENDER_THRESHOLD_FEMALE_ONLY = 254;
const GENDER_THRESHOLD_GENDERLESS = 255;
const INV_11_MOD_25 = 16;

const GROWTH_RATE_COUNT = 6;

const NATURES = {
    0: 'Hardy', 1: 'Lonely', 2: 'Brave', 3: 'Adamant',
    4: 'Naughty', 5: 'Bold', 6: 'Docile', 7: 'Relaxed',
    8: 'Impish', 9: 'Lax', 10: 'Timid', 11: 'Hasty',
    12: 'Serious', 13: 'Jolly', 14: 'Naive', 15: 'Modest',
    16: 'Mild', 17: 'Quiet', 18: 'Bashful', 19: 'Rash',
    20: 'Calm', 21: 'Gentle', 22: 'Sassy', 23: 'Careful',
    24: 'Quirky',
};

const CHARMAP = {
    0x00: ' ', 0xAB: '!', 0xAC: '?', 0xAD: '.', 0xAE: '-', 0xFF: '',
    0xB0: '0', 0xB1: '1', 0xB2: '2', 0xB3: '3', 0xB4: '4',
    0xB5: '5', 0xB6: '6', 0xB7: '7', 0xB8: '8', 0xB9: '9',
    0xBB: 'A', 0xBC: 'B', 0xBD: 'C', 0xBE: 'D', 0xBF: 'E', 0xC0: 'F',
    0xC1: 'G', 0xC2: 'H', 0xC3: 'I', 0xC4: 'J', 0xC5: 'K', 0xC6: 'L',
    0xC7: 'M', 0xC8: 'N', 0xC9: 'O', 0xCA: 'P', 0xCB: 'Q', 0xCC: 'R',
    0xCD: 'S', 0xCE: 'T', 0xCF: 'U', 0xD0: 'V', 0xD1: 'W', 0xD2: 'X',
    0xD3: 'Y', 0xD4: 'Z',
    0xD5: 'a', 0xD6: 'b', 0xD7: 'c', 0xD8: 'd', 0xD9: 'e', 0xDA: 'f',
    0xDB: 'g', 0xDC: 'h', 0xDD: 'i', 0xDE: 'j', 0xDF: 'k', 0xE0: 'l',
    0xE1: 'm', 0xE2: 'n', 0xE3: 'o', 0xE4: 'p', 0xE5: 'q', 0xE6: 'r',
    0xE7: 's', 0xE8: 't', 0xE9: 'u', 0xEA: 'v', 0xEB: 'w', 0xEC: 'x',
    0xED: 'y', 0xEE: 'z',
};

const ENCODE_CHARMAP = {
    ' ': 0x00,
    '!': 0xAB,
    '?': 0xAC,
    '.': 0xAD,
    '-': 0xAE,
    "'": 0xB4,
};
for (let i = 0; i < 10; i += 1) {
    ENCODE_CHARMAP[String(i)] = 0xB0 + i;
}
for (let i = 0; i < 26; i += 1) {
    ENCODE_CHARMAP[String.fromCharCode(65 + i)] = 0xBB + i;
    ENCODE_CHARMAP[String.fromCharCode(97 + i)] = 0xD5 + i;
}

function decodeText(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) {
        const b = bytes[i];
        if (b === 0xFF) {
            break;
        }
        out += CHARMAP[b] ?? '?';
    }
    return out;
}

function encodeText(text, maxLen = 10) {
    const safe = String(text || '').trim().slice(0, maxLen);
    const out = new Uint8Array(maxLen);
    out.fill(0xFF);
    for (let i = 0; i < safe.length; i += 1) {
        out[i] = ENCODE_CHARMAP[safe[i]] ?? 0xAC;
    }
    return out;
}

function addMonChecksum(rawMon) {
    let checksum = 0;
    for (let i = 0; i < 48; i += 2) {
        checksum = (checksum + ru16(rawMon, OFF_DATA_START + i)) & 0xFFFF;
    }
    wu16(rawMon, OFF_CHECKSUM, checksum);
}

function substructViews(rawMon) {
    const data = rawMon.slice(OFF_DATA_START, OFF_DATA_START + 48);
    return {
        B: data.slice(0, 12),
        A: data.slice(12, 24),
        D: data.slice(24, 36),
        C: data.slice(36, 48),
    };
}

function writeSubstructs(rawMon, sub) {
    const payload = new Uint8Array(48);
    payload.set(sub.B, 0);
    payload.set(sub.A, 12);
    payload.set(sub.D, 24);
    payload.set(sub.C, 36);
    rawMon.set(payload, OFF_DATA_START);
    addMonChecksum(rawMon);
}

function getNatureId(rawMon) {
    return ru32(rawMon, OFF_PID) % 25;
}

function getOtid(rawMon) {
    return ru32(rawMon, 0x04);
}

function getGenderThreshold(rawMon) {
    const speciesId = getSpeciesId(rawMon);
    const meta = speciesIdentityMeta?.[String(speciesId)];
    if (!meta || meta.gender_threshold === undefined || meta.gender_threshold === null) {
        return null;
    }
    return Number(meta.gender_threshold) & 0xFF;
}

function getSpeciesGrowthRate(rawMon) {
    const speciesId = getSpeciesId(rawMon);
    const meta = speciesGrowthRates?.[String(speciesId)];
    if (!meta || meta.growth_rate === undefined || meta.growth_rate === null) {
        return null;
    }
    const rate = Number(meta.growth_rate);
    if (Number.isNaN(rate) || rate < 0 || rate > 5) {
        return null;
    }
    return rate;
}

function getSpeciesAbilityMeta(rawMon) {
    const speciesId = getSpeciesId(rawMon);
    const meta = speciesAbilitiesMeta?.[String(speciesId)];
    if (!meta) {
        return { ability_1_id: null, ability_2_id: null, hidden_ability_id: null };
    }
    const a1 = meta.ability_1_id === undefined || meta.ability_1_id === null ? null : Number(meta.ability_1_id);
    const a2 = meta.ability_2_id === undefined || meta.ability_2_id === null ? null : Number(meta.ability_2_id);
    const ha = meta.hidden_ability_id === undefined || meta.hidden_ability_id === null ? null : Number(meta.hidden_ability_id);
    return {
        ability_1_id: Number.isNaN(a1) ? null : a1,
        ability_2_id: Number.isNaN(a2) ? null : a2,
        hidden_ability_id: Number.isNaN(ha) ? null : ha,
    };
}

function getAbilityNameById(abilityId) {
    if (abilityId === null || abilityId === undefined) {
        return null;
    }
    return abilitiesCatalog?.[String(Number(abilityId))] || null;
}

function resolveCurrentAbility(currentIndex, ability1Id, ability1Name, ability2Id, ability2Name, abilityHiddenId, abilityHiddenName) {
    if (currentIndex === 0) {
        const effectiveId = (ability1Id !== null && ability1Id !== 0) ? ability1Id : ability2Id;
        const effectiveName = ability1Name || ability2Name;
        return {
            effective_ability_id: effectiveId,
            effective_ability_name: effectiveName,
            ability_name_current: effectiveName,
            ability_label_current: effectiveName || 'Slot 1 (Standard)',
        };
    }
    if (currentIndex === 1) {
        const effectiveId = (ability2Id !== null && ability2Id !== 0) ? ability2Id : ability1Id;
        const effectiveName = ability2Name || ability1Name;
        return {
            effective_ability_id: effectiveId,
            effective_ability_name: effectiveName,
            ability_name_current: effectiveName,
            ability_label_current: effectiveName || 'Slot 2 (Standard)',
        };
    }
    const effectiveId = (abilityHiddenId !== null && abilityHiddenId !== 0) ? abilityHiddenId : null;
    return {
        effective_ability_id: effectiveId,
        effective_ability_name: abilityHiddenName,
        ability_name_current: abilityHiddenName,
        ability_label_current: abilityHiddenName || 'Hidden Ability',
    };
}

function getMoveBasePp(moveId) {
    const value = Number(getMoveBasePpById(moveId) || 0);
    if (!Number.isInteger(value) || value < 0) {
        return 0;
    }
    return value;
}

function calcMaxPp(moveId, ppUp) {
    const move = Number(moveId) || 0;
    if (move <= 0) {
        return 0;
    }
    const base = getMoveBasePp(move);
    const up = Math.max(0, Math.min(3, Number(ppUp) || 0));
    if (base <= 0) {
        return 0;
    }
    return base + Math.floor((base * up) / 5);
}

function genderModeFromThreshold(threshold) {
    if (threshold === null || threshold === undefined) {
        return 'unknown';
    }
    if (threshold === GENDER_THRESHOLD_GENDERLESS) {
        return 'genderless';
    }
    if (threshold === GENDER_THRESHOLD_MALE_ONLY) {
        return 'fixed_male';
    }
    if (threshold === GENDER_THRESHOLD_FEMALE_ONLY) {
        return 'fixed_female';
    }
    return 'dynamic';
}

function genderFromPid(pid, threshold) {
    if (threshold === null || threshold === undefined) {
        return 'unknown';
    }
    if (threshold === GENDER_THRESHOLD_GENDERLESS) {
        return 'genderless';
    }
    if (threshold === GENDER_THRESHOLD_MALE_ONLY) {
        return 'male';
    }
    if (threshold === GENDER_THRESHOLD_FEMALE_ONLY) {
        return 'female';
    }
    return (pid & 0xFF) < threshold ? 'female' : 'male';
}

function shinyValue(otid, pid) {
    const tid = otid & 0xFFFF;
    const sid = (otid >>> 16) & 0xFFFF;
    return (tid ^ sid ^ (pid & 0xFFFF) ^ ((pid >>> 16) & 0xFFFF)) >>> 0;
}

function isShinyPid(otid, pid) {
    return shinyValue(otid, pid) < 8;
}

function nearestHighForMod(reqMod, preferredHigh) {
    const minK = 0;
    const maxK = Math.floor((0xFFFF - reqMod) / 25);
    const rawK = Math.round((preferredHigh - reqMod) / 25);
    const k = Math.max(minK, Math.min(maxK, rawK));
    return reqMod + (25 * k);
}

function findIdentityPid(rawMon, payload = {}) {
    const currentPid = ru32(rawMon, OFF_PID) >>> 0;
    const currentLow = currentPid & 0xFFFF;
    const currentHigh = (currentPid >>> 16) & 0xFFFF;
    const otid = getOtid(rawMon) >>> 0;
    const tidSid = ((otid & 0xFFFF) ^ ((otid >>> 16) & 0xFFFF)) & 0xFFFF;
    const targetNatureId = getNatureId(rawMon);
    const hidden = Boolean(getHiddenAbilityFlag(rawMon));
    const requiredAbilitySlot = hidden ? null : (currentPid & 1);
    const threshold = getGenderThreshold(rawMon);
    const mode = genderModeFromThreshold(threshold);

    let desiredGender = payload.gender === undefined || payload.gender === null
        ? null
        : String(payload.gender).trim().toLowerCase();
    const desiredShiny = payload.shiny === undefined || payload.shiny === null
        ? isShinyPid(otid, currentPid)
        : Boolean(payload.shiny);

    if (desiredGender !== null && !['male', 'female', 'genderless'].includes(desiredGender)) {
        throw new Error(`Invalid gender '${desiredGender}'.`);
    }

    if (desiredGender === null && mode === 'dynamic') {
        desiredGender = genderFromPid(currentPid, threshold);
    }

    if (desiredGender === 'genderless' && threshold !== GENDER_THRESHOLD_GENDERLESS) {
        throw new Error('Selected species is not genderless.');
    }
    if ((desiredGender === 'male' || desiredGender === 'female')) {
        if (mode === 'unknown') {
            throw new Error('Gender metadata unavailable for this species.');
        }
        if (mode === 'genderless') {
            throw new Error('Selected species is genderless.');
        }
        if (mode === 'fixed_male' && desiredGender !== 'male') {
            throw new Error('Selected species is male-only.');
        }
        if (mode === 'fixed_female' && desiredGender !== 'female') {
            throw new Error('Selected species is female-only.');
        }
    }

    for (let delta = 0; delta < 0x10000; delta += 1) {
        const low = (currentLow + delta) & 0xFFFF;

        if (requiredAbilitySlot !== null && (low & 1) !== requiredAbilitySlot) {
            continue;
        }

        if ((desiredGender === 'male' || desiredGender === 'female') && mode === 'dynamic') {
            if (genderFromPid(low, threshold) !== desiredGender) {
                continue;
            }
        }

        const reqHighMod = (((targetNatureId - (low % 25)) * INV_11_MOD_25) % 25 + 25) % 25;

        if (desiredShiny) {
            for (let sv = 0; sv < 8; sv += 1) {
                const high = (tidSid ^ low ^ sv) & 0xFFFF;
                if ((high % 25) !== reqHighMod) {
                    continue;
                }
                const pid = (((high << 16) >>> 0) | low) >>> 0;
                if (desiredGender && genderFromPid(pid, threshold) !== desiredGender) {
                    continue;
                }
                return pid;
            }
            continue;
        }

        const baseHigh = nearestHighForMod(reqHighMod, currentHigh);
        let pid = (((baseHigh << 16) >>> 0) | low) >>> 0;
        if (isShinyPid(otid, pid)) {
            pid = null;
            for (let n = 1; n <= 5; n += 1) {
                const down = baseHigh - (25 * n);
                if (down >= 0) {
                    const test = (((down << 16) >>> 0) | low) >>> 0;
                    if (!isShinyPid(otid, test)) {
                        pid = test;
                        break;
                    }
                }
                const up = baseHigh + (25 * n);
                if (up <= 0xFFFF) {
                    const test = (((up << 16) >>> 0) | low) >>> 0;
                    if (!isShinyPid(otid, test)) {
                        pid = test;
                        break;
                    }
                }
            }
            if (pid === null) {
                continue;
            }
        }

        if (desiredGender && genderFromPid(pid, threshold) !== desiredGender) {
            continue;
        }
        return pid;
    }

    throw new Error('Could not find a PID satisfying all identity constraints.');
}

function setNature(rawMon, targetNatureId) {
    let pid = ru32(rawMon, OFF_PID);
    const currentAbilitySlot = pid & 1;
    while ((pid % 25) !== targetNatureId || (pid & 1) !== currentAbilitySlot) {
        pid = (pid + 1) >>> 0;
    }
    wu32(rawMon, OFF_PID, pid);
}

function getHiddenAbilityFlag(rawMon) {
    const sub = substructViews(rawMon);
    const packed = ru32(sub.C, 4);
    return (packed >>> 31) & 1;
}

function setHiddenAbilityFlag(rawMon, active) {
    const sub = substructViews(rawMon);
    let val = ru32(sub.C, 4);
    if (active) {
        val |= (1 << 31);
    } else {
        val &= ~(1 << 31);
    }
    wu32(sub.C, 4, val >>> 0);
    writeSubstructs(rawMon, sub);
}

function setAbilitySlot(rawMon, slotType) {
    if (slotType === 2) {
        setHiddenAbilityFlag(rawMon, true);
        return;
    }

    setHiddenAbilityFlag(rawMon, false);
    let pid = ru32(rawMon, OFF_PID);
    const targetNature = pid % 25;
    while ((pid % 25) !== targetNature || (pid & 1) !== slotType) {
        pid = (pid + 1) >>> 0;
    }
    wu32(rawMon, OFF_PID, pid);
}

function getIvs(rawMon) {
    const sub = substructViews(rawMon);
    const packed = ru32(sub.C, 4);
    return {
        HP: (packed >>> 0) & 0x1F,
        Atk: (packed >>> 5) & 0x1F,
        Def: (packed >>> 10) & 0x1F,
        Spd: (packed >>> 15) & 0x1F,
        SpA: (packed >>> 20) & 0x1F,
        SpD: (packed >>> 25) & 0x1F,
    };
}

function setIvs(rawMon, ivs) {
    const sub = substructViews(rawMon);
    const orig = ru32(sub.C, 4);
    let next = orig & 0xC0000000;
    next |= (ivs.HP & 0x1F) << 0;
    next |= (ivs.Atk & 0x1F) << 5;
    next |= (ivs.Def & 0x1F) << 10;
    next |= (ivs.Spd & 0x1F) << 15;
    next |= (ivs.SpA & 0x1F) << 20;
    next |= (ivs.SpD & 0x1F) << 25;
    wu32(sub.C, 4, next >>> 0);
    writeSubstructs(rawMon, sub);
}

function getEvs(rawMon) {
    const sub = substructViews(rawMon);
    return {
        HP: ru8(sub.D, 0),
        Atk: ru8(sub.D, 1),
        Def: ru8(sub.D, 2),
        Spd: ru8(sub.D, 3),
        SpA: ru8(sub.D, 4),
        SpD: ru8(sub.D, 5),
    };
}

function setEvs(rawMon, evs) {
    const sub = substructViews(rawMon);
    wu8(sub.D, 0, evs.HP);
    wu8(sub.D, 1, evs.Atk);
    wu8(sub.D, 2, evs.Def);
    wu8(sub.D, 3, evs.Spd);
    wu8(sub.D, 4, evs.SpA);
    wu8(sub.D, 5, evs.SpD);
    writeSubstructs(rawMon, sub);
}

function getMoves(rawMon) {
    const sub = substructViews(rawMon);
    return [ru16(sub.A, 0), ru16(sub.A, 2), ru16(sub.A, 4), ru16(sub.A, 6)];
}

function getMovePp(rawMon) {
    const sub = substructViews(rawMon);
    return [
        ru8(sub.A, 8),
        ru8(sub.A, 9),
        ru8(sub.A, 10),
        ru8(sub.A, 11),
    ];
}

function getMovePpUps(rawMon) {
    const sub = substructViews(rawMon);
    const packed = ru8(sub.B, 8);
    return [
        (packed >>> 0) & 0x03,
        (packed >>> 2) & 0x03,
        (packed >>> 4) & 0x03,
        (packed >>> 6) & 0x03,
    ];
}

function getMovePpMax(rawMon) {
    const moves = getMoves(rawMon);
    const ppUps = getMovePpUps(rawMon);
    return moves.map((moveId, idx) => calcMaxPp(moveId, ppUps[idx]));
}

function setMoves(rawMon, moves, movePp = null, movePpUps = null) {
    const sub = substructViews(rawMon);
    const currMoves = getMoves(rawMon);
    const currPp = getMovePp(rawMon);
    const currPpUps = getMovePpUps(rawMon);

    const nextMoves = [0, 0, 0, 0];
    for (let i = 0; i < 4; i += 1) {
        nextMoves[i] = Number(moves?.[i] || 0) & 0x3FF;
    }

    const nextPpUps = [...currPpUps];
    if (Array.isArray(movePpUps)) {
        for (let i = 0; i < 4; i += 1) {
            if (i < movePpUps.length) {
                nextPpUps[i] = Math.max(0, Math.min(3, Number(movePpUps[i]) || 0));
            }
        }
    }

    const nextPp = [...currPp];
    if (Array.isArray(movePp)) {
        for (let i = 0; i < 4; i += 1) {
            if (i < movePp.length) {
                nextPp[i] = Math.max(0, Number(movePp[i]) || 0);
            }
        }
    }

    for (let i = 0; i < 4; i += 1) {
        const moveId = nextMoves[i];
        const changedMove = moveId !== currMoves[i];
        if (moveId <= 0) {
            nextPpUps[i] = 0;
            nextPp[i] = 0;
        } else {
            const maxPp = calcMaxPp(moveId, nextPpUps[i]);
            if (changedMove) {
                nextPp[i] = maxPp;
            } else {
                nextPp[i] = Math.max(0, Math.min(maxPp, Number(nextPp[i]) || 0));
            }
        }
        wu16(sub.A, i * 2, moveId);
        wu8(sub.A, 8 + i, Math.max(0, Math.min(255, Number(nextPp[i]) || 0)));
    }

    const packedPpUps = (nextPpUps[0] & 0x03)
        | ((nextPpUps[1] & 0x03) << 2)
        | ((nextPpUps[2] & 0x03) << 4)
        | ((nextPpUps[3] & 0x03) << 6);
    wu8(sub.B, 8, packedPpUps);

    writeSubstructs(rawMon, sub);
}

function getSpeciesId(rawMon) {
    const sub = substructViews(rawMon);
    return ru16(sub.B, 0);
}

function getItemId(rawMon) {
    const sub = substructViews(rawMon);
    return ru16(sub.B, 2);
}

function getExp(rawMon) {
    const sub = substructViews(rawMon);
    return ru32(sub.B, 4);
}

function setItemId(rawMon, itemId) {
    const sub = substructViews(rawMon);
    wu16(sub.B, 2, Number(itemId));
    writeSubstructs(rawMon, sub);
}

function setNickname(rawMon, nickname) {
    const encoded = encodeText(nickname, 10);
    rawMon.set(encoded, OFF_NICK);
}

function setSpeciesId(rawMon, speciesId) {
    const sub = substructViews(rawMon);
    wu16(sub.B, 0, Number(speciesId));
    writeSubstructs(rawMon, sub);
}

function setExp(rawMon, exp) {
    const sub = substructViews(rawMon);
    wu32(sub.B, 4, Number(exp >>> 0));
    writeSubstructs(rawMon, sub);
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

function recalculatePartyStats(rawMon, clampHp = true) {
    const speciesId = getSpeciesId(rawMon);
    const base = speciesBaseStats?.[String(speciesId)];
    if (!base) {
        return;
    }

    const level = Math.max(1, Number(ru8(rawMon, OFF_LEVEL_VISUAL) || 1));
    const ivs = getIvs(rawMon);
    const evs = getEvs(rawMon);
    const natureId = getNatureId(rawMon);

    const maxHp = calcHpStat(Number(base.hp), ivs.HP, evs.HP, level);
    const atk = calcOtherStat(Number(base.atk), ivs.Atk, evs.Atk, level, natureModifier(natureId, 'atk'));
    const def = calcOtherStat(Number(base.def), ivs.Def, evs.Def, level, natureModifier(natureId, 'def'));
    const spe = calcOtherStat(Number(base.spe), ivs.Spd, evs.Spd, level, natureModifier(natureId, 'spe'));
    const spa = calcOtherStat(Number(base.spa), ivs.SpA, evs.SpA, level, natureModifier(natureId, 'spa'));
    const spd = calcOtherStat(Number(base.spd), ivs.SpD, evs.SpD, level, natureModifier(natureId, 'spd'));

    const oldHp = ru16(rawMon, OFF_CURR_HP);
    const hp = clampHp ? Math.min(oldHp, maxHp) : maxHp;

    wu16(rawMon, OFF_CURR_HP, Math.max(0, hp));
    wu16(rawMon, OFF_MAX_HP, Math.max(1, maxHp));
    wu16(rawMon, OFF_ATK, Math.max(1, atk));
    wu16(rawMon, OFF_DEF, Math.max(1, def));
    wu16(rawMon, OFF_SPE, Math.max(1, spe));
    wu16(rawMon, OFF_SPA, Math.max(1, spa));
    wu16(rawMon, OFF_SPD, Math.max(1, spd));
}

function getExpAtLevel(rateIdx, level) {
    let n = Number(level || 1);
    if (n <= 1) return 0;
    if (n > 100) n = 100;

    if (rateIdx === 0) {
        return n ** 3;
    }

    if (rateIdx === 1) {
        if (n <= 50) return Math.floor((n ** 3 * (100 - n)) / 50);
        if (n <= 68) return Math.floor((n ** 3 * (150 - n)) / 100);
        if (n <= 98) return Math.floor((n ** 3 * ((1911 - 10 * n) / 3)) / 500);
        return Math.floor((n ** 3 * (160 - n)) / 100);
    }

    if (rateIdx === 2) {
        if (n <= 15) return Math.floor(n ** 3 * ((Math.floor((n + 1) / 3) + 24) / 50));
        if (n <= 36) return Math.floor(n ** 3 * ((n + 14) / 50));
        return Math.floor(n ** 3 * ((Math.floor(n / 2) + 32) / 50));
    }

    if (rateIdx === 3) {
        return Math.floor(1.2 * (n ** 3) - 15 * (n ** 2) + 100 * n - 140);
    }

    if (rateIdx === 4) {
        return Math.floor((4 * (n ** 3)) / 5);
    }

    if (rateIdx === 5) {
        return Math.floor((5 * (n ** 3)) / 4);
    }

    return n ** 3;
}

function calcCurrentLevel(rateIdx, currentExp) {
    for (let level = 1; level <= 100; level += 1) {
        if (currentExp < getExpAtLevel(rateIdx, level + 1)) {
            return level;
        }
    }
    return 100;
}

function guessGrowthRate(currentExp, visualLevel) {
    const visual = Math.max(1, Math.min(100, Number(visualLevel || 1)));
    const ranked = [];

    for (let rate = 0; rate < GROWTH_RATE_COUNT; rate += 1) {
        const inferred = calcCurrentLevel(rate, currentExp);
        const expAtVisual = getExpAtLevel(rate, visual);
        const expAtNext = getExpAtLevel(rate, Math.min(100, visual + 1));
        const inBand = currentExp >= expAtVisual && currentExp < expAtNext;

        let expDistance = 0;
        if (!inBand) {
            if (currentExp < expAtVisual) {
                expDistance = expAtVisual - currentExp;
            } else {
                expDistance = Math.max(0, currentExp - expAtNext + 1);
            }
        }

        ranked.push({
            rate,
            inBand,
            levelDelta: Math.abs(inferred - visual),
            expDistance,
        });
    }

    ranked.sort((a, b) => {
        if (a.inBand !== b.inBand) return a.inBand ? -1 : 1;
        if (a.levelDelta !== b.levelDelta) return a.levelDelta - b.levelDelta;
        if (a.expDistance !== b.expDistance) return a.expDistance - b.expDistance;
        return a.rate - b.rate;
    });

    return ranked[0]?.rate ?? 0;
}

function findActiveTrainerSection(buffer) {
    return findActiveSectionById(buffer, TRAINER_SECTION_ID);
}

function partyMonOffset(sectionOffset, monIndex) {
    return sectionOffset + PARTY_START_OFFSET + (monIndex * PARTY_MON_SIZE);
}

export function getParty(buffer, speciesById, speciesMetaById = null) {
    const active = findActiveTrainerSection(buffer);
    if (!active) {
        throw new Error('Trainer section not found');
    }

    const teamCount = Math.min(6, ru32(buffer, active.off + PARTY_COUNT_OFFSET));
    const party = [];
    const metaMap = speciesMetaById || buildSpeciesFormMeta(speciesById);

    for (let i = 0; i < teamCount; i += 1) {
        const monOffset = partyMonOffset(active.off, i);
        const rawMon = buffer.slice(monOffset, monOffset + PARTY_MON_SIZE);
        const speciesId = getSpeciesId(rawMon);
        const natureId = getNatureId(rawMon);
        const pid = ru32(rawMon, OFF_PID) >>> 0;
        const genderThreshold = getGenderThreshold(rawMon);
        const genderMode = genderModeFromThreshold(genderThreshold);
        const speciesGrowthRate = getSpeciesGrowthRate(rawMon);
        const abilityMeta = getSpeciesAbilityMeta(rawMon);
        const abilitySlots = {
            ability_1_id: abilityMeta.ability_1_id,
            ability_2_id: abilityMeta.ability_2_id,
        };
        const ability1Name = getAbilityNameById(abilitySlots.ability_1_id);
        const ability2Name = getAbilityNameById(abilitySlots.ability_2_id);
        const abilityHiddenName = getAbilityNameById(abilityMeta.hidden_ability_id);
        const hidden = Boolean(getHiddenAbilityFlag(rawMon));
        const currentAbilityIndex = hidden ? 2 : (pid & 1);
        const resolvedAbility = resolveCurrentAbility(
            currentAbilityIndex,
            abilitySlots.ability_1_id,
            ability1Name,
            abilitySlots.ability_2_id,
            ability2Name,
            abilityMeta.hidden_ability_id,
            abilityHiddenName,
        );
        const speciesMeta = getSpeciesFormMeta(metaMap, speciesById, speciesId);

        party.push({
            index: i,
            nickname: decodeText(rawMon.slice(OFF_NICK, OFF_NICK + 10)),
            species_name: speciesMeta.species_label,
            species_display_name: speciesMeta.species_display_name,
            species_label: speciesMeta.species_label,
            species_variant_index: speciesMeta.species_variant_index,
            species_variant_count: speciesMeta.species_variant_count,
            is_form_variant: speciesMeta.is_form_variant,
            level: ru8(rawMon, OFF_LEVEL_VISUAL),
            exp: getExp(rawMon),
            nature: NATURES[natureId] || 'Unknown',
            nature_id: natureId,
            pid,
            is_shiny: isShinyPid(getOtid(rawMon), pid),
            gender: genderFromPid(pid, genderThreshold),
            gender_mode: genderMode,
            gender_editable: genderMode === 'dynamic',
            is_hidden_ability: hidden,
            ivs: getIvs(rawMon),
            evs: getEvs(rawMon),
            species_id: speciesId,
            species_growth_rate: speciesGrowthRate,
            moves: getMoves(rawMon),
            move_pp: getMovePp(rawMon),
            move_pp_ups: getMovePpUps(rawMon),
            move_pp_max: getMovePpMax(rawMon),
            ability_slot: ru32(rawMon, OFF_PID) & 1,
            current_ability_index: currentAbilityIndex,
            ability_1_id: abilitySlots.ability_1_id,
            ability_1_name: ability1Name,
            ability_2_id: abilitySlots.ability_2_id,
            ability_2_name: ability2Name,
            ability_hidden_id: abilityMeta.hidden_ability_id,
            ability_hidden_name: abilityHiddenName,
            ability_name_current: resolvedAbility.ability_name_current,
            ability_label_current: resolvedAbility.ability_label_current,
            effective_ability_id: resolvedAbility.effective_ability_id,
            effective_ability_name: resolvedAbility.effective_ability_name,
            item_id: getItemId(rawMon),
        });
    }

    return party;
}

function mutatePartyMon(buffer, monIndex, mutator) {
    const active = findActiveTrainerSection(buffer);
    if (!active) {
        throw new Error('Trainer section not found');
    }

    if (monIndex < 0 || monIndex > 5) {
        throw new Error('Invalid party index');
    }

    const monOffset = partyMonOffset(active.off, monIndex);
    const rawMon = buffer.slice(monOffset, monOffset + PARTY_MON_SIZE);
    const speciesBefore = getSpeciesId(rawMon);
    mutator(rawMon);
    const speciesAfter = getSpeciesId(rawMon);
    if (speciesAfter !== speciesBefore) {
        throw new Error(`Safety check failed: species changed unexpectedly from ${speciesBefore} to ${speciesAfter}`);
    }
    buffer.set(rawMon, monOffset);
}

function mutatePartyMonAllowSpeciesChange(buffer, monIndex, mutator) {
    const active = findActiveTrainerSection(buffer);
    if (!active) {
        throw new Error('Trainer section not found');
    }

    if (monIndex < 0 || monIndex > 5) {
        throw new Error('Invalid party index');
    }

    const monOffset = partyMonOffset(active.off, monIndex);
    const rawMon = buffer.slice(monOffset, monOffset + PARTY_MON_SIZE);
    mutator(rawMon);
    buffer.set(rawMon, monOffset);
}

export function updatePartyIvs(buffer, monIndex, payload) {
    mutatePartyMon(buffer, monIndex, (rawMon) => {
        setIvs(rawMon, {
            HP: Number(payload.hp || 0),
            Atk: Number(payload.atk || 0),
            Def: Number(payload.dfe || 0),
            Spd: Number(payload.spe || 0),
            SpA: Number(payload.spa || 0),
            SpD: Number(payload.spd || 0),
        });
        recalculatePartyStats(rawMon, true);
    });
}

export function updatePartyEvs(buffer, monIndex, payload) {
    mutatePartyMon(buffer, monIndex, (rawMon) => {
        setEvs(rawMon, {
            HP: Number(payload.hp || 0),
            Atk: Number(payload.atk || 0),
            Def: Number(payload.dfe || 0),
            Spd: Number(payload.spe || 0),
            SpA: Number(payload.spa || 0),
            SpD: Number(payload.spd || 0),
        });
        recalculatePartyStats(rawMon, true);
    });
}

export function updatePartyMoves(buffer, monIndex, payload) {
    mutatePartyMon(buffer, monIndex, (rawMon) => {
        setMoves(rawMon, payload.moves || [], payload.move_pp || null, payload.move_pp_ups || null);
    });
}

export function updatePartyNature(buffer, monIndex, payload) {
    mutatePartyMon(buffer, monIndex, (rawMon) => {
        setNature(rawMon, Number(payload.nature_id || 0));
        recalculatePartyStats(rawMon, true);
    });
}

export function updatePartyItem(buffer, monIndex, payload) {
    mutatePartyMon(buffer, monIndex, (rawMon) => {
        setItemId(rawMon, Number(payload.item_id || 0));
    });
}

export function updatePartyNickname(buffer, monIndex, payload) {
    mutatePartyMon(buffer, monIndex, (rawMon) => {
        setNickname(rawMon, payload.nickname || '');
    });
}

export function updatePartySpecies(buffer, monIndex, payload) {
    mutatePartyMonAllowSpeciesChange(buffer, monIndex, (rawMon) => {
        setSpeciesId(rawMon, Number(payload.species_id || 0));
        recalculatePartyStats(rawMon, true);
    });
}

export function updatePartyAbilitySwitch(buffer, monIndex, payload) {
    mutatePartyMon(buffer, monIndex, (rawMon) => {
        setAbilitySlot(rawMon, Number(payload.ability_index || 0));
    });
}

export function updatePartyIdentity(buffer, monIndex, payload) {
    mutatePartyMon(buffer, monIndex, (rawMon) => {
        const nextPid = findIdentityPid(rawMon, payload || {});
        wu32(rawMon, OFF_PID, nextPid >>> 0);
        recalculatePartyStats(rawMon, true);
    });
}

export function updatePartyLevel(buffer, monIndex, payload) {
    mutatePartyMon(buffer, monIndex, (rawMon) => {
        const targetLevel = Math.max(1, Math.min(100, Number(payload?.target_level || 1)));
        const currentExp = getExp(rawMon);
        const visualLevel = ru8(rawMon, OFF_LEVEL_VISUAL);

        let growthRate;
        if (payload?.growth_rate === undefined || payload?.growth_rate === null || payload?.growth_rate === '') {
            const speciesGrowth = getSpeciesGrowthRate(rawMon);
            if (speciesGrowth !== null) {
                growthRate = speciesGrowth;
            } else {
                growthRate = guessGrowthRate(currentExp, visualLevel);
            }
        } else {
            growthRate = Math.max(0, Math.min(5, Number(payload.growth_rate)));
        }

        const targetExp = getExpAtLevel(growthRate, targetLevel);
        setExp(rawMon, targetExp);
        wu8(rawMon, OFF_LEVEL_VISUAL, targetLevel);
        recalculatePartyStats(rawMon, true);
    });
}
