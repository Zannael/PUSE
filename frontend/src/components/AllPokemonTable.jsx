import React, { useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { NATURES } from '../core/showdownImport.js';
import { POKEMON_ICON_FALLBACK_URL } from '../core/iconResolver.js';
import { ALL_POKEMON_BOXES } from '../services/allPokemon.js';
import { buildRoster, rosterMarkdown } from '../services/rosterExport.js';

const PAGE_SIZE = 100;
const STATS = [
    ['HP', 'HP'], ['Atk', 'Atk'], ['Def', 'Def'],
    ['SpA', 'SpA'], ['SpD', 'SpD'], ['Spe', 'Spe'],
];

function statValue(stats, key) {
    return stats?.[key] ?? (key === 'Spe' ? stats?.Spd : undefined) ?? '—';
}

function displayName(pokemon) {
    return pokemon.species_display_name || pokemon.species_label || pokemon.species_name || `Species ${pokemon.species_id}`;
}

function natureName(pokemon) {
    return pokemon.nature || NATURES[Number(pokemon.nature_id)] || 'Unknown';
}

function StatLine({ title, values }) {
    return (
        <div>
            <h4 className="mb-2 text-xs font-semibold text-slate-300">{title}</h4>
            <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {STATS.map(([key, label]) => (
                    <div key={key} className="border-l border-slate-600 pl-2">
                        <dt className="text-[11px] text-slate-400">{label}</dt>
                        <dd className="font-mono text-sm text-slate-100">{statValue(values, key)}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}

function Inspection({ pokemon, itemNames, moveNames }) {
    const itemId = Number(pokemon.item_id) || 0;
    const moves = (pokemon.moves || []).filter((id) => Number(id) > 0);
    return (
        <div className="border-t border-slate-700 bg-slate-900/70 px-4 py-5 sm:px-6" aria-label={`Details for ${pokemon.nickname || displayName(pokemon)}`}>
            <div className="mb-5 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-300">
                <span>Species: <strong className="text-slate-100">{displayName(pokemon)}</strong></span>
                <span>Gender: <strong className="text-slate-100">{pokemon.gender || 'Unknown'}</strong></span>
                <span>Hidden Power: <strong className="text-slate-100">{pokemon.hidden_power_type || 'Unknown'}</strong></span>
                <span>Held item: <strong className="text-slate-100">{itemId ? (itemNames.get(itemId) || `Item #${itemId}`) : 'None'}</strong></span>
            </div>
            <div className="grid gap-5 lg:grid-cols-3">
                <StatLine title="Battle stats" values={pokemon.battle_stats} />
                <StatLine title="IVs" values={pokemon.ivs} />
                <StatLine title="EVs" values={pokemon.evs} />
            </div>
            <div className="mt-5">
                <h4 className="mb-2 text-xs font-semibold text-slate-300">Moves</h4>
                <p className="text-sm text-slate-200">{moves.length ? moves.map((id) => moveNames.get(Number(id)) || `Move #${id}`).join(' · ') : 'None'}</p>
            </div>
        </div>
    );
}

function PokemonRow({ pokemon, expanded, onToggle, getPokemonIconUrl, itemNames, moveNames, selected, onSelect }) {
    const name = pokemon.nickname || displayName(pokemon);
    return (
        <div className="border-t border-slate-700/70 first:border-t-0" role="listitem">
            {pokemon.source === 'pc' && <label className="flex items-center gap-2 px-4 pt-2 text-xs text-slate-300 sm:px-6">
                <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Include ${name} in ${pokemon.location} in roster export`} className="accent-blue-500" /> Include in export
            </label>}
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-label={`${expanded ? 'Hide' : 'Inspect'} ${name} in ${pokemon.location}`}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400 sm:px-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_5rem_minmax(0,1fr)_minmax(0,1.4fr)] md:items-center ${expanded ? 'bg-blue-500/10' : 'hover:bg-slate-700/40'}`}
            >
                <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-slate-800">
                        <img src={getPokemonIconUrl(pokemon.species_id)} alt="" className="h-8 w-8 object-contain pixelated"
                            onError={(event) => {
                                if (event.currentTarget.src !== POKEMON_ICON_FALLBACK_URL) {
                                    event.currentTarget.src = POKEMON_ICON_FALLBACK_URL;
                                }
                            }} />
                    </span>
                    <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-100">{name}{pokemon.is_shiny ? <span className="ml-2 text-amber-300" aria-label="Shiny">✦</span> : null}</span>
                        <span className="block truncate text-xs text-slate-400">{displayName(pokemon)}</span>
                    </span>
                </span>
                <span className="text-right text-xs text-blue-200 md:text-left">{pokemon.location}</span>
                <span className="text-sm text-slate-300"><span className="text-slate-500 md:hidden">Level </span>{pokemon.level ?? '—'}</span>
                <span className="text-right text-sm text-slate-300 md:text-left">{natureName(pokemon)}</span>
                <span className="col-span-2 truncate text-xs text-slate-400 md:col-span-1">{pokemon.ability_name_current || pokemon.effective_ability_name || 'Unknown ability'}</span>
            </button>
            {expanded && <Inspection pokemon={pokemon} itemNames={itemNames} moveNames={moveNames} />}
        </div>
    );
}

export default function AllPokemonTable({ client }) {
    const [pokemon, setPokemon] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reload, setReload] = useState(0);
    const [query, setQuery] = useState('');
    const [source, setSource] = useState('all');
    const [box, setBox] = useState('all');
    const [shinyOnly, setShinyOnly] = useState(false);
    const [shown, setShown] = useState(PAGE_SIZE);
    const [inspectedKey, setInspectedKey] = useState(null);
    const [itemNames, setItemNames] = useState(new Map());
    const [moveNames, setMoveNames] = useState(new Map());
    const [selectedPcKeys, setSelectedPcKeys] = useState(new Set());

    useEffect(() => {
        let cancelled = false;
        client.getAllPokemon().then((rows) => {
            if (!cancelled) {
                setPokemon(rows);
                setSelectedPcKeys(new Set());
                setError('');
                setLoading(false);
            }
        }).catch(() => {
            if (!cancelled) {
                setError('Could not read the Party and PC boxes. Check the loaded save and try again.');
                setLoading(false);
            }
        });
        return () => { cancelled = true; };
    }, [client, reload]);

    useEffect(() => {
        let cancelled = false;
        Promise.allSettled([client.getItems(), client.getMoves()]).then(([items, moves]) => {
            if (cancelled) return;
            if (items.status === 'fulfilled') setItemNames(new Map(items.value.map((item) => [Number(item.id), item.name])));
            if (moves.status === 'fulfilled') setMoveNames(new Map(moves.value.map((move) => [Number(move.id), move.name])));
        });
        return () => { cancelled = true; };
    }, [client]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        return pokemon.filter((row) => {
            if (source !== 'all' && row.source !== source) return false;
            if (box !== 'all' && (row.source !== 'pc' || row.box !== Number(box))) return false;
            if (shinyOnly && !row.is_shiny) return false;
            return !needle || [row.nickname, displayName(row), row.location]
                .some((value) => String(value || '').toLocaleLowerCase().includes(needle));
        });
    }, [pokemon, query, source, box, shinyOnly]);

    const partyCount = pokemon.filter((row) => row.source === 'party').length;
    const resetPage = () => { setShown(PAGE_SIZE); setInspectedKey(null); };
    const visiblePcKeys = filtered.filter((row) => row.source === 'pc').map((row) => row.rosterKey);
    const selectedCount = pokemon.filter((row) => row.source === 'pc' && selectedPcKeys.has(row.rosterKey)).length;
    const downloadRoster = (kind) => {
        const roster = buildRoster(pokemon, selectedPcKeys, itemNames, moveNames);
        if (!roster.pokemon.length) return;
        const content = kind === 'json' ? `${JSON.stringify(roster, null, 2)}\n` : rosterMarkdown(roster);
        const url = URL.createObjectURL(new Blob([content], { type: kind === 'json' ? 'application/json' : 'text/markdown' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `puse-roster-v1.${kind === 'json' ? 'json' : 'md'}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    return (
        <section className="space-y-5" aria-labelledby="all-pokemon-heading">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 id="all-pokemon-heading" className="text-2xl font-bold tracking-tight text-slate-100">All Pokémon</h2>
                    <p className="mt-1 text-sm text-slate-400">Inspect occupied Party and PC slots in one place. This view does not edit your save.</p>
                </div>
                <p className="font-mono text-sm text-blue-200" aria-live="polite">
                    {loading ? 'Reading save…' : `${partyCount} Party / ${pokemon.length - partyCount} PC`}
                </p>
            </header>

            <div className="grid gap-3 rounded-xl border border-slate-700 bg-slate-800/70 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <label className="relative block">
                    <span className="sr-only">Search Pokémon</span>
                    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="search" value={query} placeholder="Search name, species or location" onChange={(event) => { setQuery(event.target.value); resetPage(); }}
                        className="w-full rounded-lg border border-slate-600 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none focus:border-blue-400" />
                </label>
                <label className="sr-only" htmlFor="all-pokemon-source">Location</label>
                <select id="all-pokemon-source" value={source} onChange={(event) => { setSource(event.target.value); setBox('all'); resetPage(); }}
                    className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-400">
                    <option value="all">Party and PC</option><option value="party">Party only</option><option value="pc">PC only</option>
                </select>
                <label className="sr-only" htmlFor="all-pokemon-box">Box</label>
                <select id="all-pokemon-box" value={box} disabled={source === 'party'} onChange={(event) => { setBox(event.target.value); resetPage(); }}
                    className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-400 disabled:opacity-50">
                    <option value="all">All boxes</option>
                    {ALL_POKEMON_BOXES.map((id) => <option key={id} value={id}>{id === 26 ? 'Preset' : `Box ${id}`}</option>)}
                </select>
                <label className="flex items-center gap-2 px-1 text-sm text-slate-200">
                    <input type="checkbox" checked={shinyOnly} onChange={(event) => { setShinyOnly(event.target.checked); resetPage(); }} className="accent-blue-500" /> Shiny
                </label>
            </div>

            {!loading && !error && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/70 p-3 text-sm">
                <span className="mr-auto text-slate-300">Export all {partyCount} Party Pokémon and {selectedCount} selected PC Pokémon.</span>
                <button type="button" onClick={() => setSelectedPcKeys((current) => new Set([...current, ...visiblePcKeys]))}
                    disabled={!visiblePcKeys.length} className="rounded-lg border border-slate-600 px-3 py-2 text-slate-100 hover:bg-slate-700 disabled:opacity-50">Select filtered PC</button>
                <button type="button" onClick={() => setSelectedPcKeys(new Set())} disabled={!selectedCount}
                    className="rounded-lg border border-slate-600 px-3 py-2 text-slate-100 hover:bg-slate-700 disabled:opacity-50">Clear PC</button>
                <button type="button" onClick={() => downloadRoster('json')} disabled={!partyCount && !selectedCount}
                    className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white hover:bg-blue-500 disabled:opacity-50">Export JSON</button>
                <button type="button" onClick={() => downloadRoster('md')} disabled={!partyCount && !selectedCount}
                    className="rounded-lg border border-blue-500 px-3 py-2 font-semibold text-blue-100 hover:bg-blue-500/20 disabled:opacity-50">Export Markdown</button>
            </div>}

            {loading ? <p className="py-12 text-center text-slate-400" role="status">Reading Party and PC boxes…</p> : null}
            {error ? <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
                {error} <button type="button" onClick={() => { setError(''); setLoading(true); setReload((value) => value + 1); }} className="ml-2 inline-flex items-center gap-1 underline"><RefreshCw size={13} />Retry</button>
            </div> : null}
            {!loading && !error && <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800/40" role="list" aria-label="All Pokémon">
                <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_5rem_minmax(0,1fr)_minmax(0,1.4fr)] gap-3 bg-slate-800 px-6 py-2 text-xs font-semibold text-slate-400 md:grid" aria-hidden="true">
                    <span>Pokémon</span><span>Location</span><span>Level</span><span>Nature</span><span>Ability</span>
                </div>
                {filtered.slice(0, shown).map((row) => <PokemonRow key={row.rosterKey} pokemon={row} expanded={inspectedKey === row.rosterKey}
                    onToggle={() => setInspectedKey((current) => current === row.rosterKey ? null : row.rosterKey)} getPokemonIconUrl={client.getPokemonIconUrl}
                    itemNames={itemNames} moveNames={moveNames} selected={selectedPcKeys.has(row.rosterKey)}
                    onSelect={() => setSelectedPcKeys((current) => {
                        const next = new Set(current);
                        if (next.has(row.rosterKey)) next.delete(row.rosterKey); else next.add(row.rosterKey);
                        return next;
                    })} />)}
                {filtered.length === 0 && <p className="p-8 text-center text-sm text-slate-400">No Pokémon match these filters. Empty and locked slots are omitted.</p>}
            </div>}
            {!loading && !error && filtered.length > 0 && <div className="flex items-center justify-between gap-3 text-sm text-slate-400">
                <span>Showing {Math.min(shown, filtered.length)} of {filtered.length}</span>
                {shown < filtered.length && <button type="button" onClick={() => setShown((count) => count + PAGE_SIZE)}
                    className="rounded-lg border border-slate-600 px-3 py-2 text-slate-100 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-blue-400">Show 100 more</button>}
            </div>}
        </section>
    );
}
