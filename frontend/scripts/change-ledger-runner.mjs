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
const { updatePartyHappiness } = await import(path.join(ROOT, 'frontend/src/core/party.js'));
const { loadPcContext, editPcMonFull, applyPcContextToSave, syncPcContextBaseline } = await import(path.join(ROOT, 'frontend/src/core/pc.js'));
const { updateMoney, updateBp } = await import(path.join(ROOT, 'frontend/src/core/money.js'));
const { writeSlot } = await import(path.join(ROOT, 'frontend/src/core/bag.js'));
const { ChangeLedger } = await import(path.join(ROOT, 'frontend/src/core/changeLedger.js'));
const session = await import(path.join(ROOT, 'frontend/src/core/saveSession.js'));

const cases = JSON.parse(await fs.readFile(process.argv[2], 'utf-8'));

for (const test of cases) {
    await activateProfile(test.profile);
    await loadCatalog(test.profile);

    const inputBytes = new Uint8Array(await fs.readFile(test.input));
    const isUnbound = test.profile === 'unbound-2.1.1.1';
    await session.loadFile({ name: test.filename, arrayBuffer: async () => inputBytes }, test.profile);

    // Step 1: Party happiness
    {
        const before = new Uint8Array(session.getBuffer());
        const next = new Uint8Array(before);
        updatePartyHappiness(next, 0, { happiness: 200 });
        session.setBuffer(next, { preservePcContext: false });
        session.recordChange(before, 'party_edit', 'Edit Party slot 1');
    }
    await fs.writeFile(`${test.out_prefix}-step1.sav`, session.getBuffer());

    // Step 2: PC slot 1 item + baseline sync (Step 1 invariant)
    {
        const before = new Uint8Array(session.getBuffer());
        const ctx = loadPcContext(before);
        session.setPcContext(ctx);
        editPcMonFull(ctx, { box: 1, slot: 1, item_id: 17 });
        const next = new Uint8Array(before);
        applyPcContextToSave(next, ctx);
        syncPcContextBaseline(next, ctx);
        session.setBuffer(next, { preservePcContext: true });
        session.recordChange(before, 'pc_edit', 'Edit Box 1 slot 1 item');
    }
    await fs.writeFile(`${test.out_prefix}-step2.sav`, session.getBuffer());

    // Step 3a: Aborted group must restore baseline & clear stale PC context
    const entriesBeforeAbort = session.getHistorySummary().entries.length;
    session.beginHistoryGroup('resources_edit', 'Aborted group');
    {
        const next = new Uint8Array(session.getBuffer());
        updateMoney(next, 777777);
        session.setBuffer(next, { preservePcContext: true });
    }
    assert.equal(session.abortHistoryGroup().aborted, true);
    assert.equal(session.getPcContext(), null);
    assert.equal(session.getHistorySummary().entries.length, entriesBeforeAbort);
    await fs.writeFile(`${test.out_prefix}-aborted.sav`, session.getBuffer());

    // Step 3b: Committed group
    session.beginHistoryGroup('resources_edit', 'Update Money / BP');
    {
        const next = new Uint8Array(session.getBuffer());
        updateMoney(next, 88888);
        if (isUnbound) {
            updateBp(next, 777);
        }
        session.setBuffer(next, { preservePcContext: false });
    }
    const groupEntry = session.commitHistoryGroup();
    assert.ok(groupEntry);
    await fs.writeFile(`${test.out_prefix}-step3.sav`, session.getBuffer());

    if (isUnbound) {
        {
            const before = new Uint8Array(session.getBuffer());
            const next = new Uint8Array(before);
            writeSlot(next, test.bag_offset, 13, 12, 'id_qty');
            session.setBuffer(next, { preservePcContext: false });
            session.recordChange(before, 'bag_edit', 'Edit Bag slot 1');
        }
        assert.equal(session.getSessionSnapshot().bag_dirty, true);
        assert.equal(session.getSessionSnapshot().dirty, true);
        session.markSaved();
        assert.equal(session.getSessionSnapshot().bag_dirty, false);
        assert.equal(session.getSessionSnapshot().dirty, true);

        {
            const before = new Uint8Array(session.getBuffer());
            const next = new Uint8Array(before);
            writeSlot(next, test.bag_offset, 13, 20, 'id_qty');
            session.setBuffer(next, { preservePcContext: false });
            session.recordChange(before, 'bag_edit', 'Edit Bag slot 2');
        }
        assert.equal(session.getSessionSnapshot().bag_dirty, true);
        await fs.writeFile(`${test.out_prefix}-step4.sav`, session.getBuffer());

        session.undoLastChange();
        assert.equal(session.getPcContext(), null);
        await fs.writeFile(`${test.out_prefix}-undo4.sav`, session.getBuffer());

        session.undoLastChange();
    }

    session.undoLastChange();
    await fs.writeFile(`${test.out_prefix}-undo3.sav`, session.getBuffer());

    session.undoLastChange();
    await fs.writeFile(`${test.out_prefix}-undo2.sav`, session.getBuffer());

    session.undoLastChange();
    assert.deepEqual(session.getBuffer(), inputBytes);
    assert.equal(session.getHistorySummary().can_undo, false);
    await fs.writeFile(`${test.out_prefix}-undo1.sav`, session.getBuffer());

    // Bounded capacity eviction + Reset on ChangeLedger
    {
        const smallLedger = new ChangeLedger(3);
        let buf = new Uint8Array(inputBytes);
        for (let i = 0; i < 6; i += 1) {
            const prev = new Uint8Array(buf);
            updateMoney(buf, 10000 + i);
            smallLedger.record(prev, buf, i === 0 ? 'bag_edit' : 'money_edit', 'Bounded edit');
        }
        assert.equal(smallLedger.entries.length, 3);
        assert.equal(smallLedger.hasUncommittedBagChanges(), true);
        buf = smallLedger.reset(inputBytes);
        assert.deepEqual(buf, inputBytes);
        assert.equal(smallLedger.hasUncommittedBagChanges(), false);
    }

    // Session reset after re-edit
    {
        const before = new Uint8Array(session.getBuffer());
        const next = new Uint8Array(before);
        updateMoney(next, 424242);
        session.setBuffer(next, { preservePcContext: false });
        session.recordChange(before, 'money_edit', 'Pre-reset edit');
        assert.equal(session.getHistorySummary().can_reset, true);
        session.resetSaveToOriginal();
        assert.deepEqual(session.getBuffer(), inputBytes);
        assert.equal(session.getHistorySummary().can_undo, false);
        assert.equal(session.getHistorySummary().can_reset, false);
        await fs.writeFile(`${test.out_prefix}-reset.sav`, session.getBuffer());
    }
}
