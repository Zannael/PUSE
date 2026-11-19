import fs from 'node:fs';
import assert from 'node:assert/strict';
import { activateProfile } from '../src/core/profile.js';
import { buildFieldReport } from '../src/core/fieldInspector.js';
await activateProfile(process.argv[3]);
const buffer = new Uint8Array(fs.readFileSync(process.argv[2]));
const before = buffer.slice();
try {
    const report = buildFieldReport(buffer);
    assert.deepEqual(buffer, before);
    process.stdout.write(JSON.stringify(report));
} catch (error) {
    assert.deepEqual(buffer, before);
    process.stderr.write(error.message);
    process.exitCode = 3;
}
