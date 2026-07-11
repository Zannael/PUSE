import { ru8, wu8 } from './binary.js';
import { recalculateTrainerChecksum } from './checksum.js';
import { findActiveSectionById } from './sections.js';

export const TRAINER_SECTION_ID = 1;
export const DEX_SEEN_OFFSET = 0x0310;
export const DEX_CAUGHT_OFFSET = 0x038D;
export const DEX_FLAG_BYTE_COUNT = 125;
export const MAX_TRACKED_DEX_ID = 999;

export const POKEDEX_FLAG = {
    SEEN: 'seen',
    CAUGHT: 'caught',
};

function dexBitIndex(dexId) {
    const id = Number(dexId);
    if (!Number.isInteger(id) || id < 1 || id > MAX_TRACKED_DEX_ID) {
        return null;
    }
    return id - 1;
}

function readFlagAtOffset(buffer, baseOffset, dexId) {
    const bitIndex = dexBitIndex(dexId);
    if (bitIndex === null) {
        return null;
    }
    const byteIndex = Math.floor(bitIndex / 8);
    if (byteIndex < 0 || byteIndex >= DEX_FLAG_BYTE_COUNT) {
        return false;
    }
    const section = findActiveSectionById(buffer, TRAINER_SECTION_ID);
    if (!section) {
        return false;
    }
    const abs = section.off + baseOffset + byteIndex;
    if (abs < 0 || abs >= buffer.length) {
        return false;
    }
    return ((ru8(buffer, abs) >> (bitIndex % 8)) & 1) === 1;
}

function writeFlagAtOffset(buffer, baseOffset, dexId, value) {
    const bitIndex = dexBitIndex(dexId);
    if (bitIndex === null) {
        return false;
    }
    const byteIndex = Math.floor(bitIndex / 8);
    if (byteIndex < 0 || byteIndex >= DEX_FLAG_BYTE_COUNT) {
        return false;
    }
    const section = findActiveSectionById(buffer, TRAINER_SECTION_ID);
    if (!section) {
        return false;
    }
    const abs = section.off + baseOffset + byteIndex;
    if (abs < 0 || abs >= buffer.length) {
        return false;
    }
    const bit = bitIndex % 8;
    const current = ru8(buffer, abs);
    wu8(buffer, abs, value ? (current | (1 << bit)) : (current & ~(1 << bit)));
    recalculateTrainerChecksum(buffer, section.off);
    return true;
}

export function isDexSpeciesTrackable(speciesId) {
    return dexBitIndex(speciesId) !== null;
}

export function getPokedexFlags(buffer, speciesId) {
    if (!isDexSpeciesTrackable(speciesId)) {
        return { trackable: false, seen: false, caught: false };
    }
    return {
        trackable: true,
        seen: Boolean(readFlagAtOffset(buffer, DEX_SEEN_OFFSET, speciesId)),
        caught: Boolean(readFlagAtOffset(buffer, DEX_CAUGHT_OFFSET, speciesId)),
    };
}

export function setPokedexFlag(buffer, speciesId, flag, value) {
    const normalized = flag === POKEDEX_FLAG.CAUGHT ? POKEDEX_FLAG.CAUGHT : POKEDEX_FLAG.SEEN;
    const offset = normalized === POKEDEX_FLAG.CAUGHT ? DEX_CAUGHT_OFFSET : DEX_SEEN_OFFSET;
    const enabled = Boolean(value);
    if (!writeFlagAtOffset(buffer, offset, speciesId, enabled)) {
        return { ok: false, reason: 'untrackable_or_missing_section' };
    }
    if (enabled && normalized === POKEDEX_FLAG.CAUGHT) {
        writeFlagAtOffset(buffer, DEX_SEEN_OFFSET, speciesId, true);
    }
    return { ok: true, ...getPokedexFlags(buffer, speciesId) };
}

export function buildPokedexSummary(buffer, speciesRows = []) {
    const trackableSpecies = (speciesRows || [])
        .map((row) => ({
            id: Number(row.id),
            name: row.label || row.display_name || row.name || `Species ${row.id}`,
        }))
        .filter((row) => isDexSpeciesTrackable(row.id))
        .sort((a, b) => a.id - b.id);

    let seenCount = 0;
    let caughtCount = 0;
    const entries = trackableSpecies.map((row) => {
        const flags = getPokedexFlags(buffer, row.id);
        if (flags.seen) seenCount += 1;
        if (flags.caught) caughtCount += 1;
        return {
            species_id: row.id,
            species_name: row.name,
            seen: flags.seen,
            caught: flags.caught,
        };
    });

    const total = trackableSpecies.length;
    return {
        layout: 'cfru_saveblock1_v1',
        max_tracked_dex_id: MAX_TRACKED_DEX_ID,
        total,
        seen_count: seenCount,
        caught_count: caughtCount,
        seen_percent: total > 0 ? Math.round((seenCount / total) * 1000) / 10 : 0,
        caught_percent: total > 0 ? Math.round((caughtCount / total) * 1000) / 10 : 0,
        entries,
    };
}
