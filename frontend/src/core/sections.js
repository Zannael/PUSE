import { gbaChecksum } from './checksum.js';
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

export function unboundChecksumLength(id) {
    return id === 0 ? 0xF24 : id === 4 ? 0xD98 : id === 13 ? 0x450 : 0xFF0;
}

const UNBOUND_SIGNATURES = new Set([0x01121999, 0x01121998]);

export function activeUnboundSlot(buffer, verifyChecksums = true) {
    const slots = [];
    for (const base of [0, 14 * SECTION_SIZE]) {
        if (base + 14 * SECTION_SIZE > buffer.length) continue;
        const sections = new Map();
        for (let i = 0; i < 14; i += 1) {
            const off = base + i * SECTION_SIZE;
            const id = ru16(buffer, off + OFF_ID);
            if (id > 13 || sections.has(id) || !UNBOUND_SIGNATURES.has(ru32(buffer, off + 0xFF8))) break;
            // Section 4 is opaque; auxiliary sectors and RTC trailers are excluded.
            if (verifyChecksums && id !== 4 && gbaChecksum(buffer, off, unboundChecksumLength(id)) !== ru16(buffer, off + 0xFF6)) break;
            sections.set(id, { id, idx: ru32(buffer, off + OFF_SAVE_IDX), offset: off });
        }
        if (sections.size === 14 && new Set([...sections.values()].map((sec) => sec.idx)).size === 1) slots.push(sections);
    }
    if (slots.length === 2) {
        const delta = (slots[1].get(0).idx - slots[0].get(0).idx) >>> 0;
        if (delta > 0 && delta < 0x80000000) return slots[1];
    }
    return slots[0] || new Map();
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
