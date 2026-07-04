import process from 'node:process';

import { wu16, wu32 } from '../src/core/binary.js';
import {
    OFF_ID,
    OFF_SAVE_IDX,
    OFF_VALID_LEN,
    SECTION_SIZE,
} from '../src/core/sections.js';
import {
    buildPokedexSummary,
    getPokedexFlags,
    isDexSpeciesTrackable,
    MAX_TRACKED_DEX_ID,
    POKEDEX_FLAG,
    setPokedexFlag,
} from '../src/core/pokedexFlags.js';

let failures = 0;

function fail(label, message) {
    failures += 1;
    console.error(`FAIL ${label}: ${message}`);
}

function pass(label) {
    console.log(`PASS ${label}`);
}

function makeTrainerSectionBuffer() {
    const buffer = new Uint8Array(SECTION_SIZE);
    wu16(buffer, OFF_ID, 1);
    wu32(buffer, OFF_SAVE_IDX, 1);
    wu32(buffer, OFF_VALID_LEN, 0xFF4);
    return buffer;
}

if (!isDexSpeciesTrackable(1) || !isDexSpeciesTrackable(MAX_TRACKED_DEX_ID)) {
    fail('trackable range', 'expected 1 and MAX to be trackable');
} else {
    pass('trackable range');
}

if (isDexSpeciesTrackable(0) || isDexSpeciesTrackable(MAX_TRACKED_DEX_ID + 1)) {
    fail('untrackable edges', '0 and MAX+1 should be untrackable');
} else {
    pass('untrackable edges');
}

const buffer = makeTrainerSectionBuffer();
const initial = getPokedexFlags(buffer, 25);
if (initial.trackable !== true || initial.seen !== false || initial.caught !== false) {
    fail('initial flags', JSON.stringify(initial));
} else {
    pass('initial flags');
}

const seenResult = setPokedexFlag(buffer, 25, POKEDEX_FLAG.SEEN, true);
if (!seenResult.ok || !seenResult.seen || seenResult.caught) {
    fail('set seen', JSON.stringify(seenResult));
} else {
    pass('set seen');
}

const caughtResult = setPokedexFlag(buffer, 25, POKEDEX_FLAG.CAUGHT, true);
if (!caughtResult.ok || !caughtResult.seen || !caughtResult.caught) {
    fail('set caught also sets seen', JSON.stringify(caughtResult));
} else {
    pass('set caught also sets seen');
}

const clearCaught = setPokedexFlag(buffer, 25, POKEDEX_FLAG.CAUGHT, false);
if (!clearCaught.ok || clearCaught.caught || !clearCaught.seen) {
    fail('clear caught keeps seen', JSON.stringify(clearCaught));
} else {
    pass('clear caught keeps seen');
}

const summary = buildPokedexSummary(buffer, [
    { id: 25, name: 'Pikachu' },
    { id: 1, name: 'Bulbasaur' },
    { id: 1000, name: 'Beyond' },
]);
if (summary.total !== 2 || summary.seen_count !== 1 || summary.caught_count !== 0) {
    fail('buildPokedexSummary counts', JSON.stringify({
        total: summary.total,
        seen: summary.seen_count,
        caught: summary.caught_count,
    }));
} else {
    pass('buildPokedexSummary counts');
}

if (failures > 0) {
    console.error(`pokedex-flags regression failed (${failures} case(s))`);
    process.exit(1);
}

console.log('pokedex-flags regression passed');
