import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { applyPcContextToSave, editPcMonFull, getPcBox, insertPcMon, loadPcContext } from '../src/core/pc.js';

const MON_SIZE_PC = 58;
const BOX23_SEG2_BASE = 0x2F28;
const BOX23_EMPTY_SLOTS = [20, 21, 24, 26, 30];

function parseArgs(argv) {
  const cwd = process.cwd();
  return {
    api: argv.includes('--api') ? argv[argv.indexOf('--api') + 1] : 'http://127.0.0.1:8001',
    few: argv.includes('--few')
      ? path.resolve(cwd, argv[argv.indexOf('--few') + 1])
      : path.resolve(cwd, '../backend/local_artifacts/FewTimesDead.sav'),
    unbound: argv.includes('--unbound')
      ? path.resolve(cwd, argv[argv.indexOf('--unbound') + 1])
      : path.resolve(cwd, '../backend/local_artifacts/Unbound.sav'),
  };
}

async function backendRequest(baseUrl, pathname, options = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

async function uploadSave(baseUrl, bytes, name) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const res = await backendRequest(baseUrl, '/upload', { method: 'POST', body: form });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toSlotMap(rows) {
  const out = new Map();
  rows.forEach((row) => out.set(Number(row.slot), row));
  return out;
}

function box23AbsOffset(slot) {
  return BOX23_SEG2_BASE + ((slot - 1) * MON_SIZE_PC);
}

function readU16LE(buffer, off) {
  return buffer[off] | (buffer[off + 1] << 8);
}

async function getBackendBoxes(api, expectedBoxes = [22, 23, 24]) {
  const loadRes = await backendRequest(api, '/pc/load');
  assert(loadRes.ok, `GET /pc/load failed (${loadRes.status})`);

  const out = {};
  for (const boxId of expectedBoxes) {
    const boxRes = await backendRequest(api, `/pc/box/${boxId}`);
    assert(boxRes.ok, `GET /pc/box/${boxId} failed (${boxRes.status})`);
    out[boxId] = boxRes.body;
  }
  return out;
}

function validateFewTimesDeadBoxExpectations(boxes, where) {
  const b22 = boxes[22];
  const b23 = boxes[23];
  const b24 = boxes[24];

  assert(Array.isArray(b22) && b22.length === 21, `${where}: box22 expected 21 mons, got ${b22?.length}`);
  assert(Array.isArray(b23) && b23.length === 25, `${where}: box23 expected 25 mons, got ${b23?.length}`);
  assert(Array.isArray(b24) && b24.length === 25, `${where}: box24 expected 25 mons, got ${b24?.length}`);

  const m22 = toSlotMap(b22);
  const m23 = toSlotMap(b23);
  const m24 = toSlotMap(b24);

  assert(Number(m22.get(1)?.species_id) === 1183, `${where}: box22 slot1 species mismatch`);
  assert([1258, 1259].includes(Number(m22.get(21)?.species_id)), `${where}: box22 slot21 species mismatch`);
  for (let slot = 22; slot <= 30; slot += 1) {
    assert(!m22.has(slot), `${where}: box22 slot${slot} should be empty`);
  }

  assert([397, 905].includes(Number(m23.get(1)?.species_id)), `${where}: box23 slot1 species mismatch`);
  assert([1182, 1207].includes(Number(m23.get(29)?.species_id)), `${where}: box23 slot29 species mismatch`);
  for (const slot of BOX23_EMPTY_SLOTS) {
    assert(!m23.has(slot), `${where}: box23 slot${slot} should be empty`);
  }

  assert(Number(m24.get(1)?.species_id) === 541, `${where}: box24 slot1 species mismatch`);
  assert(Number(m24.get(30)?.species_id) === 249, `${where}: box24 slot30 species mismatch`);
  for (const slot of [10, 11, 19, 20, 24]) {
    assert(!m24.has(slot), `${where}: box24 slot${slot} should be empty`);
  }
}

function localBoxesFromSave(buffer) {
  const ctx = loadPcContext(buffer);
  return {
    ctx,
    boxes: {
      22: getPcBox(ctx, 22, new Map()),
      23: getPcBox(ctx, 23, new Map()),
      24: getPcBox(ctx, 24, new Map()),
    },
  };
}

function compareSlotSpecies(aRows, bRows, where) {
  const a = toSlotMap(aRows);
  const b = toSlotMap(bRows);
  const aSlots = [...a.keys()].sort((x, y) => x - y);
  const bSlots = [...b.keys()].sort((x, y) => x - y);
  assert(JSON.stringify(aSlots) === JSON.stringify(bSlots), `${where}: slot sets mismatch`);
  aSlots.forEach((slot) => {
    const aSpecies = Number(a.get(slot)?.species_id);
    const bSpecies = Number(b.get(slot)?.species_id);
    assert(aSpecies === bSpecies, `${where}: slot ${slot} species mismatch (${aSpecies} vs ${bSpecies})`);
  });
}

async function runFewTimesDead(api, fewBytes) {
  const report = [];

  await uploadSave(api, fewBytes, 'FewTimesDead.sav');
  const backendBoxes = await getBackendBoxes(api);
  validateFewTimesDeadBoxExpectations(backendBoxes, 'backend FewTimesDead');
  report.push('[PASS] backend FewTimesDead fallback boxes 22-24 detected with expected anchors');

  const localBuffer = new Uint8Array(fewBytes);
  const { ctx, boxes: localBoxes } = localBoxesFromSave(localBuffer);
  validateFewTimesDeadBoxExpectations(localBoxes, 'local FewTimesDead');
  report.push('[PASS] local FewTimesDead fallback boxes 22-24 detected with expected anchors');

  for (const boxId of [22, 23, 24]) {
    compareSlotSpecies(backendBoxes[boxId], localBoxes[boxId], `backend/local FewTimesDead box ${boxId}`);
  }
  report.push('[PASS] backend/local slot+species parity for FewTimesDead fallback boxes 22-24');

  const targetSlot = 29;
  const nickname = 'ETERN';
  const editRes = await backendRequest(api, '/pc/edit-full', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ box: 23, slot: targetSlot, nickname }),
  });
  assert(editRes.ok, `backend edit-full failed (${editRes.status}): ${JSON.stringify(editRes.body)}`);

  editPcMonFull(ctx, { box: 23, slot: targetSlot, nickname });

  const backendBoxAfter = await backendRequest(api, '/pc/box/23');
  assert(backendBoxAfter.ok, `GET /pc/box/23 failed (${backendBoxAfter.status})`);
  const backendEdited = backendBoxAfter.body.find((m) => Number(m.slot) === targetSlot);
  assert(backendEdited && backendEdited.nickname === nickname, 'backend edited nickname mismatch');

  const localEdited = getPcBox(ctx, 23, new Map()).find((m) => Number(m.slot) === targetSlot);
  assert(localEdited && localEdited.nickname === nickname, 'local edited nickname mismatch');
  report.push('[PASS] fallback edit parity for box23 slot29 nickname update');

  const insertSlot = 30;
  const insertSpecies = 25;
  const insertName = 'PIKA';
  const insertRes = await backendRequest(api, '/pc/insert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ box: 23, slot: insertSlot, species_id: insertSpecies, nickname: insertName, level: 5 }),
  });
  assert(insertRes.ok, `backend insert failed (${insertRes.status}): ${JSON.stringify(insertRes.body)}`);

  insertPcMon(ctx, { box: 23, slot: insertSlot, species_id: insertSpecies, nickname: insertName, level: 5 }, new Map([[insertSpecies, 'Pikachu']]));

  const backendAfterInsert = await backendRequest(api, '/pc/box/23');
  assert(backendAfterInsert.ok, `GET /pc/box/23 after insert failed (${backendAfterInsert.status})`);
  const backendInserted = backendAfterInsert.body.find((m) => Number(m.slot) === insertSlot);
  assert(backendInserted && Number(backendInserted.species_id) === insertSpecies, 'backend inserted mon mismatch');

  const localInserted = getPcBox(ctx, 23, new Map()).find((m) => Number(m.slot) === insertSlot);
  assert(localInserted && Number(localInserted.species_id) === insertSpecies, 'local inserted mon mismatch');
  report.push('[PASS] fallback insert parity for box23 slot30 species write');

  applyPcContextToSave(localBuffer, ctx);

  const saveRes = await backendRequest(api, '/save-all', { method: 'POST' });
  assert(saveRes.ok, `backend save-all failed (${saveRes.status}): ${JSON.stringify(saveRes.body)}`);

  let backendSaved = null;
  try {
    backendSaved = await fs.readFile(path.resolve(process.cwd(), '../backend/edited_save.sav'));
  } catch {
    backendSaved = await fs.readFile(path.resolve(process.cwd(), '../edited_save.sav'));
  }
  const absOff = box23AbsOffset(targetSlot);
  const secOff = Math.floor(absOff / 0x1000) * 0x1000;

  const backendMonSlice = backendSaved.slice(absOff, absOff + MON_SIZE_PC);
  const localMonSlice = localBuffer.slice(absOff, absOff + MON_SIZE_PC);
  assert(Buffer.compare(Buffer.from(localMonSlice), backendMonSlice) === 0, 'saved mon bytes mismatch for fallback slot');

  const backendChk = readU16LE(backendSaved, secOff + 0xFF6);
  const localChk = readU16LE(localBuffer, secOff + 0xFF6);
  assert(backendChk > 0 && localChk > 0, `invalid checksum values for touched sector (${backendChk} vs ${localChk})`);
  report.push('[PASS] save parity for fallback absolute write bytes and valid touched-sector checksums');

  await uploadSave(api, backendSaved, 'FewTimesDead_inserted.sav');
  const reloaded = await getBackendBoxes(api);
  const reloadedInserted = reloaded[23].find((m) => Number(m.slot) === insertSlot);
  assert(reloadedInserted && Number(reloadedInserted.species_id) === insertSpecies, 'backend reload lost inserted fallback mon');

  const reloadedLocal = loadPcContext(new Uint8Array(backendSaved));
  const reloadedLocalInserted = getPcBox(reloadedLocal, 23, new Map()).find((m) => Number(m.slot) === insertSlot);
  assert(reloadedLocalInserted && Number(reloadedLocalInserted.species_id) === insertSpecies, 'local reload lost inserted fallback mon');
  report.push('[PASS] fallback insert persists after reload (backend + local)');

  return report;
}

async function runUnboundNoFalsePositive(api, unboundBytes) {
  const report = [];

  await uploadSave(api, unboundBytes, 'Unbound.sav');
  const backendBoxes = await getBackendBoxes(api);
  assert(backendBoxes[22].length === 0, `backend Unbound: box22 expected empty, got ${backendBoxes[22].length}`);
  assert(backendBoxes[23].length === 0, `backend Unbound: box23 expected empty, got ${backendBoxes[23].length}`);
  assert(backendBoxes[24].length === 0, `backend Unbound: box24 expected empty, got ${backendBoxes[24].length}`);
  report.push('[PASS] backend Unbound has no fallback false positives for boxes 22-24');

  const localBuffer = new Uint8Array(unboundBytes);
  const { ctx, boxes } = localBoxesFromSave(localBuffer);
  assert(!ctx.fallbackBoxStarts[22] && !ctx.fallbackBoxStarts[23] && !ctx.fallbackBoxStarts[24], 'local Unbound fallback flags should be absent');
  assert(boxes[22].length === 0, `local Unbound: box22 expected empty, got ${boxes[22].length}`);
  assert(boxes[23].length === 0, `local Unbound: box23 expected empty, got ${boxes[23].length}`);
  assert(boxes[24].length === 0, `local Unbound: box24 expected empty, got ${boxes[24].length}`);
  report.push('[PASS] local Unbound has no fallback false positives for boxes 22-24');

  return report;
}

async function main() {
  const args = parseArgs(process.argv);
  const fewBytes = await fs.readFile(args.few);
  const unboundBytes = await fs.readFile(args.unbound);

  const report = [];
  report.push(...await runFewTimesDead(args.api, fewBytes));
  report.push(...await runUnboundNoFalsePositive(args.api, unboundBytes));

  report.forEach((line) => console.log(line));
  console.log('\n[RESULT] ALL CHECKS PASSED');
}

main().catch((err) => {
  console.error('[FATAL]', err?.stack || err);
  process.exit(1);
});
