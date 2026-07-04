import speciesTypes from './species_types.json' with { type: 'json' };

const ROM_TYPE_LABEL_OVERRIDES = {
    'Unknown(23)': 'Fairy',
};

function resolveTypeLabel(typeName, { resolveFairy = false } = {}) {
    if (!typeName) {
        return null;
    }
    if (String(typeName).startsWith('Unknown')) {
        return resolveFairy ? (ROM_TYPE_LABEL_OVERRIDES[typeName] || null) : null;
    }
    return typeName;
}

export function getSpeciesTypeList(speciesId, { resolveFairy = false } = {}) {
    const entry = speciesTypes[String(speciesId)];
    if (!entry) {
        return [];
    }
    const rawTypes = entry.types?.length
        ? entry.types
        : [entry.type1, entry.type2].filter(Boolean);
    const unknownOnly = rawTypes.length > 0
        && rawTypes.every((typeName) => String(typeName).startsWith('Unknown'));
    const effectiveResolveFairy = resolveFairy || unknownOnly;
    return [...new Set(
        rawTypes
            .map((typeName) => resolveTypeLabel(typeName, { resolveFairy: effectiveResolveFairy }))
            .filter(Boolean),
    )];
}

export function formatSpeciesTypeLine(speciesId, { resolveFairy = false } = {}) {
    const types = getSpeciesTypeList(speciesId, { resolveFairy });
    return types.length ? types.join('/') : null;
}
