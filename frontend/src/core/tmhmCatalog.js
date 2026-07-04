const TM_ITEM_ID_BY_NUMBER = (tmNum) => (tmNum <= 58 ? 288 + tmNum : 316 + tmNum);

function normalizeMoveName(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function buildMoveNameLookup(moveNameById) {
    const lookup = new Map();
    if (!(moveNameById instanceof Map)) {
        return lookup;
    }
    moveNameById.forEach((name, moveId) => {
        const normalized = normalizeMoveName(name);
        if (normalized) {
            lookup.set(normalized, Number(moveId));
        }
    });
    return lookup;
}

export function parseTmsTextToMoveItemMap(tmsText, moveNameById) {
    const moveToItemIds = new Map();
    const moveNameLookup = buildMoveNameLookup(moveNameById);

    String(tmsText || '').split(/\r?\n/).forEach((line) => {
        const match = line.trim().match(/^TM(\d{1,3}):\s*(.+)$/i);
        if (!match) {
            return;
        }
        const tmNum = Number.parseInt(match[1], 10);
        if (!Number.isFinite(tmNum) || tmNum < 1) {
            return;
        }
        const moveLabel = match[2].split(' - ')[0].trim();
        const moveId = moveNameLookup.get(normalizeMoveName(moveLabel));
        if (!moveId) {
            return;
        }
        const itemId = TM_ITEM_ID_BY_NUMBER(tmNum);
        const bucket = moveToItemIds.get(moveId) || [];
        if (!bucket.includes(itemId)) {
            bucket.push(itemId);
        }
        moveToItemIds.set(moveId, bucket);
    });

    return moveToItemIds;
}

let cachedMoveToItemIds = null;
let cachedMoveNameByIdRef = null;

export async function getMoveToTmhmItemIds(moveNameById) {
    if (cachedMoveToItemIds && cachedMoveNameByIdRef === moveNameById) {
        return cachedMoveToItemIds;
    }
    const res = await fetch(`${import.meta.env.BASE_URL}data/tms.txt`);
    if (!res.ok) {
        throw new Error('Failed to load TM catalog');
    }
    const text = await res.text();
    cachedMoveToItemIds = parseTmsTextToMoveItemMap(text, moveNameById);
    cachedMoveNameByIdRef = moveNameById;
    return cachedMoveToItemIds;
}

export function resetTmhmCatalogCacheForTests() {
    cachedMoveToItemIds = null;
    cachedMoveNameByIdRef = null;
}
