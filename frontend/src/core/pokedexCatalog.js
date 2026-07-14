import pokedexSpeciesMap from './pokedexSpeciesMap.json' with { type: 'json' };

export const MAX_TRACKED_DEX_ID = pokedexSpeciesMap.max_dex_id;

export function dexIdForSpeciesId(speciesId) {
    const sid = Number(speciesId);
    if (!Number.isInteger(sid)) {
        return null;
    }
    return Number(pokedexSpeciesMap.species_to_dex[String(sid)]) || null;
}

export function buildPokedexSpeciesGroups(speciesRows) {
    const groups = new Map();
    (speciesRows || [])
        .map((row) => ({
            ...row,
            id: Number(row.id),
        }))
        .filter((row) => Number.isInteger(row.id) && row.id > 0)
        .forEach((row) => {
            const dexId = dexIdForSpeciesId(row.id);
            if (dexId === null) return;
            const rows = groups.get(dexId) || [];
            rows.push({ ...row, internal_species_id: row.id });
            groups.set(dexId, rows);
        });
    groups.forEach((rows) => rows.sort((a, b) => a.internal_species_id - b.internal_species_id));
    return groups;
}
