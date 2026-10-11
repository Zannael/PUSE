import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadPcContext, editPcMonFull, getPcBox } from '../src/core/pc.js';
import { updatePartyOtName, getParty } from '../src/core/party.js';
import { saveAll } from '../src/core/commit.js';

const repo = path.resolve(import.meta.dirname, '../..');
const savePath = path.resolve(process.argv[2] || path.join(repo, 'backend/local_artifacts/Unbound.sav'));
const original = new Uint8Array(fs.readFileSync(savePath));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'puse-ot-name-'));
function run(command, args, options = {}) {
    const result = spawnSync(command, args, { cwd: repo, maxBuffer: 1024 * 1024, ...options });
    assert.equal(result.status, 0, `${command}: ${result.error || result.stderr?.toString()}`);
    return result.stdout;
}
try {
    const native = [];
    for (const port of ['switch-homebrew', '3ds-homebrew']) {
        const executable = path.join(temporary, port);
        const sources = ['core/SaveSections.cpp', 'core/SaveSession.cpp', 'core/Party.cpp', 'core/Pc.cpp', 'core/Bag.cpp', 'io/DataLoader.cpp'];
        run('g++', ['-std=c++17', '-I' + path.join(repo, port, 'include'), ...sources.map((s) => path.join(port, 'source', s)), path.join(port, 'tests/ot_name_parity.cpp'), '-o', executable]);
        native.push([port, executable]);
    }
    const baselineBuffer = new Uint8Array(original);
    const baseline = saveAll(baselineBuffer, loadPcContext(baselineBuffer));
    for (const name of ['Lethal', 'Soldier', 'A', " O'Neil ", '!?.- 9', 'Red Blu']) {
        const buffer = new Uint8Array(original);
        const context = loadPcContext(buffer);
        const partyBefore = getParty(buffer, new Map())[0];
        const pcBefore = getPcBox(context, 1, new Map())[0];
        assert.equal(pcBefore.slot, 1, 'fixture needs Box 1 slot 1 occupied');
        updatePartyOtName(buffer, 0, { ot_name: name });
        editPcMonFull(context, { box: 1, slot: 1, ot_name: name });
        for (const [before, after] of [[partyBefore, getParty(buffer, new Map())[0]], [pcBefore, getPcBox(context, 1, new Map())[0]]]) {
            assert.deepEqual(after, { ...before, ot_name: name.trim() }, 'OT edit changed other Pokemon properties');
        }
        const result = saveAll(buffer, context);
        const backend = run('python3', ['backend/tools/ot_name_save_fixture.py', savePath, name], { env: { ...process.env, PYTHONPATH: path.join(repo, 'backend') } });
        assert.deepEqual(Buffer.from(result), backend, 'backend/local full-save bytes differ');
        for (const [port, executable] of native) {
            assert.deepEqual(run(executable, [savePath, name], { cwd: path.join(repo, port) }), backend, `${port}/backend full-save bytes differ`);
        }
        // The finalized baseline removes unrelated stale checksums from this comparison.
        const changed = [...result.keys()].filter((i) => result[i] !== baseline[i]);
        assert(changed.length > 0);
        assert(changed.every((i) => {
            const within = i % 0x1000;
            const id = result[Math.floor(i / 0x1000) * 0x1000 + 0xFF4];
            return (within >= 0xFF6 && within < 0xFF8) ||
                (id === 1 && within >= 0x38 + 0x14 && within < 0x38 + 0x1B) ||
                (id === 5 && within >= 4 + 0x14 && within < 4 + 0x1B);
        }), 'mutation touched bytes outside OT names and section checksums');
    }
    for (const name of ['', '   ', '12345678', 'José', 'Red\nBlue', '😀']) {
        const buffer = new Uint8Array(original);
        const context = loadPcContext(buffer);
        assert.throws(() => updatePartyOtName(buffer, 0, { ot_name: name }));
        assert.throws(() => editPcMonFull(context, { box: 1, slot: 1, ot_name: name }));
        assert.deepEqual(buffer, original, 'rejected edit mutated the save');
        const backend = spawnSync('python3', ['backend/tools/ot_name_save_fixture.py', savePath, name], { cwd: repo, env: { ...process.env, PYTHONPATH: path.join(repo, 'backend') } });
        assert.notEqual(backend.status, 0, 'backend accepted invalid name');
    }
    console.log('Original Trainer names: backend/local/Switch/3DS full-save parity and identity preservation passed.');
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}
