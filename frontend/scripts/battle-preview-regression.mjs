import process from 'node:process';

import { calculateBattleStats, calculateHiddenPowerType } from '../src/core/battlePreview.js';

const cases = [
    {
        label: 'Pikachu L50 neutral',
        input: {
            speciesId: 25,
            level: 50,
            natureId: 0,
            ivs: { HP: 31, Atk: 31, Def: 31, SpA: 31, SpD: 31, Spd: 31 },
            evs: { HP: 0, Atk: 0, Def: 0, SpA: 0, SpD: 0, Spd: 0 },
        },
        expected: { HP: 110, Atk: 75, Def: 60, SpA: 70, SpD: 70, Spe: 110 },
    },
    {
        label: 'Pikachu L100 Jolly trained',
        input: {
            speciesId: 25,
            level: 100,
            natureId: 13,
            ivs: { HP: 31, Atk: 31, Def: 31, SpA: 31, SpD: 31, Spe: 31 },
            evs: { HP: 0, Atk: 252, Def: 0, SpA: 0, SpD: 4, Spe: 252 },
        },
        expected: { HP: 211, Atk: 209, Def: 116, SpA: 122, SpD: 137, Spe: 306 },
    },
];

for (const testCase of cases) {
    const actual = calculateBattleStats(testCase.input);
    if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {
        throw new Error(`${testCase.label}: expected ${JSON.stringify(testCase.expected)}, got ${JSON.stringify(actual)}`);
    }
}

const hiddenPowerCases = [
    [{ HP: 30, Atk: 30, Def: 30, SpA: 30, SpD: 30, Spe: 30 }, 'Fighting'],
    [{ HP: 31, Atk: 31, Def: 31, SpA: 31, SpD: 31, Spd: 31 }, 'Dark'],
];
for (const [ivs, expected] of hiddenPowerCases) {
    const actual = calculateHiddenPowerType(ivs);
    if (actual !== expected) throw new Error(`Hidden Power expected ${expected}, got ${actual}`);
}

console.log('battle preview regression passed');
