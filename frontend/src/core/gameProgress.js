import { ru8 } from './binary.js';
import { findActiveSectionById } from './sections.js';
import { readBp, readMoney } from './money.js';
import { collectOwnedTmhmItemIds, mapPocketFromAnchor, resolveQuickPockets } from './bag.js';
import {
    CAP_PROFILES,
    computeExpertLevelCapFromProgress,
    computeNormalLevelCapFromProgress,
    normalizeCapProfile,
    resolveEffectiveLevelCapFromProgress,
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

const MEGA_ACCESSORY_ITEM_IDS = [ITEM_MEGA_RING, ITEM_MEGA_CUFF, ITEM_MEGA_CHARM, ITEM_MEGA_BRACELET];
const EMPTY_ITEM_NAME_MAP = new Map();

export { CAP_PROFILES, NORMAL_LEVEL_CAP_BY_BADGES } from './levelCap.js';

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

function hasItem(slots, itemId) {
    return sumItemQuantity(slots, itemId) > 0;
}

function readOrZero(fn, buffer) {
    try {
        return fn(buffer);
    } catch {
        return 0;
    }
}

export function buildGameProgressSnapshot(buffer, { itemNameById, capProfile = CAP_PROFILES.NORMAL } = {}) {
    const pockets = resolveQuickPockets(buffer);
    const ownedSlots = collectOwnedSlots(buffer, pockets);
    const badgeCount = countBadges(buffer);
    const champion = isChampion(buffer);
    const progress = { badgeCount, isChampion: champion };
    const resolvedProfile = normalizeCapProfile(capProfile);
    const normalLevelCap = computeNormalLevelCapFromProgress(progress);
    const expertLevelCap = computeExpertLevelCapFromProgress(progress);
    const tmOwnership = collectOwnedTmhmItemIds(buffer, itemNameById);

    return {
        badge_count: badgeCount,
        active_level_cap: normalLevelCap,
        normal_level_cap: normalLevelCap,
        expert_level_cap: expertLevelCap,
        cap_profile: resolvedProfile,
        effective_level_cap: resolveEffectiveLevelCapFromProgress(progress, resolvedProfile),
        difficulty_flag_known: false,
        is_champion: champion,
        mega_unlocked: MEGA_ACCESSORY_ITEM_IDS.some((id) => hasItem(ownedSlots, id)),
        money: readOrZero(readMoney, buffer),
        battle_points: readOrZero(readBp, buffer),
        tm_case_owned: tmOwnership.tm_case_owned,
        owned_tmhm_item_ids: tmOwnership.owned_tmhm_item_ids,
        key_items: {
            dexnav: readEventFlag(buffer, FLAG_SYS_DEXNAV),
            stat_scanner: hasItem(ownedSlots, ITEM_STAT_SCANNER),
            mega_ring: hasItem(ownedSlots, ITEM_MEGA_RING),
        },
        consumables: {
            heart_scale: sumItemQuantity(ownedSlots, ITEM_HEART_SCALE),
            dream_mist: sumItemQuantity(ownedSlots, ITEM_DREAM_MIST),
            bottle_cap: sumItemQuantity(ownedSlots, ITEM_BOTTLE_CAP),
            gold_bottle_cap: sumItemQuantity(ownedSlots, ITEM_GOLD_BOTTLE_CAP),
        },
    };
}
