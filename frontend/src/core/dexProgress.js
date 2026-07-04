import { buildUnboundDexMoveFilterUrl } from './unboundDex.js';

export const LEARNSET_BUCKETS = {
    LEVEL_UP: 'level_up',
    TMHM: 'tmhm',
    TUTOR: 'tutor',
    EGG: 'egg',
};

export const MOVE_AVAILABILITY = {
    AVAILABLE: 'available',
    TM_MISSING: 'tm_missing',
    TM_CASE_LOCKED: 'tm_case_locked',
    TUTOR_UNKNOWN: 'tutor_unknown',
    UNKNOWN: 'unknown',
};

export function buildDexProgressPayload(gameProgress) {
    if (!gameProgress) {
        return null;
    }
    const owned = new Set(
        (gameProgress.owned_tmhm_item_ids || []).map((id) => Number(id)).filter((id) => id > 0),
    );
    return {
        badge_count: gameProgress.badge_count ?? 0,
        is_champion: Boolean(gameProgress.is_champion),
        cap_profile: gameProgress.cap_profile ?? 'normal',
        effective_level_cap: gameProgress.effective_level_cap ?? null,
        normal_level_cap: gameProgress.normal_level_cap ?? gameProgress.active_level_cap ?? null,
        expert_level_cap: gameProgress.expert_level_cap ?? null,
        tm_case_owned: Boolean(gameProgress.tm_case_owned),
        owned_tmhm_item_ids: [...owned],
        owned_tm_count: owned.size,
        key_items: gameProgress.key_items || {},
    };
}

export function classifyMoveAvailability(moveId, bucket, dexProgress, moveToItemIds) {
    const id = Number(moveId);
    if (!Number.isFinite(id) || id <= 0 || !dexProgress) {
        return MOVE_AVAILABILITY.UNKNOWN;
    }

    if (bucket === LEARNSET_BUCKETS.TUTOR) {
        return MOVE_AVAILABILITY.TUTOR_UNKNOWN;
    }

    if (bucket !== LEARNSET_BUCKETS.TMHM) {
        return MOVE_AVAILABILITY.AVAILABLE;
    }

    const requiredItemIds = moveToItemIds?.get?.(id);
    if (!Array.isArray(requiredItemIds) || requiredItemIds.length === 0) {
        return MOVE_AVAILABILITY.UNKNOWN;
    }

    if (!dexProgress.tm_case_owned) {
        return MOVE_AVAILABILITY.TM_CASE_LOCKED;
    }

    const owned = new Set(dexProgress.owned_tmhm_item_ids || []);
    const hasItem = requiredItemIds.some((itemId) => owned.has(Number(itemId)));
    return hasItem ? MOVE_AVAILABILITY.AVAILABLE : MOVE_AVAILABILITY.TM_MISSING;
}

export function availabilityHint(status) {
    switch (status) {
    case MOVE_AVAILABILITY.TM_MISSING:
        return 'TM not in bag';
    case MOVE_AVAILABILITY.TM_CASE_LOCKED:
        return 'TM Case not unlocked';
    case MOVE_AVAILABILITY.TUTOR_UNKNOWN:
        return 'tutor unlock varies';
    default:
        return null;
    }
}

export function formatLearnsetBucketWithProgress({
    moveIds = [],
    moveNameById,
    bucket,
    dexProgress,
    moveToItemIds,
    limit = 12,
}) {
    const entries = (moveIds || []).map((moveId) => {
        const id = Number(moveId);
        const name = moveNameById?.get?.(id) || `Move ${id}`;
        const status = classifyMoveAvailability(id, bucket, dexProgress, moveToItemIds);
        const hint = availabilityHint(status);
        const label = hint ? `${name} (${hint})` : name;
        return { id, name, status, hint, label };
    });

    const visible = entries.slice(0, limit);
    const overflow = entries.length - visible.length;
    const text = visible.map((entry) => entry.label).join(', ');
    const summary = overflow > 0 ? `${text}, +${overflow} more` : text;

    return {
        entries,
        text: summary,
        missingTmCount: entries.filter((entry) => entry.status === MOVE_AVAILABILITY.TM_MISSING).length,
        lockedTmCount: entries.filter((entry) => entry.status === MOVE_AVAILABILITY.TM_CASE_LOCKED).length,
    };
}

export function buildDexProgressSummaryLines(dexProgress) {
    if (!dexProgress) {
        return [];
    }
    const capBits = [
        `${dexProgress.badge_count} badge${dexProgress.badge_count === 1 ? '' : 's'}`,
        dexProgress.is_champion ? 'Champion' : `cap ${dexProgress.effective_level_cap ?? '—'} (${dexProgress.cap_profile})`,
    ];
    const tmBits = dexProgress.tm_case_owned
        ? `${dexProgress.owned_tm_count} TM/HM in bag`
        : 'TM Case locked';
    return [
        `Save progress: ${capBits.join(' · ')} · ${tmBits}`,
    ];
}

export function buildDexMoveDeepLink(moveName) {
    return buildUnboundDexMoveFilterUrl(moveName);
}
