const API_BASE = import.meta.env.VITE_API_BASE_URL;
import {
    resolveItemIconUrl,
    resolvePokemonIconUrl,
} from '../core/iconResolver.js';
import { saveAll as commitSaveAll } from '../core/commit.js';
import { getAbilitiesList, getItemsList, getMovesList, getSpeciesFormMetaMap, getSpeciesList, getSpeciesMap, loadCatalog } from '../core/catalog.js';
import {
    formatScanResults,
    mapPocketFromAnchor,
    resolveQuickPockets,
    scanForItemCandidates,
    writeSlot,
} from '../core/bag.js';
import { readMoney, updateMoney as patchMoney } from '../core/money.js';
import {
    getParty as readParty,
    updatePartyAbilitySwitch as patchPartyAbilitySwitch,
    updatePartyEvs as patchPartyEvs,
    updatePartyItem as patchPartyItem,
    updatePartyIdentity as patchPartyIdentity,
    updatePartyIvs as patchPartyIvs,
    updatePartyLevel as patchPartyLevel,
    updatePartyMoves as patchPartyMoves,
    updatePartyNature as patchPartyNature,
    updatePartyNickname as patchPartyNickname,
    updatePartySpecies as patchPartySpecies,
} from '../core/party.js';
import {
    clearPcContext,
    exportBlob,
    getBuffer,
    getFilename,
    getPcContext,
    loadFile,
    setPcContext,
    updateBuffer,
} from '../core/saveSession.js';
import { editPcMonFull, getPcBox as readPcBox, loadPcContext } from '../core/pc.js';

const MODE_STORAGE_KEY = "runtime_mode";

export const RUNTIME_MODES = {
    backend: "backend",
    local: "local",
};

function normalizeRuntimeMode(mode) {
    if (!mode) {
        return null;
    }

    const normalized = String(mode).toLowerCase();
    if (normalized === RUNTIME_MODES.backend || normalized === RUNTIME_MODES.local) {
        return normalized;
    }

    return null;
}

export function getInitialRuntimeMode() {
    const fromStorage = normalizeRuntimeMode(window.localStorage.getItem(MODE_STORAGE_KEY));
    if (fromStorage) {
        return fromStorage;
    }

    const fromEnv = normalizeRuntimeMode(import.meta.env.VITE_RUNTIME_MODE);
    return fromEnv || RUNTIME_MODES.backend;
}

export function persistRuntimeMode(mode) {
    const normalized = normalizeRuntimeMode(mode);
    if (!normalized) {
        return;
    }
    window.localStorage.setItem(MODE_STORAGE_KEY, normalized);
}

async function backendJson(path, options = undefined) {
    const res = await fetch(`${API_BASE}${path}`, options);
    if (!res.ok) {
        throw new Error(`Backend request failed: ${path}`);
    }
    return res.json();
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

let itemNameMapCache = null;

async function getItemNameMap() {
    if (itemNameMapCache) {
        return itemNameMapCache;
    }
    const items = await getItemsList();
    itemNameMapCache = new Map(items.map((it) => [it.id, it.name]));
    return itemNameMapCache;
}

async function ensureValidSpeciesId(speciesId) {
    const nextId = Number(speciesId);
    const speciesMap = await getSpeciesMap();
    if (!Number.isInteger(nextId) || nextId <= 0 || !speciesMap.has(nextId)) {
        throw new Error('Invalid species_id');
    }
    return nextId;
}

const backendClient = {
    getPokemonIconUrl(speciesId) {
        return resolvePokemonIconUrl(speciesId, API_BASE);
    },
    getItemIconUrl(itemId) {
        return resolveItemIconUrl(itemId, API_BASE);
    },
    async uploadSave(file) {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
        if (!res.ok) {
            throw new Error("Upload failed");
        }
        return res.json();
    },
    getMoney() {
        return backendJson("/money");
    },
    async updateMoney(amount) {
        const res = await fetch(`${API_BASE}/money/update?amount=${amount}`, { method: "POST" });
        if (!res.ok) {
            throw new Error("Money update failed");
        }
        return res.json();
    },
    downloadSave() {
        window.location.href = `${API_BASE}/download`;
    },
    getParty() {
        return backendJson("/party");
    },
    async updatePartyIvs(index, payload) {
        await backendJson(`/party/${index}/ivs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },
    async updatePartyEvs(index, payload) {
        await backendJson(`/party/${index}/evs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },
    async updatePartyMoves(index, payload) {
        await backendJson(`/party/${index}/moves`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },
    async updatePartyAbilitySwitch(index, payload) {
        await backendJson(`/party/${index}/ability-switch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },
    async updatePartyNature(index, payload) {
        await backendJson(`/party/${index}/nature`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },
    async updatePartyLevel(index, payload) {
        await backendJson(`/party/${index}/level`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },
    async updatePartyItem(index, payload) {
        await backendJson(`/party/${index}/item`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },
    async updatePartyIdentity(index, payload) {
        await backendJson(`/party/${index}/identity`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },
    async updatePartyNickname(index, payload) {
        await backendJson(`/party/${index}/nickname`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },
    async updatePartySpecies(index, payload) {
        await backendJson(`/party/${index}/species`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },
    loadPc() {
        return backendJson("/pc/load");
    },
    getPcBox(boxId) {
        return backendJson(`/pc/box/${boxId}`);
    },
    editPcFull(payload) {
        return backendJson("/pc/edit-full", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },
    getMoves() {
        return backendJson("/moves");
    },
    getAbilities() {
        return backendJson("/abilities");
    },
    getItems() {
        return backendJson("/items");
    },
    getSpecies() {
        return backendJson("/species");
    },
    scanBag(searchId) {
        return backendJson(`/bag/scan/${searchId}`);
    },
    getBagPocket(anchorOffset) {
        return backendJson(`/bag/pocket?anchor_offset=${anchorOffset}&_ts=${Date.now()}`, { cache: "no-store" });
    },
    updateBagItem(payload) {
        return backendJson("/bag/item/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },
    getBagPocketsBootstrap() {
        return backendJson("/bag/pockets/bootstrap");
    },
    saveAll() {
        return backendJson("/save-all", { method: "POST" });
    },
};

const localClient = {
    getPokemonIconUrl(speciesId) {
        return resolvePokemonIconUrl(speciesId, API_BASE);
    },
    getItemIconUrl(itemId) {
        return resolveItemIconUrl(itemId, API_BASE);
    },
    uploadSave(file) {
        itemNameMapCache = null;
        clearPcContext();
        return Promise.all([loadFile(file), loadCatalog()]);
    },
    getMoney() {
        const money = readMoney(getBuffer());
        return Promise.resolve({ money });
    },
    updateMoney(amount) {
        const newMoney = updateBuffer((next) => patchMoney(next, amount));
        return Promise.resolve({
            message: `Money updated to ${readMoney(newMoney)}`,
            new_money: readMoney(newMoney),
        });
    },
    downloadSave() {
        downloadBlob(exportBlob(), getFilename());
    },
    getParty() {
        return Promise.all([getSpeciesMap(), getSpeciesFormMetaMap()]).then(([speciesMap, speciesMeta]) =>
            readParty(getBuffer(), speciesMap, speciesMeta)
        );
    },
    updatePartyIvs(index, payload) {
        updateBuffer((next) => patchPartyIvs(next, Number(index), payload || {}));
        return Promise.resolve({ status: 'IVs updated in memory' });
    },
    updatePartyEvs(index, payload) {
        updateBuffer((next) => patchPartyEvs(next, Number(index), payload || {}));
        return Promise.resolve({ status: 'EVs updated in memory' });
    },
    updatePartyMoves(index, payload) {
        updateBuffer((next) => patchPartyMoves(next, Number(index), payload || {}));
        return Promise.resolve({ status: 'Moves updated in memory' });
    },
    updatePartyAbilitySwitch(index, payload) {
        updateBuffer((next) => patchPartyAbilitySwitch(next, Number(index), payload || {}));
        return Promise.resolve({ status: 'Ability updated in memory' });
    },
    updatePartyNature(index, payload) {
        updateBuffer((next) => patchPartyNature(next, Number(index), payload || {}));
        return Promise.resolve({ status: 'Nature updated in memory' });
    },
    updatePartyLevel(index, payload) {
        updateBuffer((next) => patchPartyLevel(next, Number(index), payload || {}));
        return Promise.resolve({ status: 'Level updated in memory' });
    },
    updatePartyItem(index, payload) {
        updateBuffer((next) => patchPartyItem(next, Number(index), payload || {}));
        return Promise.resolve({ status: 'Item updated in memory' });
    },
    updatePartyIdentity(index, payload) {
        updateBuffer((next) => patchPartyIdentity(next, Number(index), payload || {}));
        return Promise.resolve({ status: 'Identity updated in memory' });
    },
    updatePartyNickname(index, payload) {
        updateBuffer((next) => patchPartyNickname(next, Number(index), payload || {}));
        return Promise.resolve({ status: 'Nickname updated in memory' });
    },
    async updatePartySpecies(index, payload) {
        const speciesId = await ensureValidSpeciesId(payload?.species_id);
        updateBuffer((next) => patchPartySpecies(next, Number(index), { species_id: speciesId }));
        return Promise.resolve({ status: 'Species updated in memory' });
    },
    loadPc() {
        const context = loadPcContext(getBuffer());
        setPcContext(context);
        return Promise.resolve({ message: 'PC loaded' });
    },
    async getPcBox(boxId) {
        let context = getPcContext();
        if (!context) {
            context = loadPcContext(getBuffer());
            setPcContext(context);
        }
        const [speciesMap, speciesMeta] = await Promise.all([getSpeciesMap(), getSpeciesFormMetaMap()]);
        return readPcBox(context, Number(boxId), speciesMap, speciesMeta);
    },
    async editPcFull(payload) {
        let context = getPcContext();
        if (!context) {
            context = loadPcContext(getBuffer());
            setPcContext(context);
        }
        const nextPayload = { ...(payload || {}) };
        if (nextPayload.species_id !== undefined && nextPayload.species_id !== null) {
            nextPayload.species_id = await ensureValidSpeciesId(nextPayload.species_id);
        }
        editPcMonFull(context, nextPayload);
        return Promise.resolve({ status: 'PC edit buffered' });
    },
    getMoves() {
        return getMovesList();
    },
    getAbilities() {
        return getAbilitiesList();
    },
    getItems() {
        return getItemsList();
    },
    getSpecies() {
        return getSpeciesList();
    },
    scanBag(searchId) {
        const candidates = scanForItemCandidates(getBuffer(), Number(searchId));
        return Promise.resolve(formatScanResults(candidates, Number(searchId)));
    },
    async getBagPocket(anchorOffset) {
        const itemNames = await getItemNameMap();
        return mapPocketFromAnchor(getBuffer(), Number(anchorOffset), itemNames);
    },
    updateBagItem(payload) {
        updateBuffer((next) => {
            writeSlot(
                next,
                Number(payload.offset),
                Number(payload.item_id),
                Number(payload.quantity),
                payload.encoding || null,
            );
        });
        return Promise.resolve({ status: 'Bag slot updated' });
    },
    getBagPocketsBootstrap() {
        return Promise.resolve({ pockets: resolveQuickPockets(getBuffer()) });
    },
    saveAll() {
        updateBuffer((next) => {
            commitSaveAll(next, getPcContext());
        });
        return Promise.resolve({ message: 'Save completed' });
    },
};

export function createApiClient(mode) {
    return mode === RUNTIME_MODES.local ? localClient : backendClient;
}
