import assert from 'node:assert/strict';
import { recalculateSectionChecksum } from '../src/core/checksum.js';
import { writeSlot } from '../src/core/bag.js';
import { findActiveSectionById } from '../src/core/sections.js';
import { saveAll } from '../src/core/commit.js';
import { readMoney, updateMoney } from '../src/core/money.js';
import fs from 'node:fs';
import { loadPcContext, applyPcContextToSave, getPcBox } from '../src/core/pc.js';
const [input, edits, output] = process.argv.slice(2);
const save = new Uint8Array(fs.readFileSync(input));
try {
    const context = loadPcContext(save);
    const protectedSave = save.slice();
    for (const off of [findActiveSectionById(save, 4).off, 30 * 4096, 31 * 4096]) recalculateSectionChecksum(protectedSave, off);
    assert.deepEqual(protectedSave, save, 'Opaque/auxiliary checksum reconciliation changed bytes');
    fs.writeFileSync(`${output}.stream`, context.pcBuffer);
    fs.writeFileSync(`${output}.counts`, Array.from({ length: 24 }, (_, i) => getPcBox(context, i + 1, new Map()).length).join("\n") + "\n");
    if (edits === 'finalize') {
        fs.writeFileSync(`${output}.money`, String(readMoney(save)));
        writeSlot(save, findActiveSectionById(save, 13).off + 0x1A8, 1, 9, "id_qty");
        updateMoney(save, 123456);
        saveAll(save, context);
    } else if (edits === 'preset') {
        context.presetBuffer[0xB0 + 25] = 70;
        const off = context.sectors.find((sec) => sec.id === 0).offset;
        save[off + 0xAE0] ^= 1;
    } else if (edits !== 'noop') context.pcBuffer.set(fs.readFileSync(edits));
    applyPcContextToSave(save, context);
    fs.writeFileSync(output, save);
} catch (error) {
    console.error(error.message);
    process.exit(3);
}
