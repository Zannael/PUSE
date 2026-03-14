import { recalculateBagChecksums, recalculateTrainerChecksum } from './checksum.js';
import { applyPcContextToSave } from './pc.js';
import { listSections } from './sections.js';

const TRAINER_SECTION_ID = 1;

export function saveAll(buffer, pcContext = null) {
    const sections = listSections(buffer);

    sections
        .filter((section) => section.id === TRAINER_SECTION_ID)
        .forEach((section) => recalculateTrainerChecksum(buffer, section.off));

    recalculateBagChecksums(buffer, sections);

    applyPcContextToSave(buffer, pcContext);

    return buffer;
}
