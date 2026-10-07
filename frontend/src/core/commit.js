import { recalculateBagChecksums, recalculateTrainerChecksum } from './checksum.js';
import { applyPcContextToSave } from './pc.js';
import { activeSections } from './sections.js';
import { fixPartyMonChecksums } from './party.js';

const TRAINER_SECTION_ID = 1;

export function saveAll(buffer, pcContext = null) {
    const sections = activeSections(buffer);
    // Fix stale per-mon checksums before section checksum is computed.
    fixPartyMonChecksums(buffer);

    sections
        .filter((section) => section.id === TRAINER_SECTION_ID)
        .forEach((section) => recalculateTrainerChecksum(buffer, section.off));

    recalculateBagChecksums(buffer, sections);

    applyPcContextToSave(buffer, pcContext);

    return buffer;
}
