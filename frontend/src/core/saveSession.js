const session = {
    saveBuffer: null,
    filename: null,
    dirty: false,
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

export async function loadFile(file) {
    if (!file) {
        throw new Error('Missing file');
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    session.saveBuffer = bytes;
    session.filename = file.name || 'edited_save.sav';
    session.dirty = false;
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

export function setBuffer(nextBuffer, { dirty = true } = {}) {
    if (!(nextBuffer instanceof Uint8Array)) {
        throw new Error('setBuffer expects Uint8Array');
    }
    session.saveBuffer = nextBuffer;
    if (dirty) {
        session.dirty = true;
    }
}

export function updateBuffer(mutator) {
    assertLoaded();
    const working = cloneBuffer(session.saveBuffer);
    mutator(working);
    setBuffer(working, { dirty: true });
    return working;
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
    return {
        filename: session.filename,
        dirty: session.dirty,
        size: session.saveBuffer ? session.saveBuffer.length : 0,
        hasSave: !!session.saveBuffer,
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
