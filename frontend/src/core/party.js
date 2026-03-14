import { ru8, ru16, ru32, wu8, wu16, wu32 } from './binary.js';
import { findActiveSectionById } from './sections.js';

const TRAINER_SECTION_ID = 1;
const PARTY_COUNT_OFFSET = 0x34;
const PARTY_START_OFFSET = 0x38;
const PARTY_MON_SIZE = 100;

const OFF_PID = 0x00;
const OFF_NICK = 0x08;
const OFF_CHECKSUM = 0x1C;
const OFF_DATA_START = 0x20;
const OFF_LEVEL_VISUAL = 0x54;

const NATURES = {
    0: 'Hardy (Ardita)', 1: 'Lonely (Schiva)', 2: 'Brave (Audace)', 3: 'Adamant (Decisa)',
    4: 'Naughty (Birbona)', 5: 'Bold (Sicura)', 6: 'Docile (Docile)', 7: 'Relaxed (Placida)',
    8: 'Impish (Scaltra)', 9: 'Lax (Fiacca)', 10: 'Timid (Timida)', 11: 'Hasty (Lesta)',
    12: 'Serious (Seria)', 13: 'Jolly (Allegra)', 14: 'Naive (Ingenua)', 15: 'Modest (Modesta)',
    16: 'Mild (Mite)', 17: 'Quiet (Quieta)', 18: 'Bashful (Ritrosa)', 19: 'Rash (Ardente)',
    20: 'Calm (Calma)', 21: 'Gentle (Gentile)', 22: 'Sassy (Vivace)', 23: 'Careful (Cauta)',
    24: 'Quirky (Furba)',
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

function setMoves(rawMon, moves) {
    const sub = substructViews(rawMon);
    for (let i = 0; i < 4; i += 1) {
        wu16(sub.A, i * 2, Number(moves[i] || 0));
    }
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

function setItemId(rawMon, itemId) {
    const sub = substructViews(rawMon);
    wu16(sub.B, 2, Number(itemId));
    writeSubstructs(rawMon, sub);
}

function findActiveTrainerSection(buffer) {
    return findActiveSectionById(buffer, TRAINER_SECTION_ID);
}

function partyMonOffset(sectionOffset, monIndex) {
    return sectionOffset + PARTY_START_OFFSET + (monIndex * PARTY_MON_SIZE);
}

export function getParty(buffer, speciesById) {
    const active = findActiveTrainerSection(buffer);
    if (!active) {
        throw new Error('Trainer section not found');
    }

    const teamCount = Math.min(6, ru32(buffer, active.off + PARTY_COUNT_OFFSET));
    const party = [];

    for (let i = 0; i < teamCount; i += 1) {
        const monOffset = partyMonOffset(active.off, i);
        const rawMon = buffer.slice(monOffset, monOffset + PARTY_MON_SIZE);
        const speciesId = getSpeciesId(rawMon);
        const natureId = getNatureId(rawMon);
        const hidden = Boolean(getHiddenAbilityFlag(rawMon));

        party.push({
            index: i,
            nickname: decodeText(rawMon.slice(OFF_NICK, OFF_NICK + 10)),
            species_name: speciesById.get(speciesId) || 'Unknown',
            level: ru8(rawMon, OFF_LEVEL_VISUAL),
            nature: NATURES[natureId] || 'Sconosciuta',
            nature_id: natureId,
            is_hidden_ability: hidden,
            ivs: getIvs(rawMon),
            evs: getEvs(rawMon),
            species_id: speciesId,
            moves: getMoves(rawMon),
            ability_slot: ru32(rawMon, OFF_PID) & 1,
            current_ability_index: hidden ? 2 : (ru32(rawMon, OFF_PID) & 1),
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
    });
}

export function updatePartyMoves(buffer, monIndex, payload) {
    mutatePartyMon(buffer, monIndex, (rawMon) => {
        setMoves(rawMon, payload.moves || []);
    });
}

export function updatePartyNature(buffer, monIndex, payload) {
    mutatePartyMon(buffer, monIndex, (rawMon) => {
        setNature(rawMon, Number(payload.nature_id || 0));
    });
}

export function updatePartyItem(buffer, monIndex, payload) {
    mutatePartyMon(buffer, monIndex, (rawMon) => {
        setItemId(rawMon, Number(payload.item_id || 0));
    });
}

export function updatePartyAbilitySwitch(buffer, monIndex, payload) {
    mutatePartyMon(buffer, monIndex, (rawMon) => {
        setAbilitySlot(rawMon, Number(payload.ability_index || 0));
    });
}
