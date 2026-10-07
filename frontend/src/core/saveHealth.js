import { gbaChecksum } from './checksum.js';
import { listSections, SECTION_SIZE, activeUnboundSlot } from './sections.js';

const IDS = Array.from({ length: 14 }, (_, index) => index);
const PC_MON_SIZE = 58;

function pcField(prefix, inside) {
    const fields = [
        [0x00, 0x04, 'PID'], [0x04, 0x08, 'owner ID'], [0x08, 0x12, 'nickname'],
        [0x1C, 0x1E, 'species'], [0x1E, 0x20, 'held item'], [0x20, 0x24, 'EXP'],
        [0x24, 0x25, 'PP Ups'], [0x25, 0x26, 'happiness'], [0x26, 0x27, 'caught ball'], [0x27, 0x2C, 'moves'],
        [0x2C, 0x32, 'EVs'], [0x36, 0x3A, 'IVs/ability flag'],
    ];
    const found = fields.find(([start, end]) => inside >= start && inside < end);
    return `${prefix} ${found ? found[2] : 'data'}`;
}

function fieldLabel(sectionId, offset) {
    if (sectionId === 1) {
        if (offset >= 0x34 && offset < 0x38) return 'Party count';
        if (offset >= 0x38 && offset < 0x38 + 6 * 100) {
            const slot = Math.floor((offset - 0x38) / 100) + 1;
            const inside = (offset - 0x38) % 100;
            if (inside >= 0x08 && inside < 0x12) return `Party ${slot} nickname`;
            if (inside === 0x29) return `Party ${slot} happiness`;
            if (inside === 0x54) return `Party ${slot} level`;
            return `Party ${slot} data`;
        }
        return 'Trainer data';
    }
    if (sectionId === 0 && offset >= 0xB0 && offset < 0xB0 + 30 * PC_MON_SIZE) {
        const relative = offset - 0xB0;
        return pcField(`Preset slot ${Math.floor(relative / PC_MON_SIZE) + 1}`, relative % PC_MON_SIZE);
    }
    if (sectionId >= 5 && sectionId <= 12 && offset >= (sectionId === 5 ? 4 : 0) && offset < 0xFF0) {
        const relative = (sectionId - 5) * 0xFF0 + offset - 4;
        const monIndex = Math.floor(relative / PC_MON_SIZE);
        return pcField(`Box ${Math.floor(monIndex / 30) + 1} slot ${monIndex % 30 + 1}`, relative % PC_MON_SIZE);
    }
    if (sectionId >= 13 && sectionId <= 16) return 'Bag data';
    if (sectionId === 4 && offset >= 0xF34 && offset < 0xF36) return 'Battle Points';
    return 'Section data';
}

export function buildSaveReport(original, current, includeSource = true) {
    const sections = listSections(current);
    const active = new Map([...activeUnboundSlot(current, false)]
        .map(([id, sec]) => [id, sections[sec.offset / SECTION_SIZE]]));
    const warnings = [];
    if (current.length < 28 * SECTION_SIZE) warnings.push({ code: 'short_save', message: 'Save has fewer than 28 complete sectors.' });
    if (original.length !== current.length) warnings.push({ code: 'size_changed', message: 'Save size changed after upload.' });
    const missing = IDS.filter((id) => !active.has(id));
    if (missing.length) warnings.push({ code: 'missing_sections', message: `Active save is missing section IDs: ${missing.join(', ')}.` });

    const checksums = [];
    for (const id of IDS) {
        const section = active.get(id);
        if (!section) continue;
        if (id === 4) {
            checksums.push({ id, index: section.index, status: 'opaque', stored: section.checksum, computed: null });
            continue;
        }
        const length = id === 0 ? 0xF24 : id === 13 ? 0x450 : 0xFF0;
        const computed = gbaChecksum(current, section.off, length);
        const status = computed === section.checksum ? 'ok' : 'mismatch';
        checksums.push({ id, index: section.index, status, stored: section.checksum, computed });
        if (status === 'mismatch') warnings.push({ code: 'checksum_mismatch', message: `Active section ${id} checksum differs from its stored value.` });
    }

    const changedSectors = [];
    let changedBytes = 0;
    const totalSections = Math.floor(Math.max(original.length, current.length) / SECTION_SIZE);
    for (let index = 0; index < totalSections; index += 1) {
        const offset = index * SECTION_SIZE;
        const before = original.subarray(offset, offset + SECTION_SIZE);
        const after = current.subarray(offset, offset + SECTION_SIZE);
        const metadata = sections[index];
        const fields = new Map();
        let payloadBytes = 0;
        let footerBytes = 0;
        for (let inside = 0; inside < Math.max(before.length, after.length); inside += 1) {
            const old = inside < before.length ? before[inside] : null;
            const next = inside < after.length ? after[inside] : null;
            if (old === next) continue;
            changedBytes += 1;
            if (inside >= 0xFF0) footerBytes += 1;
            else {
                payloadBytes += 1;
                const label = fieldLabel(metadata?.id ?? null, inside);
                fields.set(label, (fields.get(label) || 0) + 1);
            }
        }
        if (payloadBytes || footerBytes) changedSectors.push({
            index, id: metadata?.id ?? null, save_index: metadata?.saveIdx ?? null,
            payload_bytes: payloadBytes, footer_bytes: footerBytes,
            fields: [...fields].map(([name, changed_bytes]) => ({ name, changed_bytes })),
        });
    }
    for (let offset = totalSections * SECTION_SIZE; offset < Math.max(original.length, current.length); offset += 1) {
        changedBytes += (offset < original.length ? original[offset] : null) !== (offset < current.length ? current[offset] : null) ? 1 : 0;
    }
    return {
        layout: { size: current.length, section_count: sections.length, trailing_bytes: current.length % SECTION_SIZE,
            active_save_index: active.size ? Math.max(...[...active.values()].map((section) => section.saveIdx)) : null,
            missing_ids: missing },
        checksums, warnings,
        source_warnings: includeSource ? buildSaveReport(original, original, false).warnings : [],
        changes: { changed_bytes: changedBytes, sectors: changedSectors },
    };
}
