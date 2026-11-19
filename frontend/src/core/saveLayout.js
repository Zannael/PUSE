import { ru16, ru32 } from './binary.js';
import { gbaChecksum } from './checksumPrimitive.js';

export function selectActiveSlot(buffer, profile, verifyChecksums = true) {
    const slots = [];
    const count = profile.container.sections_per_slot;
    for (let slot = 0; slot < profile.container.slot_count; slot += 1) {
        const base = slot * count * profile.container.section_size;
        if (base + count * profile.container.section_size > buffer.length) continue;
        const sections = new Map();
        for (let i = 0; i < count; i += 1) {
            const off = base + i * profile.container.section_size;
            const id = ru16(buffer, off + profile.container.footer.id);
            if (id >= count || sections.has(id) || !profile.container.signatures.includes(ru32(buffer, off + profile.container.footer.signature))) break;
            // Section 4 is opaque; auxiliary sectors and RTC trailers are excluded.
            if (verifyChecksums && !profile.container.checksum.opaque_ids.includes(id) && gbaChecksum(buffer, off, (profile.container.checksum.lengths[id] ?? profile.container.checksum.default_length)) !== ru16(buffer, off + profile.container.footer.checksum)) break;
            sections.set(id, { id, idx: ru32(buffer, off + profile.container.footer.counter), offset: off });
        }
        if (sections.size === count && new Set([...sections.values()].map((sec) => sec.idx)).size === 1) slots.push(sections);
    }
    if (slots.length === 2) {
        const delta = (slots[1].get(0).idx - slots[0].get(0).idx) >>> 0;
        if (delta > 0 && delta < 0x80000000) return slots[1];
    }
    return slots[0] || new Map();
}
