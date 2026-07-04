import process from 'node:process';

import { getEvolutionExportInfo } from '../src/core/evolutionMeta.js';

let failures = 0;

function assertTag(speciesId, label, expectedSubstring) {
    const info = getEvolutionExportInfo(speciesId);
    if (!info?.tag || !info.tag.includes(expectedSubstring)) {
        failures += 1;
        console.error(`FAIL ${label}: expected tag containing "${expectedSubstring}", got ${info?.tag ?? 'null'}`);
        return;
    }
    console.log(`PASS ${label}`);
}

function assertNoTag(speciesId, label) {
    const info = getEvolutionExportInfo(speciesId);
    if (info) {
        failures += 1;
        console.error(`FAIL ${label}: expected no tag, got ${info.tag}`);
        return;
    }
    console.log(`PASS ${label}`);
}

function assertNoAbilityFlag(speciesId, label) {
    const info = getEvolutionExportInfo(speciesId);
    if (!info?.tag || info.tag.includes('Ability:')) {
        failures += 1;
        console.error(`FAIL ${label}: expected no ability flag, got ${info?.tag ?? 'null'}`);
        return;
    }
    console.log(`PASS ${label}`);
}

function assertTagExcludes(speciesId, label, excludedSubstring) {
    const info = getEvolutionExportInfo(speciesId);
    if (!info?.tag || info.tag.includes(excludedSubstring)) {
        failures += 1;
        console.error(`FAIL ${label}: expected tag without "${excludedSubstring}", got ${info?.tag ?? 'null'}`);
        return;
    }
    console.log(`PASS ${label}`);
}

assertTag(147, 'Dratini final form', 'Dragonite');
assertTag(147, 'Dratini BST', 'BST 600');
assertTag(147, 'Dratini stage', 'Stage 1 of 3');
assertTag(147, 'Dratini evo reqs', 'Lv 30 → Lv 55');
assertTag(147, 'Dratini ability change', 'Ability: Shed Skin→Inner Focus');
assertTag(399, 'Metang stage', 'Stage 2 of 3');
assertTag(399, 'Metang evo reqs', 'Lv 45');
assertTag(382, 'Aron stage', 'Stage 1 of 3');
assertTag(382, 'Aron evo reqs', 'Lv 32 → Lv 42');
assertNoAbilityFlag(382, 'Aron same-line ability not flagged');
assertNoAbilityFlag(399, 'Metang same-line ability not flagged');
assertTag(183, 'Marill level evo', 'Lv 18');
assertTag(350, 'Azurill friendship then level', 'Friendship → Lv 18');
assertTag(350, 'Azumarill final types', 'Water/Fairy');
assertTagExcludes(399, 'Metang omits unchanged final types', 'Steel/Psychic');
assertTag(56, 'Mankey to Primeape', 'Primeape');
assertTag(56, 'Mankey level evo', 'Lv 28');
assertTag(29, 'NidoranF to Nidoqueen', 'Nidoqueen');
assertTag(29, 'NidoranF poison ground', 'Poison/Ground');
assertTag(32, 'NidoranM to Nidoking', 'Nidoking');
assertTag(777, 'Flabebe to Florges', 'Florges');
assertTag(777, 'Flabebe evo chain', 'Lv 19 → Shiny Stone');
assertTag(459, 'Budew evo chain', 'Friendship → Shiny Stone');
assertTag(468, 'Combee gender lock', '(♀ only)');
assertTag(1025, 'Alolan Vulpix ability', 'Ability: Snow Cloak→Snow Warning');
assertTag(1025, 'Alolan Vulpix evo item', 'Ice Stone');
assertTag(10, 'Caterpie final form', 'Butterfree');
assertNoTag(400, 'Metagross is final');

if (failures > 0) {
    console.error(`evolution-meta regression failed (${failures} case(s))`);
    process.exit(1);
}

console.log('evolution-meta regression passed');
