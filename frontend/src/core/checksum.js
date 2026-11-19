import { gbaChecksum } from './checksumPrimitive.js';
export { gbaChecksum };
import { PROFILE } from './profile.js';
import { wu16 } from './binary.js';
import {
    OFF_CHECKSUM,
    OFF_ID,
    unboundChecksumLength,
    SECTION_SIZE,
} from './sections.js';

const MAX_SECTION_PAYLOAD = 0xFF4;

export function normalizedValidLen(validLen) {
    if (!validLen || validLen > MAX_SECTION_PAYLOAD) {
        return MAX_SECTION_PAYLOAD;
    }
    return validLen;
}

export function recalculateSectionChecksum(buffer, sectionOffset) {
    if (sectionOffset >= PROFILE.container.slot_count * PROFILE.container.sections_per_slot * SECTION_SIZE) return null;
    const sectionId = buffer[sectionOffset + OFF_ID] | (buffer[sectionOffset + OFF_ID + 1] << 8);
    if (PROFILE.container.checksum.opaque_ids.includes(sectionId)) return null;
    const validLen = unboundChecksumLength(sectionId);

    const checksum = gbaChecksum(buffer, sectionOffset, validLen);
    wu16(buffer, sectionOffset + OFF_CHECKSUM, checksum);
    return checksum;
}

export function recalculateTrainerChecksum(buffer, sectionOffset) {
    const validLen = PROFILE.container.checksum.default_length;
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
