// Read-only projection; the backend implementation in modules/roster_export.py is canonical.
export const ROSTER_FORMAT = 'puse.roster';
export const ROSTER_VERSION = 1;
const STATS = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];

function stats(values = {}) {
    return Object.fromEntries(STATS.map((key) => [key, Number(values?.[key] ?? (key === 'Spe' ? values?.Spd : 0) ?? 0)]));
}

export function buildRoster(rows, selectedPcKeys, itemNames = new Map(), moveNames = new Map()) {
    const selected = new Set(selectedPcKeys);
    const pokemon = [];
    for (const row of rows) {
        if (Number(row.species_id) <= 0) continue;
        let location;
        if (row.source === 'party') {
            location = { source: 'party', index: Number(row.partyIndex) };
        } else if (row.source === 'pc') {
            if (Number(row.slot) < 1 || Number(row.slot) > 30 || !selected.has(row.rosterKey)) continue;
            location = { source: 'pc', box: Number(row.box), slot: Number(row.slot) };
        } else continue;
        const speciesId = Number(row.species_id);
        const itemId = Number(row.item_id) || 0;
        pokemon.push({
            location,
            species: { id: speciesId, name: row.species_label || row.species_name || `Species #${speciesId}` },
            nickname: row.nickname || '',
            level: Number(row.level) || 0,
            nature: { id: Number(row.nature_id) || 0, name: row.nature || '' },
            shiny: Boolean(row.is_shiny),
            gender: row.gender || 'Unknown',
            ability: { id: Number(row.effective_ability_id) || 0, name: row.ability_name_current || row.effective_ability_name || '', slot: Number(row.current_ability_index) || 0 },
            held_item: { id: itemId, name: itemId ? (itemNames.get(itemId) || `Item #${itemId}`) : 'None' },
            ivs: stats(row.ivs),
            evs: stats(row.evs),
            moves: (row.moves || []).flatMap((id, index) => Number(id) > 0 ? [{
                id: Number(id), name: moveNames.get(Number(id)) || `Move #${id}`,
                pp: Number(row.move_pp?.[index]) || 0,
                pp_ups: Number(row.move_pp_ups?.[index]) || 0,
                pp_max: Number(row.move_pp_max?.[index]) || 0,
            }] : []),
        });
    }
    return { format: ROSTER_FORMAT, version: ROSTER_VERSION, game: 'Pokemon Unbound 2.1.1.1', pokemon };
}

function cell(value) {
    return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('\r', ' ');
}

function place(location) {
    if (location.source === 'party') return `Party ${location.index + 1}`;
    return `${location.box === 26 ? 'Preset' : `Box ${location.box}`} · ${location.slot}`;
}

export function rosterMarkdown(roster) {
    const lines = ['# PUSE roster', '', `Pokemon Unbound 2.1.1.1 · ${roster.pokemon.length} Pokémon`, '',
        '| Location | Pokémon | Level | Nature | Ability | Held item | Shiny |',
        '| --- | --- | ---: | --- | --- | --- | --- |'];
    for (const mon of roster.pokemon) {
        let name = mon.nickname || mon.species.name;
        if (name !== mon.species.name) name += ` (${mon.species.name})`;
        lines.push(`| ${[place(mon.location), name, mon.level, mon.nature.name, mon.ability.name, mon.held_item.name, mon.shiny ? 'Yes' : 'No'].map(cell).join(' | ')} |`);
    }
    lines.push('');
    for (const mon of roster.pokemon) {
        lines.push(`## ${mon.nickname || mon.species.name} — ${place(mon.location)}`, '',
            `Species: ${mon.species.name} (#${mon.species.id}) · Gender: ${mon.gender}`, '',
            `IVs: ${STATS.map((key) => `${key} ${mon.ivs[key]}`).join(', ')}`, '',
            `EVs: ${STATS.map((key) => `${key} ${mon.evs[key]}`).join(', ')}`, '',
            `Moves: ${mon.moves.map((move) => move.name).join(', ') || 'None'}`, '');
    }
    return `${lines.join('\n').trimEnd()}\n`;
}
