import { ru32, wu16 } from './binary.js';
import {
    OFF_CHECKSUM,
    OFF_ID,
    OFF_VALID_LEN,
    SECTION_SIZE,
} from './sections.js';

const MAX_SECTION_PAYLOAD = 0xFF4;
const UNBOUND_ITEM_SECTOR_ID = 13;
const UNBOUND_ITEM_FIXED_LEN = 0x450;

export function gbaChecksum(buffer, offset, length) {
    const safeLength = Math.max(0, length);
    const fullWordsLength = safeLength - (safeLength % 4);
    let total = 0;

    for (let i = 0; i < fullWordsLength; i += 4) {
        total = (total + ru32(buffer, offset + i)) >>> 0;
    }

    if (safeLength % 4 !== 0) {
        const tail = [0, 0, 0, 0];
        for (let i = 0; i < safeLength % 4; i += 1) {
            tail[i] = buffer[offset + fullWordsLength + i];
        }
        const tailWord =
            tail[0] |
            (tail[1] << 8) |
            (tail[2] << 16) |
            (tail[3] << 24);
        total = (total + (tailWord >>> 0)) >>> 0;
    }

    return (((total >>> 16) + (total & 0xFFFF)) & 0xFFFF) >>> 0;
}

export function normalizedValidLen(validLen) {
    if (!validLen || validLen > MAX_SECTION_PAYLOAD) {
        return MAX_SECTION_PAYLOAD;
    }
    return validLen;
}

export function recalculateSectionChecksum(buffer, sectionOffset) {
    const sectionId = buffer[sectionOffset + OFF_ID] | (buffer[sectionOffset + OFF_ID + 1] << 8);
    const validLenRaw =
        buffer[sectionOffset + OFF_VALID_LEN] |
        (buffer[sectionOffset + OFF_VALID_LEN + 1] << 8) |
        (buffer[sectionOffset + OFF_VALID_LEN + 2] << 16) |
        (buffer[sectionOffset + OFF_VALID_LEN + 3] << 24);

    const validLen = sectionId === UNBOUND_ITEM_SECTOR_ID
        ? UNBOUND_ITEM_FIXED_LEN
        : normalizedValidLen(validLenRaw >>> 0);

    const checksum = gbaChecksum(buffer, sectionOffset, validLen);
    wu16(buffer, sectionOffset + OFF_CHECKSUM, checksum);
    return checksum;
}

export function recalculateTrainerChecksum(buffer, sectionOffset) {
    const validLenRaw =
        buffer[sectionOffset + OFF_VALID_LEN] |
        (buffer[sectionOffset + OFF_VALID_LEN + 1] << 8) |
        (buffer[sectionOffset + OFF_VALID_LEN + 2] << 16) |
        (buffer[sectionOffset + OFF_VALID_LEN + 3] << 24);

    const validLen = normalizedValidLen(validLenRaw >>> 0);
    const checksum = gbaChecksum(buffer, sectionOffset, validLen);
    wu16(buffer, sectionOffset + OFF_CHECKSUM, checksum);
    return checksum;
}

export function recalculateBagChecksums(buffer, sections) {
    sections
        .filter((section) => section.id >= 13 && section.id <= 16)
        .forEach((section) => recalculateSectionChecksum(buffer, section.off));
}

export function isSectionAlignedOffset(offset) {
    return offset >= 0 && offset % SECTION_SIZE === 0;
}
