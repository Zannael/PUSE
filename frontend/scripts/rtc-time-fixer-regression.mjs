import { reenableTimeFixer } from '../src/core/rtc.js';

const SAVE_BODY_LEN = 0x20000;
const SAVE_WITH_TRAILER_LEN = 0x20010;
const SECTION_SIZE = 0x1000;
const SIGNATURE = 0x01121999;
const TARGET_REL_OFF = 0xE89;

function wu16(bytes, offset, value) {
  bytes[offset] = value & 0xFF;
  bytes[offset + 1] = (value >>> 8) & 0xFF;
}

function wu32(bytes, offset, value) {
  bytes[offset] = value & 0xFF;
  bytes[offset + 1] = (value >>> 8) & 0xFF;
  bytes[offset + 2] = (value >>> 16) & 0xFF;
  bytes[offset + 3] = (value >>> 24) & 0xFF;
}

function sectionOffset(sid, saveIdx) {
  const firstBlock = saveIdx % 2 === 0 ? 0 : 14;
  return (firstBlock + ((sid + (saveIdx % 14)) % 14)) * SECTION_SIZE;
}

function buildSave({ activeFlag = true } = {}) {
  const bytes = new Uint8Array(SAVE_WITH_TRAILER_LEN).fill(0xA5);
  for (let idx = 0; idx < 16; idx += 1) bytes[SAVE_BODY_LEN + idx] = idx;

  for (const saveIdx of [40, 41]) {
    for (let sid = 0; sid < 14; sid += 1) {
      const off = sectionOffset(sid, saveIdx);
      bytes.fill(sid, off, off + SECTION_SIZE);
      wu32(bytes, off + 0xFF0, 0);
      wu16(bytes, off + 0xFF4, sid);
      wu16(bytes, off + 0xFF6, 0x5C4B);
      wu32(bytes, off + 0xFF8, SIGNATURE);
      wu32(bytes, off + 0xFFC, saveIdx);
    }
  }

  const activeOff = sectionOffset(4, 41);
  const olderOff = sectionOffset(4, 40);
  bytes[activeOff + TARGET_REL_OFF] = activeFlag ? 0x28 : 0x08;
  bytes[olderOff + TARGET_REL_OFF] = 0x28;
  return { bytes, activeOff, olderOff };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectFailure(bytes, expected) {
  try {
    reenableTimeFixer(bytes);
  } catch (error) {
    assert(String(error.message).includes(expected), `Expected "${expected}", got "${error.message}"`);
    return;
  }
  throw new Error(`Expected failure containing "${expected}"`);
}

const { bytes: source, activeOff, olderOff } = buildSave();
const result = reenableTimeFixer(source);
const target = activeOff + TARGET_REL_OFF;
const changed = [];
for (let idx = 0; idx < source.length; idx += 1) {
  if (source[idx] !== result.bytes[idx]) changed.push(idx);
}

assert(result.save_idx === 41, 'wrong active generation');
assert(result.section_offset === activeOff, 'wrong active section offset');
assert(result.absolute_offset === target, 'wrong target offset');
assert(result.before === 0x28 && result.after === 0x08, 'wrong masked values');
assert(changed.length === 1 && changed[0] === target, 'mutation was not exactly one byte');
assert(result.bytes[olderOff + TARGET_REL_OFF] === 0x28, 'older fallback generation changed');
assert(
  result.bytes.slice(activeOff + 0xFF0, activeOff + 0x1000).every((byte, idx) => byte === source[activeOff + 0xFF0 + idx]),
  'section footer changed',
);
assert(
  result.bytes.slice(SAVE_BODY_LEN).every((byte, idx) => byte === source[SAVE_BODY_LEN + idx]),
  'RTC trailer changed',
);

expectFailure(buildSave({ activeFlag: false }).bytes, 'already available');
expectFailure(source.slice(0, SAVE_BODY_LEN - 1), 'Unsupported save size');

const invalid = new Uint8Array(source);
for (const saveIdx of [40, 41]) wu32(invalid, sectionOffset(4, saveIdx) + 0xFF8, 0);
expectFailure(invalid, 'No coherent');

console.log('[PASS] RTC Time Fixer reset changes one byte and preserves fallback/footer/trailer');
