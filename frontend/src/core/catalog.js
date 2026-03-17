import { buildSpeciesFormMeta, getSpeciesFormMeta } from './speciesForms.js';

const cache = {
    itemsById: null,
    movesById: null,
    abilitiesById: null,
    speciesById: null,
    speciesMetaById: null,
    loaded: false,
};

const DATA_BASE_URL = `${import.meta.env.BASE_URL}data`;

function parseIdNameText(content) {
    const map = new Map();
    content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            return;
        }
        const splitIdx = trimmed.indexOf(':');
        if (splitIdx <= 0) {
            return;
        }
        const id = Number.parseInt(trimmed.slice(0, splitIdx), 10);
        const name = trimmed.slice(splitIdx + 1).trim();
        if (!Number.isNaN(id) && name) {
            map.set(id, name);
        }
    });
    return map;
}

function applyTmOverlay(itemsById, tmsText) {
    tmsText.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('TM') || !trimmed.includes(':')) {
            return;
        }

        const [left, right] = trimmed.split(':', 2);
        const tag = left.trim().toUpperCase().replace(/\s+/g, '');
        const tmNum = Number.parseInt(tag.slice(2), 10);
        if (Number.isNaN(tmNum) || tmNum < 1 || tmNum > 120) {
            return;
        }

        const moveName = (right || '').trim();
        if (!moveName) {
            return;
        }

        const itemId = tmNum <= 58 ? 288 + tmNum : 316 + tmNum;
        itemsById.set(itemId, `TM${String(tmNum).padStart(3, '0')}: ${moveName}`);
    });
}

async function fetchText(path) {
    const res = await fetch(path);
    if (!res.ok) {
        throw new Error(`Failed to load catalog file: ${path}`);
    }
    return res.text();
}

export async function loadCatalog() {
    if (cache.loaded) {
        return;
    }

    const [itemsText, movesText, abilitiesText, pokemonText, tmsText] = await Promise.all([
        fetchText(`${DATA_BASE_URL}/items.txt`),
        fetchText(`${DATA_BASE_URL}/moves.txt`),
        fetchText(`${DATA_BASE_URL}/abilities.txt`),
        fetchText(`${DATA_BASE_URL}/pokemon.txt`),
        fetchText(`${DATA_BASE_URL}/tms.txt`),
    ]);

    cache.itemsById = parseIdNameText(itemsText);
    cache.movesById = parseIdNameText(movesText);
    cache.abilitiesById = parseIdNameText(abilitiesText);
    cache.speciesById = parseIdNameText(pokemonText);
    cache.speciesMetaById = buildSpeciesFormMeta(cache.speciesById);
    applyTmOverlay(cache.itemsById, tmsText);
    cache.loaded = true;
}

function ensureLoaded() {
    if (!cache.loaded) {
        throw new Error('Catalog not loaded');
    }
}

function mapToList(idMap, { includeZero = false } = {}) {
    const out = [];
    idMap.forEach((name, id) => {
        if (!includeZero && id === 0) {
            return;
        }
        out.push({ id, name });
    });
    out.sort((a, b) => a.id - b.id);
    return out;
}

export async function getItemsList() {
    if (!cache.loaded) {
        await loadCatalog();
    }
    ensureLoaded();
    return mapToList(cache.itemsById, { includeZero: false });
}

export async function getMovesList() {
    if (!cache.loaded) {
        await loadCatalog();
    }
    ensureLoaded();
    return mapToList(cache.movesById, { includeZero: true });
}

export async function getAbilitiesList() {
    if (!cache.loaded) {
        await loadCatalog();
    }
    ensureLoaded();
    return mapToList(cache.abilitiesById, { includeZero: false });
}

export async function getSpeciesList() {
    if (!cache.loaded) {
        await loadCatalog();
    }
    ensureLoaded();
    const base = mapToList(cache.speciesById, { includeZero: true });
    return base.map((entry) => {
        const meta = getSpeciesFormMeta(cache.speciesMetaById, cache.speciesById, entry.id);
        return {
            id: entry.id,
            name: entry.name,
            label: meta.species_label,
            display_name: meta.species_display_name,
            variant_index: meta.species_variant_index,
            variant_count: meta.species_variant_count,
            is_form_variant: meta.is_form_variant,
        };
    });
}

export async function getSpeciesMap() {
    if (!cache.loaded) {
        await loadCatalog();
    }
    ensureLoaded();
    return cache.speciesById;
}

export async function getSpeciesFormMetaMap() {
    if (!cache.loaded) {
        await loadCatalog();
    }
    ensureLoaded();
    return cache.speciesMetaById;
}
