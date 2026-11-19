import assert from 'node:assert/strict';
import fs from 'node:fs';
import { activateProfile } from '../src/core/profile.js';
import { loadPcContext, editPcMonFull, applyPcContextToSave } from '../src/core/pc.js';
import { updatePartyHappiness, updatePartyItem } from '../src/core/party.js';

// Each case starts from the same immutable synthetic input as Python/C++.
for (const test of JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))) {
    await activateProfile(test.profile);
    const save = new Uint8Array(fs.readFileSync(test.input));
    const context = loadPcContext(save);
    const before = save.slice(), pcBefore = context.pcBuffer.slice();
    const payload = { [test.operation === 'item' ? 'item_id' : 'happiness']: test.value };
    const party = () => (test.operation === 'item' ? updatePartyItem : updatePartyHappiness)(save, test.index, payload);
    const pc = () => editPcMonFull(context, { box: test.box, slot: test.slot, ...payload });
    if (test.reject) {
        assert.throws(party, undefined, test.name);
        assert.deepEqual(save, before, test.name);
        assert.throws(pc, undefined, test.name);
        assert.deepEqual(context.pcBuffer, pcBefore, test.name);
    } else {
        party();
        pc();
    }
    applyPcContextToSave(save, context);
    if (test.reject) assert.deepEqual(save, before, test.name);
    fs.writeFileSync(test.output, save);
}
