import process from 'node:process';

import {
    getCurrentMilestone,
    isMilestoneCleared,
    buildSpeedTierRosterContext,
} from '../src/core/unboundSpeedTiers.js';

let failures = 0;

function assertEqual(label, actual, expected) {
    if (actual !== expected) {
        failures += 1;
        console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
        return;
    }
    console.log(`PASS ${label}`);
}

function progress({ badges = 0, mega = false, champion = false } = {}) {
    return {
        badge_count: badges,
        mega_unlocked: mega,
        is_champion: champion,
        active_level_cap: 40,
    };
}

// Pre-Maxima: 4 badges, no Mega accessory -> Maxima is the next fight.
assertEqual(
    'upcoming before Maxima',
    getCurrentMilestone(progress({ badges: 4, mega: false }))?.boss_name,
    'Maxima',
);

// Core bug: beat Maxima (owns Mega accessory) but still only 4 badges.
// Must advance to the next level-cap fight (Galavan), not stay on Maxima.
assertEqual(
    'upcoming after Maxima advances to Galavan',
    getCurrentMilestone(progress({ badges: 4, mega: true }))?.boss_name,
    'Galavan',
);

// Maxima clears on any of the four Mega accessory choices (signalled by mega_unlocked).
assertEqual(
    'Maxima cleared via mega_unlocked',
    isMilestoneCleared({ boss_name: 'Maxima', trainer: 'Successor Maxima (Fairy)' }, progress({ badges: 4, mega: true })),
    true,
);
assertEqual(
    'Maxima not cleared without mega accessory',
    isMilestoneCleared({ boss_name: 'Maxima', trainer: 'Successor Maxima (Fairy)' }, progress({ badges: 4, mega: false })),
    false,
);

// Gym gating by badge count.
assertEqual(
    'Galavan cleared at 5 badges',
    isMilestoneCleared({ boss_name: 'Galavan', trainer: '5. Galavan (Electric)' }, progress({ badges: 5, mega: true })),
    true,
);
assertEqual(
    'upcoming at 6 badges is Tessy',
    getCurrentMilestone(progress({ badges: 6, mega: true }))?.boss_name,
    'Tessy',
);

// 7 badges (beat Tessy) -> gym 8 Benjamin is the next fight.
assertEqual(
    'upcoming at 7 badges is Benjamin (gym 8)',
    getCurrentMilestone(progress({ badges: 7, mega: true }))?.boss_name,
    'Benjamin',
);

// After all 8 gyms + Maxima (non-champion), the Elite Four gauntlet is upcoming.
assertEqual(
    'post-gym upcoming is Elite Four',
    getCurrentMilestone(progress({ badges: 8, mega: true }))?.boss_name,
    'Elite Four: Moleman',
);

// Newly added bosses have no generated speed-tier rows yet: context still surfaces the
// milestone (with threat names) so the export degrades gracefully instead of vanishing.
const benjaminContext = buildSpeedTierRosterContext({
    party: [],
    gameProgress: progress({ badges: 7, mega: true }),
});
assertEqual('Benjamin milestone surfaced', benjaminContext.milestone?.boss_name, 'Benjamin');
assertEqual('Benjamin has no detailed speed rows yet', benjaminContext.party_checks.length, 0);
assertEqual(
    'Benjamin threat names available for fallback',
    benjaminContext.milestone?.threats?.includes('Volcarona'),
    true,
);

// Champion: speed tier context is omitted entirely.
const championContext = buildSpeedTierRosterContext({
    party: [],
    gameProgress: progress({ badges: 8, mega: true, champion: true }),
});
assertEqual('champion context has null milestone', championContext.milestone, null);
assertEqual('champion context flagged champion', championContext.champion, true);

if (failures > 0) {
    console.error(`speed-tier progress regression failed (${failures} case(s))`);
    process.exit(1);
}

console.log('speed-tier progress regression passed');
