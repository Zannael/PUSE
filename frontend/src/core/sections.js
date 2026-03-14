import { ru16, ru32 } from './binary.js';

export const SECTION_SIZE = 0x1000;
export const OFF_VALID_LEN = 0xFF0;
export const OFF_ID = 0xFF4;
export const OFF_CHECKSUM = 0xFF6;
export const OFF_SAVE_IDX = 0xFFC;

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

export function findActiveSectionById(buffer, sectionId) {
    const matches = findSectionsById(buffer, sectionId);
    if (matches.length === 0) {
        return null;
    }

    return matches.reduce((best, current) => {
        if (!best) {
            return current;
        }
        return current.saveIdx > best.saveIdx ? current : best;
    }, null);
}
