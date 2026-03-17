import speciesGrowthRates from './speciesGrowthRates.json' with { type: 'json' };

export const GROWTH_OPTIONS = [
    { id: 0, label: 'Medium Fast' },
    { id: 1, label: 'Erratic' },
    { id: 2, label: 'Fluctuating' },
    { id: 3, label: 'Medium Slow' },
    { id: 4, label: 'Fast' },
    { id: 5, label: 'Slow' },
];

export function getSpeciesGrowthRate(speciesId) {
    const entry = speciesGrowthRates?.[String(Number(speciesId))];
    if (!entry) {
        return null;
    }
    const rate = Number(entry.growth_rate);
    if (Number.isNaN(rate) || rate < 0 || rate > 5) {
        return null;
    }
    return rate;
}

export function getExpAtLevel(rateIdx, level) {
    let n = Number(level || 1);
    if (n <= 1) return 0;
    if (n > 100) n = 100;

    if (rateIdx === 0) {
        return n ** 3;
    }

    if (rateIdx === 1) {
        if (n <= 50) return Math.floor((n ** 3 * (100 - n)) / 50);
        if (n <= 68) return Math.floor((n ** 3 * (150 - n)) / 100);
        if (n <= 98) return Math.floor((n ** 3 * ((1911 - 10 * n) / 3)) / 500);
        return Math.floor((n ** 3 * (160 - n)) / 100);
    }

    if (rateIdx === 2) {
        if (n <= 15) return Math.floor(n ** 3 * ((Math.floor((n + 1) / 3) + 24) / 50));
        if (n <= 36) return Math.floor(n ** 3 * ((n + 14) / 50));
        return Math.floor(n ** 3 * ((Math.floor(n / 2) + 32) / 50));
    }

    if (rateIdx === 3) {
        return Math.floor(1.2 * (n ** 3) - 15 * (n ** 2) + 100 * n - 140);
    }

    if (rateIdx === 4) {
        return Math.floor((4 * (n ** 3)) / 5);
    }

    if (rateIdx === 5) {
        return Math.floor((5 * (n ** 3)) / 4);
    }

    return n ** 3;
}

export function calcCurrentLevel(rateIdx, currentExp) {
    for (let level = 1; level <= 100; level += 1) {
        if (currentExp < getExpAtLevel(rateIdx, level + 1)) {
            return level;
        }
    }
    return 100;
}
