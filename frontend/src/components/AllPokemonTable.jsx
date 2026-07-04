import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, Copy, FileArchive, Loader2, Search, SlidersHorizontal, Sparkles, Table2, Trash2 } from 'lucide-react';
import { POKEMON_ICON_FALLBACK_URL } from '../core/iconResolver.js';
import { calcCurrentLevel } from '../core/growth.js';
import { getSpeciesBst } from '../core/statCalc.js';
import { NATURES } from '../core/showdownImport.js';
import ExportToggleButton from './ExportToggleButton.jsx';
import { isSelectionKeyActive, partySelectionKey, pcSelectionKey } from '../core/exportSelection.js';
import { getSpeciesTypeList } from '../core/speciesTypeFormat.js';

const IV_COLUMNS = [
    { key: 'hp', label: 'HP', path: 'HP' },
    { key: 'atk', label: 'Atk', path: 'Atk' },
    { key: 'def', label: 'Def', path: 'Def' },
    { key: 'spa', label: 'SpA', path: 'SpA' },
    { key: 'spd', label: 'SpD', path: 'SpD' },
    { key: 'spe', label: 'Spe', path: 'Spe' },
];

const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'perfect2', label: '2+ perfect IVs' },
    { id: 'shiny', label: 'Shiny' },
    { id: 'ha', label: 'Hidden ability' },
    { id: 'flawless', label: '6 IV' },
];

const EMPTY_IV_MIN = { hp: '', atk: '', def: '', spa: '', spd: '', spe: '' };

const TYPE_BADGE_CLASS = {
    Normal: 'bg-stone-500/20 text-stone-200 border-stone-400/30',
    Fire: 'bg-orange-500/20 text-orange-200 border-orange-400/30',
    Water: 'bg-blue-500/20 text-blue-200 border-blue-400/30',
    Electric: 'bg-yellow-500/20 text-yellow-200 border-yellow-400/30',
    Grass: 'bg-green-500/20 text-green-200 border-green-400/30',
    Ice: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/30',
    Fighting: 'bg-red-600/20 text-red-200 border-red-500/30',
    Poison: 'bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/30',
    Ground: 'bg-amber-600/20 text-amber-200 border-amber-500/30',
    Flying: 'bg-indigo-400/20 text-indigo-200 border-indigo-300/30',
    Psychic: 'bg-pink-500/20 text-pink-200 border-pink-400/30',
    Bug: 'bg-lime-500/20 text-lime-200 border-lime-400/30',
    Rock: 'bg-yellow-700/25 text-yellow-200 border-yellow-600/30',
    Ghost: 'bg-purple-500/20 text-purple-200 border-purple-400/30',
    Dragon: 'bg-violet-600/20 text-violet-200 border-violet-500/30',
    Dark: 'bg-slate-600/30 text-slate-200 border-slate-400/30',
    Steel: 'bg-slate-400/20 text-slate-200 border-slate-300/30',
    Fairy: 'bg-rose-400/20 text-rose-200 border-rose-300/30',
};

function typeBadgeClass(type) {
    return TYPE_BADGE_CLASS[type] || 'bg-slate-700/30 text-slate-300 border-white/10';
}

function ivColor(val) {
    if (val === 31) return 'text-emerald-400';
    if (val >= 20) return 'text-blue-400';
    if (val >= 10) return 'text-amber-400';
    return 'text-rose-400';
}

function resolveIv(ivs, path) {
    if (!ivs) return 0;
    if (path === 'Spe') return Number(ivs.Spe ?? ivs.Spd ?? 0);
    return Number(ivs[path] ?? 0);
}

function resolveLevel(mon) {
    if (Number.isFinite(mon.level) && mon.level > 0) return mon.level;
    if (Number.isFinite(mon.exp) && Number.isFinite(mon.species_growth_rate)) {
        return calcCurrentLevel(mon.species_growth_rate, mon.exp);
    }
    return 0;
}

function locationLabel(mon) {
    if (mon._source === 'party') return `Party ${Number(mon._index ?? 0) + 1}`;
    const box = Number(mon.box);
    const boxLabel = box === 26 ? 'Preset' : `Box ${box}`;
    return `${boxLabel} \u00B7 ${mon.slot}`;
}

function selectionKeyFor(mon) {
    if (mon._source === 'party') return partySelectionKey(mon._index);
    return pcSelectionKey(mon.box, mon.slot);
}

function clampThreshold(value) {
    if (value === '' || value === null || value === undefined) return '';
    const num = Math.round(Number(value));
    if (!Number.isFinite(num)) return '';
    return Math.max(0, Math.min(31, num));
}

function SortHeader({ column, sortKey, sortDir, onSort, className = '' }) {
    const active = sortKey === column.key;
    return (
        <th className={`sticky top-0 z-10 bg-slate-900/95 backdrop-blur px-3 py-2.5 ${className}`}>
            <button
                type="button"
                onClick={() => onSort(column.key)}
                className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider transition-colors ${
                    active ? 'text-blue-300' : 'text-slate-400 hover:text-slate-200'
                }`}
            >
                {column.label}
                {active && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
            </button>
        </th>
    );
}

export default function AllPokemonTable({
    client,
    onEditPokemon,
    exportSelection = [],
    onToggleExportSelection,
    onBulkToggleSelection,
    onCopySelection,
    onExportSelection,
    onDeleteSelection,
    selectionCopied = false,
}) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [typeFilters, setTypeFilters] = useState([]);
    const [showTypeFilters, setShowTypeFilters] = useState(false);
    const typeFilterRef = useRef(null);
    const [sortKey, setSortKey] = useState('dex');
    const [sortDir, setSortDir] = useState('asc');
    const [showIvFilters, setShowIvFilters] = useState(false);
    const [ivMin, setIvMin] = useState(EMPTY_IV_MIN);
    const [ivMode, setIvMode] = useState('and');
    const [totalMin, setTotalMin] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await client.getAllOwnedPokemon();
            setRows(Array.isArray(data) ? data : []);
        } catch (err) {
            setRows([]);
            setError(err?.message || 'Failed to load Pokémon.');
        } finally {
            setLoading(false);
        }
    }, [client]);

    useEffect(() => {
        load();
    }, [load]);

    const decorated = useMemo(() => rows.map((mon) => {
        const ivs = mon.ivs || {};
        const iv = {
            hp: resolveIv(ivs, 'HP'),
            atk: resolveIv(ivs, 'Atk'),
            def: resolveIv(ivs, 'Def'),
            spa: resolveIv(ivs, 'SpA'),
            spd: resolveIv(ivs, 'SpD'),
            spe: resolveIv(ivs, 'Spe'),
        };
        const ivTotal = iv.hp + iv.atk + iv.def + iv.spa + iv.spd + iv.spe;
        const perfectCount = IV_COLUMNS.reduce((acc, col) => acc + (iv[col.key] === 31 ? 1 : 0), 0);
        const types = getSpeciesTypeList(mon.species_id, { resolveFairy: true });
        return {
            mon,
            key: mon._source === 'party' ? `party-${mon._index}` : `pc-${mon.box}-${mon.slot}`,
            selectionKey: selectionKeyFor(mon),
            name: mon.nickname || mon.species_name || '',
            species: mon.species_name || '',
            speciesId: Number(mon.species_id) || 0,
            types,
            typeLine: types.join('/'),
            level: resolveLevel(mon),
            nature: mon.nature || NATURES[mon.nature_id] || '\u2014',
            ability: mon.ability_label_current || mon.ability_name_current || '\u2014',
            iv,
            ivTotal,
            perfectCount,
            bst: getSpeciesBst(mon.species_id),
            location: locationLabel(mon),
            isShiny: Boolean(mon.is_shiny),
            isHA: Boolean(mon.is_hidden_ability),
        };
    }), [rows]);

    const typeOptions = useMemo(() => {
        const set = new Set();
        decorated.forEach((row) => row.types.forEach((t) => set.add(t)));
        return [...set].sort();
    }, [decorated]);

    const ivThresholds = useMemo(() => {
        const parsed = {};
        IV_COLUMNS.forEach((col) => {
            const raw = ivMin[col.key];
            if (raw !== '' && raw !== null && raw !== undefined) {
                parsed[col.key] = Number(raw);
            }
        });
        return parsed;
    }, [ivMin]);

    const ivFilterActive = Object.keys(ivThresholds).length > 0
        || (totalMin !== '' && Number(totalMin) > 0);

    const visible = useMemo(() => {
        let list = decorated;

        switch (filter) {
        case 'perfect2':
            list = list.filter((row) => row.perfectCount >= 2);
            break;
        case 'shiny':
            list = list.filter((row) => row.isShiny);
            break;
        case 'ha':
            list = list.filter((row) => row.isHA);
            break;
        case 'flawless':
            list = list.filter((row) => row.ivTotal === 186);
            break;
        default:
            break;
        }

        if (typeFilters.length > 0) {
            list = list.filter((row) => row.types.some((t) => typeFilters.includes(t)));
        }

        const minTotal = totalMin === '' ? 0 : Number(totalMin);
        const thresholdEntries = Object.entries(ivThresholds);
        if (minTotal > 0 || thresholdEntries.length > 0) {
            list = list.filter((row) => {
                if (row.ivTotal < minTotal) return false;
                if (thresholdEntries.length === 0) return true;
                return ivMode === 'or'
                    ? thresholdEntries.some(([k, min]) => row.iv[k] >= min)
                    : thresholdEntries.every(([k, min]) => row.iv[k] >= min);
            });
        }

        const q = search.trim().toLowerCase();
        if (q) {
            list = list.filter((row) =>
                row.name.toLowerCase().includes(q)
                || row.species.toLowerCase().includes(q)
                || String(row.speciesId).includes(q));
        }

        const dir = sortDir === 'asc' ? 1 : -1;
        const valueOf = (row) => {
            switch (sortKey) {
            case 'name': return row.name.toLowerCase();
            case 'nature': return row.nature.toLowerCase();
            case 'type': return row.typeLine.toLowerCase();
            case 'ability': return row.ability.toLowerCase();
            case 'location': return row.location.toLowerCase();
            case 'level': return row.level;
            case 'total': return row.ivTotal;
            case 'bst': return row.bst ?? 0;
            case 'dex': return row.speciesId;
            default: return row.iv[sortKey] ?? 0;
            }
        };

        return [...list].sort((a, b) => {
            const av = valueOf(a);
            const bv = valueOf(b);
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return a.speciesId - b.speciesId;
        });
    }, [decorated, filter, typeFilters, search, sortKey, sortDir, ivThresholds, ivMode, totalMin]);

    const selectedVisibleCount = useMemo(
        () => visible.reduce((acc, row) => acc + (isSelectionKeyActive(exportSelection, row.selectionKey) ? 1 : 0), 0),
        [visible, exportSelection],
    );
    const allVisibleSelected = visible.length > 0 && selectedVisibleCount === visible.length;
    const selectionCount = exportSelection.length;
    const selectedPcCount = useMemo(
        () => decorated.reduce(
            (acc, row) => acc + ((row.mon._source === 'pc' && isSelectionKeyActive(exportSelection, row.selectionKey)) ? 1 : 0),
            0,
        ),
        [decorated, exportSelection],
    );

    const handleSort = useCallback((key) => {
        setSortKey((prevKey) => {
            if (prevKey === key) {
                setSortDir((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
                return prevKey;
            }
            const stringKeys = new Set(['name', 'nature', 'type', 'ability', 'location']);
            setSortDir(stringKeys.has(key) ? 'asc' : 'desc');
            return key;
        });
    }, []);

    const handleToggleAllVisible = useCallback(() => {
        if (!onBulkToggleSelection) return;
        const keys = visible.map((row) => row.selectionKey);
        onBulkToggleSelection(keys, !allVisibleSelected);
    }, [onBulkToggleSelection, visible, allVisibleSelected]);

    const toggleTypeFilter = useCallback((type) => {
        setTypeFilters((prev) => (prev.includes(type)
            ? prev.filter((t) => t !== type)
            : [...prev, type]));
    }, []);

    useEffect(() => {
        if (!showTypeFilters) return undefined;
        const handleClickOutside = (event) => {
            if (typeFilterRef.current && !typeFilterRef.current.contains(event.target)) {
                setShowTypeFilters(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showTypeFilters]);

    const handleIvMinChange = useCallback((key, value) => {
        setIvMin((prev) => ({ ...prev, [key]: clampThreshold(value) }));
    }, []);

    const clearIvFilters = useCallback(() => {
        setIvMin(EMPTY_IV_MIN);
        setTotalMin('');
    }, []);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                <Loader2 className="animate-spin mb-4" size={48} />
                <p>Gathering every Pokémon...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center space-y-3">
                <p className="text-sm text-rose-200">{error}</p>
                <button
                    type="button"
                    onClick={load}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4 pb-28">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Table2 size={18} className="text-blue-300" />
                    <div>
                        <h2 className="text-lg font-bold text-slate-100">All Pokémon</h2>
                        <p className="text-xs text-slate-400">
                            Filter, select, and copy any subset of your party and PC boxes.
                        </p>
                    </div>
                </div>
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                    {visible.length} shown
                </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                    <Search className="absolute left-3 top-2.5 text-slate-500" size={16} />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by nickname, species, or dex ID..."
                        className="w-full rounded-xl border border-white/10 bg-slate-900 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-500/50"
                    />
                </div>
                {FILTERS.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => setFilter(item.id)}
                        className={`rounded-xl px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide border ${
                            filter === item.id
                                ? 'border-blue-400/50 bg-blue-500/20 text-blue-100'
                                : 'border-white/10 bg-slate-900/50 text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        {item.label}
                    </button>
                ))}
                <div className="relative" ref={typeFilterRef}>
                    <button
                        type="button"
                        onClick={() => setShowTypeFilters((prev) => !prev)}
                        className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide border ${
                            typeFilters.length > 0
                                ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100'
                                : 'border-white/10 bg-slate-900/50 text-slate-400 hover:text-slate-200'
                        }`}
                        title="Filter by type"
                    >
                        {typeFilters.length === 0
                            ? 'All types'
                            : typeFilters.length === 1
                                ? typeFilters[0]
                                : `${typeFilters.length} types`}
                        <ChevronDown size={12} />
                    </button>
                    {showTypeFilters && (
                        <div className="absolute left-0 top-full z-30 mt-1.5 w-44 rounded-xl border border-white/10 bg-slate-900 p-2 shadow-xl shadow-black/40">
                            <div className="flex items-center justify-between px-1 pb-1.5">
                                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Match any type</span>
                                {typeFilters.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setTypeFilters([])}
                                        className="text-[9px] font-bold uppercase tracking-widest text-slate-400 hover:text-rose-300"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                            <div className="max-h-64 overflow-y-auto">
                                {typeOptions.map((t) => {
                                    const checked = typeFilters.includes(t);
                                    return (
                                        <button
                                            key={t}
                                            type="button"
                                            onClick={() => toggleTypeFilter(t)}
                                            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold transition-colors ${
                                                checked ? 'bg-emerald-500/15 text-emerald-100' : 'text-slate-300 hover:bg-white/5'
                                            }`}
                                        >
                                            <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                                                checked ? 'border-emerald-400 bg-emerald-500/40' : 'border-white/20'
                                            }`}>
                                                {checked && <Check size={10} />}
                                            </span>
                                            {t}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => setShowIvFilters((prev) => !prev)}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide border ${
                        ivFilterActive
                            ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100'
                            : 'border-white/10 bg-slate-900/50 text-slate-400 hover:text-slate-200'
                    }`}
                >
                    <SlidersHorizontal size={12} />
                    IV filters{ivFilterActive ? ' \u25CF' : ''}
                </button>
            </div>

            {showIvFilters && (
                <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                            Minimum IV thresholds
                        </p>
                        <div className="flex items-center gap-3">
                            <div className="inline-flex overflow-hidden rounded-lg border border-white/10">
                                {['and', 'or'].map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        onClick={() => setIvMode(mode)}
                                        className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                                            ivMode === mode
                                                ? 'bg-blue-500/30 text-blue-100'
                                                : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                                        }`}
                                    >
                                        {mode === 'and' ? 'Match all' : 'Match any'}
                                    </button>
                                ))}
                            </div>
                            {ivFilterActive && (
                                <button
                                    type="button"
                                    onClick={clearIvFilters}
                                    className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-rose-300"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        {IV_COLUMNS.map((col) => (
                            <label key={col.key} className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{col.label}</span>
                                <input
                                    type="number"
                                    min="0"
                                    max="31"
                                    value={ivMin[col.key]}
                                    onChange={(e) => handleIvMinChange(col.key, e.target.value)}
                                    placeholder="0"
                                    className="w-16 rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-sm font-mono text-slate-100 outline-none focus:border-blue-500/50"
                                />
                            </label>
                        ))}
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Min total</span>
                            <input
                                type="number"
                                min="0"
                                max="186"
                                value={totalMin}
                                onChange={(e) => setTotalMin(e.target.value === '' ? '' : Math.max(0, Math.min(186, Math.round(Number(e.target.value)))))}
                                placeholder="0"
                                className="w-20 rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-sm font-mono text-slate-100 outline-none focus:border-blue-500/50"
                            />
                        </label>
                    </div>
                    <p className="text-[10px] text-slate-500">
                        {ivMode === 'or'
                            ? 'Match any: a Pokémon is shown if at least one stat meets its threshold.'
                            : 'Match all: a Pokémon is shown only if every set stat meets its threshold.'}
                        {' '}The IV total minimum is always applied.
                    </p>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/40 px-3 py-2">
                <button
                    type="button"
                    onClick={handleToggleAllVisible}
                    disabled={visible.length === 0}
                    className="rounded-xl border border-violet-400/30 bg-violet-600/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-200 hover:bg-violet-600/25 disabled:opacity-40"
                >
                    {allVisibleSelected ? 'Deselect filtered' : 'Select filtered'}
                </button>
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                    {selectionCount} selected{selectedVisibleCount !== selectionCount ? ` (${selectedVisibleCount} in view)` : ''}
                </span>
                <div className="ml-auto flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onCopySelection}
                        disabled={selectionCount === 0}
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all disabled:opacity-40 ${
                            selectionCopied
                                ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-violet-700/40 hover:bg-violet-600/50 text-violet-100 border border-violet-400/30'
                        }`}
                        title="Copy selected Pokémon as Markdown to clipboard"
                    >
                        {selectionCopied ? <Check size={14} /> : <Copy size={14} />}
                        {selectionCopied ? 'COPIED' : 'COPY SELECTION'}
                    </button>
                    <button
                        type="button"
                        onClick={onExportSelection}
                        disabled={selectionCount === 0}
                        className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-700/40 px-3 py-1.5 text-[11px] font-bold text-violet-100 hover:bg-violet-600/50 transition-all disabled:opacity-40"
                        title="Download selected Pokémon as Markdown"
                    >
                        <FileArchive size={14} /> EXPORT
                    </button>
                    {onDeleteSelection && (
                        <button
                            type="button"
                            onClick={onDeleteSelection}
                            disabled={selectedPcCount === 0}
                            className="inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-600/15 px-3 py-1.5 text-[11px] font-bold text-rose-300 hover:bg-rose-600/30 transition-all disabled:opacity-40"
                            title="Release selected PC Pokémon (party Pokémon are skipped)"
                        >
                            <Trash2 size={14} /> DELETE{selectedPcCount > 0 ? ` (${selectedPcCount})` : ''}
                        </button>
                    )}
                </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/40">
                <table className="w-full border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-white/10">
                            <th className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur px-3 py-2.5 text-left">
                                <input
                                    type="checkbox"
                                    checked={allVisibleSelected}
                                    onChange={handleToggleAllVisible}
                                    disabled={visible.length === 0}
                                    className="h-4 w-4 cursor-pointer accent-violet-500"
                                    title="Select all filtered"
                                />
                            </th>
                            <SortHeader column={{ key: 'dex', label: '#' }} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-left" />
                            <SortHeader column={{ key: 'name', label: 'Pokémon' }} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-left" />
                            <SortHeader column={{ key: 'level', label: 'Lv' }} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-right" />
                            <SortHeader column={{ key: 'nature', label: 'Nature' }} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-left" />
                            <SortHeader column={{ key: 'type', label: 'Type' }} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-left" />
                            <SortHeader column={{ key: 'ability', label: 'Ability' }} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-left" />
                            {IV_COLUMNS.map((col) => (
                                <SortHeader key={col.key} column={col} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-right" />
                            ))}
                            <SortHeader column={{ key: 'total', label: 'IV\u2211' }} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-right" />
                            <SortHeader column={{ key: 'bst', label: 'BST' }} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-right" />
                            <SortHeader column={{ key: 'location', label: 'Location' }} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-left" />
                        </tr>
                    </thead>
                    <tbody>
                        {visible.length === 0 ? (
                            <tr>
                                <td colSpan={16} className="py-16 text-center text-slate-500 italic">
                                    No Pokémon match these filters.
                                </td>
                            </tr>
                        ) : (
                            visible.map((row) => {
                                const selected = isSelectionKeyActive(exportSelection, row.selectionKey);
                                return (
                                    <tr
                                        key={row.key}
                                        onClick={() => onEditPokemon(row.mon)}
                                        className={`border-b border-white/5 cursor-pointer transition-colors ${
                                            selected ? 'bg-violet-500/10 hover:bg-violet-500/15' : 'hover:bg-white/5'
                                        }`}
                                    >
                                        <td className="px-3 py-2 text-left" onClick={(e) => e.stopPropagation()}>
                                            <ExportToggleButton
                                                active={selected}
                                                onToggle={() => onToggleExportSelection?.(row.selectionKey)}
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-left text-[11px] font-mono text-slate-500">
                                            {row.speciesId || '\u2014'}
                                        </td>
                                        <td className="px-3 py-2 text-left">
                                            <div className="flex items-center gap-2.5 min-w-[180px]">
                                                <img
                                                    src={client.getPokemonIconUrl(row.mon.species_id)}
                                                    alt={row.name}
                                                    className="w-8 h-8 object-contain pixelated shrink-0"
                                                    onError={(e) => {
                                                        if (e.currentTarget.src !== POKEMON_ICON_FALLBACK_URL) {
                                                            e.currentTarget.src = POKEMON_ICON_FALLBACK_URL;
                                                        }
                                                    }}
                                                />
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="font-semibold text-slate-100 truncate">{row.name}</span>
                                                        {row.isShiny && <Sparkles size={12} className="text-amber-300 shrink-0" />}
                                                    </div>
                                                    {row.species && row.species !== row.name && (
                                                        <span className="block text-[10px] text-slate-500 truncate">{row.species}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-slate-200">{row.level || '\u2014'}</td>
                                        <td className="px-3 py-2 text-left text-slate-300">{row.nature}</td>
                                        <td className="px-3 py-2 text-left">
                                            {row.types.length ? (
                                                <div className="flex flex-wrap gap-1">
                                                    {row.types.map((t) => (
                                                        <span
                                                            key={t}
                                                            className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide border ${typeBadgeClass(t)}`}
                                                        >
                                                            {t}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-slate-600">{'\u2014'}</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-left">
                                            <span className={row.isHA ? 'text-amber-300' : 'text-slate-300'}>{row.ability}</span>
                                        </td>
                                        {IV_COLUMNS.map((col) => (
                                            <td key={col.key} className={`px-3 py-2 text-right font-mono font-bold ${ivColor(row.iv[col.key])}`}>
                                                {row.iv[col.key]}
                                            </td>
                                        ))}
                                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-100">{row.ivTotal}</td>
                                        <td className="px-3 py-2 text-right font-mono text-slate-300">{row.bst ?? '—'}</td>
                                        <td className="px-3 py-2 text-left text-[11px] text-slate-400 whitespace-nowrap">{row.location}</td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
