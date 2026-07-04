import process from 'node:process';

import {
    buildDexProgressPayload,
    classifyMoveAvailability,
    formatLearnsetBucketWithProgress,
    LEARNSET_BUCKETS,
    MOVE_AVAILABILITY,
} from '../src/core/dexProgress.js';
import { parseTmsTextToMoveItemMap } from '../src/core/tmhmCatalog.js';

let failures = 0;

function fail(label, message) {
    failures += 1;
    console.error(`FAIL ${label}: ${message}`);
}

function pass(label) {
    console.log(`PASS ${label}`);
}

const moveNameById = new Map([
    [24, 'Thunderbolt'],
    [57, 'Surf'],
    [15, 'Cut'],
]);

const tmsText = 'TM24: Thunderbolt - Electric\nTM03: Water Pulse - Water\n';
const moveToItemIds = parseTmsTextToMoveItemMap(tmsText, moveNameById);

if (!moveToItemIds.get(24)?.includes(312)) {
    fail('TM24 maps to item 312', JSON.stringify(moveToItemIds.get(24)));
} else {
    pass('TM24 maps to item 312');
}

const dexProgress = buildDexProgressPayload({
    badge_count: 3,
    is_champion: false,
    cap_profile: 'expert',
    effective_level_cap: 32,
    normal_level_cap: 32,
    expert_level_cap: 32,
    tm_case_owned: true,
    owned_tmhm_item_ids: [312],
    key_items: { dexnav: true },
});

if (!dexProgress || dexProgress.owned_tm_count !== 1) {
    fail('buildDexProgressPayload owned_tm_count', String(dexProgress?.owned_tm_count));
} else {
    pass('buildDexProgressPayload owned_tm_count');
}

const ownedTm = classifyMoveAvailability(
    24,
    LEARNSET_BUCKETS.TMHM,
    dexProgress,
    moveToItemIds,
);
if (ownedTm !== MOVE_AVAILABILITY.AVAILABLE) {
    fail('owned TM availability', ownedTm);
} else {
    pass('owned TM availability');
}

const missingTm = classifyMoveAvailability(
    57,
    LEARNSET_BUCKETS.TMHM,
    dexProgress,
    moveToItemIds,
);
if (missingTm !== MOVE_AVAILABILITY.UNKNOWN) {
    fail('unmapped HM availability', missingTm);
} else {
    pass('unmapped HM availability');
}

const lockedCase = classifyMoveAvailability(
    24,
    LEARNSET_BUCKETS.TMHM,
    { ...dexProgress, tm_case_owned: false },
    moveToItemIds,
);
if (lockedCase !== MOVE_AVAILABILITY.TM_CASE_LOCKED) {
    fail('locked TM case availability', lockedCase);
} else {
    pass('locked TM case availability');
}

const formatted = formatLearnsetBucketWithProgress({
    moveIds: [24, 57],
    moveNameById,
    bucket: LEARNSET_BUCKETS.TMHM,
    dexProgress,
    moveToItemIds,
});
if (!formatted.text.includes('Thunderbolt') || formatted.missingTmCount !== 0) {
    fail('formatted owned TM bucket', formatted.text);
} else {
    pass('formatted owned TM bucket');
}

if (failures > 0) {
    console.error(`dex-progress regression failed (${failures} case(s))`);
    process.exit(1);
}

console.log('dex-progress regression passed');
