import { ru32, wu32 } from './binary.js';
import { recalculateTrainerChecksum } from './checksum.js';
import { findActiveSectionById, findSectionsById } from './sections.js';

const TRAINER_SECTION_ID = 1;
const FALLBACK_OFF_MONEY = 0x290;

function toBcd3(value) {
    const padded = String(Math.max(0, value)).padStart(6, '0').slice(-6);
    const b0 = (Number(padded[1]) << 4) | Number(padded[0]);
    const b1 = (Number(padded[3]) << 4) | Number(padded[2]);
    const b2 = (Number(padded[5]) << 4) | Number(padded[4]);
    return [b0, b1, b2];
}

export function readMoney(buffer) {
    const section = findActiveSectionById(buffer, TRAINER_SECTION_ID);
    if (!section) {
        throw new Error('Trainer section not found');
    }

    return ru32(buffer, section.off + FALLBACK_OFF_MONEY);
}

export function updateMoney(buffer, amount) {
    const trainerSections = findSectionsById(buffer, TRAINER_SECTION_ID);
    if (trainerSections.length === 0) {
        throw new Error('Trainer sections not found');
    }

    const safeAmount = Math.max(0, Number(amount) || 0);
    const bcd = toBcd3(safeAmount);

    trainerSections.forEach((section) => {
        const moneyOffset = section.off + FALLBACK_OFF_MONEY;
        const bcdOffset = moneyOffset - 3;

        wu32(buffer, moneyOffset, safeAmount);
        buffer[bcdOffset] = bcd[0];
        buffer[bcdOffset + 1] = bcd[1];
        buffer[bcdOffset + 2] = bcd[2];
        recalculateTrainerChecksum(buffer, section.off);
    });

    return safeAmount;
}
