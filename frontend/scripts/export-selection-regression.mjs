import process from 'node:process';

import {
    addPcBoxToSelection,
    filterPartyBySelection,
    filterPcBySelection,
    partySelectionKey,
    pcSelectionKey,
    summarizeSelection,
    toggleSelectionKey,
} from '../src/core/exportSelection.js';
import { rosterPayloadToMarkdown } from '../src/core/rosterExportMarkdown.js';
import { buildRosterPayload } from '../src/core/rosterExport.js';

let failures = 0;

function fail(label, message) {
    failures += 1;
    console.error(`FAIL ${label}: ${message}`);
}

function pass(label) {
    console.log(`PASS ${label}`);
}

const selection = [
    partySelectionKey(1),
    pcSelectionKey(4, 7),
    pcSelectionKey(9, 2),
];

if (toggleSelectionKey(selection, partySelectionKey(1)).length !== 2) {
    fail('toggle removes party key', String(toggleSelectionKey(selection, partySelectionKey(1)).length));
} else {
    pass('toggle removes party key');
}

const withBox = addPcBoxToSelection([pcSelectionKey(4, 7)], 4, [
    { slot: 7 },
    { slot: 8 },
]);
if (!withBox.includes(pcSelectionKey(4, 8)) || withBox.length !== 2) {
    fail('addPcBoxToSelection', withBox.join(','));
} else {
    pass('addPcBoxToSelection');
}

const party = [
    { index: 0, species_id: 25 },
    { index: 1, species_id: 6 },
];
const pc = [
    { box: 4, slot: 7, mon: { species_id: 133 } },
    { box: 9, slot: 2, mon: { species_id: 1 } },
    { box: 9, slot: 3, mon: { species_id: 4 } },
];

const filteredParty = filterPartyBySelection(party, selection);
const filteredPc = filterPcBySelection(pc, selection);
if (filteredParty.length !== 1 || filteredPc.length !== 2) {
    fail('filter selection counts', `${filteredParty.length}/${filteredPc.length}`);
} else {
    pass('filter selection counts');
}

const summary = summarizeSelection(selection);
if (summary.total !== 3 || summary.party !== 1 || summary.pc !== 2) {
    fail('summarizeSelection', JSON.stringify(summary));
} else {
    pass('summarizeSelection');
}

const payload = buildRosterPayload({
    party: filteredParty.map((mon) => ({
        ...mon,
        species_name: `Species ${mon.species_id}`,
        nickname: 'Test',
        level: 50,
        nature: 'Hardy',
        ability_name_current: 'Test',
        moves: [],
        ivs: {},
        evs: {},
    })),
    pc: filteredPc,
    catalogs: { itemNameById: new Map(), moveNameById: new Map() },
    exportMode: 'selection',
});
const markdown = rosterPayloadToMarkdown(payload);
if (!markdown.includes('Selection export: 3 Pokémon') || !markdown.includes('## Selected PC')) {
    fail('selection markdown markers', markdown.slice(0, 200));
} else {
    pass('selection markdown markers');
}

if (failures > 0) {
    console.error(`export-selection regression failed (${failures} case(s))`);
    process.exit(1);
}

console.log('export-selection regression passed');
