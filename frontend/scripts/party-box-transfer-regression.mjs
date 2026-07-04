import process from 'node:process';

import { ru8, ru16, ru32, wu8, wu16, wu32 } from '../src/core/binary.js';
import { buildPcRawFromPartyMon } from '../src/core/pc.js';
import { readPartyMonRaw, removePartyMonAt, appendPcMonToParty } from '../src/core/party.js';

let failures = 0;

function fail(label, message) {
    failures += 1;
    console.error(`FAIL ${label}: ${message}`);
}

function pass(label) {
    console.log(`PASS ${label}`);
}

function expectEqual(label, actual, expected) {
    if (actual !== expected) {
        fail(label, `expected ${expected}, got ${actual}`);
        return false;
    }
    pass(label);
    return true;
}

const SECTION_SIZE = 0x1000;
const PARTY_COUNT_OFFSET = 0x34;
const PARTY_START_OFFSET = 0x38;
const PARTY_MON_SIZE = 100;

// Sample party mon (Bulbasaur, species 1 so base stats exist for stat recalc).
const SAMPLE = {
    pid: 0x9ABCDEF0,
    otid: 0x12345678,
    species: 1,
    item: 16, // a held item id
    exp: 125000,
    ppUpsByte: 0x1B, // pp-ups [3, 2, 1, 0]
    moves: [33, 45, 1023, 0],
    evs: [4, 12, 0, 252, 0, 252],
    iv32: 0x3FFFFFFF, // all IVs 31, no hidden-ability flag
};

function makeTrainerSave() {
    const buf = new Uint8Array(SECTION_SIZE);
    wu16(buf, 0xFF4, 1); // section id 1 = trainer/party
    wu32(buf, 0xFFC, 1); // save index
    wu32(buf, PARTY_COUNT_OFFSET, 0);
    return buf;
}

function writePartyMon(buf, index, fields) {
    const off = PARTY_START_OFFSET + (index * PARTY_MON_SIZE);
    wu32(buf, off + 0x00, fields.pid >>> 0);
    wu32(buf, off + 0x04, fields.otid >>> 0);
    buf[off + 0x08] = 0xBB; // nickname first char 'A'
    buf[off + 0x14] = 0xBC; // OT name first char 'B'
    wu16(buf, off + 0x20, fields.species);
    wu16(buf, off + 0x22, fields.item);
    wu32(buf, off + 0x24, fields.exp);
    wu8(buf, off + 0x28, fields.ppUpsByte);
    fields.moves.forEach((m, i) => wu16(buf, off + 0x2C + (i * 2), m));
    fields.evs.forEach((e, i) => wu8(buf, off + 0x38 + i, e));
    wu32(buf, off + 0x48, fields.iv32 >>> 0);
    wu8(buf, off + 0x54, 50); // visual level (recomputed on conversion back)
}

function unpackPcMoves(raw58) {
    let packed = 0n;
    for (let i = 0; i < 5; i += 1) {
        packed |= BigInt(raw58[0x27 + i]) << BigInt(8 * i);
    }
    return [
        Number((packed >> 0n) & 0x3FFn),
        Number((packed >> 10n) & 0x3FFn),
        Number((packed >> 20n) & 0x3FFn),
        Number((packed >> 30n) & 0x3FFn),
    ];
}

// 1. Party -> PC raw conversion preserves every persisted field.
{
    const buf = makeTrainerSave();
    writePartyMon(buf, 0, SAMPLE);
    wu32(buf, PARTY_COUNT_OFFSET, 1);

    const raw100 = readPartyMonRaw(buf, 0);
    const raw58 = buildPcRawFromPartyMon(raw100);

    let headerOk = true;
    for (let i = 0; i < 0x1C; i += 1) {
        if (raw58[i] !== raw100[i]) {
            headerOk = false;
            break;
        }
    }
    expectEqual('party->pc header (0x00-0x1B) preserved', headerOk, true);
    expectEqual('party->pc species', ru16(raw58, 0x1C), SAMPLE.species);
    expectEqual('party->pc item', ru16(raw58, 0x1E), SAMPLE.item);
    expectEqual('party->pc exp', ru32(raw58, 0x20), SAMPLE.exp);
    expectEqual('party->pc pp-ups byte', ru8(raw58, 0x24), SAMPLE.ppUpsByte);
    expectEqual('party->pc moves', unpackPcMoves(raw58).join(','), SAMPLE.moves.join(','));
    const pcEvs = Array.from(raw58.slice(0x2C, 0x32));
    expectEqual('party->pc evs', pcEvs.join(','), SAMPLE.evs.join(','));
    expectEqual('party->pc ivs', ru32(raw58, 0x36) >>> 0, SAMPLE.iv32 >>> 0);
}

// 2. Round trip party -> PC raw -> appended back into party preserves identity/fields.
{
    const src = makeTrainerSave();
    writePartyMon(src, 0, SAMPLE);
    wu32(src, PARTY_COUNT_OFFSET, 1);
    const raw58 = buildPcRawFromPartyMon(readPartyMonRaw(src, 0));

    const dest = makeTrainerSave();
    const newIndex = appendPcMonToParty(dest, raw58);
    expectEqual('append returns slot 0 on empty party', newIndex, 0);
    expectEqual('append increments party count', ru32(dest, PARTY_COUNT_OFFSET), 1);

    const back = readPartyMonRaw(dest, 0);
    expectEqual('round-trip pid', ru32(back, 0x00) >>> 0, SAMPLE.pid >>> 0);
    expectEqual('round-trip otid', ru32(back, 0x04) >>> 0, SAMPLE.otid >>> 0);
    expectEqual('round-trip species', ru16(back, 0x20), SAMPLE.species);
    expectEqual('round-trip item', ru16(back, 0x22), SAMPLE.item);
    expectEqual('round-trip exp', ru32(back, 0x24), SAMPLE.exp);
    expectEqual('round-trip pp-ups byte', ru8(back, 0x28), SAMPLE.ppUpsByte);
    const backMoves = [0, 1, 2, 3].map((i) => ru16(back, 0x2C + (i * 2)));
    expectEqual('round-trip moves', backMoves.join(','), SAMPLE.moves.join(','));
    const backEvs = Array.from(back.slice(0x38, 0x3E));
    expectEqual('round-trip evs', backEvs.join(','), SAMPLE.evs.join(','));
    expectEqual('round-trip ivs', ru32(back, 0x48) >>> 0, SAMPLE.iv32 >>> 0);
}

// 3. removePartyMonAt shifts remaining mons up, zeroes the tail, and decrements count.
{
    const buf = makeTrainerSave();
    const second = { ...SAMPLE, pid: 0x11112222, otid: 0x33334444, species: 4, item: 0 };
    writePartyMon(buf, 0, SAMPLE);
    writePartyMon(buf, 1, second);
    wu32(buf, PARTY_COUNT_OFFSET, 2);

    const remaining = removePartyMonAt(buf, 0);
    expectEqual('remove returns new count', remaining, 1);
    expectEqual('remove decrements party count', ru32(buf, PARTY_COUNT_OFFSET), 1);

    const promoted = readPartyMonRaw(buf, 0);
    expectEqual('remove promotes next mon (pid)', ru32(promoted, 0x00) >>> 0, second.pid >>> 0);
    expectEqual('remove promotes next mon (species)', ru16(promoted, 0x20), second.species);

    const tailOff = PARTY_START_OFFSET + (1 * PARTY_MON_SIZE);
    const tailZeroed = buf.slice(tailOff, tailOff + PARTY_MON_SIZE).every((b) => b === 0);
    expectEqual('remove zeroes vacated tail slot', tailZeroed, true);
}

// 4. Guards: cannot empty the party; appending to a full party fails.
{
    const buf = makeTrainerSave();
    writePartyMon(buf, 0, SAMPLE);
    wu32(buf, PARTY_COUNT_OFFSET, 1);
    let threw = false;
    try {
        removePartyMonAt(buf, 0);
    } catch {
        threw = true;
    }
    expectEqual('cannot remove last party mon', threw, true);

    const full = makeTrainerSave();
    for (let i = 0; i < 6; i += 1) {
        writePartyMon(full, i, SAMPLE);
    }
    wu32(full, PARTY_COUNT_OFFSET, 6);
    const raw58 = buildPcRawFromPartyMon(readPartyMonRaw(full, 0));
    let fullThrew = false;
    try {
        appendPcMonToParty(full, raw58);
    } catch {
        fullThrew = true;
    }
    expectEqual('cannot append to full party', fullThrew, true);
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
}
console.log('\nAll party-box transfer checks passed.');
