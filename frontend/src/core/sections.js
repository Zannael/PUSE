import { selectActiveSlot } from './saveLayout.js';
import { PROFILE } from './profile.js';
import { ru16, ru32 } from './binary.js';

export const SECTION_SIZE = PROFILE.container.section_size;
export const OFF_VALID_LEN = PROFILE.container.footer.payload_end;
export const OFF_ID = PROFILE.container.footer.id;
export const OFF_CHECKSUM = PROFILE.container.footer.checksum;
export const OFF_SAVE_IDX = PROFILE.container.footer.counter;

export function listSections(buffer) {
    const sections = [];
    const total = Math.floor(buffer.length / SECTION_SIZE);

    for (let i = 0; i < total; i += 1) {
        const off = i * SECTION_SIZE;
        sections.push({
            index: i,
            off,
            id: ru16(buffer, off + OFF_ID),
            validLen: ru32(buffer, off + OFF_VALID_LEN),
            checksum: ru16(buffer, off + OFF_CHECKSUM),
            saveIdx: ru32(buffer, off + OFF_SAVE_IDX),
        });
    }

    return sections;
}

export function findSectionsById(buffer, sectionId) {
    return listSections(buffer).filter((s) => s.id === sectionId);
}

export function unboundChecksumLength(id) {
    return PROFILE.container.checksum.lengths[id] ?? PROFILE.container.checksum.default_length;
}

export function activeSections(buffer) {
    return [...activeUnboundSlot(buffer).values()].map((sec) => ({
        id: sec.id, off: sec.offset, saveIdx: sec.idx,
        validLen: unboundChecksumLength(sec.id),
    }));
}

export function findActiveSectionById(buffer, sectionId) {
    return activeSections(buffer).find((sec) => sec.id === sectionId) || null;
}

export function activeUnboundSlot(buffer, verifyChecksums = true) {
    return selectActiveSlot(buffer, PROFILE, verifyChecksums);
}
