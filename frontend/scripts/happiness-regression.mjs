import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadPcContext, editPcMonFull, getPcBox } from '../src/core/pc.js';
import { updatePartyHappiness, getParty } from '../src/core/party.js';
import { saveAll } from '../src/core/commit.js';
import { buildSaveReport } from '../src/core/saveHealth.js';

const savePath = path.resolve(process.cwd(), process.argv[2] || '../backend/local_artifacts/Unbound.sav');
const original = new Uint8Array(fs.readFileSync(savePath));
for (const [partyValue, pcValue] of [[0, 255], [255, 0], [70, 143]]) {
    const buffer = new Uint8Array(original);
    const context = loadPcContext(buffer);
    const partyBefore = getParty(buffer, new Map());
    const pcBefore = getPcBox(context, 1, new Map())[0];
    assert(partyBefore.length > 0 && pcBefore, 'fixture needs Party and Box 1 Pokémon');
    updatePartyHappiness(buffer, 0, { happiness: partyValue });
    editPcMonFull(context, { box: 1, slot: pcBefore.slot, happiness: pcValue });
    assert.equal(getParty(buffer, new Map())[0].happiness, partyValue);
    assert.equal(getPcBox(context, 1, new Map())[0].happiness, pcValue);
    const result = saveAll(buffer, context);

    const backend = spawnSync('python3', ['../backend/tools/happiness_save_fixture.py', savePath, String(partyValue), String(pcValue)], {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONPATH: '../backend' },
        maxBuffer: 1024 * 1024,
    });
    assert.equal(backend.status, 0, backend.stderr.toString());
    assert.deepEqual(Buffer.from(result), backend.stdout, 'backend/local saved bytes differ');
    const differences = [...result.keys()].filter((index) => result[index] !== original[index]);
    assert(differences.length > 0, 'mutation did not change save');
    const fields = buildSaveReport(original, result).changes.sectors.flatMap((sector) => sector.fields.map((field) => field.name));
    if (partyBefore[0].happiness !== partyValue) assert(fields.includes('Party 1 happiness'));
    if (pcBefore.happiness !== pcValue) assert(fields.includes('Box 1 slot 1 happiness'));
}

for (const invalid of [-1, 256, 1.5]) {
    const buffer = new Uint8Array(original);
    const context = loadPcContext(buffer);
    assert.throws(() => updatePartyHappiness(buffer, 0, { happiness: invalid }));
    assert.throws(() => editPcMonFull(context, { box: 1, slot: 1, happiness: invalid }));
}
console.log('Happiness backend/local full-save parity passed.');
