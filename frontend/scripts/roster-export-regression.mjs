import process from 'node:process';

import { classifyKnownEggMoves } from '../src/core/unboundLearnset.js';
import { formatAbilityDisplayName } from '../src/core/abilityDisplay.js';
import { formatSpeciesTypeLine } from '../src/core/speciesTypeFormat.js';
import { getEvolutionExportInfo } from '../src/core/evolutionMeta.js';

let failures = 0;

function fail(label, message) {
    failures += 1;
    console.error(`FAIL ${label}: ${message}`);
}

function pass(label) {
    console.log(`PASS ${label}`);
}

const moveNameById = new Map([
    [15, 'Cut'],
    [72, 'Mega Drain'],
    [77, 'PoisonPowder'],
    [78, 'Stun Spore'],
    [75, 'Razor Leaf'],
]);

const budewEggMoves = classifyKnownEggMoves({
    species_id: 459,
    moves: [72, 15, 78, 77],
}, moveNameById);

if (budewEggMoves.length !== 0) {
    fail('Budew egg moves exclude non-egg moveset', `expected [], got ${budewEggMoves.join(', ')}`);
} else {
    pass('Budew egg moves exclude non-egg moveset');
}

const budewWithEggMove = classifyKnownEggMoves({
    species_id: 459,
    moves: [75, 15],
}, moveNameById);

if (!budewWithEggMove.includes('Razor Leaf') || budewWithEggMove.includes('Cut')) {
    fail('Budew egg moves keep only egg bucket', `got ${budewWithEggMove.join(', ')}`);
} else {
    pass('Budew egg moves keep only egg bucket');
}

if (formatSpeciesTypeLine(184, { resolveFairy: true }) !== 'Water/Fairy') {
    fail('Azumarill type line', `expected Water/Fairy, got ${formatSpeciesTypeLine(184, { resolveFairy: true })}`);
} else {
    pass('Azumarill type line');
}

if (formatSpeciesTypeLine(350) !== 'Normal') {
    fail('Azurill type line', `expected Normal, got ${formatSpeciesTypeLine(350)}`);
} else {
    pass('Azurill type line');
}

if (formatSpeciesTypeLine(981) !== 'Fairy') {
    fail('Comfey mono-fairy type line', `expected Fairy, got ${formatSpeciesTypeLine(981)}`);
} else {
    pass('Comfey mono-fairy type line');
}

if (formatSpeciesTypeLine(777) !== 'Fairy') {
    fail('Flabebe mono-fairy type line', `expected Fairy, got ${formatSpeciesTypeLine(777)}`);
} else {
    pass('Flabebe mono-fairy type line');
}

const snoruntTag = getEvolutionExportInfo(346, { currentAbilityName: 'Ice Body' })?.tag || '';
if (!snoruntTag.includes('Ability: Ice Body→Snow Cloak')) {
    fail('Snorunt uses actual ability in tag', `got ${snoruntTag}`);
} else {
    pass('Snorunt uses actual ability in tag');
}

const lillipupTag = getEvolutionExportInfo(559, { currentAbilityName: 'Pickup' })?.tag || '';
if (!lillipupTag.includes('Ability: Pickup→Intimidate')) {
    fail('Lillipup uses actual ability in tag', `got ${lillipupTag}`);
} else {
    pass('Lillipup uses actual ability in tag');
}

function assertNoAbilityTag(speciesId, abilityName, abilityIndex, label) {
    const tag = getEvolutionExportInfo(speciesId, {
        currentAbilityName: abilityName,
        currentAbilityIndex: abilityIndex,
    })?.tag || '';
    if (tag.includes('Ability:')) {
        fail(label, `expected no ability tag, got ${tag}`);
    } else {
        pass(label);
    }
}

assertNoAbilityTag(377, 'Frisk', 1, 'Shuppet Frisk preserved on evolution');
assertNoAbilityTag(818, 'Frisk', 1, 'Pumpkaboo Frisk preserved on evolution');
assertNoAbilityTag(580, 'Klutz', 1, 'Woobat Klutz preserved on evolution');
assertNoAbilityTag(986, 'Water Compaction', 0, 'Sandygast Water Compaction preserved on evolution');

if (formatAbilityDisplayName('Water Compact') !== 'Water Compaction') {
    fail('Water Compact display alias', `got ${formatAbilityDisplayName('Water Compact')}`);
} else {
    pass('Water Compact display alias');
}

if (failures > 0) {
    console.error(`roster-export regression failed (${failures} case(s))`);
    process.exit(1);
}

console.log('roster-export regression passed');
