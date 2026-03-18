import speciesFormAliases from './speciesFormAliases.json' with { type: 'json' };

export function buildSpeciesFormMeta(speciesById) {
    const byName = new Map();

    speciesById.forEach((name, id) => {
        const key = String(name || '').trim().toLowerCase();
        if (!key) {
            return;
        }
        if (!byName.has(key)) {
            byName.set(key, []);
        }
        byName.get(key).push(id);
    });

    byName.forEach((ids) => ids.sort((a, b) => a - b));

    const metaById = new Map();
    speciesById.forEach((name, id) => {
        const key = String(name || '').trim().toLowerCase();
        const ids = byName.get(key) || [id];
        const variantCount = ids.length;
        const variantIndex = Math.max(1, ids.indexOf(id) + 1);
        const isFormVariant = variantCount > 1;
        const displayName = name || 'Unknown';

        const aliasMeta = speciesFormAliases?.[String(id)];
        const aliasLabel =
            aliasMeta && aliasMeta.confidence === 'high' && aliasMeta.alias
                ? `${displayName} (${aliasMeta.alias})`
                : null;
        const label = aliasLabel || (isFormVariant ? `${displayName} (Form ${variantIndex})` : displayName);

        metaById.set(id, {
            species_display_name: displayName,
            species_label: label,
            species_variant_index: variantIndex,
            species_variant_count: variantCount,
            is_form_variant: isFormVariant,
        });
    });

    return metaById;
}

export function getSpeciesFormMeta(metaById, speciesById, speciesId) {
    const sid = Number(speciesId);
    if (metaById?.has(sid)) {
        return metaById.get(sid);
    }
    const fallbackName = speciesById.get(sid) || 'Unknown';
    return {
        species_display_name: fallbackName,
        species_label: fallbackName,
        species_variant_index: 1,
        species_variant_count: 1,
        is_form_variant: false,
    };
}
