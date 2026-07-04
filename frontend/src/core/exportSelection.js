export const EXPORT_MODE = {
    FULL: 'full',
    PARTY: 'party',
    SELECTION: 'selection',
};

export function partySelectionKey(index) {
    return `party:${Number(index)}`;
}

export function pcSelectionKey(box, slot) {
    return `pc:${Number(box)}:${Number(slot)}`;
}

export function parseSelectionKey(key) {
    const text = String(key || '');
    if (text.startsWith('party:')) {
        const index = Number(text.slice(6));
        return Number.isFinite(index) ? { source: 'party', index } : null;
    }
    if (text.startsWith('pc:')) {
        const parts = text.slice(3).split(':');
        const box = Number(parts[0]);
        const slot = Number(parts[1]);
        if (!Number.isFinite(box) || !Number.isFinite(slot)) {
            return null;
        }
        return { source: 'pc', box, slot };
    }
    return null;
}

export function isSelectionKeyActive(selection, key) {
    if (!Array.isArray(selection)) {
        return false;
    }
    return selection.includes(key);
}

export function toggleSelectionKey(selection, key) {
    const list = Array.isArray(selection) ? selection : [];
    if (list.includes(key)) {
        return list.filter((entry) => entry !== key);
    }
    return [...list, key];
}

export function addPcBoxToSelection(selection, boxId, pokemon = []) {
    const list = Array.isArray(selection) ? [...selection] : [];
    const existing = new Set(list);
    pokemon.forEach((mon) => {
        const slot = Number(mon?.slot);
        if (!Number.isFinite(slot) || slot <= 0) {
            return;
        }
        const key = pcSelectionKey(boxId, slot);
        if (!existing.has(key)) {
            existing.add(key);
            list.push(key);
        }
    });
    return list;
}

export function filterPartyBySelection(party = [], selection = []) {
    const keys = new Set(selection);
    return party.filter((mon) => keys.has(partySelectionKey(mon.index)));
}

export function filterPcBySelection(pc = [], selection = []) {
    const keys = new Set(selection);
    return pc.filter((entry) => keys.has(pcSelectionKey(entry.box, entry.slot)));
}

export function summarizeSelection(selection = []) {
    let party = 0;
    let pc = 0;
    selection.forEach((key) => {
        const parsed = parseSelectionKey(key);
        if (!parsed) {
            return;
        }
        if (parsed.source === 'party') {
            party += 1;
        } else {
            pc += 1;
        }
    });
    return {
        total: party + pc,
        party,
        pc,
    };
}
