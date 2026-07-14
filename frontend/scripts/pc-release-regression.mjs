import { releasePcMon } from '../src/core/pc.js';

const MON_SIZE_PC = 58;
const SPECIES_OFFSET = 0x1C;
const EXP_OFFSET = 0x20;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeU16(buffer, offset, value) {
  buffer[offset] = value & 0xFF;
  buffer[offset + 1] = (value >>> 8) & 0xFF;
}

function writeU32(buffer, offset, value) {
  buffer[offset] = value & 0xFF;
  buffer[offset + 1] = (value >>> 8) & 0xFF;
  buffer[offset + 2] = (value >>> 16) & 0xFF;
  buffer[offset + 3] = (value >>> 24) & 0xFF;
}

const stream = new Uint8Array(MON_SIZE_PC);
writeU16(stream, SPECIES_OFFSET, 25);
writeU32(stream, EXP_OFFSET, 1);
const context = {
  pcBuffer: stream,
  presetBuffer: null,
  sourceBuffer: stream,
  fallbackBoxStarts: {},
  fallbackSlotOffsets: {},
  absoluteEdits: new Map(),
  absoluteTouchedSectors: new Set(),
};

releasePcMon(context, { box: 1, slot: 1 });
assert(stream.every((byte) => byte === 0), 'release should clear the complete 58-byte slot');

let rejected = false;
try {
  releasePcMon(context, { box: 1, slot: 1 });
} catch (error) {
  rejected = error.message === 'Pokemon not found in PC';
}
assert(rejected, 'release should reject an empty slot');
console.log('PC release regression checks passed.');
