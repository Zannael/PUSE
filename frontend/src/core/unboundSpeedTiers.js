import speedTiersPayload from './unbound_speed_tiers.json' with { type: 'json' };
import levelCapsPayload from './unbound_level_caps.json' with { type: 'json' };

const ENTRIES = Array.isArray(speedTiersPayload?.entries) ? speedTiersPayload.entries : [];
const MILESTONES = Array.isArray(levelCapsPayload?.entries) ? levelCapsPayload.entries : [];

export function getSpeedTierEntries() {
    return ENTRIES;
}

export function getSpeedTierMilestones() {
    return MILESTONES;
}

export function getThreatsForBoss(bossName) {
    const target = String(bossName || '').trim().toLowerCase();
    if (!target) {
        return [];
    }
    return ENTRIES.filter((row) => String(row.boss_name || '').trim().toLowerCase() === target);
}

const GYM_TRAINER_RE = /^\s*(\d+)\s*\./;

// A milestone is "cleared" relative to live save progress. Gym leaders are gated
// by badge count; Successor Maxima awards a Mega accessory (mega_unlocked); the
// Elite Four / rival finale only clears once the game is beaten (champion).
export function isMilestoneCleared(entry, gameProgress = {}) {
    const badgeCount = Number(gameProgress?.badge_count) || 0;
    const gymMatch = GYM_TRAINER_RE.exec(String(entry?.trainer || ''));
    if (gymMatch) {
        return badgeCount >= Number(gymMatch[1]);
    }
    if (/maxima/i.test(entry?.boss_name || '') || /successor/i.test(entry?.trainer || '')) {
        return Boolean(gameProgress?.mega_unlocked);
    }
    return Boolean(gameProgress?.is_champion);
}

export function getCurrentMilestone(gameProgress = {}) {
    if (!MILESTONES.length) {
        return null;
    }
    const next = MILESTONES.find((entry) => !isMilestoneCleared(entry, gameProgress));
    return next || MILESTONES[MILESTONES.length - 1];
}

export function getUpcomingSpeedThreats(gameProgress = {}) {
    const milestone = getCurrentMilestone(gameProgress);
    if (!milestone) {
        return { milestone: null, threats: [] };
    }
    return {
        milestone,
        threats: getThreatsForBoss(milestone.boss_name),
    };
}

export function listPartyOutspeeders(party = [], requiredSpeed) {
    const target = Number(requiredSpeed);
    if (!Number.isFinite(target)) {
        return [];
    }
    return party
        .filter((mon) => Number.isFinite(mon?.stats?.Spe) && mon.stats.Spe >= target)
        .map((mon) => {
            const nickname = String(mon.nickname || '').trim();
            const label = nickname ? `${mon.species_name} (${nickname})` : mon.species_name;
            return `${label} (${mon.stats.Spe} Spe)`;
        });
}

export function buildSpeedTierRosterContext({ party = [], gameProgress = null } = {}) {
    if (!gameProgress || gameProgress.is_champion) {
        return {
            mode: speedTiersPayload?.mode || 'expert',
            champion: Boolean(gameProgress?.is_champion),
            milestone: null,
            threats: [],
            party_checks: [],
        };
    }

    const { milestone, threats } = getUpcomingSpeedThreats(gameProgress);
    const partyChecks = threats.map((threat) => ({
        threat,
        outspeeders: listPartyOutspeeders(party, threat.required_roster_speed),
    }));

    return {
        mode: speedTiersPayload?.mode || 'expert',
        champion: false,
        milestone,
        threats,
        party_checks: partyChecks,
        normal_level_cap: gameProgress.active_level_cap ?? null,
    };
}
