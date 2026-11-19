import { ru32 } from './binary.js';

export function gbaChecksum(buffer, offset, length) {
    const safeLength = Math.max(0, length);
    const fullWordsLength = safeLength - (safeLength % 4);
    let total = 0;

    for (let i = 0; i < fullWordsLength; i += 4) {
        total = (total + ru32(buffer, offset + i)) >>> 0;
    }

    if (safeLength % 4 !== 0) {
        const tail = [0, 0, 0, 0];
        for (let i = 0; i < safeLength % 4; i += 1) {
            tail[i] = buffer[offset + fullWordsLength + i];
        }
        const tailWord =
            tail[0] |
            (tail[1] << 8) |
            (tail[2] << 16) |
            (tail[3] << 24);
        total = (total + (tailWord >>> 0)) >>> 0;
    }

    return (((total >>> 16) + (total & 0xFFFF)) & 0xFFFF) >>> 0;
}
