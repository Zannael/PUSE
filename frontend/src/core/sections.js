import { PROFILE } from './profile.js';
import { gbaChecksum } from './checksum.js';
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

const UNBOUND_SIGNATURES = new Set(PROFILE.container.signatures);

export function activeUnboundSlot(buffer, verifyChecksums = true) {
    const slots = [];
    const count = PROFILE.container.sections_per_slot;
    for (let slot = 0; slot < PROFILE.container.slot_count; slot += 1) {
        const base = slot * count * SECTION_SIZE;
        if (base + count * SECTION_SIZE > buffer.length) continue;
        const sections = new Map();
        for (let i = 0; i < count; i += 1) {
            const off = base + i * SECTION_SIZE;
            const id = ru16(buffer, off + OFF_ID);
            if (id >= count || sections.has(id) || !UNBOUND_SIGNATURES.has(ru32(buffer, off + PROFILE.container.footer.signature))) break;
            // Section 4 is opaque; auxiliary sectors and RTC trailers are excluded.
            if (verifyChecksums && !PROFILE.container.checksum.opaque_ids.includes(id) && gbaChecksum(buffer, off, unboundChecksumLength(id)) !== ru16(buffer, off + OFF_CHECKSUM)) break;
            sections.set(id, { id, idx: ru32(buffer, off + OFF_SAVE_IDX), offset: off });
        }
        if (sections.size === count && new Set([...sections.values()].map((sec) => sec.idx)).size === 1) slots.push(sections);
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
