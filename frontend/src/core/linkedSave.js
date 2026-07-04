const SAV_FILE_TYPES = [
    {
        description: 'Pokémon save files',
        accept: {
            'application/octet-stream': ['.sav', '.srm'],
        },
    },
];

let linkedHandle = null;

function normalizeFeatureFlag(value) {
    if (value === undefined || value === null || value === '') {
        return false;
    }
    const normalized = String(value).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isLinkedSaveEnabled() {
    return normalizeFeatureFlag(import.meta.env.VITE_FEATURE_LINKED_SAVE);
}

export function isLinkedSaveActive() {
    return Boolean(linkedHandle);
}

export function getLinkedHandle() {
    return linkedHandle;
}

export function clearLinkedSave() {
    linkedHandle = null;
}

export function getLinkedSaveMeta() {
    if (!linkedHandle) {
        return { linked: false, name: null, lastModified: null };
    }
    return {
        linked: true,
        name: linkedHandle.name || null,
        lastModified: null,
    };
}

export async function linkSaveFile() {
    if (!isLinkedSaveEnabled()) {
        throw new Error('Linked save is not enabled in this build');
    }
    if (!window.showOpenFilePicker) {
        throw new Error('This browser does not support linked save (File System Access API unavailable)');
    }

    const [handle] = await window.showOpenFilePicker({
        mode: 'readwrite',
        types: SAV_FILE_TYPES,
        multiple: false,
    });

    linkedHandle = handle;
    return getLinkedSaveMeta();
}

export async function readLinkedFile() {
    if (!linkedHandle) {
        throw new Error('No linked save file');
    }
    return linkedHandle.getFile();
}

export async function writeLinkedFile(bytes) {
    if (!linkedHandle) {
        throw new Error('No linked save file');
    }
    if (!(bytes instanceof Uint8Array)) {
        throw new Error('writeLinkedFile expects Uint8Array');
    }

    const writable = await linkedHandle.createWritable();
    await writable.write(bytes);
    await writable.close();
}
