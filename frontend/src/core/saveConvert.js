const SAVE_BODY_LEN = 0x20000;
const SAVE_WITH_TRAILER_LEN = 0x20010;
const RTC_TRAILER_LEN = 0x10;

export function normalizeTargetExt(targetExt) {
    const raw = String(targetExt || '').trim().toLowerCase();
    const ext = raw.startsWith('.') ? raw : `.${raw}`;
    if (ext !== '.sav' && ext !== '.srm') {
        throw new Error('targetExt must be .sav or .srm');
    }
    return ext;
}

export function convertSaveBytes(input, targetExt) {
    const ext = normalizeTargetExt(targetExt);
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

    if (bytes.length !== SAVE_BODY_LEN && bytes.length !== SAVE_WITH_TRAILER_LEN) {
        throw new Error(`Unsupported save size: ${bytes.length} bytes. Expected ${SAVE_BODY_LEN} or ${SAVE_WITH_TRAILER_LEN}.`);
    }

    if (ext === '.srm') {
        return bytes.length === SAVE_WITH_TRAILER_LEN ? bytes.slice(0, SAVE_BODY_LEN) : new Uint8Array(bytes);
    }

    if (bytes.length === SAVE_BODY_LEN) {
        const out = new Uint8Array(SAVE_WITH_TRAILER_LEN);
        out.set(bytes, 0);
        return out;
    }

    return new Uint8Array(bytes);
}

export function buildConvertedFileName(fileName, targetExt) {
    const ext = normalizeTargetExt(targetExt);
    const base = String(fileName || 'save').replace(/\.[^.]+$/, '');
    return `${base}${ext}`;
}
