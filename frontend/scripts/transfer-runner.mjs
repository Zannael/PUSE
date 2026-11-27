import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = '/home/zappaganini/PycharmProjects/pokemon';
const publicDir = path.join(ROOT, 'frontend', 'public');
globalThis.fetch = async (urlPath) => {
    const rel = String(urlPath).replace(/^\/+/, '');
    const fullPath = path.join(publicDir, rel);
    const text = await fs.readFile(fullPath, 'utf-8');
    return {
        ok: true,
        status: 200,
        text: async () => text,
        json: async () => JSON.parse(text),
    };
};

const { activateProfile } = await import(path.join(ROOT, 'frontend/src/core/profile.js'));
const { loadCatalog } = await import(path.join(ROOT, 'frontend/src/core/catalog.js'));
const { transferPartyPc } = await import(path.join(ROOT, 'frontend/src/core/transfer.js'));
const session = await import(path.join(ROOT, 'frontend/src/core/saveSession.js'));

function assertRejectsImmutable(baseBytes, payload) {
    const copy = new Uint8Array(baseBytes);
    assert.throws(() => transferPartyPc(copy, payload));
    assert.deepEqual(copy, baseBytes);
}

function formatLabel(res) {
    const pNum = res.party_index + 1;
    if (res.mode === 'party_to_pc') {
        return `Move Party #${pNum} -> Box ${res.box}-${res.slot}`;
    }
    if (res.mode === 'pc_to_party') {
        return `Move Box ${res.box}-${res.slot} -> Party #${pNum}`;
    }
    return `Swap Party #${pNum} <-> Box ${res.box}-${res.slot}`;
}

function runAndRecord(payload) {
    const before = new Uint8Array(session.getBuffer());
    const next = new Uint8Array(before);
    const res = transferPartyPc(next, payload);
    session.setBuffer(next, { dirty: true, preservePcContext: false });
    session.recordChange(before, 'party_pc_transfer', formatLabel(res));
    return res;
}

const cases = JSON.parse(await fs.readFile(process.argv[2], 'utf-8'));

for (const test of cases) {
    await activateProfile(test.profile);
    await loadCatalog(test.profile);

    const isUnbound = test.profile === 'unbound-2.1.1.1';
    const boundaryBox = isUnbound ? 20 : 25;
    const boundarySlot = isUnbound ? 1 : 5;
    const swapBox = isUnbound ? 23 : 25;
    const swapSlot = isUnbound ? 4 : 1;
    const boxCount = isUnbound ? 24 : 25;

    const mainInput = new Uint8Array(await fs.readFile(test.main_input));
    await session.loadFile({ name: `${test.profile}.sav`, arrayBuffer: async () => mainInput }, test.profile);

    let res = runAndRecord({ mode: 'party_to_pc', party_index: 0, box: boundaryBox, slot: boundarySlot });
    assert.equal(res.party_count, 5);
    await fs.writeFile(`${test.out_prefix}-s1.sav`, session.getBuffer());

    res = runAndRecord({ mode: 'party_to_pc', party_index: 1, box: null, slot: null });
    assert.equal(res.box, 1);
    assert.equal(res.slot, 3);
    assert.equal(res.party_count, 4);
    await fs.writeFile(`${test.out_prefix}-s2.sav`, session.getBuffer());

    res = runAndRecord({ mode: 'pc_to_party', party_index: null, box: 1, slot: 1 });
    assert.equal(res.party_index, 4);
    assert.equal(res.party_count, 5);
    await fs.writeFile(`${test.out_prefix}-s3.sav`, session.getBuffer());

    res = runAndRecord({ mode: 'swap_party_pc', party_index: 2, box: swapBox, slot: swapSlot });
    assert.equal(res.party_count, 5);
    await fs.writeFile(`${test.out_prefix}-s4.sav`, session.getBuffer());

    res = runAndRecord({ mode: 'party_to_pc', party_index: 4, box: 1, slot: 1 });
    assert.equal(res.party_count, 4);
    res = runAndRecord({ mode: 'pc_to_party', party_index: null, box: 1, slot: 1 });
    assert.equal(res.party_index, 4);
    assert.equal(res.party_count, 5);
    await fs.writeFile(`${test.out_prefix}-s5.sav`, session.getBuffer());

    assertRejectsImmutable(session.getBuffer(), { mode: 'party_to_pc', party_index: 0, box: 1, slot: 3 });
    assertRejectsImmutable(session.getBuffer(), { mode: 'party_to_pc', party_index: 0, box: 1, slot: 2 });
    assertRejectsImmutable(session.getBuffer(), { mode: 'pc_to_party', party_index: null, box: 1, slot: 1 });
    assertRejectsImmutable(session.getBuffer(), { mode: 'pc_to_party', party_index: null, box: 1, slot: 2 });
    assertRejectsImmutable(session.getBuffer(), { mode: 'swap_party_pc', party_index: 0, box: 1, slot: 1 });
    assertRejectsImmutable(session.getBuffer(), { mode: 'swap_party_pc', party_index: 0, box: 1, slot: 2 });
    assertRejectsImmutable(session.getBuffer(), { mode: 'party_to_pc', party_index: 0, box: 26, slot: 1 });
    assertRejectsImmutable(session.getBuffer(), { mode: 'pc_to_party', party_index: null, box: 26, slot: 1 });
    assertRejectsImmutable(session.getBuffer(), { mode: 'party_to_pc', party_index: 0, box: boxCount + 1, slot: 1 });
    assertRejectsImmutable(session.getBuffer(), { mode: 'party_to_pc', party_index: 0, box: 1, slot: 31 });
    assertRejectsImmutable(session.getBuffer(), { mode: 'party_to_pc', party_index: 5, box: 1, slot: 1 });
    assertRejectsImmutable(mainInput, { mode: 'pc_to_party', party_index: null, box: 1, slot: 3 });

    session.undoLastChange();
    session.undoLastChange();
    await fs.writeFile(`${test.out_prefix}-undo_to_s4.sav`, session.getBuffer());
    while (session.getHistorySummary().can_undo) {
        session.undoLastChange();
    }
    assert.deepEqual(session.getBuffer(), mainInput);
    await fs.writeFile(`${test.out_prefix}-undo_all.sav`, session.getBuffer());

    runAndRecord({ mode: 'swap_party_pc', party_index: 0, box: 1, slot: 1 });
    session.resetSaveToOriginal();
    assert.deepEqual(session.getBuffer(), mainInput);
    await fs.writeFile(`${test.out_prefix}-reset.sav`, session.getBuffer());

    {
        const oneInput = new Uint8Array(await fs.readFile(test.one_input));
        await session.loadFile({ name: `${test.profile}_one.sav`, arrayBuffer: async () => oneInput }, test.profile);
        assertRejectsImmutable(session.getBuffer(), { mode: 'party_to_pc', party_index: 0, box: 1, slot: 3 });
        assertRejectsImmutable(session.getBuffer(), { mode: 'party_to_pc', party_index: 0, box: null, slot: null });
        const oneRes = runAndRecord({ mode: 'swap_party_pc', party_index: 0, box: 1, slot: 1 });
        assert.equal(oneRes.party_count, 1);
        await fs.writeFile(`${test.out_prefix}-one_swap.sav`, session.getBuffer());
    }

    {
        const fullInput = new Uint8Array(await fs.readFile(test.full_pc_input));
        assertRejectsImmutable(fullInput, { mode: 'party_to_pc', party_index: 0, box: null, slot: null });
        assertRejectsImmutable(fullInput, { mode: 'party_to_pc', party_index: 0, box: 1, slot: null });
    }
}
