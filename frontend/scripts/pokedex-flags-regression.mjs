import process from 'node:process';

import { wu16, wu32 } from '../src/core/binary.js';
import { gbaChecksum } from '../src/core/checksum.js';
import {
    OFF_CHECKSUM,
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
import { buildPokedexSpeciesGroups, dexIdForSpeciesId } from '../src/core/pokedexCatalog.js';

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
    wu32(buffer, OFF_VALID_LEN, 0xFF4);
    wu16(buffer, OFF_ID, 1);
    wu32(buffer, OFF_SAVE_IDX, 1);
    wu16(buffer, OFF_CHECKSUM, gbaChecksum(buffer, 0, 0xFF4));
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

const checksum = (buffer[OFF_CHECKSUM] | (buffer[OFF_CHECKSUM + 1] << 8)) >>> 0;
const expectedChecksum = gbaChecksum(buffer, 0, 0xFF4);
if (checksum !== expectedChecksum) {
    fail('trainer checksum', `stored=${checksum} expected=${expectedChecksum}`);
} else {
    pass('trainer checksum');
}

const summary = buildPokedexSummary(buffer, [
    { id: 25, name: 'Pikachu' },
    { id: 1, name: 'Bulbasaur' },
    { id: 1300, name: 'Beyond' },
]);
if (summary.total !== 2 || summary.seen_count !== 1 || summary.caught_count !== 0) {
    fail('buildPokedexSummary counts', JSON.stringify(summary));
} else {
    pass('buildPokedexSummary counts');
}

const dexGroups = buildPokedexSpeciesGroups([
    { id: 251, name: 'Celebi' },
    { id: 252, name: 'Egg' },
    { id: 276, name: '?' },
    { id: 277, name: 'Treecko' },
    { id: 283, name: 'Mudkip' },
]);
if (dexIdForSpeciesId(283) !== 258 || dexGroups.get(258)?.[0]?.name !== 'Mudkip') {
    fail('internal species to dex mapping', JSON.stringify({ dexGroups: [...dexGroups], mapped: dexIdForSpeciesId(283) }));
} else {
    pass('internal species to dex mapping');
}

const groupedSummary = buildPokedexSummary(buffer, [
    { id: 19, name: 'Rattata', display_name: 'Rattata', label: 'Rattata (Form 1)' },
    { id: 1020, name: 'Rattata', display_name: 'Rattata', label: 'Rattata (Alolan)' },
]);
const standard = groupedSummary.entries.find((entry) => entry.species_id === 19);
if (
    groupedSummary.total !== 1 || standard?.species_name !== 'Rattata' ||
    standard?.forms?.[0]?.name !== 'Alolan' || standard.forms[0].status !== 'n/a'
) {
    fail('form grouping metadata', JSON.stringify(groupedSummary));
} else {
    pass('form grouping metadata');
}

const formBuffer = makeTrainerSectionBuffer();
setPokedexFlag(formBuffer, 19, POKEDEX_FLAG.SEEN, true);
const alolanRattata = getPokedexFlags(formBuffer, 1020);
if (alolanRattata.dex_id !== 19 || !alolanRattata.seen || alolanRattata.caught) {
    fail('form shares base dex flag', JSON.stringify(alolanRattata));
} else {
    pass('form shares base dex flag');
}

if (failures > 0) {
    console.error(`pokedex-flags regression failed (${failures} case(s))`);
    process.exit(1);
}

console.log('pokedex-flags regression passed');
