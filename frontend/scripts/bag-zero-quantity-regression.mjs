import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { mapPocketFromAnchor, pocketTypeForItemId, writeSlot } from '../src/core/bag.js';

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
assert.throws(() => writeSlot(bytes, mainAnchor, 92, 1, 'id_qty'), /different bag pocket/);
assert.deepEqual(bytes.slice(mainAnchor, mainAnchor + 4), before);
writeSlot(bytes, mainAnchor, 13, 5, 'id_qty');
assert.deepEqual(mapPocketFromAnchor(bytes, mainAnchor, names)[0].id, 13);

console.log('[PASS] quantity-zero recovery, compacting removal, and cross-pocket guard');

// Magma Stone is a Valuable in the live ROM table; the legacy table says main.
assert.equal(pocketTypeForItemId(92), 'key');
const keyAnchor = 0x1e900;
slot(keyAnchor, 259, 1);
writeSlot(bytes, keyAnchor, 92, 0, 'id_qty');
assert.deepEqual([...bytes.slice(keyAnchor, keyAnchor + 4)], [92, 0, 1, 0]);

const backend = spawnSync('python3', ['-c', `
from modules import bag
assert bag.pocket_type_for_item_id(92) == 'key'
assert 92 in bag._fallback_pocket_sets()[-1]
data = bytearray(0x20010)
bag.wu16(data, 0x1e900, 259)
bag.wu16(data, 0x1e902, 1)
bag.write_slot(data, 0x1e900, 92, 0, 'id_qty')
assert data[0x1e900:0x1e904] == bytes([92, 0, 1, 0])
bag.wu16(data, 0x7ad8, 13)
bag.wu16(data, 0x7ada, 5)
before = bytes(data)
try:
    bag.write_slot(data, 0x7ad8, 92, 1, 'id_qty')
except ValueError:
    pass
else:
    raise AssertionError('Magma Stone accepted in main pocket')
assert data == before
`], { env: { ...process.env, PYTHONPATH: '../backend' }, encoding: 'utf8' });
assert.equal(backend.status, 0, backend.stderr);
console.log('[PASS] Magma Stone key-pocket classification, quantity, and backend/local guards');
