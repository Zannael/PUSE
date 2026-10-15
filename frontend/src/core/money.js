import { PROFILE } from './profile.js';
import { ru16, ru32, wu16, wu32 } from './binary.js';
import { recalculateTrainerChecksum } from './checksum.js';
import { findActiveSectionById, activeSections } from './sections.js';

const TRAINER_SECTION_ID = PROFILE.storage.resources.trainer_section_id;
const FALLBACK_OFF_MONEY = PROFILE.storage.resources.money_offset;
const BP_SECTION_ID = PROFILE.storage.resources.bp_section_id;
const BP_OFFSET_IN_SECTION = PROFILE.storage.resources.bp_offset;
const MAX_MONEY = PROFILE.rules.money_max;
const MAX_BP = PROFILE.rules.bp_max;

function toBcd3(value) {
    if (value > 999999) {
        return null;
    }
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
    const trainerSections = activeSections(buffer).filter((sec) => sec.id === TRAINER_SECTION_ID);
    if (trainerSections.length === 0) {
        throw new Error('Trainer sections not found');
    }

    const safeAmount = Math.max(0, Math.min(MAX_MONEY, Number(amount) || 0));
    const bcd = toBcd3(safeAmount);

    trainerSections.forEach((section) => {
        const moneyOffset = section.off + FALLBACK_OFF_MONEY;
        const bcdOffset = moneyOffset - 3;

        wu32(buffer, moneyOffset, safeAmount);
        if (bcd) {
            buffer[bcdOffset] = bcd[0];
            buffer[bcdOffset + 1] = bcd[1];
            buffer[bcdOffset + 2] = bcd[2];
        }
        recalculateTrainerChecksum(buffer, section.off);
    });

    return safeAmount;
}

export function readBp(buffer) {
    const section = findActiveSectionById(buffer, BP_SECTION_ID);
    if (!section) {
        throw new Error('Battle Points section not found');
    }

    return ru16(buffer, section.off + BP_OFFSET_IN_SECTION);
}

export function updateBp(buffer, amount) {
    const section = findActiveSectionById(buffer, BP_SECTION_ID);
    if (!section) {
        throw new Error('Battle Points section not found');
    }

    const safeAmount = Math.max(0, Math.min(MAX_BP, Number(amount) || 0));
    wu16(buffer, section.off + BP_OFFSET_IN_SECTION, safeAmount);
    return safeAmount;
}
