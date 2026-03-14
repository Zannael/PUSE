import { ru16, ru32, wu16 } from './binary.js';
import { OFF_ID, OFF_SAVE_IDX, SECTION_SIZE } from './sections.js';

const OFF_VALID_LEN = 0xFF0;

const UNBOUND_ITEM_SECTOR_ID = 13;
const BAG_SECTOR_IDS = new Set([13, 14, 15, 16]);

const MAX_PLAUSIBLE_ITEM_ID = 4095;
const MAX_PLAUSIBLE_ITEM_QTY = 2000;
const MAX_POCKET_SLOTS = 200;
const MAX_STRICT_POCKET_SLOTS = 80;
const MAX_STRICT_DUP_RATIO = 0.35;
const MAX_MEDIUM_DUP_RATIO = 0.6;

const BALL_ITEM_IDS = new Set([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    52, 53, 60, 61, 62,
    622, 623, 624, 625, 626, 627, 628, 629, 630, 631,
]);

const BERRY_ITEM_IDS = new Set([
    ...Array.from({ length: 43 }, (_, i) => 133 + i),
    ...Array.from({ length: 23 }, (_, i) => 540 + i),
]);

const TM_ITEM_IDS = new Set([
    ...Array.from({ length: 58 }, (_, i) => 289 + i),
    ...Array.from({ length: 62 }, (_, i) => 375 + i),
]);

const HM_ITEM_IDS = new Set(Array.from({ length: 8 }, (_, i) => 437 + i));
const TMHM_ITEM_IDS = new Set([...TM_ITEM_IDS, ...HM_ITEM_IDS]);

const KNOWN_POCKET_ANCHORS = {
    ball: 0x1E31C,
    tm: 0x1E3E4,
    berry: 0x1E5E4,
};

const MAIN_POCKET_PROBE_IDS = [13, 84, 197, 94, 24, 26, 16, 493, 603, 606, 72];

function decodeSlot(buffer, offset, swapped = false) {
    const a = ru16(buffer, offset);
    const b = ru16(buffer, offset + 2);
    return swapped ? [b, a] : [a, b];
}

function isPlausibleSlot(itemId, qty) {
    return itemId >= 0 && itemId <= MAX_PLAUSIBLE_ITEM_ID && qty >= 1 && qty <= MAX_PLAUSIBLE_ITEM_QTY;
}

function scorePocket(nonZeroCount, duplicateCount, slotCount) {
    const uniqueCount = Math.max(0, nonZeroCount - duplicateCount);
    const denseReward = Math.min(uniqueCount, 64) * 6;
    const overflowReward = Math.max(0, uniqueCount - 64);
    const oversizePenalty = Math.max(0, slotCount - 64) * 10;
    const duplicatePenalty = duplicateCount * 20;
    return denseReward + overflowReward - oversizePenalty - duplicatePenalty;
}

function classifyPocketQuality(nonZeroCount, duplicateCount, slotCount) {
    if (slotCount <= 0) {
        return 'reject';
    }
    const dupRatio = duplicateCount / slotCount;
    if (slotCount <= MAX_STRICT_POCKET_SLOTS && dupRatio <= MAX_STRICT_DUP_RATIO) {
        return 'strict';
    }
    if (dupRatio <= MAX_MEDIUM_DUP_RATIO) {
        return 'medium';
    }
    return 'reject';
}

function extractPocketBounds(buffer, anchorOffset, swapped = false) {
    if (anchorOffset < 0 || anchorOffset + 3 >= buffer.length) {
        return null;
    }

    const sectorStart = Math.floor(anchorOffset / SECTION_SIZE) * SECTION_SIZE;
    const sectorEnd = sectorStart + OFF_VALID_LEN;
    if (!(sectorStart <= anchorOffset && anchorOffset < sectorEnd)) {
        return null;
    }

    let curr = anchorOffset;
    while (true) {
        const prev = curr - 4;
        if (prev < sectorStart) {
            break;
        }
        const [pid, pqty] = decodeSlot(buffer, prev, swapped);
        if (pid === 0 || !isPlausibleSlot(pid, pqty)) {
            break;
        }
        curr = prev;
    }

    const startAbs = curr;
    let nonZeroCount = 0;
    let duplicateCount = 0;
    let slotCount = 0;
    let terminated = false;
    const seen = new Set();

    while (curr + 3 < sectorEnd && slotCount < MAX_POCKET_SLOTS) {
        const [iid, iqty] = decodeSlot(buffer, curr, swapped);
        if (iid === 0 || iqty === 0) {
            terminated = true;
            break;
        }
        if (!isPlausibleSlot(iid, iqty)) {
            break;
        }

        slotCount += 1;
        nonZeroCount += 1;
        if (seen.has(iid)) {
            duplicateCount += 1;
        } else {
            seen.add(iid);
        }
        curr += 4;
    }

    if (slotCount === 0 || !terminated) {
        return null;
    }

    return [startAbs, curr, nonZeroCount, slotCount, duplicateCount];
}

function bestPocketForAnchor(buffer, anchorOffset) {
    const candidates = [];
    [false, true].forEach((swapped) => {
        const bounds = extractPocketBounds(buffer, anchorOffset, swapped);
        if (!bounds) {
            return;
        }
        const [, , nonZeroCount, slotCount, duplicateCount] = bounds;
        candidates.push({ score: scorePocket(nonZeroCount, duplicateCount, slotCount), swapped, bounds });
    });

    if (candidates.length === 0) {
        return [null, null];
    }

    candidates.sort((a, b) => b.score - a.score);
    return [candidates[0].swapped, candidates[0].bounds];
}

function extractIdSetPocketBoundsGlobal(buffer, anchorOffset, validIds, minSlots = 4) {
    if (anchorOffset < 0 || anchorOffset + 3 >= buffer.length) {
        return null;
    }

    let curr = anchorOffset;
    const seen = new Set();

    while (true) {
        const prev = curr - 4;
        if (prev < 0) {
            break;
        }
        const pid = ru16(buffer, prev);
        const pqty = ru16(buffer, prev + 2);
        if (pid === 0 || !validIds.has(pid) || !(pqty >= 1 && pqty <= MAX_PLAUSIBLE_ITEM_QTY)) {
            break;
        }
        curr = prev;
    }

    const startAbs = curr;
    let nonZeroCount = 0;
    let duplicateCount = 0;
    let slotCount = 0;
    let terminated = false;

    while (curr + 3 < buffer.length && slotCount < MAX_POCKET_SLOTS) {
        const iid = ru16(buffer, curr);
        const iqty = ru16(buffer, curr + 2);
        if (iid === 0) {
            terminated = true;
            break;
        }
        if (!validIds.has(iid) || !(iqty >= 1 && iqty <= MAX_PLAUSIBLE_ITEM_QTY)) {
            break;
        }

        slotCount += 1;
        nonZeroCount += 1;
        if (seen.has(iid)) {
            duplicateCount += 1;
        } else {
            seen.add(iid);
        }
        curr += 4;
    }

    if (slotCount < minSlots || !terminated) {
        return null;
    }

    return [startAbs, curr, nonZeroCount, slotCount, duplicateCount];
}

function scanGlobalIdSetCandidates(buffer, itemId, activeSaveIdx, validIds, scoreBonus = 500, minSlots = 4) {
    if (!validIds.has(itemId)) {
        return [];
    }

    const out = [];
    const seen = new Set();
    for (let absOff = 0; absOff < buffer.length - 3; absOff += 2) {
        const iid = ru16(buffer, absOff);
        const qty = ru16(buffer, absOff + 2);
        if (iid !== itemId || qty <= 0) {
            continue;
        }

        const bounds = extractIdSetPocketBoundsGlobal(buffer, absOff, validIds, minSlots);
        if (!bounds) {
            continue;
        }

        const [pStart, pEnd, nonZeroCount, slotCount, dupCount] = bounds;
        const quality = classifyPocketQuality(nonZeroCount, dupCount, slotCount);
        if (quality === 'reject') {
            continue;
        }

        const key = `${pStart}:${pEnd}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        const secIdx = Math.floor(pStart / SECTION_SIZE);
        const sectId = ru16(buffer, secIdx * SECTION_SIZE + OFF_ID);
        out.push({
            offset: pStart,
            qty,
            sector: secIdx,
            sect_id: sectId,
            save_idx: activeSaveIdx,
            pocket_end: pEnd,
            pocket_nonzero: nonZeroCount,
            pocket_slots: slotCount,
            pocket_dups: dupCount,
            encoding_swapped: false,
            score: scorePocket(nonZeroCount, dupCount, slotCount) + scoreBonus,
            quality,
        });
    }
    return out;
}

function scanGlobalIdSetPockets(buffer, activeSaveIdx, validIds, scoreBonus = 500, minSlots = 4) {
    const out = [];
    const seen = new Set();

    for (let absOff = 0; absOff < buffer.length - 3; absOff += 2) {
        const iid = ru16(buffer, absOff);
        const qty = ru16(buffer, absOff + 2);
        if (!validIds.has(iid) || qty <= 0) {
            continue;
        }

        const bounds = extractIdSetPocketBoundsGlobal(buffer, absOff, validIds, minSlots);
        if (!bounds) {
            continue;
        }

        const [pStart, pEnd, nonZeroCount, slotCount, dupCount] = bounds;
        const key = `${pStart}:${pEnd}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        const quality = classifyPocketQuality(nonZeroCount, dupCount, slotCount);
        if (quality === 'reject') {
            continue;
        }

        const secIdx = Math.floor(pStart / SECTION_SIZE);
        const sectId = ru16(buffer, secIdx * SECTION_SIZE + OFF_ID);
        out.push({
            offset: pStart,
            qty: 0,
            sector: secIdx,
            sect_id: sectId,
            save_idx: activeSaveIdx,
            pocket_end: pEnd,
            pocket_nonzero: nonZeroCount,
            pocket_slots: slotCount,
            pocket_dups: dupCount,
            encoding_swapped: false,
            score: scorePocket(nonZeroCount, dupCount, slotCount) + scoreBonus,
            quality,
        });
    }

    return out;
}

function computeActiveSaveIdx(buffer, sectorIds = null) {
    const totalSectors = Math.floor(buffer.length / SECTION_SIZE);
    let maxIdx = 0;

    for (let secIdx = 0; secIdx < totalSectors; secIdx += 1) {
        const secOff = secIdx * SECTION_SIZE;
        const sectId = ru16(buffer, secOff + OFF_ID);
        if (sectorIds && !sectorIds.has(sectId)) {
            continue;
        }

        const saveIdx = ru32(buffer, secOff + OFF_SAVE_IDX);
        if (saveIdx <= 0 || saveIdx === 0xFFFFFFFF) {
            continue;
        }
        if (saveIdx > maxIdx) {
            maxIdx = saveIdx;
        }
    }

    if (maxIdx > 0) {
        return maxIdx;
    }

    for (let secIdx = 0; secIdx < totalSectors; secIdx += 1) {
        const secOff = secIdx * SECTION_SIZE;
        const saveIdx = ru32(buffer, secOff + OFF_SAVE_IDX);
        if (saveIdx <= 0 || saveIdx === 0xFFFFFFFF) {
            continue;
        }
        if (saveIdx > maxIdx) {
            maxIdx = saveIdx;
        }
    }

    return maxIdx;
}

function pickBestCandidate(candidates) {
    if (!candidates || candidates.length === 0) {
        return null;
    }

    return candidates.reduce((best, cand) => {
        if (!best) {
            return cand;
        }
        const bestKey = [best.save_idx || 0, best.quality === 'strict' ? 1 : 0, best.score || -1000000000, best.pocket_slots || 0, -(best.offset || 0)];
        const candKey = [cand.save_idx || 0, cand.quality === 'strict' ? 1 : 0, cand.score || -1000000000, cand.pocket_slots || 0, -(cand.offset || 0)];
        if (
            candKey[0] > bestKey[0] ||
            (candKey[0] === bestKey[0] && candKey[1] > bestKey[1]) ||
            (candKey[0] === bestKey[0] && candKey[1] === bestKey[1] && candKey[2] > bestKey[2]) ||
            (candKey[0] === bestKey[0] && candKey[1] === bestKey[1] && candKey[2] === bestKey[2] && candKey[3] > bestKey[3]) ||
            (candKey[0] === bestKey[0] && candKey[1] === bestKey[1] && candKey[2] === bestKey[2] && candKey[3] === bestKey[3] && candKey[4] > bestKey[4])
        ) {
            return cand;
        }
        return best;
    }, null);
}

export function pocketTypeForItemId(itemId) {
    if (BALL_ITEM_IDS.has(itemId)) return 'ball';
    if (BERRY_ITEM_IDS.has(itemId)) return 'berry';
    if (TM_ITEM_IDS.has(itemId)) return 'tm';
    if (HM_ITEM_IDS.has(itemId)) return 'hm';
    return 'generic';
}

export function scanForItemCandidates(buffer, itemId) {
    if (itemId <= 0) {
        return [];
    }

    const strictCandidates = [];
    const mediumCandidates = [];

    const totalSectors = Math.floor(buffer.length / SECTION_SIZE);
    const activeSaveIdx = computeActiveSaveIdx(buffer, BAG_SECTOR_IDS);

    for (let secIdx = 0; secIdx < totalSectors; secIdx += 1) {
        const secOff = secIdx * SECTION_SIZE;
        const sectId = ru16(buffer, secOff + OFF_ID);
        const saveIdx = ru32(buffer, secOff + OFF_SAVE_IDX);

        if (!BAG_SECTOR_IDS.has(sectId) || saveIdx <= 0) {
            continue;
        }

        for (let rel = 0; rel < OFF_VALID_LEN - 3; rel += 2) {
            const absOff = secOff + rel;
            [false, true].forEach((swapped) => {
                const [iid, qty] = decodeSlot(buffer, absOff, swapped);
                if (iid !== itemId || qty <= 0 || !isPlausibleSlot(iid, qty)) {
                    return;
                }

                const bounds = extractPocketBounds(buffer, absOff, swapped);
                if (!bounds) {
                    return;
                }

                const [pStart, pEnd, nonZeroCount, slotCount, dupCount] = bounds;
                if (nonZeroCount <= 0 || slotCount < 2) {
                    return;
                }

                const quality = classifyPocketQuality(nonZeroCount, dupCount, slotCount);
                if (quality === 'reject') {
                    return;
                }

                const candidate = {
                    offset: pStart,
                    qty,
                    sector: secIdx,
                    sect_id: sectId,
                    save_idx: saveIdx,
                    pocket_end: pEnd,
                    pocket_nonzero: nonZeroCount,
                    pocket_slots: slotCount,
                    pocket_dups: dupCount,
                    encoding_swapped: swapped,
                    score: scorePocket(nonZeroCount, dupCount, slotCount),
                    quality,
                };

                if (quality === 'strict') {
                    strictCandidates.push(candidate);
                } else {
                    mediumCandidates.push(candidate);
                }
            });
        }
    }

    strictCandidates.push(...scanGlobalIdSetCandidates(buffer, itemId, activeSaveIdx, BALL_ITEM_IDS, 500, 4));
    strictCandidates.push(...scanGlobalIdSetCandidates(buffer, itemId, activeSaveIdx, BERRY_ITEM_IDS, 450, 8));
    strictCandidates.push(...scanGlobalIdSetCandidates(buffer, itemId, activeSaveIdx, TMHM_ITEM_IDS, 480, 12));

    let out = [...strictCandidates, ...mediumCandidates];

    if (out.length === 0) {
        if (BALL_ITEM_IDS.has(itemId)) {
            out = scanGlobalIdSetPockets(buffer, activeSaveIdx, BALL_ITEM_IDS, 500, 4);
        } else if (BERRY_ITEM_IDS.has(itemId)) {
            out = scanGlobalIdSetPockets(buffer, activeSaveIdx, BERRY_ITEM_IDS, 450, 8);
        } else if (TM_ITEM_IDS.has(itemId)) {
            out = scanGlobalIdSetPockets(buffer, activeSaveIdx, TMHM_ITEM_IDS, 480, 12);
        }
    }

    if (out.length === 0) {
        return [];
    }

    const bestByPocket = new Map();
    out.forEach((c) => {
        const key = `${c.save_idx}:${c.sect_id}:${c.offset}:${c.encoding_swapped ? 1 : 0}`;
        const prev = bestByPocket.get(key);
        if (!prev) {
            bestByPocket.set(key, c);
            return;
        }

        const prevRank = prev.quality === 'strict' ? 2 : 1;
        const currRank = c.quality === 'strict' ? 2 : 1;
        const prevScore = [prevRank, prev.score, prev.pocket_nonzero];
        const currScore = [currRank, c.score, c.pocket_nonzero];

        if (
            currScore[0] > prevScore[0] ||
            (currScore[0] === prevScore[0] && currScore[1] > prevScore[1]) ||
            (currScore[0] === prevScore[0] && currScore[1] === prevScore[1] && currScore[2] > prevScore[2])
        ) {
            bestByPocket.set(key, c);
            return;
        }

        if (
            prevRank === 1 && currRank === 1 &&
            prev.score < 0 && c.score < 0 &&
            c.offset < prev.offset
        ) {
            bestByPocket.set(key, c);
        }
    });

    out = Array.from(bestByPocket.values()).sort((a, b) => a.save_idx - b.save_idx || a.sect_id - b.sect_id || a.offset - b.offset);

    const collapsed = [];
    out.forEach((cand) => {
        const twinIdx = collapsed.findIndex((prev) => (
            prev.save_idx === cand.save_idx &&
            prev.sect_id === cand.sect_id &&
            Math.abs(prev.offset - cand.offset) <= 2 &&
            Math.abs(prev.pocket_end - cand.pocket_end) <= 2
        ));

        if (twinIdx < 0) {
            collapsed.push(cand);
            return;
        }

        const prev = collapsed[twinIdx];
        const prevRank = prev.quality === 'strict' ? 2 : 1;
        const candRank = cand.quality === 'strict' ? 2 : 1;

        if (prevRank === 1 && candRank === 1 && prev.score < 0 && cand.score < 0) {
            if (cand.offset < prev.offset) {
                collapsed[twinIdx] = cand;
            }
            return;
        }

        const prevKey = [prevRank, prev.score, -prev.offset];
        const candKey = [candRank, cand.score, -cand.offset];
        if (
            candKey[0] > prevKey[0] ||
            (candKey[0] === prevKey[0] && candKey[1] > prevKey[1]) ||
            (candKey[0] === prevKey[0] && candKey[1] === prevKey[1] && candKey[2] > prevKey[2])
        ) {
            collapsed[twinIdx] = cand;
        }
    });

    out = collapsed;

    function filterFamilyBest(list) {
        const strict = list.filter((c) => c.quality === 'strict');
        if (strict.length === 0) {
            return list;
        }
        const maxSlots = Math.max(...strict.map((c) => c.pocket_slots || 0));
        if (maxSlots < 1) {
            return list;
        }
        const bestSlots = strict.filter((c) => (c.pocket_slots || 0) === maxSlots);
        const maxIdx = Math.max(...bestSlots.map((c) => c.save_idx));
        return bestSlots.filter((c) => c.save_idx === maxIdx);
    }

    if (BALL_ITEM_IDS.has(itemId)) {
        const strictBall = out.filter((c) => c.quality === 'strict');
        if (strictBall.length > 0 && Math.max(...strictBall.map((c) => c.pocket_slots || 0)) >= 8) {
            out = filterFamilyBest(out);
        }
    }
    if (BERRY_ITEM_IDS.has(itemId)) {
        const strictBerry = out.filter((c) => c.quality === 'strict');
        if (strictBerry.length > 0 && Math.max(...strictBerry.map((c) => c.pocket_slots || 0)) >= 12) {
            out = filterFamilyBest(out);
        }
    }
    if (TM_ITEM_IDS.has(itemId)) {
        const strictTm = out.filter((c) => c.quality === 'strict');
        if (strictTm.length > 0 && Math.max(...strictTm.map((c) => c.pocket_slots || 0)) >= 20) {
            out = filterFamilyBest(out);
        }
    }

    out.sort((a, b) => (
        b.save_idx - a.save_idx ||
        (a.quality === 'strict' ? 0 : 1) - (b.quality === 'strict' ? 0 : 1) ||
        b.score - a.score ||
        a.sect_id - b.sect_id ||
        a.sector - b.sector ||
        a.offset - b.offset
    ));

    return out;
}

export function mapPocketFromAnchor(buffer, anchorOffset, itemNameById) {
    const [swapped, bounds] = bestPocketForAnchor(buffer, anchorOffset);
    if (!bounds) {
        return [];
    }

    const swappedFlag = !!swapped;
    const [startAbs, endAbs] = bounds;
    const items = [];

    let curr = startAbs;
    while (curr < endAbs) {
        const [iid, iqty] = decodeSlot(buffer, curr, swappedFlag);
        if (iid === 0 || !isPlausibleSlot(iid, iqty)) {
            break;
        }
        items.push({
            id: iid,
            qty: iqty,
            offset: curr,
            name: itemNameById.get(iid) || `Item ${iid}`,
            encoding: swappedFlag ? 'qty_id' : 'id_qty',
        });
        curr += 4;
    }

    let empties = 0;
    const sectorStart = Math.floor(startAbs / SECTION_SIZE) * SECTION_SIZE;
    const sectorEnd = sectorStart + OFF_VALID_LEN;
    while (curr + 3 < sectorEnd && empties < 3) {
        const [iid] = decodeSlot(buffer, curr, swappedFlag);
        if (iid !== 0) {
            break;
        }
        items.push({
            id: 0,
            qty: 0,
            offset: curr,
            name: '--- EMPTY ---',
            encoding: swappedFlag ? 'qty_id' : 'id_qty',
        });
        empties += 1;
        curr += 4;
    }

    return items;
}

function candidateFromAnchor(buffer, anchorOffset) {
    const items = mapPocketFromAnchor(buffer, anchorOffset, new Map());
    if (items.length === 0) {
        return [null, []];
    }

    const nonZero = items.filter((it) => it.id !== 0);
    if (nonZero.length === 0) {
        return [null, items];
    }

    const slotCount = nonZero.length;
    const dupCount = Math.max(0, slotCount - new Set(nonZero.map((it) => it.id)).size);
    const score = scorePocket(slotCount, dupCount, slotCount);
    const quality = classifyPocketQuality(slotCount, dupCount, slotCount);

    const secIdx = Math.floor(anchorOffset / SECTION_SIZE);
    const secOff = secIdx * SECTION_SIZE;
    const sectId = ru16(buffer, secOff + OFF_ID);
    const saveIdx = ru32(buffer, secOff + OFF_SAVE_IDX);

    return [{
        offset: anchorOffset,
        qty: nonZero[0].qty,
        sector: secIdx,
        sect_id: sectId,
        save_idx: saveIdx,
        pocket_end: nonZero[nonZero.length - 1].offset + 4,
        pocket_nonzero: slotCount,
        pocket_slots: slotCount,
        pocket_dups: dupCount,
        encoding_swapped: nonZero[0].encoding === 'qty_id',
        score,
        quality,
    }, items];
}

function slotFamilyStats(items, validSet) {
    const nonZero = items.filter((it) => it.id !== 0);
    if (nonZero.length === 0) {
        return [0, 0];
    }
    const familyHits = nonZero.filter((it) => validSet.has(it.id)).length;
    return [nonZero.length, familyHits];
}

function resolveFamilyPocket(buffer, pocketType, knownAnchor, probeItemId, validSet, minSlots) {
    const [candidate, items] = candidateFromAnchor(buffer, knownAnchor);
    if (candidate && candidate.quality !== 'reject') {
        const [slotCount, familyHits] = slotFamilyStats(items, validSet);
        if (slotCount >= minSlots && familyHits >= Math.max(minSlots - 2, Math.floor(slotCount * 0.7))) {
            const purity = slotCount > 0 ? familyHits / slotCount : 0;
            return {
                pocket_type: pocketType,
                anchor_offset: knownAnchor,
                quality: candidate.quality,
                score: candidate.score,
                slot_count: candidate.pocket_slots,
                dup_count: candidate.pocket_dups,
                family_purity: Number(purity.toFixed(3)),
                source: 'validated_static',
                confidence: 'high',
                detection_note: `static anchor validated with strong family purity (${Math.round(purity * 100)}%)`,
            };
        }

        if (slotCount > 0) {
            const purity = familyHits / slotCount;
            const sparseFloor = Math.max(4, Math.floor(minSlots / 3));
            if (slotCount >= sparseFloor && purity >= 0.9) {
                return {
                    pocket_type: pocketType,
                    anchor_offset: knownAnchor,
                    quality: candidate.quality,
                    score: candidate.score,
                    slot_count: candidate.pocket_slots,
                    dup_count: candidate.pocket_dups,
                    family_purity: Number(purity.toFixed(3)),
                    source: 'validated_sparse',
                    confidence: slotCount >= Math.floor(minSlots / 2) ? 'medium' : 'low',
                    detection_note: `sparse pocket accepted: ${slotCount} slots, family purity ${Math.round(purity * 100)}%`,
                };
            }
        }
    }

    const scanned = scanForItemCandidates(buffer, probeItemId);
    if (scanned.length > 0) {
        const top = scanned[0];
        return {
            pocket_type: pocketType,
            anchor_offset: top.offset,
            quality: top.quality,
            score: top.score,
            slot_count: top.pocket_slots,
            dup_count: top.pocket_dups,
            source: 'scan_fallback',
            confidence: top.quality === 'strict' ? 'high' : 'medium',
            detection_note: `found by probing item id ${probeItemId}`,
        };
    }

    const activeSaveIdx = computeActiveSaveIdx(buffer, BAG_SECTOR_IDS);
    const sparseFloor = Math.max(4, Math.floor(minSlots / 3));
    let scoreBonus = 500;
    if (pocketType === 'berry') {
        scoreBonus = 450;
    } else if (pocketType === 'tm') {
        scoreBonus = 480;
    }

    const sparseScan = scanGlobalIdSetPockets(buffer, activeSaveIdx, validSet, scoreBonus, sparseFloor);
    if (sparseScan.length > 0) {
        const top = sparseScan[0];
        return {
            pocket_type: pocketType,
            anchor_offset: top.offset,
            quality: top.quality,
            score: top.score,
            slot_count: top.pocket_slots,
            dup_count: top.pocket_dups,
            family_purity: 1,
            source: 'scan_sparse',
            confidence: (top.pocket_slots || 0) >= Math.floor(minSlots / 2) ? 'medium' : 'low',
            detection_note: `sparse global scan matched ${top.pocket_slots || 0} family slots`,
        };
    }

    return null;
}

function resolveMainPocket(buffer) {
    let best = null;
    let bestProbe = null;

    for (const probeItemId of MAIN_POCKET_PROBE_IDS) {
        const top = pickBestCandidate(scanForItemCandidates(buffer, probeItemId));
        if (!top) {
            continue;
        }
        if (top.quality === 'strict' && (top.pocket_slots || 0) >= 6) {
            best = top;
            bestProbe = probeItemId;
            break;
        }
        if (!best) {
            best = top;
            bestProbe = probeItemId;
            continue;
        }
        const resolved = pickBestCandidate([best, top]);
        if (resolved === top) {
            bestProbe = probeItemId;
        }
        best = resolved;
    }

    if (!best) {
        return null;
    }

    return {
        pocket_type: 'main',
        anchor_offset: best.offset,
        quality: best.quality,
        score: best.score,
        slot_count: best.pocket_slots,
        dup_count: best.pocket_dups,
        source: `scan_probe:${bestProbe}`,
        confidence: best.quality === 'strict' ? 'high' : 'medium',
        detection_note: `main pocket resolved with probe item id ${bestProbe}`,
    };
}

export function resolveQuickPockets(buffer) {
    if (!buffer || buffer.length === 0) {
        return {};
    }

    const quick = {};
    quick.main = resolveMainPocket(buffer);

    quick.ball = resolveFamilyPocket(buffer, 'ball', KNOWN_POCKET_ANCHORS.ball, 4, BALL_ITEM_IDS, 8);
    quick.berry = resolveFamilyPocket(buffer, 'berry', KNOWN_POCKET_ANCHORS.berry, 149, BERRY_ITEM_IDS, 12);
    quick.tm = resolveFamilyPocket(buffer, 'tm', KNOWN_POCKET_ANCHORS.tm, 307, TMHM_ITEM_IDS, 20);

    return quick;
}

export function writeSlot(buffer, offset, itemId, quantity, encoding = null) {
    let writeEncoding = encoding;
    if (writeEncoding !== 'id_qty' && writeEncoding !== 'qty_id') {
        const [swapped] = bestPocketForAnchor(buffer, offset);
        writeEncoding = swapped ? 'qty_id' : 'id_qty';
    }

    let qty = quantity;
    if (TMHM_ITEM_IDS.has(itemId) && qty <= 0) {
        qty = 1;
    }

    if (writeEncoding === 'qty_id') {
        wu16(buffer, offset, qty);
        wu16(buffer, offset + 2, itemId);
    } else {
        wu16(buffer, offset, itemId);
        wu16(buffer, offset + 2, qty);
    }
}

export function formatScanResults(rawCandidates, searchItemId) {
    if (!rawCandidates || rawCandidates.length === 0) {
        return { results: [] };
    }

    const maxIdx = Math.max(...rawCandidates.map((c) => c.save_idx));
    const pocketType = pocketTypeForItemId(searchItemId);

    return {
        results: rawCandidates.map((c) => ({
            anchor_offset: c.offset,
            sector: c.sector,
            sect_id: c.sect_id,
            save_idx: c.save_idx,
            is_active: c.save_idx === maxIdx,
            is_main_pocket: c.sect_id === UNBOUND_ITEM_SECTOR_ID,
            quality: c.quality,
            score: c.score,
            slot_count: c.pocket_slots,
            dup_count: c.pocket_dups,
            pocket_type: pocketType,
        })),
    };
}
