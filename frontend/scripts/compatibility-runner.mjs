import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buildCompatibilityReport, getProfile } from '../src/core/profile.js';
import { loadFile, getBuffer, getOriginalBuffer, getPcContext, setPcContext, getSessionSnapshot } from '../src/core/saveSession.js';
const file = (path) => ({ name: path, arrayBuffer: async () => new Uint8Array(fs.readFileSync(path)).buffer });
await loadFile(file(process.argv[5]), 'unbound-2.1.1.1');
const original = getBuffer().slice(), profile = getProfile(), snapshot = getSessionSnapshot();
const context = { pending: true };
setPcContext(context);
const bytes = new Uint8Array(fs.readFileSync(process.argv[2]));
const before = bytes.slice();
const report = buildCompatibilityReport(bytes, process.argv[3] || null);
assert.equal(getProfile(), profile);
assert.deepEqual(bytes, before);
const allowed = process.argv[4] === '1';
assert.equal(report.mutations_allowed, allowed);
if (allowed) await loadFile(file(process.argv[2]), process.argv[3] || null);
else {
    await assert.rejects(loadFile(file(process.argv[2]), process.argv[3] || null));
    assert.deepEqual(getBuffer(), original);
    assert.deepEqual(getOriginalBuffer(), original);
    assert.deepEqual(getSessionSnapshot(), snapshot);
    assert.equal(getPcContext(), context);
    assert.equal(getProfile(), profile);
}
process.stdout.write(JSON.stringify(report));
