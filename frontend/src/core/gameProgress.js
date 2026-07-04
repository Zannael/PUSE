import { ru8 } from './binary.js';
import { findActiveSectionById } from './sections.js';
import { readMoney, readBp } from './money.js';
import { resolveQuickPockets, collectOwnedTmhmItemIds, mapPocketFromAnchor } from './bag.js';
import {
    CAP_PROFILES,
    computeExpertLevelCap,
    computeNormalLevelCap,
    normalizeCapProfile,
    resolveEffectiveLevelCap,
} from './levelCap.js';

const SAVE_BLOCK1_CHUNK_SIZES = [0xFF0, 0xFF0, 0xFF0, 0xD98];
const SAVE_BLOCK1_SECTION_IDS = [1, 2, 3, 4];
const SAVEBLOCK1_FLAGS_OFFSET = 0x0EE0;
const EXPANDED_FLAGS_BASE = 0x900;
const EXPANDED_FLAGS_SECTION_ID = 4;
const EXPANDED_FLAGS_SECTION_OFFSET = 0xD98;
const EXPANDED_FLAGS_SIZE = 0x258;

const FLAG_BADGE01_GET = 0x820;
const FLAG_BADGE08_GET = 0x827;
const FLAG_SYS_GAME_CLEAR = 0x82C;
const FLAG_SYS_DEXNAV = 0x91E;

const ITEM_HEART_SCALE = 111;
const ITEM_DREAM_MIST = 89;
const ITEM_BOTTLE_CAP = 616;
const ITEM_GOLD_BOTTLE_CAP = 617;
const ITEM_STAT_SCANNER = 278;
const ITEM_MEGA_RING = 353;
const ITEM_MEGA_CUFF = 119;
const ITEM_MEGA_CHARM = 528;
const ITEM_MEGA_BRACELET = 529;

// Successor Maxima awards the Mega Keystone, embedded in one of four accessories
// the player chooses. Owning any of them proves Maxima has been defeated.
const MEGA_ACCESSORY_ITEM_IDS = [ITEM_MEGA_RING, ITEM_MEGA_CUFF, ITEM_MEGA_CHARM, ITEM_MEGA_BRACELET];

export { CAP_PROFILES, NORMAL_LEVEL_CAP_BY_BADGES } from './levelCap.js';

export const GAME_PROGRESS_ITEM_IDS = {
    heart_scale: ITEM_HEART_SCALE,
    dream_mist: ITEM_DREAM_MIST,
    bottle_cap: ITEM_BOTTLE_CAP,
    gold_bottle_cap: ITEM_GOLD_BOTTLE_CAP,
    stat_scanner: ITEM_STAT_SCANNER,
    mega_ring: ITEM_MEGA_RING,
};

function saveBlock1OffsetToSection(absOffset) {
    let remaining = absOffset;
    for (let i = 0; i < SAVE_BLOCK1_CHUNK_SIZES.length; i += 1) {
        const chunkSize = SAVE_BLOCK1_CHUNK_SIZES[i];
        if (remaining < chunkSize) {
            return {
                sectionId: SAVE_BLOCK1_SECTION_IDS[i],
                relOffset: remaining,
            };
        }
        remaining -= chunkSize;
    }
    return null;
}

function readFlagBit(buffer, sectionId, relOffset, bitIndex) {
    const section = findActiveSectionById(buffer, sectionId);
    if (!section) {
        return false;
    }
    const absOffset = section.off + relOffset;
    if (absOffset < 0 || absOffset >= buffer.length) {
        return false;
    }
    const byte = ru8(buffer, absOffset);
    return ((byte >> bitIndex) & 1) === 1;
}

function readStandardEventFlag(buffer, flagId) {
    const byteOffset = SAVEBLOCK1_FLAGS_OFFSET + Math.floor(flagId / 8);
    const bitIndex = flagId % 8;
    const mapped = saveBlock1OffsetToSection(byteOffset);
    if (!mapped) {
        return false;
    }
    return readFlagBit(buffer, mapped.sectionId, mapped.relOffset, bitIndex);
}

function readExpandedEventFlag(buffer, flagId) {
    if (flagId < EXPANDED_FLAGS_BASE || flagId >= 0x1900) {
        return false;
    }
    const flagIndex = flagId - EXPANDED_FLAGS_BASE;
    const byteOffset = EXPANDED_FLAGS_SECTION_OFFSET + Math.floor(flagIndex / 8);
    const bitIndex = flagIndex % 8;
    if (byteOffset >= EXPANDED_FLAGS_SECTION_OFFSET + EXPANDED_FLAGS_SIZE) {
        return false;
    }
    return readFlagBit(buffer, EXPANDED_FLAGS_SECTION_ID, byteOffset, bitIndex);
}

export function readEventFlag(buffer, flagId) {
    const id = Number(flagId);
    if (!Number.isFinite(id)) {
        return false;
    }
    if (id >= EXPANDED_FLAGS_BASE && id < 0x1900) {
        return readExpandedEventFlag(buffer, id);
    }
    if (id >= 0x4000) {
        return false;
    }
    return readStandardEventFlag(buffer, id);
}

export function countBadges(buffer) {
    let count = 0;
    for (let flagId = FLAG_BADGE01_GET; flagId <= FLAG_BADGE08_GET; flagId += 1) {
        if (readEventFlag(buffer, flagId)) {
            count += 1;
        }
    }
    return count;
}

export function isChampion(buffer) {
    return readEventFlag(buffer, FLAG_SYS_GAME_CLEAR);
}

export function computeActiveLevelCap(buffer) {
    return computeNormalLevelCap(buffer);
}

const EMPTY_ITEM_NAME_MAP = new Map();

// resolveQuickPockets returns pocket descriptors (anchor_offset, slot_count, ...),
// not item slots. Read the real slots for each pocket from its anchor so item
// ownership checks actually see the save's contents.
function collectOwnedSlots(buffer, pockets) {
    const slots = [];
    Object.values(pockets || {}).forEach((pocket) => {
        const anchor = pocket?.anchor_offset;
        if (!Number.isInteger(anchor)) {
            return;
        }
        mapPocketFromAnchor(buffer, anchor, EMPTY_ITEM_NAME_MAP).forEach((slot) => {
            if (Number(slot?.id) > 0) {
                slots.push(slot);
            }
        });
    });
    return slots;
}

function sumItemQuantity(slots, itemId) {
    let total = 0;
    (slots || []).forEach((slot) => {
        if (Number(slot?.id) === itemId) {
            total += Math.max(0, Number(slot?.qty) || 0);
        }
    });
    return total;
}

function hasKeyItem(slots, itemId) {
    return sumItemQuantity(slots, itemId) > 0;
}

function lookupItemName(itemNameById, itemId, fallback) {
    return itemNameById?.get(Number(itemId)) || fallback;
}

export function buildGameProgressSnapshot(buffer, { itemNameById, capProfile = CAP_PROFILES.NORMAL } = {}) {
    const pockets = resolveQuickPockets(buffer);
    const ownedSlots = collectOwnedSlots(buffer, pockets);
    const money = readMoney(buffer);
    const battlePoints = readBp(buffer);
    const badgeCount = countBadges(buffer);
    const champion = isChampion(buffer);
    const megaUnlocked = MEGA_ACCESSORY_ITEM_IDS.some((id) => hasKeyItem(ownedSlots, id));
    const resolvedProfile = normalizeCapProfile(capProfile);
    const normalLevelCap = computeNormalLevelCap(buffer);
    const expertLevelCap = computeExpertLevelCap(buffer);
    const effectiveLevelCap = resolveEffectiveLevelCap(buffer, resolvedProfile);
    const tmOwnership = collectOwnedTmhmItemIds(buffer, itemNameById);

    return {
        badge_count: badgeCount,
        active_level_cap: normalLevelCap,
        normal_level_cap: normalLevelCap,
        expert_level_cap: expertLevelCap,
        cap_profile: resolvedProfile,
        effective_level_cap: effectiveLevelCap,
        difficulty_flag_known: false,
        is_champion: champion,
        mega_unlocked: megaUnlocked,
        money,
        battle_points: battlePoints,
        tm_case_owned: tmOwnership.tm_case_owned,
        owned_tmhm_item_ids: tmOwnership.owned_tmhm_item_ids,
        key_items: {
            dexnav: readEventFlag(buffer, FLAG_SYS_DEXNAV),
            stat_scanner: hasKeyItem(ownedSlots, ITEM_STAT_SCANNER),
            mega_ring: hasKeyItem(ownedSlots, ITEM_MEGA_RING),
        },
        consumables: {
            heart_scale: sumItemQuantity(ownedSlots, ITEM_HEART_SCALE),
            dream_mist: sumItemQuantity(ownedSlots, ITEM_DREAM_MIST),
            bottle_cap: sumItemQuantity(ownedSlots, ITEM_BOTTLE_CAP),
            gold_bottle_cap: sumItemQuantity(ownedSlots, ITEM_GOLD_BOTTLE_CAP),
        },
        key_items_detail: {
            dexnav: {
                owned: readEventFlag(buffer, FLAG_SYS_DEXNAV),
                source: 'event_flag',
                flag_id: FLAG_SYS_DEXNAV,
            },
            stat_scanner: {
                owned: hasKeyItem(ownedSlots, ITEM_STAT_SCANNER),
                item_id: ITEM_STAT_SCANNER,
                item_name: lookupItemName(itemNameById, ITEM_STAT_SCANNER, 'Stat Scanner'),
            },
            mega_ring: {
                owned: hasKeyItem(ownedSlots, ITEM_MEGA_RING),
                item_id: ITEM_MEGA_RING,
                item_name: lookupItemName(itemNameById, ITEM_MEGA_RING, 'Mega Ring'),
            },
        },
        consumables_detail: {
            heart_scale: {
                count: sumItemQuantity(ownedSlots, ITEM_HEART_SCALE),
                item_id: ITEM_HEART_SCALE,
                item_name: lookupItemName(itemNameById, ITEM_HEART_SCALE, 'Heart Scale'),
            },
            dream_mist: {
                count: sumItemQuantity(ownedSlots, ITEM_DREAM_MIST),
                item_id: ITEM_DREAM_MIST,
                item_name: lookupItemName(itemNameById, ITEM_DREAM_MIST, 'Dream Mist'),
            },
            bottle_cap: {
                count: sumItemQuantity(ownedSlots, ITEM_BOTTLE_CAP),
                item_id: ITEM_BOTTLE_CAP,
                item_name: lookupItemName(itemNameById, ITEM_BOTTLE_CAP, 'Bottle Cap'),
            },
            gold_bottle_cap: {
                count: sumItemQuantity(ownedSlots, ITEM_GOLD_BOTTLE_CAP),
                item_id: ITEM_GOLD_BOTTLE_CAP,
                item_name: lookupItemName(itemNameById, ITEM_GOLD_BOTTLE_CAP, 'Gold Bottle Cap'),
            },
        },
    };
}
