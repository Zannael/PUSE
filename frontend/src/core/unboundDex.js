import speciesConstants from './species_constants.json' with { type: 'json' };

export const UNBOUND_DEX_BASE_URL = 'https://ydarissep.github.io/Unbound-Pokedex/';

export function buildUnboundDexSpeciesPageUrl(speciesId, speciesLabel) {
    const constant = speciesConstants[String(speciesId)];
    if (constant) {
        const params = new URLSearchParams({ species: constant });
        return `${UNBOUND_DEX_BASE_URL}?${params.toString()}`;
    }
    return buildUnboundDexSpeciesUrl(speciesLabel);
}

export function resolveDexSpeciesLabel(speciesRow, fallback = '') {
    return (
        speciesRow?.label
        || speciesRow?.display_name
        || speciesRow?.name
        || fallback
    );
}

export function buildUnboundDexSpeciesUrl(speciesLabel) {
    const label = String(speciesLabel || '').trim();
    if (!label) {
        return UNBOUND_DEX_BASE_URL;
    }
    const params = new URLSearchParams({
        input: label,
        table: 'speciesTable',
    });
    return `${UNBOUND_DEX_BASE_URL}?${params.toString()}`;
}

export function buildUnboundDexMoveFilterUrl(moveName) {
    const label = String(moveName || '').trim();
    if (!label) {
        return UNBOUND_DEX_BASE_URL;
    }
    const params = new URLSearchParams({
        table: 'speciesTable',
        filter: `Move:${label}`,
    });
    return `${UNBOUND_DEX_BASE_URL}?${params.toString()}`;
}
