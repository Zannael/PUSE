import speciesAbilitiesMeta from './speciesAbilitiesMeta.json' with { type: 'json' };
import abilitiesCatalog from './abilitiesCatalog.json' with { type: 'json' };

const ABILITY_DISPLAY_ALIASES = {
    'Water Compact': 'Water Compaction',
};

const abilityNameById = new Map(
    Object.entries(abilitiesCatalog).map(([id, name]) => [Number(id), name]),
);

export function normalizeAbilityToken(name) {
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function formatAbilityDisplayName(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
        return '';
    }
    return ABILITY_DISPLAY_ALIASES[trimmed] || trimmed;
}

function getSlotAbilityId(meta, slotIndex) {
    const slot = Number(slotIndex);
    if (slot === 2) {
        return Number(meta.hidden_ability_id || 0) || 0;
    }
    if (slot === 1) {
        return Number(meta.ability_2_id || 0) || 0;
    }
    return Number(meta.ability_1_id || 0) || 0;
}

function resolveAbilitySlotIndex(meta, abilityName, currentAbilityIndex) {
    const index = Number(currentAbilityIndex);
    if (index === 0 || index === 1 || index === 2) {
        if (getSlotAbilityId(meta, index) > 0) {
            return index;
        }
    }

    const token = normalizeAbilityToken(abilityName);
    for (const slot of [0, 1, 2]) {
        const abilityId = getSlotAbilityId(meta, slot);
        if (abilityId > 0 && normalizeAbilityToken(abilityNameById.get(abilityId)) === token) {
            return slot;
        }
    }
    return 0;
}

export function abilityIdPreservedOnEvolution(
    speciesId,
    finalSpeciesId,
    currentAbilityName,
    currentAbilityIndex,
) {
    const currentMeta = speciesAbilitiesMeta[String(speciesId)];
    const finalMeta = speciesAbilitiesMeta[String(finalSpeciesId)];
    if (!currentMeta || !finalMeta || !currentAbilityName) {
        return false;
    }

    const slot = resolveAbilitySlotIndex(currentMeta, currentAbilityName, currentAbilityIndex);
    const currentId = getSlotAbilityId(currentMeta, slot);
    const finalId = getSlotAbilityId(finalMeta, slot);
    return currentId > 0 && finalId > 0 && currentId === finalId;
}

export function resolveEvolutionAbilityArrow(entry, speciesId, {
    currentAbilityName,
    currentAbilityIndex,
} = {}) {
    const abilityFrom = String(currentAbilityName || '').trim() || String(entry?.current_ability || '').trim();
    if (!abilityFrom || !entry?.final_species_id) {
        return null;
    }

    const preserved = abilityIdPreservedOnEvolution(
        speciesId,
        entry.final_species_id,
        abilityFrom,
        currentAbilityIndex,
    );
    const from = formatAbilityDisplayName(abilityFrom);
    const to = formatAbilityDisplayName(entry.final_ability || '');

    if (preserved && !(entry.ability_changes_on_evo && to && normalizeAbilityToken(from) !== normalizeAbilityToken(to))) {
        return null;
    }

    if (entry.ability_changes_on_evo && to && normalizeAbilityToken(from) !== normalizeAbilityToken(to)) {
        return `${from}→${to}`;
    }

    return null;
}
