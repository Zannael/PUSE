const API_BASE = import.meta.env.VITE_API_BASE_URL;
import {
    resolveItemIconUrl,
    resolvePokemonIconUrl,
} from '../core/iconResolver.js';

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
let localCoreModulesPromise = null;

async function getLocalCoreModules() {
    if (!localCoreModulesPromise) {
        localCoreModulesPromise = Promise.all([
            import('../core/catalog.js'),
            import('../core/party.js'),
            import('../core/saveSession.js'),
            import('../core/pc.js'),
            import('../core/bag.js'),
            import('../core/money.js'),
            import('../core/commit.js'),
        ]).then(([catalog, party, saveSession, pc, bag, money, commit]) => ({
            ...catalog,
            ...party,
            ...saveSession,
            ...pc,
            ...bag,
            ...money,
            ...commit,
        }));
    }
    return localCoreModulesPromise;
}

async function getItemNameMap() {
    if (itemNameMapCache) {
        return itemNameMapCache;
    }
    const { getItemsList } = await getLocalCoreModules();
    const items = await getItemsList();
    itemNameMapCache = new Map(items.map((it) => [it.id, it.name]));
    return itemNameMapCache;
}

async function ensureValidSpeciesId(speciesId) {
    const nextId = Number(speciesId);
    const { getSpeciesMap } = await getLocalCoreModules();
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
    insertPc(payload) {
        return backendJson('/pc/insert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
    async uploadSave(file) {
        const { clearPcContext, loadFile, loadCatalog } = await getLocalCoreModules();
        itemNameMapCache = null;
        clearPcContext();
        await Promise.all([loadFile(file), loadCatalog()]);
    },
    async getMoney() {
        const { readMoney, getBuffer } = await getLocalCoreModules();
        const money = readMoney(getBuffer());
        return { money };
    },
    async updateMoney(amount) {
        const { updateBuffer, readMoney, updateMoney: patchMoney } = await getLocalCoreModules();
        const newMoney = updateBuffer((next) => patchMoney(next, amount));
        return {
            message: `Money updated to ${readMoney(newMoney)}`,
            new_money: readMoney(newMoney),
        };
    },
    async downloadSave() {
        const { exportBlob, getFilename } = await getLocalCoreModules();
        downloadBlob(exportBlob(), getFilename());
    },
    async getParty() {
        const { getSpeciesMap, getSpeciesFormMetaMap, getParty: readParty, getBuffer } = await getLocalCoreModules();
        return Promise.all([getSpeciesMap(), getSpeciesFormMetaMap()]).then(([speciesMap, speciesMeta]) =>
            readParty(getBuffer(), speciesMap, speciesMeta)
        );
    },
    async updatePartyIvs(index, payload) {
        const { updateBuffer, updatePartyIvs: patchPartyIvs } = await getLocalCoreModules();
        updateBuffer((next) => patchPartyIvs(next, Number(index), payload || {}));
        return { status: 'IVs updated in memory' };
    },
    async updatePartyEvs(index, payload) {
        const { updateBuffer, updatePartyEvs: patchPartyEvs } = await getLocalCoreModules();
        updateBuffer((next) => patchPartyEvs(next, Number(index), payload || {}));
        return { status: 'EVs updated in memory' };
    },
    async updatePartyMoves(index, payload) {
        const { updateBuffer, updatePartyMoves: patchPartyMoves } = await getLocalCoreModules();
        updateBuffer((next) => patchPartyMoves(next, Number(index), payload || {}));
        return { status: 'Moves updated in memory' };
    },
    async updatePartyAbilitySwitch(index, payload) {
        const { updateBuffer, updatePartyAbilitySwitch: patchPartyAbilitySwitch } = await getLocalCoreModules();
        updateBuffer((next) => patchPartyAbilitySwitch(next, Number(index), payload || {}));
        return { status: 'Ability updated in memory' };
    },
    async updatePartyNature(index, payload) {
        const { updateBuffer, updatePartyNature: patchPartyNature } = await getLocalCoreModules();
        updateBuffer((next) => patchPartyNature(next, Number(index), payload || {}));
        return { status: 'Nature updated in memory' };
    },
    async updatePartyLevel(index, payload) {
        const { updateBuffer, updatePartyLevel: patchPartyLevel } = await getLocalCoreModules();
        updateBuffer((next) => patchPartyLevel(next, Number(index), payload || {}));
        return { status: 'Level updated in memory' };
    },
    async updatePartyItem(index, payload) {
        const { updateBuffer, updatePartyItem: patchPartyItem } = await getLocalCoreModules();
        updateBuffer((next) => patchPartyItem(next, Number(index), payload || {}));
        return { status: 'Item updated in memory' };
    },
    async updatePartyIdentity(index, payload) {
        const { updateBuffer, updatePartyIdentity: patchPartyIdentity } = await getLocalCoreModules();
        updateBuffer((next) => patchPartyIdentity(next, Number(index), payload || {}));
        return { status: 'Identity updated in memory' };
    },
    async updatePartyNickname(index, payload) {
        const { updateBuffer, updatePartyNickname: patchPartyNickname } = await getLocalCoreModules();
        updateBuffer((next) => patchPartyNickname(next, Number(index), payload || {}));
        return { status: 'Nickname updated in memory' };
    },
    async updatePartySpecies(index, payload) {
        const { updateBuffer, updatePartySpecies: patchPartySpecies } = await getLocalCoreModules();
        const speciesId = await ensureValidSpeciesId(payload?.species_id);
        updateBuffer((next) => patchPartySpecies(next, Number(index), { species_id: speciesId }));
        return { status: 'Species updated in memory' };
    },
    async loadPc() {
        const { getBuffer, loadPcContext, setPcContext } = await getLocalCoreModules();
        const context = loadPcContext(getBuffer());
        setPcContext(context);
        return { message: 'PC loaded' };
    },
    async getPcBox(boxId) {
        const {
            getPcContext,
            loadPcContext,
            setPcContext,
            getBuffer,
            getSpeciesMap,
            getSpeciesFormMetaMap,
            getPcBox: readPcBox,
        } = await getLocalCoreModules();
        let context = getPcContext();
        if (!context) {
            context = loadPcContext(getBuffer());
            setPcContext(context);
        }
        const [speciesMap, speciesMeta] = await Promise.all([getSpeciesMap(), getSpeciesFormMetaMap()]);
        return readPcBox(context, Number(boxId), speciesMap, speciesMeta);
    },
    async editPcFull(payload) {
        const {
            getPcContext,
            loadPcContext,
            setPcContext,
            getBuffer,
            editPcMonFull,
        } = await getLocalCoreModules();
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
        return { status: 'PC edit buffered' };
    },
    async insertPc(payload) {
        const {
            getPcContext,
            loadPcContext,
            setPcContext,
            getBuffer,
            getSpeciesMap,
            insertPcMon,
        } = await getLocalCoreModules();
        let context = getPcContext();
        if (!context) {
            context = loadPcContext(getBuffer());
            setPcContext(context);
        }
        const speciesMap = await getSpeciesMap();
        const nextPayload = { ...(payload || {}) };
        nextPayload.species_id = await ensureValidSpeciesId(nextPayload.species_id);
        return insertPcMon(context, nextPayload, speciesMap);
    },
    async getMoves() {
        const { getMovesList } = await getLocalCoreModules();
        return getMovesList();
    },
    async getAbilities() {
        const { getAbilitiesList } = await getLocalCoreModules();
        return getAbilitiesList();
    },
    async getItems() {
        const { getItemsList } = await getLocalCoreModules();
        return getItemsList();
    },
    async getSpecies() {
        const { getSpeciesList } = await getLocalCoreModules();
        return getSpeciesList();
    },
    async scanBag(searchId) {
        const { getBuffer, scanForItemCandidates, formatScanResults } = await getLocalCoreModules();
        const candidates = scanForItemCandidates(getBuffer(), Number(searchId));
        return formatScanResults(candidates, Number(searchId));
    },
    async getBagPocket(anchorOffset) {
        const { getBuffer, mapPocketFromAnchor } = await getLocalCoreModules();
        const itemNames = await getItemNameMap();
        return mapPocketFromAnchor(getBuffer(), Number(anchorOffset), itemNames);
    },
    async updateBagItem(payload) {
        const { updateBuffer, writeSlot } = await getLocalCoreModules();
        updateBuffer((next) => {
            writeSlot(
                next,
                Number(payload.offset),
                Number(payload.item_id),
                Number(payload.quantity),
                payload.encoding || null,
            );
        });
        return { status: 'Bag slot updated' };
    },
    async getBagPocketsBootstrap() {
        const { resolveQuickPockets, getBuffer } = await getLocalCoreModules();
        return { pockets: resolveQuickPockets(getBuffer()) };
    },
    async saveAll() {
        const { updateBuffer, saveAll: commitSaveAll, getPcContext } = await getLocalCoreModules();
        updateBuffer((next) => {
            commitSaveAll(next, getPcContext());
        });
        return { message: 'Save completed' };
    },
};

export function createApiClient(mode) {
    return mode === RUNTIME_MODES.local ? localClient : backendClient;
}
