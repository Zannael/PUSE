import { ru8, ru16, ru32, wu8, wu16, wu32 } from './binary.js';
import { gbaChecksum } from './checksum.js';
import { OFF_ID, OFF_SAVE_IDX, SECTION_SIZE } from './sections.js';
import { buildSpeciesFormMeta, getSpeciesFormMeta } from './speciesForms.js';
import { getExpAtLevel } from './growth.js';
import speciesIdentityMeta from './speciesIdentityMeta.json' with { type: 'json' };
import speciesGrowthRates from './speciesGrowthRates.json' with { type: 'json' };
import speciesAbilitiesMeta from './speciesAbilitiesMeta.json' with { type: 'json' };
import abilitiesCatalog from './abilitiesCatalog.json' with { type: 'json' };

const POKEMON_STREAM_SECTORS = [5, 6, 7, 8, 9, 10, 11, 12];
const PRESET_SECTOR_ID = 0;
const OTHER_SECTORS = [13];
const ALL_PC_SECTORS = new Set([...POKEMON_STREAM_SECTORS, ...OTHER_SECTORS, PRESET_SECTOR_ID]);

const SECTOR_HEADER_SIZE = 4;
const SECTOR_PAYLOAD_SIZE = 0xFF4 - SECTOR_HEADER_SIZE;
const MON_SIZE_PC = 58;

const OFFSET_PRESET_START = 0xB0;
const PRESET_CAPACITY = 30;
const BOX_SLOT_COUNT = 30;
const TRAINER_SECTION_ID = 1;
const PARTY_COUNT_OFFSET = 0x34;
const PARTY_START_OFFSET = 0x38;
const PARTY_MON_SIZE = 100;

const FALLBACK_BOX_LAYOUTS = {
    22: [[1, 30, 0x1F8B4]],
    23: [[1, 4, 0x2F18], [5, 30, 0x2F28]],
    24: [[1, 30, 0x35F4]],
};

const OFF_PID = 0x00;
const OFF_NICK = 0x08;
const OFF_OT_MISC_1 = 0x12;
const OFF_OT_MISC_2 = 0x13;
const OFF_OT_NAME = 0x14;
const OT_NAME_LEN = 7;
const OFF_SPECIES = 0x1C;
const OFF_ITEM = 0x1E;
const OFF_EXP = 0x20;
const OFF_MOVES = 0x24;
const OFF_EVS = 0x2C;
const OFF_IVS = 0x36;

const GENDER_THRESHOLD_MALE_ONLY = 0;
const GENDER_THRESHOLD_FEMALE_ONLY = 254;
const GENDER_THRESHOLD_GENDERLESS = 255;
const INV_11_MOD_25 = 16;

const UNBOUND_PRESET_MAGIC_LEN = 0xADC;

const CHARMAP = {
    0x00: ' ', 0x01: 'A', 0x02: 'A', 0x03: 'A', 0x04: 'C', 0x05: 'E', 0x06: 'E', 0x07: 'E', 0x08: 'E', 0x09: 'I',
    0x0B: 'I', 0x0C: 'I', 0x0D: 'O', 0x0E: 'O', 0x0F: 'O', 0x10: 'OE', 0x11: 'U', 0x12: 'U', 0x13: 'U', 0x14: 'N',
    0x15: 'B', 0x16: 'a', 0x17: 'a', 0x19: 'c', 0x1A: 'e', 0x1B: 'e', 0x1C: 'e', 0x1D: 'e', 0x1E: 'i', 0x20: 'i',
    0x21: 'i', 0x22: 'o', 0x23: 'o', 0x24: 'o', 0x25: 'oe', 0x26: 'u', 0x27: 'u', 0x28: 'u', 0x29: 'n', 0x2A: 'o',
    0x2B: 'a', 0x2D: '&', 0x2E: '+', 0x34: 'Lv', 0x35: '=', 0x36: ';', 0x51: '?', 0x52: '!', 0x53: 'PK', 0x54: 'MN',
    0x55: 'PO', 0x56: 'Ke', 0x57: 'Bl', 0x58: 'oc', 0x59: 'k', 0x5A: 'I', 0x5B: '%', 0x5C: '(', 0x5D: ')', 0x68: 'a',
    0x6F: 'i', 0x79: '^', 0x7A: 'v', 0x7B: '<', 0x7C: '>', 0x85: '<', 0x86: '>', 0xA1: '0', 0xA2: '1', 0xA3: '2',
    0xA4: '3', 0xA5: '4', 0xA6: '5', 0xA7: '6', 0xA8: '7', 0xA9: '8', 0xAA: '9', 0xAB: '!', 0xAC: '?', 0xAD: '.',
    0xAE: '-', 0xAF: '.', 0xB0: '...', 0xB1: '"', 0xB2: '"', 0xB3: '\'', 0xB4: '\'', 0xB5: 'M', 0xB6: 'F', 0xB7: '$',
    0xB8: ',', 0xB9: 'x', 0xBA: '/', 0xBB: 'A', 0xBC: 'B', 0xBD: 'C', 0xBE: 'D', 0xBF: 'E', 0xC0: 'F', 0xC1: 'G',
    0xC2: 'H', 0xC3: 'I', 0xC4: 'J', 0xC5: 'K', 0xC6: 'L', 0xC7: 'M', 0xC8: 'N', 0xC9: 'O', 0xCA: 'P', 0xCB: 'Q',
    0xCC: 'R', 0xCD: 'S', 0xCE: 'T', 0xCF: 'U', 0xD0: 'V', 0xD1: 'W', 0xD2: 'X', 0xD3: 'Y', 0xD4: 'Z', 0xD5: 'a',
    0xD6: 'b', 0xD7: 'c', 0xD8: 'd', 0xD9: 'e', 0xDA: 'f', 0xDB: 'g', 0xDC: 'h', 0xDD: 'i', 0xDE: 'j', 0xDF: 'k',
    0xE0: 'l', 0xE1: 'm', 0xE2: 'n', 0xE3: 'o', 0xE4: 'p', 0xE5: 'q', 0xE6: 'r', 0xE7: 's', 0xE8: 't', 0xE9: 'u',
    0xEA: 'v', 0xEB: 'w', 0xEC: 'x', 0xED: 'y', 0xEE: 'z', 0xEF: '>', 0xF0: ':', 0xF1: 'A', 0xF2: 'O', 0xF3: 'U',
    0xF4: 'a', 0xF5: 'o', 0xF6: 'u', 0xFF: '',
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
    ENCODE_CHARMAP[String(i)] = 0xA1 + i;
}
for (let i = 0; i < 26; i += 1) {
    ENCODE_CHARMAP[String.fromCharCode(65 + i)] = 0xBB + i;
    ENCODE_CHARMAP[String.fromCharCode(97 + i)] = 0xD5 + i;
}

function decodeText(data) {
    let s = '';
    for (let i = 0; i < data.length; i += 1) {
        const b = data[i];
        if (b === 0xFF) {
            break;
        }
        s += CHARMAP[b] ?? '?';
    }
    return s;
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

function isValidMon(raw) {
    if (!raw || raw.length < MON_SIZE_PC) {
        return false;
    }
    const speciesId = ru16(raw, OFF_SPECIES);
    const exp = ru32(raw, OFF_EXP);
    if (speciesId === 0 || speciesId > 2500) {
        return false;
    }
    return exp > 0 && exp <= 2_000_000;
}

function getMoves(raw) {
    let packed = 0n;
    for (let i = 0; i < 5; i += 1) {
        packed |= BigInt(raw[0x27 + i]) << BigInt(8 * i);
    }
    return [
        Number((packed >> 0n) & 0x3FFn),
        Number((packed >> 10n) & 0x3FFn),
        Number((packed >> 20n) & 0x3FFn),
        Number((packed >> 30n) & 0x3FFn),
    ];
}

function setMoves(raw, movesList) {
    const curr = [...movesList];
    while (curr.length < 4) {
        curr.push(0);
    }

    let packed = 0n;
    for (let i = 0; i < 5; i += 1) {
        packed |= BigInt(raw[0x27 + i]) << BigInt(8 * i);
    }

    for (let i = 0; i < 4; i += 1) {
        const shift = BigInt(i * 10);
        packed &= ~(0x3FFn << shift);
        packed |= (BigInt(Number(curr[i]) & 0x3FF)) << shift;
    }

    for (let i = 0; i < 5; i += 1) {
        raw[0x27 + i] = Number((packed >> BigInt(8 * i)) & 0xFFn);
    }
}

function getIvs(raw) {
    const val = ru32(raw, OFF_IVS);
    return {
        HP: (val >>> 0) & 0x1F,
        Atk: (val >>> 5) & 0x1F,
        Def: (val >>> 10) & 0x1F,
        Spe: (val >>> 15) & 0x1F,
        SpA: (val >>> 20) & 0x1F,
        SpD: (val >>> 25) & 0x1F,
    };
}

function setIvs(raw, ivs) {
    const oldVal = ru32(raw, OFF_IVS);
    const flags = oldVal & 0xC0000000;
    let next = 0;
    next |= (Number(ivs.HP || 0) & 0x1F) << 0;
    next |= (Number(ivs.Atk || 0) & 0x1F) << 5;
    next |= (Number(ivs.Def || 0) & 0x1F) << 10;
    next |= (Number(ivs.Spe || 0) & 0x1F) << 15;
    next |= (Number(ivs.SpA || 0) & 0x1F) << 20;
    next |= (Number(ivs.SpD || 0) & 0x1F) << 25;
    next |= flags;
    wu32(raw, OFF_IVS, next >>> 0);
}

function getEvs(raw) {
    return {
        HP: ru8(raw, OFF_EVS),
        Atk: ru8(raw, OFF_EVS + 1),
        Def: ru8(raw, OFF_EVS + 2),
        Spe: ru8(raw, OFF_EVS + 3),
        SpA: ru8(raw, OFF_EVS + 4),
        SpD: ru8(raw, OFF_EVS + 5),
    };
}

function setEvs(raw, evs) {
    wu8(raw, OFF_EVS, Number(evs.HP || 0));
    wu8(raw, OFF_EVS + 1, Number(evs.Atk || 0));
    wu8(raw, OFF_EVS + 2, Number(evs.Def || 0));
    wu8(raw, OFF_EVS + 3, Number(evs.Spe || 0));
    wu8(raw, OFF_EVS + 4, Number(evs.SpA || 0));
    wu8(raw, OFF_EVS + 5, Number(evs.SpD || 0));
}

function getHiddenAbilityFlag(raw) {
    return (ru32(raw, OFF_IVS) >>> 31) & 1;
}

function setHiddenAbilityFlag(raw, active) {
    let val = ru32(raw, OFF_IVS) >>> 0;
    if (active) {
        val |= (1 << 31) >>> 0;
    } else {
        val &= (~((1 << 31) >>> 0)) >>> 0;
    }
    wu32(raw, OFF_IVS, val >>> 0);
}

function setAbilitySlot(raw, slotType) {
    const slot = Number(slotType);
    if (slot === 2) {
        setHiddenAbilityFlag(raw, true);
        return;
    }
    if (slot !== 0 && slot !== 1) {
        throw new Error('Invalid ability slot (must be 0, 1, or 2)');
    }

    setHiddenAbilityFlag(raw, false);
    let pid = ru32(raw, OFF_PID) >>> 0;
    const targetNature = pid % 25;
    while ((pid % 25) !== targetNature || ((pid & 1) !== slot)) {
        pid = (pid + 1) >>> 0;
    }
    wu32(raw, OFF_PID, pid >>> 0);
}

function setNature(raw, natureId) {
    let pid = ru32(raw, OFF_PID) >>> 0;
    const targetNature = Number(natureId) % 25;
    const keepSlot = !getHiddenAbilityFlag(raw);
    const currentSlot = pid & 1;
    while ((pid % 25) !== targetNature || (keepSlot && ((pid & 1) !== currentSlot))) {
        pid = (pid + 1) >>> 0;
    }
    wu32(raw, OFF_PID, pid >>> 0);
}

function getOtid(raw) {
    return ru32(raw, 0x04);
}

function getGenderThreshold(raw) {
    const speciesId = ru16(raw, OFF_SPECIES);
    const meta = speciesIdentityMeta?.[String(speciesId)];
    if (!meta || meta.gender_threshold === undefined || meta.gender_threshold === null) {
        return null;
    }
    return Number(meta.gender_threshold) & 0xFF;
}

function getSpeciesGrowthRate(speciesId) {
    const entry = speciesGrowthRates?.[String(Number(speciesId))];
    if (!entry || entry.growth_rate === undefined || entry.growth_rate === null) {
        return null;
    }
    const rate = Number(entry.growth_rate);
    if (Number.isNaN(rate) || rate < 0 || rate > 5) {
        return null;
    }
    return rate;
}

function getSpeciesAbilityMeta(speciesId) {
    const meta = speciesAbilitiesMeta?.[String(Number(speciesId))];
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

function findIdentityPid(raw, payload = {}) {
    const currentPid = ru32(raw, OFF_PID) >>> 0;
    const currentLow = currentPid & 0xFFFF;
    const currentHigh = (currentPid >>> 16) & 0xFFFF;
    const otid = getOtid(raw) >>> 0;
    const tidSid = ((otid & 0xFFFF) ^ ((otid >>> 16) & 0xFFFF)) & 0xFFFF;
    const targetNatureId = currentPid % 25;
    const hidden = Boolean(getHiddenAbilityFlag(raw));
    const requiredAbilitySlot = hidden ? null : (currentPid & 1);
    const threshold = getGenderThreshold(raw);
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
    if (desiredGender === 'male' || desiredGender === 'female') {
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

function parseMon(raw, box, slot, speciesMap, speciesMetaById) {
    if (!isValidMon(raw)) {
        return null;
    }

    const speciesId = ru16(raw, OFF_SPECIES);
    const pid = ru32(raw, OFF_PID) >>> 0;
    const genderThreshold = getGenderThreshold(raw);
    const genderMode = genderModeFromThreshold(genderThreshold);
    const abilityMeta = getSpeciesAbilityMeta(speciesId);
    const abilitySlots = {
        ability_1_id: abilityMeta.ability_1_id,
        ability_2_id: abilityMeta.ability_2_id,
    };
    const ability1Name = getAbilityNameById(abilitySlots.ability_1_id);
    const ability2Name = getAbilityNameById(abilitySlots.ability_2_id);
    const abilityHiddenName = getAbilityNameById(abilityMeta.hidden_ability_id);
    const currentAbilityIndex = getHiddenAbilityFlag(raw) ? 2 : (pid & 1);
    const resolvedAbility = resolveCurrentAbility(
        currentAbilityIndex,
        abilitySlots.ability_1_id,
        ability1Name,
        abilitySlots.ability_2_id,
        ability2Name,
        abilityMeta.hidden_ability_id,
        abilityHiddenName,
    );
    const speciesMeta = getSpeciesFormMeta(speciesMetaById, speciesMap, speciesId);
    return {
        box,
        slot,
        nickname: decodeText(raw.slice(OFF_NICK, OFF_NICK + 10)),
        species_name: speciesMeta.species_label,
        species_display_name: speciesMeta.species_display_name,
        species_label: speciesMeta.species_label,
        species_variant_index: speciesMeta.species_variant_index,
        species_variant_count: speciesMeta.species_variant_count,
        is_form_variant: speciesMeta.is_form_variant,
        species_id: speciesId,
        species_growth_rate: getSpeciesGrowthRate(speciesId),
        item_id: ru16(raw, OFF_ITEM),
        exp: ru32(raw, OFF_EXP),
        nature_id: pid % 25,
        pid,
        is_shiny: isShinyPid(getOtid(raw), pid),
        gender: genderFromPid(pid, genderThreshold),
        gender_mode: genderMode,
        gender_editable: genderMode === 'dynamic',
        ivs: getIvs(raw),
        evs: getEvs(raw),
        moves: getMoves(raw),
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
    };
}

function fallbackSlotOffset(boxId, slot) {
    if (Number(boxId) === 23) {
        if (slot >= 1 && slot <= 4) {
            return 0x2F18 + ((slot - 1) * MON_SIZE_PC);
        }
        if (slot >= 5 && slot <= 30) {
            return 0x2F28 + ((slot - 1) * MON_SIZE_PC);
        }
        return null;
    }

    const layout = FALLBACK_BOX_LAYOUTS[Number(boxId)] || [];
    for (const [startSlot, endSlot, baseOff] of layout) {
        if (slot >= startSlot && slot <= endSlot) {
            return Number(baseOff) + ((slot - startSlot) * MON_SIZE_PC);
        }
    }
    return null;
}

function readSlotRaw(data, boxId, slot) {
    const off = fallbackSlotOffset(boxId, slot);
    if (!Number.isInteger(off)) {
        return { raw: null, offset: null };
    }
    if (off < 0 || off + MON_SIZE_PC > data.length) {
        return { raw: null, offset: off };
    }
    return { raw: data.slice(off, off + MON_SIZE_PC), offset: off };
}

function slotState(data, boxId, slot) {
    const { raw } = readSlotRaw(data, boxId, slot);
    if (!raw) {
        return { state: 'missing', mon: null };
    }
    if (raw.every((b) => b === 0)) {
        return { state: 'empty', mon: null };
    }
    if (isValidMon(raw)) {
        return { state: 'valid', mon: raw };
    }
    return { state: 'invalid', mon: null };
}

function ru16At(raw, off) {
    return raw[off] | (raw[off + 1] << 8);
}

function validateFallbackBox(buffer, boxId) {
    let validCount = 0;
    for (let slot = 1; slot <= BOX_SLOT_COUNT; slot += 1) {
        const { state } = slotState(buffer, boxId, slot);
        if (state === 'valid') {
            validCount += 1;
        } else if (state !== 'empty') {
            return false;
        }
    }
    if (validCount < 20) {
        return false;
    }

    if (boxId === 22) {
        const s1 = slotState(buffer, boxId, 1);
        const s21 = slotState(buffer, boxId, 21);
        if (s1.state !== 'valid' || ru16At(s1.mon, OFF_SPECIES) !== 1183) return false;
        if (s21.state !== 'valid' || ![1258, 1259].includes(ru16At(s21.mon, OFF_SPECIES))) return false;
        return true;
    }

    if (boxId === 23) {
        const s29 = slotState(buffer, boxId, 29);
        if (s29.state !== 'valid' || ![1182, 1207].includes(ru16At(s29.mon, OFF_SPECIES))) return false;
        const s1 = slotState(buffer, boxId, 1);
        if (s1.state !== 'valid' || ![397, 905].includes(ru16At(s1.mon, OFF_SPECIES))) return false;
        return true;
    }

    if (boxId === 24) {
        const s1 = slotState(buffer, boxId, 1);
        const s30 = slotState(buffer, boxId, 30);
        if (s1.state !== 'valid' || ru16At(s1.mon, OFF_SPECIES) !== 541) return false;
        if (s30.state !== 'valid' || ru16At(s30.mon, OFF_SPECIES) !== 249) return false;
        return true;
    }

    return false;
}

function detectFallbackBoxStarts(buffer) {
    const out = {};
    Object.entries(FALLBACK_BOX_LAYOUTS).forEach(([box, segments]) => {
        const boxId = Number(box);
        const inBounds = segments.every(([startSlot, endSlot, baseOff]) => {
            const lastOff = Number(baseOff) + ((endSlot - startSlot) * MON_SIZE_PC);
            return baseOff >= 0 && lastOff + MON_SIZE_PC <= buffer.length;
        });
        if (!inBounds) {
            return;
        }
        if (validateFallbackBox(buffer, boxId)) {
            out[boxId] = true;
        }
    });
    return out;
}

export function getActivePcSectors(buffer) {
    const sections = [];

    for (let off = 0; off + SECTION_SIZE <= buffer.length; off += SECTION_SIZE) {
        const secId = ru16(buffer, off + OFF_ID);
        const saveIdx = ru32(buffer, off + OFF_SAVE_IDX);
        if (ALL_PC_SECTORS.has(secId)) {
            sections.push({ id: secId, idx: saveIdx, offset: off });
        }
    }

    if (sections.length === 0) {
        return [];
    }

    const maxIdx = Math.max(...sections.map((s) => s.idx));
    return sections.filter((s) => s.idx === maxIdx).sort((a, b) => a.id - b.id);
}

export function loadPcContext(buffer) {
    const sectors = getActivePcSectors(buffer);
    if (sectors.length === 0) {
        throw new Error('PC sectors not found');
    }

    const headers = {};
    const pcChunks = [];
    let presetBuffer = null;

    sectors.forEach((sec) => {
        const off = sec.offset;
        headers[sec.id] = buffer.slice(off, off + SECTOR_HEADER_SIZE);

        if (POKEMON_STREAM_SECTORS.includes(sec.id)) {
            pcChunks.push(buffer.slice(off + SECTOR_HEADER_SIZE, off + SECTOR_HEADER_SIZE + SECTOR_PAYLOAD_SIZE));
        } else if (sec.id === PRESET_SECTOR_ID) {
            presetBuffer = buffer.slice(off, off + SECTION_SIZE);
        }
    });

    const totalLen = pcChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const pcBuffer = new Uint8Array(totalLen);
    let cursor = 0;
    pcChunks.forEach((chunk) => {
        pcBuffer.set(chunk, cursor);
        cursor += chunk.length;
    });

    return {
        sectors,
        headers,
        pcBuffer,
        presetBuffer,
        sourceBuffer: buffer,
        fallbackBoxStarts: detectFallbackBoxStarts(buffer),
        absoluteEdits: new Map(),
        absoluteTouchedSectors: new Set(),
    };
}

export function getPcBox(context, boxId, speciesMap, speciesMetaById = null) {
    const mons = [];
    const metaMap = speciesMetaById || buildSpeciesFormMeta(speciesMap);
    const hasFallback = Boolean(context.fallbackBoxStarts?.[Number(boxId)]);

    if (boxId >= 1 && boxId <= 25) {
        const base = (boxId - 1) * 30;
        for (let slot = 1; slot <= 30; slot += 1) {
            const idx = base + (slot - 1);
            const off = idx * MON_SIZE_PC;
            if (off + MON_SIZE_PC > context.pcBuffer.length) {
                break;
            }
            const raw = context.pcBuffer.slice(off, off + MON_SIZE_PC);
            const mon = parseMon(raw, boxId, slot, speciesMap, metaMap);
            if (mon) {
                mons.push(mon);
            }
        }
        if (mons.length > 0 || !hasFallback || !context.sourceBuffer) {
            return mons;
        }

        for (let slot = 1; slot <= BOX_SLOT_COUNT; slot += 1) {
            const absOff = fallbackSlotOffset(boxId, slot);
            if (!Number.isInteger(absOff)) {
                continue;
            }
            const raw = context.absoluteEdits?.get(absOff) || context.sourceBuffer.slice(absOff, absOff + MON_SIZE_PC);
            const mon = parseMon(raw, boxId, slot, speciesMap, metaMap);
            if (mon) {
                mons.push(mon);
            }
        }
        return mons;
    }

    if (boxId === 26 && context.presetBuffer) {
        let off = OFFSET_PRESET_START;
        for (let slot = 1; slot <= PRESET_CAPACITY; slot += 1) {
            if (off + MON_SIZE_PC > context.presetBuffer.length) {
                break;
            }
            const raw = context.presetBuffer.slice(off, off + MON_SIZE_PC);
            const mon = parseMon(raw, 26, slot, speciesMap, metaMap);
            if (mon) {
                mons.push(mon);
            }
            off += MON_SIZE_PC;
        }
    }

    return mons;
}

function getMonBufferAndOffset(context, box, slot) {
    if (box === 26) {
        if (!context.presetBuffer) {
            throw new Error('Preset sector not loaded');
        }
        const off = OFFSET_PRESET_START + (slot - 1) * MON_SIZE_PC;
        if (off + MON_SIZE_PC > context.presetBuffer.length) {
            throw new Error('Invalid preset slot');
        }
        return { buffer: context.presetBuffer, offset: off };
    }

    if (box < 1 || box > 25) {
        throw new Error('Invalid box id');
    }
    const idx = ((box - 1) * 30) + (slot - 1);
    const off = idx * MON_SIZE_PC;
    if (off + MON_SIZE_PC > context.pcBuffer.length) {
        const hasFallback = Boolean(context.fallbackBoxStarts?.[Number(box)]);
        if (hasFallback && context.sourceBuffer) {
            const absOff = fallbackSlotOffset(box, slot);
            if (Number.isInteger(absOff) && absOff + MON_SIZE_PC <= context.sourceBuffer.length) {
                return { buffer: context.sourceBuffer, offset: absOff, kind: 'absolute' };
            }
        }
        throw new Error('Invalid box slot');
    }
    return { buffer: context.pcBuffer, offset: off, kind: 'stream' };
}

function inferDefaultOwnerTemplate(context) {
    const counts = new Map();
    const order = new Map();

    const add = (otidValue, nameValue, misc1 = 0, misc2 = 0) => {
        const otid = Number(otidValue) >>> 0;
        const name = String(nameValue || '').trim();
        if (!otid || !name) return;
        const key = `${otid}|${name}|${Number(misc1) & 0xFF}|${Number(misc2) & 0xFF}`;
        if (!order.has(key)) {
            order.set(key, order.size);
        }
        counts.set(key, (counts.get(key) || 0) + 1);
    };

    const src = context?.sourceBuffer;
    if (src) {
        let bestTrainer = null;
        for (let off = 0; off + SECTION_SIZE <= src.length; off += SECTION_SIZE) {
            const secId = ru16(src, off + OFF_ID);
            if (secId !== TRAINER_SECTION_ID) continue;
            const saveIdx = ru32(src, off + OFF_SAVE_IDX);
            if (!bestTrainer || saveIdx > bestTrainer.saveIdx) {
                bestTrainer = { off, saveIdx };
            }
        }
        if (bestTrainer) {
            const teamCount = Math.min(6, ru32(src, bestTrainer.off + PARTY_COUNT_OFFSET));
            for (let i = 0; i < teamCount; i += 1) {
                const monOff = bestTrainer.off + PARTY_START_OFFSET + (i * PARTY_MON_SIZE);
                if (monOff + PARTY_MON_SIZE > src.length) break;
                add(
                    ru32(src, monOff + 0x04),
                    decodeText(src.slice(monOff + OFF_OT_NAME, monOff + OFF_OT_NAME + OT_NAME_LEN)),
                    ru8(src, monOff + OFF_OT_MISC_1),
                    ru8(src, monOff + OFF_OT_MISC_2),
                );
            }
        }
    }

    if (context?.pcBuffer) {
        for (let off = 0; off + MON_SIZE_PC <= context.pcBuffer.length; off += MON_SIZE_PC) {
            const raw = context.pcBuffer.slice(off, off + MON_SIZE_PC);
            if (!isValidMon(raw)) continue;
            add(
                getOtid(raw),
                decodeText(raw.slice(OFF_OT_NAME, OFF_OT_NAME + OT_NAME_LEN)),
                ru8(raw, OFF_OT_MISC_1),
                ru8(raw, OFF_OT_MISC_2),
            );
        }
    }

    if (counts.size === 0) {
        return { otid: 0, otName: '', otMisc1: 0, otMisc2: 0 };
    }

    let bestKey = '';
    let bestCount = -1;
    let bestOrder = Number.MAX_SAFE_INTEGER;
    counts.forEach((count, key) => {
        const seen = order.get(key) ?? Number.MAX_SAFE_INTEGER;
        if (count > bestCount || (count === bestCount && seen < bestOrder)) {
            bestCount = count;
            bestOrder = seen;
            bestKey = key;
        }
    });

    const [otidStr, otName, misc1Str, misc2Str] = bestKey.split('|');

    return {
        otid: Number(otidStr) >>> 0,
        otName: String(otName || ''),
        otMisc1: Number(misc1Str) & 0xFF,
        otMisc2: Number(misc2Str) & 0xFF,
    };
}

function buildPcMonRaw(payload, speciesMap, context) {
    const speciesId = Number(payload?.species_id);
    if (!Number.isInteger(speciesId) || speciesId <= 0) {
        throw new Error('Invalid species_id');
    }

    let exp = null;
    if (payload?.exp !== undefined && payload?.exp !== null) {
        exp = Number(payload.exp);
    } else {
        const level = Math.max(1, Math.min(100, Number(payload?.level ?? 5) || 5));
        const rate = getSpeciesGrowthRate(speciesId);
        exp = getExpAtLevel(rate === null ? 0 : rate, level);
    }
    if (!Number.isFinite(exp) || exp <= 0) {
        throw new Error('EXP must be > 0');
    }

    const raw = new Uint8Array(MON_SIZE_PC);
    wu16(raw, OFF_SPECIES, speciesId);
    wu16(raw, OFF_ITEM, Number(payload?.item_id ?? 0));
    wu32(raw, OFF_EXP, Number(exp));
    wu32(raw, OFF_PID, ((speciesId * 2654435761) >>> 0));
    const inferredOwner = inferDefaultOwnerTemplate(context);
    wu32(raw, 0x04, Number(payload?.otid ?? inferredOwner.otid) >>> 0);
    raw.set(encodeText(payload?.ot_name ?? inferredOwner.otName ?? '', OT_NAME_LEN), OFF_OT_NAME);
    wu8(raw, OFF_OT_MISC_1, Number(payload?.ot_misc_1 ?? inferredOwner.otMisc1 ?? 0) & 0xFF);
    wu8(raw, OFF_OT_MISC_2, Number(payload?.ot_misc_2 ?? inferredOwner.otMisc2 ?? 0) & 0xFF);

    const speciesName = speciesMap?.get?.(speciesId) || `Species ${speciesId}`;
    const nickname = payload?.nickname === undefined || payload?.nickname === null ? speciesName : payload.nickname;
    raw.set(encodeText(nickname, 10), OFF_NICK);

    if (payload?.moves) {
        setMoves(raw, payload.moves);
    }
    if (payload?.ivs) {
        setIvs(raw, payload.ivs);
    } else {
        setIvs(raw, { HP: 31, Atk: 31, Def: 31, Spe: 31, SpA: 31, SpD: 31 });
    }
    if (payload?.evs) {
        setEvs(raw, payload.evs);
    }
    if (payload?.current_ability_index !== undefined && payload?.current_ability_index !== null) {
        setAbilitySlot(raw, Number(payload.current_ability_index));
    }
    if (payload?.nature_id !== undefined && payload?.nature_id !== null) {
        setNature(raw, Number(payload.nature_id));
    }
    if (payload?.shiny !== undefined || payload?.gender !== undefined) {
        const nextPid = findIdentityPid(raw, {
            shiny: payload.shiny,
            gender: payload.gender,
        });
        wu32(raw, OFF_PID, nextPid >>> 0);
    }

    if (!isValidMon(raw)) {
        throw new Error('Failed to build valid Pokemon');
    }
    return raw;
}

function isPcSlotOccupied(context, box, slot) {
    if (box === 26) {
        if (!context.presetBuffer) {
            return false;
        }
        const off = OFFSET_PRESET_START + ((slot - 1) * MON_SIZE_PC);
        if (off + MON_SIZE_PC > context.presetBuffer.length) {
            return false;
        }
        return isValidMon(context.presetBuffer.slice(off, off + MON_SIZE_PC));
    }

    const streamOff = (((box - 1) * 30) + (slot - 1)) * MON_SIZE_PC;
    if (streamOff + MON_SIZE_PC <= context.pcBuffer.length) {
        return isValidMon(context.pcBuffer.slice(streamOff, streamOff + MON_SIZE_PC));
    }

    const hasFallback = Boolean(context.fallbackBoxStarts?.[Number(box)]);
    if (hasFallback && context.sourceBuffer) {
        const absOff = fallbackSlotOffset(box, slot);
        if (Number.isInteger(absOff) && absOff + MON_SIZE_PC <= context.sourceBuffer.length) {
            const raw = context.absoluteEdits?.get(absOff) || context.sourceBuffer.slice(absOff, absOff + MON_SIZE_PC);
            return isValidMon(raw);
        }
    }
    return false;
}

export function insertPcMon(context, payload, speciesMap = null) {
    const box = Number(payload?.box);
    if (!Number.isInteger(box) || box < 1 || box > 26) {
        throw new Error('Invalid box');
    }

    let slot = payload?.slot;
    if (slot !== undefined && slot !== null) {
        slot = Number(slot);
        if (!Number.isInteger(slot) || slot < 1 || slot > 30) {
            throw new Error('Invalid slot');
        }
        if (isPcSlotOccupied(context, box, slot)) {
            throw new Error('Target slot is occupied');
        }
    } else {
        slot = null;
        for (let s = 1; s <= 30; s += 1) {
            if (!isPcSlotOccupied(context, box, s)) {
                slot = s;
                break;
            }
        }
        if (slot === null) {
            throw new Error('Box is full');
        }
    }

    const raw = buildPcMonRaw(payload, speciesMap, context);

    if (box === 26) {
        if (!context.presetBuffer) {
            throw new Error('Preset sector not loaded');
        }
        const off = OFFSET_PRESET_START + ((slot - 1) * MON_SIZE_PC);
        if (off + MON_SIZE_PC > context.presetBuffer.length) {
            throw new Error('Invalid preset slot');
        }
        context.presetBuffer.set(raw, off);
        return { box, slot };
    }

    const streamOff = (((box - 1) * 30) + (slot - 1)) * MON_SIZE_PC;
    if (streamOff + MON_SIZE_PC <= context.pcBuffer.length) {
        context.pcBuffer.set(raw, streamOff);
        return { box, slot };
    }

    const hasFallback = Boolean(context.fallbackBoxStarts?.[Number(box)]);
    if (hasFallback && context.sourceBuffer) {
        const absOff = fallbackSlotOffset(box, slot);
        if (Number.isInteger(absOff) && absOff + MON_SIZE_PC <= context.sourceBuffer.length) {
            context.absoluteEdits.set(absOff, raw);
            context.absoluteTouchedSectors.add(Math.floor(absOff / SECTION_SIZE) * SECTION_SIZE);
            return { box, slot };
        }
    }

    throw new Error('Slot not writable in this save layout');
}

export function editPcMonFull(context, payload) {
    const box = Number(payload.box);
    const slot = Number(payload.slot);
    const { buffer, offset, kind } = getMonBufferAndOffset(context, box, slot);

    const raw = buffer.slice(offset, offset + MON_SIZE_PC);
    if (!isValidMon(raw)) {
        throw new Error('Pokemon not found in slot');
    }
    const speciesBefore = ru16(raw, OFF_SPECIES);

    if (payload.nickname !== undefined && payload.nickname !== null) {
        raw.set(encodeText(payload.nickname, 10), OFF_NICK);
    }

    if (payload.moves) {
        setMoves(raw, payload.moves);
    }
    if (payload.item_id !== undefined && payload.item_id !== null) {
        wu16(raw, OFF_ITEM, Number(payload.item_id));
    }
    if (payload.species_id !== undefined && payload.species_id !== null) {
        wu16(raw, OFF_SPECIES, Number(payload.species_id));
    }
    if (payload.ivs) {
        setIvs(raw, payload.ivs);
    }
    if (payload.evs) {
        setEvs(raw, payload.evs);
    }
    if (payload.current_ability_index !== undefined && payload.current_ability_index !== null) {
        setAbilitySlot(raw, Number(payload.current_ability_index));
    }
    if (payload.nature_id !== undefined && payload.nature_id !== null) {
        setNature(raw, Number(payload.nature_id));
    }
    if (payload.shiny !== undefined || payload.gender !== undefined) {
        const nextPid = findIdentityPid(raw, {
            shiny: payload.shiny,
            gender: payload.gender,
        });
        wu32(raw, OFF_PID, nextPid >>> 0);
    }
    if (payload.exp !== undefined && payload.exp !== null) {
        wu32(raw, OFF_EXP, Number(payload.exp));
    }

    if ((payload.species_id === undefined || payload.species_id === null) && ru16(raw, OFF_SPECIES) !== speciesBefore) {
        throw new Error(`Safety check failed: PC species changed unexpectedly from ${speciesBefore} to ${ru16(raw, OFF_SPECIES)}`);
    }

    if (kind === 'absolute') {
        context.absoluteEdits.set(offset, raw);
        context.absoluteTouchedSectors.add(Math.floor(offset / SECTION_SIZE) * SECTION_SIZE);
        return;
    }
    buffer.set(raw, offset);
}

export function applyPcContextToSave(buffer, context) {
    if (!context || !context.sectors || !context.pcBuffer) {
        return;
    }

    let cursor = 0;
    context.sectors.forEach((sec) => {
        const off = sec.offset;
        if (sec.id === PRESET_SECTOR_ID) {
            if (context.presetBuffer) {
                buffer.set(context.presetBuffer, off);
                const chk = gbaChecksum(buffer, off, UNBOUND_PRESET_MAGIC_LEN);
                wu16(buffer, off + 0xFF6, chk);
            }
            return;
        }

        if (!POKEMON_STREAM_SECTORS.includes(sec.id)) {
            return;
        }

        const header = context.headers[sec.id];
        if (header) {
            buffer.set(header, off);
        }

        const chunk = context.pcBuffer.slice(cursor, cursor + SECTOR_PAYLOAD_SIZE);
        buffer.set(chunk, off + SECTOR_HEADER_SIZE);

        const chk = gbaChecksum(buffer, off, 0xFF4);
        wu16(buffer, off + 0xFF6, chk);

        cursor += SECTOR_PAYLOAD_SIZE;
    });

    if (context.absoluteEdits && context.absoluteEdits.size > 0) {
        context.absoluteEdits.forEach((raw, absOff) => {
            buffer.set(raw, absOff);
        });
    }

    if (context.absoluteTouchedSectors && context.absoluteTouchedSectors.size > 0) {
        context.absoluteTouchedSectors.forEach((secOff) => {
            if (secOff < 0 || secOff + SECTION_SIZE > buffer.length) {
                return;
            }
            const secId = ru16(buffer, secOff + OFF_ID);
            if (secId === 0) {
                const chk = gbaChecksum(buffer, secOff, UNBOUND_PRESET_MAGIC_LEN);
                wu16(buffer, secOff + 0xFF6, chk);
                return;
            }
            const chk = gbaChecksum(buffer, secOff, 0xFF4);
            wu16(buffer, secOff + 0xFF6, chk);
        });
    }
}
