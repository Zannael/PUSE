import { DEFAULT_PROFILE_ID, getProfile, chooseProfile, activateProfile } from './profile.js';

const session = {
    saveBuffer: null,
    profileId: null,
    originalBuffer: null,
    filename: null,
    dirty: false,
    bagDirty: false,
    pcContext: null,
};

function assertLoaded() {
    if (!session.saveBuffer) {
        throw new Error('No save loaded');
    }
}

function cloneBuffer(buffer) {
    return new Uint8Array(buffer);
}

function buffersEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

export async function loadFile(file, profileId = null) {
    if (!file) {
        throw new Error('Missing file');
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const chosen = chooseProfile(bytes, profileId);
    await activateProfile(chosen);
    session.profileId = chosen;
    session.saveBuffer = bytes;
    session.originalBuffer = cloneBuffer(bytes);
    session.filename = file.name || 'edited_save.sav';
    session.dirty = false;
    session.bagDirty = false;
    session.pcContext = null;
    return { filename: session.filename, size: bytes.length };
}

export function hasLoadedSave() {
    return !!session.saveBuffer;
}

export function getBuffer() {
    assertLoaded();
    return session.saveBuffer;
}

export function getOriginalBuffer() {
    assertLoaded();
    return session.originalBuffer;
}

export function setBuffer(nextBuffer, { dirty = true, preservePcContext = false } = {}) {
    if (!(nextBuffer instanceof Uint8Array)) {
        throw new Error('setBuffer expects Uint8Array');
    }
    session.profileId = getProfile(session.profileId ?? DEFAULT_PROFILE_ID).id;
    session.saveBuffer = nextBuffer;
    if (dirty) {
        session.dirty = true;
    }
    if (!preservePcContext) {
        session.pcContext = null;
    }
}

export function updateBuffer(mutator, { dirty = true, preservePcContext = false } = {}) {
    assertLoaded();
    const working = cloneBuffer(session.saveBuffer);
    mutator(working);
    setBuffer(working, { dirty, preservePcContext });
    return working;
}

export function setBagDirty(flag) {
    session.bagDirty = Boolean(flag);
}

export function getFilename() {
    assertLoaded();
    return session.filename || 'edited_save.sav';
}

export function exportBlob() {
    assertLoaded();
    return new Blob([session.saveBuffer], { type: 'application/octet-stream' });
}

export function getSessionSnapshot() {
    const hasSave = !!session.saveBuffer;
    return {
        filename: session.filename,
        dirty: session.dirty,
        bag_dirty: session.bagDirty,
        has_changes_from_original: hasSave ? !buffersEqual(session.saveBuffer, session.originalBuffer) : false,
        size: session.saveBuffer ? session.saveBuffer.length : 0,
        hasSave,
        has_save: hasSave,
    };
}

export function getPcContext() {
    return session.pcContext;
}

export function setPcContext(pcContext) {
    session.pcContext = pcContext;
}

export function clearPcContext() {
    session.pcContext = null;
}

export function getSessionProfile() {
    assertLoaded();
    return getProfile(session.profileId);
}
