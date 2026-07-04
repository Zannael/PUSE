import levelCapsPayload from './unbound_level_caps.json' with { type: 'json' };
import { countBadges, isChampion } from './gameProgress.js';

// Save flag for expert difficulty is not confirmed yet (WEB-06).
export const DIFFICULTY_FLAG_ID = null;

export const CAP_PROFILES = {
    NORMAL: 'normal',
    EXPERT: 'expert',
};

export const NORMAL_LEVEL_CAP_BY_BADGES = [20, 26, 32, 36, 40, 52, 57, 61, 75];

export function normalizeCapProfile(value) {
    return value === CAP_PROFILES.EXPERT ? CAP_PROFILES.EXPERT : CAP_PROFILES.NORMAL;
}

export function computeNormalLevelCap(buffer) {
    if (isChampion(buffer)) {
        return 100;
    }
    const badgeCount = countBadges(buffer);
    if (badgeCount <= 0) {
        return NORMAL_LEVEL_CAP_BY_BADGES[0];
    }
    if (badgeCount >= NORMAL_LEVEL_CAP_BY_BADGES.length) {
        return NORMAL_LEVEL_CAP_BY_BADGES[NORMAL_LEVEL_CAP_BY_BADGES.length - 1];
    }
    return NORMAL_LEVEL_CAP_BY_BADGES[badgeCount];
}

export function computeExpertLevelCap(buffer) {
    if (isChampion(buffer)) {
        return 100;
    }
    const entries = levelCapsPayload?.entries;
    if (!Array.isArray(entries) || entries.length === 0) {
        return 100;
    }
    const badgeCount = countBadges(buffer);
    const index = Math.min(Math.max(0, badgeCount), entries.length - 1);
    return Number(entries[index]?.level_cap) || 100;
}

export function resolveEffectiveLevelCap(buffer, capProfile = CAP_PROFILES.NORMAL) {
    return normalizeCapProfile(capProfile) === CAP_PROFILES.EXPERT
        ? computeExpertLevelCap(buffer)
        : computeNormalLevelCap(buffer);
}

export function getLevelCapViolation(level, cap) {
    const resolvedLevel = Number(level);
    const resolvedCap = Number(cap);
    if (!Number.isFinite(resolvedLevel) || !Number.isFinite(resolvedCap) || resolvedCap >= 100) {
        return null;
    }
    if (resolvedLevel > resolvedCap) {
        return {
            level: resolvedLevel,
            cap: resolvedCap,
            over_by: resolvedLevel - resolvedCap,
        };
    }
    return null;
}

export function checkPokemonLevelCap(pokemon, gameProgress) {
    if (!gameProgress || gameProgress.is_champion) {
        return null;
    }
    return getLevelCapViolation(pokemon?.level, gameProgress.effective_level_cap);
}

export function findRosterLevelCapViolations({ party = [], pc = [], gameProgress } = {}) {
    if (!gameProgress || gameProgress.is_champion) {
        return [];
    }

    const violations = [];
    const inspect = (mon, location) => {
        const issue = checkPokemonLevelCap(mon, gameProgress);
        if (!issue) {
            return;
        }
        violations.push({
            ...issue,
            location,
            species_name: mon.species_name,
            nickname: mon.nickname || '',
        });
    };

    party.forEach((mon) => inspect(mon, 'party'));
    pc.forEach((entry) => inspect(entry, `box ${entry.box}`));

    return violations;
}
