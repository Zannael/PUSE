import process from 'node:process';

import { calculateBattleStats } from '../src/core/statCalc.js';
import { calculateHiddenPowerType } from '../src/core/hiddenPower.js';

const STAT_KEYS = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];

const CASES = [
    {
        speciesId: 25,
        level: 50,
        natureId: 0,
        ivs: { HP: 31, Atk: 31, Def: 31, SpA: 31, SpD: 31, Spd: 31 },
        evs: { HP: 0, Atk: 0, Def: 0, SpA: 0, SpD: 0, Spd: 0 },
        expected: { HP: 110, Atk: 75, Def: 60, SpA: 70, SpD: 70, Spe: 110 },
    },
    {
        speciesId: 25,
        level: 100,
        natureId: 13,
        ivs: { HP: 31, Atk: 31, Def: 31, SpA: 31, SpD: 31, Spd: 31 },
        evs: { HP: 0, Atk: 252, Def: 0, SpA: 0, SpD: 4, Spd: 252 },
        expected: { HP: 211, Atk: 209, Def: 116, SpA: 122, SpD: 137, Spe: 306 },
    },
    {
        speciesId: 150,
        level: 70,
        natureId: 1,
        ivs: { HP: 0, Atk: 31, Def: 31, SpA: 31, SpD: 31, Spd: 31 },
        evs: { HP: 252, Atk: 252, Def: 0, SpA: 0, SpD: 0, Spd: 4 },
        expected: { HP: 272, Atk: 246, Def: 136, SpA: 242, SpD: 152, Spe: 209 },
    },
];

const HIDDEN_POWER_CASES = [
    {
        ivs: { HP: 30, Atk: 30, Def: 30, SpA: 30, SpD: 30, Spd: 30 },
        expected: 'Fighting',
    },
    {
        ivs: { HP: 31, Atk: 31, Def: 31, SpA: 31, SpD: 31, Spd: 31 },
        expected: 'Dark',
    },
];

function assertStatsMatch(label, actual, expected) {
    if (!actual) {
        throw new Error(`${label}: calculateBattleStats returned null`);
    }
    for (const key of STAT_KEYS) {
        if (actual[key] !== expected[key]) {
            throw new Error(`${label}: ${key} expected ${expected[key]}, got ${actual[key]}`);
        }
    }
}

let failures = 0;

for (const testCase of CASES) {
    const label = `species ${testCase.speciesId} L${testCase.level} nature ${testCase.natureId}`;
    try {
        const actual = calculateBattleStats(testCase);
        assertStatsMatch(label, actual, testCase.expected);
        console.log(`PASS ${label}`);
    } catch (error) {
        failures += 1;
        console.error(`FAIL ${label}: ${error.message}`);
    }
}

for (const testCase of HIDDEN_POWER_CASES) {
    const label = `hidden power ${JSON.stringify(testCase.ivs)}`;
    try {
        const actual = calculateHiddenPowerType(testCase.ivs);
        if (actual !== testCase.expected) {
            throw new Error(`expected ${testCase.expected}, got ${actual}`);
        }
        console.log(`PASS ${label}`);
    } catch (error) {
        failures += 1;
        console.error(`FAIL ${label}: ${error.message}`);
    }
}

if (failures > 0) {
    console.error(`stat-calc parity regression failed (${failures} case(s))`);
    process.exit(1);
}

console.log('stat-calc parity regression passed');
