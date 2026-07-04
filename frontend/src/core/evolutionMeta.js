import evolutionPayload from './species_evolution_meta.json' with { type: 'json' };
import { resolveEvolutionAbilityArrow } from './abilityDisplay.js';
import { formatSpeciesTypeLine } from './speciesTypeFormat.js';

const ENTRIES = evolutionPayload?.entries || {};

function formatEvoRequirements(requirements) {
    if (!requirements) {
        return null;
    }
    return String(requirements).replace(/ \/ /g, ' → ');
}

function buildEvolutionTag(entry, speciesId, { currentAbilityName, currentAbilityIndex } = {}) {
    const finalName = entry.final_species_name;
    const finalBst = Number(entry.final_bst);
    if (!finalName || !Number.isFinite(finalBst)) {
        return null;
    }

    const inner = [`BST ${finalBst}`];
    const currentTypes = formatSpeciesTypeLine(speciesId);
    const finalTypes = formatSpeciesTypeLine(entry.final_species_id, { resolveFairy: true });
    if (finalTypes && finalTypes !== currentTypes) {
        inner.push(finalTypes);
    }
    if (Number.isFinite(entry.stage_index) && Number.isFinite(entry.stage_total)) {
        inner.push(`Stage ${entry.stage_index} of ${entry.stage_total}`);
    }
    if (entry.evo_requirements) {
        inner.push(formatEvoRequirements(entry.evo_requirements));
    }

    let tag = `→ [${finalName}] (${inner.join(', ')})`;

    const abilityArrow = resolveEvolutionAbilityArrow(entry, speciesId, {
        currentAbilityName,
        currentAbilityIndex,
    });
    if (abilityArrow) {
        tag += ` · Ability: ${abilityArrow}`;
    }

    if (entry.evo_gender === 'F') {
        tag += ' (♀ only)';
    } else if (entry.evo_gender === 'M') {
        tag += ' (♂ only)';
    }

    return tag;
}

export function getEvolutionExportInfo(speciesId, {
    currentAbilityName,
    currentAbilityIndex,
} = {}) {
    const entry = ENTRIES[String(speciesId)];
    if (!entry || entry.is_final_form) {
        return null;
    }

    const tag = buildEvolutionTag(entry, speciesId, { currentAbilityName, currentAbilityIndex });
    if (!tag) {
        return null;
    }

    return {
        final_species_id: entry.final_species_id,
        final_species_name: entry.final_species_name,
        final_bst: Number(entry.final_bst),
        stage_index: entry.stage_index ?? null,
        stage_total: entry.stage_total ?? null,
        evos_remaining: entry.evos_remaining ?? null,
        evo_requirements: entry.evo_requirements ?? null,
        ability_changes_on_evo: Boolean(entry.ability_changes_on_evo),
        current_ability: entry.current_ability ?? null,
        final_ability: entry.final_ability ?? null,
        tag,
    };
}
