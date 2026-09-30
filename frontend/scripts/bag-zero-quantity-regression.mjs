import assert from 'node:assert/strict';

import { mapPocketFromAnchor, writeSlot } from '../src/core/bag.js';

const anchor = 0x1e31c;
const bytes = new Uint8Array(0x20010);
const names = new Map();

function slot(offset, id, qty) {
  bytes[offset] = id & 0xff;
  bytes[offset + 1] = id >> 8;
  bytes[offset + 2] = qty & 0xff;
  bytes[offset + 3] = qty >> 8;
}

slot(anchor, 3, 2);
slot(anchor + 4, 8, 1);
slot(anchor + 8, 6, 0); // Old quantity-zero edit: item ID was left behind.
slot(anchor + 12, 60, 3);
slot(anchor + 16, 62, 6);

const initial = mapPocketFromAnchor(bytes, anchor, names);
assert.deepEqual(initial.slice(0, 5).map(({ id, qty }) => [id, qty]), [
  [3, 2], [8, 1], [0, 0], [60, 3], [62, 6],
]);
assert.equal(initial[5].offset, anchor + 20);

writeSlot(bytes, anchor + 8, 6, 1, 'id_qty');
assert.deepEqual(mapPocketFromAnchor(bytes, anchor, names).slice(0, 5).map(({ id }) => id), [3, 8, 6, 60, 62]);

writeSlot(bytes, anchor + 4, 8, 0, 'id_qty');
assert.deepEqual(mapPocketFromAnchor(bytes, anchor, names).slice(0, 5).map(({ id, qty }) => [id, qty]), [
  [3, 2], [6, 1], [60, 3], [62, 6], [0, 0],
]);
assert.equal(bytes[anchor + 16], 0);
assert.equal(bytes[anchor + 18], 0);

const mainAnchor = 0x7ad8;
slot(mainAnchor, 86, 8);
slot(mainAnchor + 4, 85, 72);
slot(mainAnchor + 8, 19, 995);
bytes[0x7ff4] = 13; // Active main-items section.
bytes[0x7ffc] = 1;
const before = bytes.slice(mainAnchor, mainAnchor + 4);
assert.throws(() => writeSlot(bytes, mainAnchor, 153, 99, 'id_qty'), /different bag pocket/);
assert.throws(() => writeSlot(bytes, mainAnchor, 364, 0, 'id_qty'), /different bag pocket/);
assert.deepEqual(bytes.slice(mainAnchor, mainAnchor + 4), before);
writeSlot(bytes, mainAnchor, 13, 5, 'id_qty');
assert.deepEqual(mapPocketFromAnchor(bytes, mainAnchor, names)[0].id, 13);

console.log('[PASS] quantity-zero recovery, compacting removal, and cross-pocket guard');
