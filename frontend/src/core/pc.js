import { ru8, ru16, ru32, wu8, wu16, wu32 } from './binary.js';
import { gbaChecksum } from './checksum.js';
import { OFF_ID, OFF_SAVE_IDX, SECTION_SIZE } from './sections.js';

const POKEMON_STREAM_SECTORS = [5, 6, 7, 8, 9, 10, 11, 12];
const PRESET_SECTOR_ID = 0;
const OTHER_SECTORS = [13];
const ALL_PC_SECTORS = new Set([...POKEMON_STREAM_SECTORS, ...OTHER_SECTORS, PRESET_SECTOR_ID]);

const SECTOR_HEADER_SIZE = 4;
const SECTOR_PAYLOAD_SIZE = 0xFF4 - SECTOR_HEADER_SIZE;
const MON_SIZE_PC = 58;

const OFFSET_PRESET_START = 0xB0;
const PRESET_CAPACITY = 30;

const OFF_PID = 0x00;
const OFF_NICK = 0x08;
const OFF_SPECIES = 0x1C;
const OFF_ITEM = 0x1E;
const OFF_EXP = 0x20;
const OFF_MOVES = 0x24;
const OFF_EVS = 0x2C;
const OFF_IVS = 0x36;

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
    const moves = [];
    const m1Raw = (raw[0x26] << 8) | raw[0x27];
    moves.push(m1Raw & 0x1FF);
    const m2Raw = (raw[0x29] << 8) | raw[0x28];
    moves.push((m2Raw >>> 2) & 0x1FF);
    const m3Raw = (raw[0x2A] << 8) | raw[0x29];
    moves.push((m3Raw >>> 4) & 0x1FF);
    const m4Raw = (raw[0x2B] << 8) | raw[0x2A];
    moves.push((m4Raw >>> 6) & 0x1FF);
    return moves;
}

function writeBits(raw, idxLow, idxHigh, shift, value, isBe = false) {
    let existing;
    if (isBe) {
        existing = (raw[idxLow] << 8) | raw[idxHigh];
    } else {
        existing = (raw[idxHigh] << 8) | raw[idxLow];
    }

    const mask = 0x1FF << shift;
    existing &= ~mask;
    const next = existing | ((value & 0x1FF) << shift);

    if (isBe) {
        raw[idxLow] = (next >>> 8) & 0xFF;
        raw[idxHigh] = next & 0xFF;
    } else {
        raw[idxHigh] = (next >>> 8) & 0xFF;
        raw[idxLow] = next & 0xFF;
    }
}

function setMoves(raw, movesList) {
    const curr = [...movesList];
    while (curr.length < 4) {
        curr.push(0);
    }

    writeBits(raw, 0x26, 0x27, 0, curr[0], true);
    writeBits(raw, 0x28, 0x29, 2, curr[1], false);
    writeBits(raw, 0x29, 0x2A, 4, curr[2], false);
    writeBits(raw, 0x2A, 0x2B, 6, curr[3], false);
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

function setNature(raw, natureId) {
    let pid = ru32(raw, OFF_PID);
    while ((pid % 25) !== Number(natureId)) {
        pid = (pid + 1) >>> 0;
    }
    wu32(raw, OFF_PID, pid);
}

function parseMon(raw, box, slot, speciesMap) {
    if (!isValidMon(raw)) {
        return null;
    }

    const speciesId = ru16(raw, OFF_SPECIES);
    return {
        box,
        slot,
        nickname: decodeText(raw.slice(OFF_NICK, OFF_NICK + 10)),
        species_name: speciesMap.get(speciesId) || 'Unknown',
        species_id: speciesId,
        item_id: ru16(raw, OFF_ITEM),
        exp: ru32(raw, OFF_EXP),
        nature_id: ru32(raw, OFF_PID) % 25,
        ivs: getIvs(raw),
        evs: getEvs(raw),
        moves: getMoves(raw),
        current_ability_index: getHiddenAbilityFlag(raw) ? 2 : 0,
    };
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
    };
}

export function getPcBox(context, boxId, speciesMap) {
    const mons = [];

    if (boxId >= 1 && boxId <= 25) {
        const base = (boxId - 1) * 30;
        for (let slot = 1; slot <= 30; slot += 1) {
            const idx = base + (slot - 1);
            const off = idx * MON_SIZE_PC;
            if (off + MON_SIZE_PC > context.pcBuffer.length) {
                break;
            }
            const raw = context.pcBuffer.slice(off, off + MON_SIZE_PC);
            const mon = parseMon(raw, boxId, slot, speciesMap);
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
            const mon = parseMon(raw, 26, slot, speciesMap);
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
        throw new Error('Invalid box slot');
    }
    return { buffer: context.pcBuffer, offset: off };
}

export function editPcMonFull(context, payload) {
    const box = Number(payload.box);
    const slot = Number(payload.slot);
    const { buffer, offset } = getMonBufferAndOffset(context, box, slot);

    const raw = buffer.slice(offset, offset + MON_SIZE_PC);
    if (!isValidMon(raw)) {
        throw new Error('Pokemon not found in slot');
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
    if (payload.nature_id !== undefined && payload.nature_id !== null) {
        setNature(raw, Number(payload.nature_id));
    }
    if (payload.exp !== undefined && payload.exp !== null) {
        wu32(raw, OFF_EXP, Number(payload.exp));
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
}
