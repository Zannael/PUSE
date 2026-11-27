import { getProfile, requireCapability } from './profile.js';
import { getMoveBasePpById } from './catalog.js';
import { getSpeciesGrowthRate, calcCurrentLevel } from './growth.js';
import { calculateBattleStats } from './battlePreview.js';
import { loadPcContext, applyPcContextToSave } from './pc.js';
import { activeUnboundSlot } from './sections.js';
import { recalculateSectionChecksum } from './checksum.js';
import { ru16, ru32, wu16, wu32 } from './binary.js';

const PARTY_MON_SIZE = 100;
const PC_MON_SIZE = 58;
const VALID_MODES = new Set(['party_to_pc', 'pc_to_party', 'swap_party_pc']);

function parseStrictInt(value, label) {
    if (typeof value === 'boolean' || value === null || value === undefined || value === '') {
        throw new Error(`Invalid ${label}`);
    }
    const num = Number(value);
    if (!Number.isInteger(num)) {
        throw new Error(`Invalid ${label}`);
    }
    return num;
}

function isZeroOrMissing(value) {
    if (value === null || value === undefined || value === '') {
        return true;
    }
    if (typeof value === 'boolean') {
        return false;
    }
    return Number(value) === 0;
}

function calculateMaxPp(moveId, ppUps) {
    const id = Number(moveId);
    if (!Number.isInteger(id) || id <= 0) {
        return 0;
    }
    const basePp = getMoveBasePpById(id);
    if (basePp <= 0) {
        return 0;
    }
    const ups = Math.max(0, Math.min(3, Math.trunc(Number(ppUps) || 0)));
    return basePp + Math.floor((basePp * ups) / 5);
}

function isValidPcRecord(pcRaw, profile) {
    const fields = profile.codecs.pc.fields;
    const val = profile.codecs.pc.legacy_validation;
    const speciesId = ru16(pcRaw, fields.species);
    const exp = ru32(pcRaw, fields.exp);
    return speciesId !== 0 && speciesId <= val.max_species_id && exp >= val.min_exp && exp <= val.max_exp;
}

export function partyRawToPcRaw(partyRaw) {
    if (!(partyRaw instanceof Uint8Array) || partyRaw.length !== PARTY_MON_SIZE) {
        throw new Error('Invalid party record width');
    }

    const raw = new Uint8Array(PC_MON_SIZE);
    raw.set(partyRaw.subarray(0x00, 0x1C), 0x00);
    raw.set(partyRaw.subarray(0x20, 0x2B), 0x1C);

    let packedMoves = 0n;
    for (let i = 0; i < 4; i += 1) {
        const moveId = BigInt(ru16(partyRaw, 0x2C + (i * 2)) & 0x3FF);
        packedMoves |= moveId << BigInt(10 * i);
    }
    for (let i = 0; i < 5; i += 1) {
        raw[0x27 + i] = Number((packedMoves >> BigInt(8 * i)) & 0xFFn);
    }

    raw.set(partyRaw.subarray(0x38, 0x3E), 0x2C);
    raw.set(partyRaw.subarray(0x44, 0x4C), 0x32);
    return raw;
}

export function pcRawToPartyRaw(pcRaw) {
    if (!(pcRaw instanceof Uint8Array) || pcRaw.length !== PC_MON_SIZE) {
        throw new Error('Invalid PC record width');
    }

    const profile = getProfile();
    const raw = new Uint8Array(PARTY_MON_SIZE);
    raw.set(pcRaw.subarray(0x00, 0x1C), 0x00);
    raw.set(pcRaw.subarray(0x1C, 0x27), 0x20);

    let packedMoves = 0n;
    for (let i = 0; i < 5; i += 1) {
        packedMoves |= BigInt(pcRaw[0x27 + i]) << BigInt(8 * i);
    }
    const ppUpsByte = raw[0x28];
    for (let i = 0; i < 4; i += 1) {
        const moveId = Number((packedMoves >> BigInt(10 * i)) & 0x3FFn);
        wu16(raw, 0x2C + (i * 2), moveId);
        const ppUp = (ppUpsByte >> (2 * i)) & 0x03;
        const maxPp = calculateMaxPp(moveId, ppUp);
        raw[0x34 + i] = Math.max(0, Math.min(255, maxPp));
    }

    raw.set(pcRaw.subarray(0x2C, 0x32), 0x38);
    raw.set(pcRaw.subarray(0x32, 0x3A), 0x44);

    const speciesId = ru16(raw, 0x20);
    const exp = ru32(raw, 0x24);
    const speciesGrowth = getSpeciesGrowthRate(speciesId);
    const growthRate = speciesGrowth === null ? 0 : speciesGrowth;
    const levelMax = Number(profile.rules.level_max);
    const level = Math.max(1, Math.min(levelMax, calcCurrentLevel(growthRate, exp)));
    raw[0x54] = level;
    raw[0x55] = 0xFF;

    const ivPacked = ru32(raw, 0x48);
    const ivs = {
        HP: (ivPacked >>> 0) & 0x1F,
        Atk: (ivPacked >>> 5) & 0x1F,
        Def: (ivPacked >>> 10) & 0x1F,
        Spe: (ivPacked >>> 15) & 0x1F,
        SpA: (ivPacked >>> 20) & 0x1F,
        SpD: (ivPacked >>> 25) & 0x1F,
    };
    const evs = {
        HP: raw[0x38],
        Atk: raw[0x39],
        Def: raw[0x3A],
        Spe: raw[0x3B],
        SpA: raw[0x3C],
        SpD: raw[0x3D],
    };
    const natureId = ru32(raw, 0x00) % 25;
    const stats = calculateBattleStats({ speciesId, level, natureId, ivs, evs });
    if (stats) {
        wu16(raw, 0x56, Math.max(1, stats.HP));
        wu16(raw, 0x58, Math.max(1, stats.HP));
        wu16(raw, 0x5A, Math.max(1, stats.Atk));
        wu16(raw, 0x5C, Math.max(1, stats.Def));
        wu16(raw, 0x5E, Math.max(1, stats.Spe));
        wu16(raw, 0x60, Math.max(1, stats.SpA));
        wu16(raw, 0x62, Math.max(1, stats.SpD));
    }
    wu16(raw, 0x1C, 0);
    return raw;
}

export function findFirstEmptyPcSlot(stream, { box = null, profile = null } = {}) {
    const activeProfile = profile || getProfile();
    const pcCfg = activeProfile.storage.pc;
    const boxCount = Number(pcCfg.box_count);
    const slotsPerBox = Number(pcCfg.slots_per_box);
    const recSize = Number(pcCfg.record_size);
    const speciesOff = Number(activeProfile.codecs.pc.fields.species);

    let boxList;
    if (box !== null && box !== undefined) {
        const targetBox = parseStrictInt(box, 'PC box');
        if (targetBox < 1 || targetBox > boxCount) {
            throw new Error('Invalid PC box');
        }
        boxList = [targetBox];
    } else {
        boxList = Array.from({ length: boxCount }, (_, i) => i + 1);
    }

    for (const b of boxList) {
        for (let s = 1; s <= slotsPerBox; s += 1) {
            const off = (((b - 1) * slotsPerBox) + (s - 1)) * recSize;
            if (off + recSize > stream.length) {
                break;
            }
            if (ru16(stream, off + speciesOff) === 0) {
                return { box: b, slot: s };
            }
        }
    }
    return null;
}

function validateExplicitBoxSlot(box, slot, pcBufferLen, profile) {
    const pcCfg = profile.storage.pc;
    const boxCount = Number(pcCfg.box_count);
    const slotsPerBox = Number(pcCfg.slots_per_box);
    const recSize = Number(pcCfg.record_size);

    if (box === null || box === undefined) {
        throw new Error('PC box is required');
    }
    const b = parseStrictInt(box, 'PC box');
    if (b < 1 || b > boxCount) {
        throw new Error('Invalid PC box');
    }

    if (slot === null || slot === undefined) {
        throw new Error('PC slot is required');
    }
    const s = parseStrictInt(slot, 'PC slot');
    if (s < 1 || s > slotsPerBox) {
        throw new Error('Invalid PC slot');
    }

    const streamOff = (((b - 1) * slotsPerBox) + (s - 1)) * recSize;
    if (streamOff + recSize > pcBufferLen) {
        throw new Error('PC slot out of bounds');
    }
    return { box: b, slot: s, streamOff };
}

export function transferPartyPc(buffer, { mode, party_index = null, box = null, slot = null } = {}) {
    if (!(buffer instanceof Uint8Array)) {
        throw new Error('Expected Uint8Array save buffer');
    }

    requireCapability('party');
    requireCapability('pc');

    const modeNorm = String(mode || '').trim().toLowerCase();
    if (!VALID_MODES.has(modeNorm)) {
        throw new Error('Invalid transfer mode');
    }

    const profile = getProfile();
    const partyCfg = profile.storage.party;
    const pcCfg = profile.storage.pc;

    const activeSlot = activeUnboundSlot(buffer);
    const trainerSid = Number(partyCfg.section_id);
    const trainerSec = activeSlot.get(trainerSid);
    if (!trainerSec) {
        throw new Error('Trainer section not found');
    }
    const trainerOff = trainerSec.offset;

    const pcContext = loadPcContext(buffer);
    const pcBuffer = pcContext.pcBuffer;

    const countOffset = Number(partyCfg.count_offset);
    const partyStart = Number(partyCfg.start);
    const partyRecSize = Number(partyCfg.record_size);
    const partyCap = Number(partyCfg.capacity);
    const partySpeciesOff = Number(profile.codecs.party.fields.data_start);

    const boxCount = Number(pcCfg.box_count);
    const slotsPerBox = Number(pcCfg.slots_per_box);
    const pcRecSize = Number(pcCfg.record_size);
    const pcSpeciesOff = Number(profile.codecs.pc.fields.species);

    const partyCount = ru32(buffer, trainerOff + countOffset);
    if (partyCount > partyCap) {
        throw new Error('Invalid party count');
    }

    if (modeNorm === 'party_to_pc') {
        if (partyCount <= 1) {
            throw new Error('Cannot move the last Pokemon out of your party');
        }
        if (party_index === null || party_index === undefined) {
            throw new Error('party_index is required');
        }
        const idx = parseStrictInt(party_index, 'party_index');
        if (idx < 0 || idx >= partyCount) {
            throw new Error('Party Pokemon not found');
        }

        const partyOff = trainerOff + partyStart + (idx * partyRecSize);
        const partyRaw = buffer.slice(partyOff, partyOff + partyRecSize);
        if (ru16(partyRaw, partySpeciesOff) === 0) {
            throw new Error('Party Pokemon not found');
        }

        let targetBox;
        let targetSlot;
        let streamOff;

        if (isZeroOrMissing(box)) {
            if (!isZeroOrMissing(slot)) {
                throw new Error('PC box is required when slot is specified');
            }
            const found = findFirstEmptyPcSlot(pcBuffer, { profile });
            if (!found) {
                throw new Error('PC storage is full');
            }
            targetBox = found.box;
            targetSlot = found.slot;
            streamOff = (((targetBox - 1) * slotsPerBox) + (targetSlot - 1)) * pcRecSize;
        } else if (isZeroOrMissing(slot)) {
            targetBox = parseStrictInt(box, 'PC box');
            if (targetBox < 1 || targetBox > boxCount) {
                throw new Error('Invalid PC box');
            }
            const found = findFirstEmptyPcSlot(pcBuffer, { box: targetBox, profile });
            if (!found) {
                throw new Error('Target box is full');
            }
            targetSlot = found.slot;
            streamOff = (((targetBox - 1) * slotsPerBox) + (targetSlot - 1)) * pcRecSize;
        } else {
            ({ box: targetBox, slot: targetSlot, streamOff } = validateExplicitBoxSlot(box, slot, pcBuffer.length, profile));
        }

        if (ru16(pcBuffer, streamOff + pcSpeciesOff) !== 0) {
            throw new Error('Target PC slot is occupied');
        }

        const nextPc = partyRawToPcRaw(partyRaw);

        pcBuffer.set(nextPc, streamOff);
        for (let k = idx; k < partyCount - 1; k += 1) {
            const dst = trainerOff + partyStart + (k * partyRecSize);
            const src = trainerOff + partyStart + ((k + 1) * partyRecSize);
            buffer.set(buffer.subarray(src, src + partyRecSize), dst);
        }
        const tailOff = trainerOff + partyStart + ((partyCount - 1) * partyRecSize);
        buffer.fill(0, tailOff, tailOff + partyRecSize);
        const newCount = partyCount - 1;
        wu32(buffer, trainerOff + countOffset, newCount);
        recalculateSectionChecksum(buffer, trainerOff);
        applyPcContextToSave(buffer, pcContext);

        return {
            mode: modeNorm,
            party_index: idx,
            box: targetBox,
            slot: targetSlot,
            party_count: newCount,
        };
    }

    if (modeNorm === 'pc_to_party') {
        if (partyCount >= partyCap) {
            throw new Error('Party is full');
        }
        const { box: targetBox, slot: targetSlot, streamOff } = validateExplicitBoxSlot(box, slot, pcBuffer.length, profile);
        const pcRaw = pcBuffer.slice(streamOff, streamOff + pcRecSize);
        if (ru16(pcRaw, pcSpeciesOff) === 0) {
            throw new Error('Source PC slot is empty');
        }
        if (!isValidPcRecord(pcRaw, profile)) {
            throw new Error('Source PC slot is invalid or unsupported');
        }

        const nextParty = pcRawToPartyRaw(pcRaw);

        const dstOff = trainerOff + partyStart + (partyCount * partyRecSize);
        buffer.set(nextParty, dstOff);
        const newCount = partyCount + 1;
        wu32(buffer, trainerOff + countOffset, newCount);
        recalculateSectionChecksum(buffer, trainerOff);
        pcBuffer.fill(0, streamOff, streamOff + pcRecSize);
        applyPcContextToSave(buffer, pcContext);

        return {
            mode: modeNorm,
            party_index: partyCount,
            box: targetBox,
            slot: targetSlot,
            party_count: newCount,
        };
    }

    if (partyCount <= 0) {
        throw new Error('Party is empty');
    }
    if (party_index === null || party_index === undefined) {
        throw new Error('party_index is required');
    }
    const idx = parseStrictInt(party_index, 'party_index');
    if (idx < 0 || idx >= partyCount) {
        throw new Error('Party Pokemon not found');
    }

    const { box: targetBox, slot: targetSlot, streamOff } = validateExplicitBoxSlot(box, slot, pcBuffer.length, profile);
    const partyOff = trainerOff + partyStart + (idx * partyRecSize);
    const partyRaw = buffer.slice(partyOff, partyOff + partyRecSize);
    if (ru16(partyRaw, partySpeciesOff) === 0) {
        throw new Error('Party Pokemon not found');
    }

    const pcRaw = pcBuffer.slice(streamOff, streamOff + pcRecSize);
    if (ru16(pcRaw, pcSpeciesOff) === 0) {
        throw new Error('Source PC slot is empty');
    }
    if (!isValidPcRecord(pcRaw, profile)) {
        throw new Error('Source PC slot is invalid or unsupported');
    }

    const nextPc = partyRawToPcRaw(partyRaw);
    const nextParty = pcRawToPartyRaw(pcRaw);

    buffer.set(nextParty, partyOff);
    recalculateSectionChecksum(buffer, trainerOff);
    pcBuffer.set(nextPc, streamOff);
    applyPcContextToSave(buffer, pcContext);

    return {
        mode: modeNorm,
        party_index: idx,
        box: targetBox,
        slot: targetSlot,
        party_count: partyCount,
    };
}
