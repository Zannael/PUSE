import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildSaveReport } from '../src/core/saveHealth.js';
import { saveAll } from '../src/core/commit.js';
import { loadPcContext, editPcMonFull, getPcBox } from '../src/core/pc.js';
import { updatePartyNickname } from '../src/core/party.js';
import { findActiveSectionById } from '../src/core/sections.js';
import { recalculateSectionChecksum } from '../src/core/checksum.js';

const savePath = path.resolve(process.cwd(), process.argv.includes('--save')
    ? process.argv[process.argv.indexOf('--save') + 1]
    : '../backend/local_artifacts/Unbound.sav');
const api = process.argv.includes('--api') ? process.argv[process.argv.indexOf('--api') + 1] : 'http://127.0.0.1:8001';
const original = new Uint8Array(await fs.readFile(savePath));
const untouched = Buffer.from(original);
const context = loadPcContext(original);
const committedPath = path.resolve('../backend/edited_save.sav');
const readCommitted = async () => fs.readFile(committedPath).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
});

const request = async (route, options) => {
    const response = await fetch(`${api}${route}`, options);
    assert(response.ok, `${route} returned ${response.status}`);
    return response.json();
};
const upload = new FormData();
upload.append('file', new Blob([original]), path.basename(savePath));
await request('/upload', { method: 'POST', body: upload });
await request('/pc/load');

const baselineCandidate = new Uint8Array(original);
saveAll(baselineCandidate, context);
const baselineLocal = buildSaveReport(original, baselineCandidate);
const committedBeforePreview = await readCommitted();
const baselineBackend = await request('/save-report');
assert.deepEqual(await readCommitted(), committedBeforePreview, 'read-only report wrote the output save');
assert.deepEqual(baselineLocal, baselineBackend, 'unchanged save report differs');
assert.equal(baselineLocal.layout.missing_ids.length, 0);
assert.equal(baselineLocal.warnings.length, 0);
assert(baselineLocal.checksums.some((row) => row.id === 4 && row.status === 'opaque'));

const edited = new Uint8Array(original);
updatePartyNickname(edited, 0, { nickname: 'REPORT' });
const proposed = new Uint8Array(edited);
saveAll(proposed, context);
await request('/party/0/nickname', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'REPORT' }),
});
const local = buildSaveReport(original, proposed);
const backend = await request('/save-report');
assert.deepEqual(local, backend, 'edited save report differs');
assert(local.changes.changed_bytes > 0);
assert(local.changes.sectors.some((sector) => sector.fields.some((field) => field.name === 'Party 1 nickname')));
assert.equal(local.warnings.length, 0);

const beforeReport = await request('/save-report');
assert.deepEqual(beforeReport, backend, 'report read changed backend bytes');
await request('/save-all', { method: 'POST' });
const downloaded = new Uint8Array(await (await fetch(`${api}/download`)).arrayBuffer());
assert.deepEqual(downloaded, proposed, 'preview bytes differ from committed download');
assert.deepEqual(Buffer.from(original), untouched, 'local report changed upload snapshot');

// A PC edit stays in the PC context until save-all; preview must include it without committing it.
const pcUpload = new FormData();
pcUpload.append('file', new Blob([original]), path.basename(savePath));
await request('/upload', { method: 'POST', body: pcUpload });
await request('/pc/load');
const pcRows = getPcBox(loadPcContext(original), 1, new Map());
assert(pcRows.length > 0, 'fixture needs an occupied Box 1 slot');
const pcTarget = pcRows[0];
const pcPayload = { box: 1, slot: pcTarget.slot, item_id: Number(pcTarget.item_id) === 1 ? 0 : 1 };
const pcContext = loadPcContext(original);
editPcMonFull(pcContext, pcPayload);
await request('/pc/edit-full', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pcPayload),
});
const pcProposed = new Uint8Array(original);
saveAll(pcProposed, pcContext);
const pcPreview = await request('/save-report');
assert.deepEqual(pcPreview, buildSaveReport(original, pcProposed), 'pending PC edit report differs');
assert(pcPreview.changes.sectors.some((sector) => sector.fields.some((field) => field.name.includes('held item'))));
await request('/save-all', { method: 'POST' });
const pcDownload = new Uint8Array(await (await fetch(`${api}/download`)).arrayBuffer());
assert.deepEqual(pcDownload, pcProposed, 'pending PC preview differs from committed download');

const corrupt = new Uint8Array(original);
const trainer = findActiveSectionById(corrupt, 1);
corrupt[trainer.off + 0x38 + 0x08] ^= 1;
const warning = buildSaveReport(original, corrupt);
assert(warning.warnings.some((row) => row.code === 'checksum_mismatch'));
assert(warning.changes.sectors.some((sector) => sector.fields.some((field) => field.name === 'Party 1 nickname')));
const repairedSource = buildSaveReport(corrupt, original);
assert(repairedSource.source_warnings.some((row) => row.code === 'checksum_mismatch'));
assert.equal(repairedSource.warnings.length, 0);

const bagCorrupt = new Uint8Array(original);
bagCorrupt[findActiveSectionById(bagCorrupt, 13).off + 0x20] ^= 1;
assert(buildSaveReport(original, bagCorrupt).warnings.some((row) => row.code === 'checksum_mismatch'));
const opaqueEdit = new Uint8Array(original);
opaqueEdit[findActiveSectionById(opaqueEdit, 4).off + 0xF34] ^= 1;
assert.equal(buildSaveReport(original, opaqueEdit).warnings.length, 0, 'opaque section was generically validated');
const pcEdit = new Uint8Array(original);
const pcSection = findActiveSectionById(pcEdit, 5);
pcEdit[pcSection.off + 4 + 0x1C] ^= 1;
recalculateSectionChecksum(pcEdit, pcSection.off);
const pcReport = buildSaveReport(original, pcEdit);
assert(pcReport.changes.sectors.some((sector) => sector.fields.some((field) => field.name === 'Box 1 slot 1 species')));
assert.equal(pcReport.warnings.length, 0);
const shortReport = buildSaveReport(original.slice(0, 16), original.slice(0, 16));
assert(shortReport.warnings.some((row) => row.code === 'short_save'));
assert.equal(shortReport.layout.missing_ids.length, 14);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'puse-save-health-'));
try {
    const beforePath = path.join(temp, 'before.bin');
    const afterPath = path.join(temp, 'after.bin');
    await fs.writeFile(beforePath, original);
    await fs.writeFile(afterPath, pcEdit);
    const python = spawnSync('python3', ['-c', `import json,sys
from pathlib import Path
from modules.save_health import build_save_report
print(json.dumps(build_save_report(Path(sys.argv[1]).read_bytes(),Path(sys.argv[2]).read_bytes())))`, beforePath, afterPath], {
        cwd: '../backend', encoding: 'utf8', timeout: 10000,
    });
    assert.equal(python.status, 0, python.stderr);
    assert.deepEqual(pcReport, JSON.parse(python.stdout), 'PC field report differs from canonical Python');
} finally {
    await fs.rm(temp, { recursive: true, force: true });
}

console.log('[PASS] save health and change report match backend/local, remain read-only, and preview exact download bytes');
