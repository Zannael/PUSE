import levelCapsPayload from './unboundLevelCaps.json' with { type: 'json' };

export const CAP_PROFILES = {
    NORMAL: 'normal',
    EXPERT: 'expert',
};

export const NORMAL_LEVEL_CAP_BY_BADGES = [20, 26, 32, 36, 40, 52, 57, 61, 75];

export function normalizeCapProfile(value) {
    return value === CAP_PROFILES.EXPERT ? CAP_PROFILES.EXPERT : CAP_PROFILES.NORMAL;
}

export function computeNormalLevelCapFromProgress({ badgeCount = 0, isChampion = false } = {}) {
    if (isChampion) {
        return 100;
    }
    const count = Number(badgeCount) || 0;
    if (count <= 0) {
        return NORMAL_LEVEL_CAP_BY_BADGES[0];
    }
    if (count >= NORMAL_LEVEL_CAP_BY_BADGES.length) {
        return NORMAL_LEVEL_CAP_BY_BADGES[NORMAL_LEVEL_CAP_BY_BADGES.length - 1];
    }
    return NORMAL_LEVEL_CAP_BY_BADGES[count];
}

export function computeExpertLevelCapFromProgress({ badgeCount = 0, isChampion = false } = {}) {
    if (isChampion) {
        return 100;
    }
    const entries = levelCapsPayload?.entries;
    if (!Array.isArray(entries) || entries.length === 0) {
        return 100;
    }
    const index = Math.min(Math.max(0, Number(badgeCount) || 0), entries.length - 1);
    return Number(entries[index]?.level_cap) || 100;
}

export function resolveEffectiveLevelCapFromProgress(progress = {}, capProfile = CAP_PROFILES.NORMAL) {
    return normalizeCapProfile(capProfile) === CAP_PROFILES.EXPERT
        ? computeExpertLevelCapFromProgress(progress)
        : computeNormalLevelCapFromProgress(progress);
}
