function ensureBounds(buffer, offset, size) {
    if (!(buffer instanceof Uint8Array)) {
        throw new Error('Expected Uint8Array buffer');
    }
    if (offset < 0 || offset + size > buffer.length) {
        throw new Error(`Out of bounds read/write at offset ${offset}`);
    }
}

function makeView(buffer) {
    return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

export function ru8(buffer, offset) {
    ensureBounds(buffer, offset, 1);
    return makeView(buffer).getUint8(offset);
}

export function ru16(buffer, offset) {
    ensureBounds(buffer, offset, 2);
    return makeView(buffer).getUint16(offset, true);
}

export function ru32(buffer, offset) {
    ensureBounds(buffer, offset, 4);
    return makeView(buffer).getUint32(offset, true);
}

export function wu8(buffer, offset, value) {
    ensureBounds(buffer, offset, 1);
    makeView(buffer).setUint8(offset, value & 0xFF);
}

export function wu16(buffer, offset, value) {
    ensureBounds(buffer, offset, 2);
    makeView(buffer).setUint16(offset, value & 0xFFFF, true);
}

export function wu32(buffer, offset, value) {
    ensureBounds(buffer, offset, 4);
    makeView(buffer).setUint32(offset, value >>> 0, true);
}
