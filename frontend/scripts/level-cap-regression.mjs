import process from 'node:process';

import {
    getLevelCapViolation,
    normalizeCapProfile,
    NORMAL_LEVEL_CAP_BY_BADGES,
} from '../src/core/levelCap.js';

let failures = 0;

function assertEqual(label, actual, expected) {
    if (actual !== expected) {
        failures += 1;
        console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
        return;
    }
    console.log(`PASS ${label}`);
}

assertEqual('normalizeCapProfile expert', normalizeCapProfile('expert'), 'expert');
assertEqual('normalizeCapProfile normal', normalizeCapProfile('vanilla'), 'normal');

const over = getLevelCapViolation(50, 32);
if (!over || over.over_by !== 18) {
    failures += 1;
    console.error('FAIL getLevelCapViolation over cap');
} else {
    console.log('PASS getLevelCapViolation over cap');
}

assertEqual('getLevelCapViolation at cap', getLevelCapViolation(32, 32), null);
assertEqual('getLevelCapViolation champion cap', getLevelCapViolation(100, 100), null);
assertEqual('getLevelCapViolation above champion', getLevelCapViolation(101, 100), null);

if (NORMAL_LEVEL_CAP_BY_BADGES[0] !== 20 || NORMAL_LEVEL_CAP_BY_BADGES.at(-1) !== 75) {
    failures += 1;
    console.error('FAIL NORMAL_LEVEL_CAP_BY_BADGES anchors');
} else {
    console.log('PASS NORMAL_LEVEL_CAP_BY_BADGES anchors');
}

if (failures > 0) {
    console.error(`level-cap regression failed (${failures} case(s))`);
    process.exit(1);
}

console.log('level-cap regression passed');
