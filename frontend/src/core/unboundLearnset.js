import speciesLearnsetsPayload from './species_learnsets.json' with { type: 'json' };
import speciesAbilitiesMeta from './speciesAbilitiesMeta.json' with { type: 'json' };
import speciesTypes from './species_types.json' with { type: 'json' };
import speciesBaseStats from './speciesBaseStats.json' with { type: 'json' };

const learnsetsBySpeciesId = speciesLearnsetsPayload?.learnsets || {};

export function getSpeciesLearnsetEntry(speciesId) {
    const key = String(speciesId);
    return learnsetsBySpeciesId[key] || null;
}

export function getSpeciesDexSummary(speciesId) {
    const key = String(speciesId);
    const types = speciesTypes[key] || null;
    const stats = speciesBaseStats[key] || null;
    const abilities = speciesAbilitiesMeta[key] || null;
    const learnset = getSpeciesLearnsetEntry(speciesId);

    return {
        types,
        stats,
        abilities,
        learnset,
        learnsetLoaded: Boolean(learnset),
    };
}

export function isMoveLegalForSpecies(speciesId, moveId) {
    const move = Number(moveId);
    if (!Number.isFinite(move) || move <= 0) {
        return true;
    }
    const entry = getSpeciesLearnsetEntry(speciesId);
    if (!entry || !Array.isArray(entry.all)) {
        return null;
    }
    return entry.all.includes(move);
}

export function validatePokemonLegitSet({
    speciesId,
    moves = [],
    currentAbilityIndex = 0,
    abilityNames = {},
    moveNameById,
}) {
    const issues = [];
    const warnings = [];
    const entry = getSpeciesLearnsetEntry(speciesId);

    if (!entry) {
        warnings.push('Learnset data is unavailable for this species. Move checks were skipped.');
    } else {
        const legalMoves = new Set(entry.all || []);
        moves.forEach((moveId, index) => {
            const id = Number(moveId);
            if (!Number.isFinite(id) || id <= 0) {
                return;
            }
            if (!legalMoves.has(id)) {
                const moveName = moveNameById?.get?.(id) || `Move ${id}`;
                issues.push(`Move ${index + 1} (${moveName}) is not in the Unbound learnset for this species.`);
            }
        });
    }

    const abilityMeta = speciesAbilitiesMeta[String(speciesId)];
    if (abilityMeta) {
        const selected = Number(currentAbilityIndex);
        const slotId = selected === 2
            ? Number(abilityMeta.hidden_ability_id || 0)
            : selected === 1
                ? Number(abilityMeta.ability_2_id || 0)
                : Number(abilityMeta.ability_1_id || 0);

        if (!slotId) {
            const slotLabel = selected === 2 ? 'Hidden ability' : `Ability slot ${selected + 1}`;
            issues.push(`${slotLabel} is not available for this species in Unbound.`);
        } else if (abilityNames?.current) {
            const allowedIds = [
                Number(abilityMeta.ability_1_id || 0),
                Number(abilityMeta.ability_2_id || 0),
                Number(abilityMeta.hidden_ability_id || 0),
            ].filter((id) => id > 0);
            const currentId = Number(abilityNames.currentId || 0);
            if (currentId > 0 && !allowedIds.includes(currentId)) {
                issues.push(`Ability (${abilityNames.current}) is not valid for this species in Unbound.`);
            }
        }
    }

    return { issues, warnings };
}

export function classifyKnownEggMoves(mon, moveNameById) {
    const entry = getSpeciesLearnsetEntry(mon?.species_id);
    if (!entry || !Array.isArray(entry.egg) || entry.egg.length === 0) {
        return [];
    }
    const eggIds = new Set(entry.egg.map((id) => Number(id)));
    return (mon?.moves || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0 && eggIds.has(id))
        .map((id) => moveNameById.get(id) || `Move ${id}`)
        .filter(Boolean);
}

export function formatLearnsetBucket(moveIds, moveNameById, limit = 12) {
    const names = (moveIds || [])
        .map((id) => moveNameById?.get?.(Number(id)) || `Move ${id}`)
        .filter(Boolean);
    if (names.length <= limit) {
        return names.join(', ');
    }
    const visible = names.slice(0, limit).join(', ');
    return `${visible}, +${names.length - limit} more`;
}
