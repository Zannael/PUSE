import { PROFILE } from './profile.js';
import { activeUnboundSlot } from './sections.js';
import { readTrainer } from './party.js';

export function buildFieldReport(buffer) {
    const sections = activeUnboundSlot(buffer);
    if (sections.size !== 14) throw new Error('No coherent save generation for the selected profile');
    const fields = [];
    const add = (id, label, sid, relative, width, bit = null, decoder = null, confidence = 'verified-layout') => {
        const offset = sections.get(sid).offset + relative;
        const raw = buffer.slice(offset, offset + width);
        const value = raw.reduce((sum, byte, i) => sum + byte * (2 ** (8 * i)), 0);
        const decoded = decoder ? decoder(value) : bit === null ? String(value) : String(Boolean(value & (1 << bit)));
        fields.push({ id, label, section_id: sid, relative_offset: relative, file_offset: offset,
            width, bit, raw_hex: [...raw].map((byte) => byte.toString(16).padStart(2, '0')).join(''), decoded, confidence });
    };
    add('trainer.name', 'Trainer name', 0, 0, 7, null, () => readTrainer(buffer).name);
    add('trainer.gender', 'Trainer gender byte (unclassified enum)', 0, 8, 1, null, null, 'layout-only');
    add('trainer.tid', 'Trainer ID', 0, 0xA, 2);
    add('trainer.sid', 'Secret ID', 0, 0xC, 2);
    const party = PROFILE.storage.party;
    add('party.count', 'Stored party count', party.section_id, party.count_offset, 4);
    const resources = PROFILE.storage.resources;
    let key = 0;
    if (PROFILE.id === 'radical-red-4.1') {
        add('money.key', 'Money XOR key', 0, resources.key_offset, 4);
        key = Number(fields.at(-1).decoded);
    }
    add('money.value', 'Stored money (decoded)', resources.trainer_section_id, resources.money_offset, 4, null,
        (value) => String((value ^ key) >>> 0));
    if (PROFILE.id === 'unbound-2.1.1.1') {
        const flags = Array.from({ length: 8 }, (_, n) => [0x820 + n, `badge.${n + 1}`, `Badge ${n + 1}`]);
        flags.push([0x82C, 'progress.champion', 'Champion'], [0x91E, 'progress.dexnav', 'DexNav']);
        for (const [flag, id, label] of flags) {
            let sid = flag >= 0x900 ? 4 : 1;
            let relative = flag >= 0x900 ? 0xD98 + Math.floor((flag - 0x900) / 8) : 0xEE0 + Math.floor(flag / 8);
            while (relative >= 0xFF0) { sid += 1; relative -= 0xFF0; }
            add(id, label, sid, relative, 1, flag % 8);
        }
    }
    return { schema_version: 1, profile_id: PROFILE.id, read_only: true, exact_rom_version_confirmed: false,
        notice: 'Known fields for the selected profile; layout evidence does not confirm the ROM version. Unknown flags are not classified.',
        save_index: sections.get(0).idx, fields };
}
