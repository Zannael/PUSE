import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, BookOpen, Check, ChevronDown, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { buildUnboundDexSpeciesPageUrl } from '../core/unboundDex.js';
import { MAX_TRACKED_DEX_ID } from '../core/pokedexFlags.js';
import { getSpeciesTypeList } from '../core/speciesTypeFormat.js';
import { getSpeciesBst } from '../core/statCalc.js';

const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'caught', label: 'Caught' },
    { id: 'seen_only', label: 'Seen, not caught' },
];

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

function ProgressCard({ label, count, total, percent, barClass, textClass }) {
    const safeTotal = total || 0;
    const width = safeTotal > 0 ? Math.min(100, (count / safeTotal) * 100) : 0;
    return (
        <div className="rounded-2xl border border-white/10 bg-slate-800/40 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
                <p className={`text-sm font-bold ${textClass}`}>{percent}%</p>
            </div>
            <div className="h-2 rounded-full bg-slate-900 overflow-hidden">
                <div className={`h-full rounded-full ${barClass}`} style={{ width: `${width}%` }} />
            </div>
            <p className="text-xs text-slate-400">
                {count} / {safeTotal} species (IDs 1–{MAX_TRACKED_DEX_ID})
            </p>
        </div>
    );
}

function SortHeader({ column, label, sortKey, sortDir, onSort, className = 'justify-center' }) {
    const active = sortKey === column;
    return (
        <button
            type="button"
            onClick={() => onSort(column)}
            className={`inline-flex w-full items-center gap-1 text-[10px] font-black uppercase tracking-wider transition-colors ${
                active ? 'text-violet-300' : 'text-slate-500 hover:text-slate-300'
            } ${className}`}
        >
            {label}
            {active && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
        </button>
    );
}

export default function LivingDexPanel({ client }) {
    const [summary, setSummary] = useState(null);
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState('dex');
    const [sortDir, setSortDir] = useState('asc');
    const [typeFilters, setTypeFilters] = useState([]);
    const [showTypeFilters, setShowTypeFilters] = useState(false);
    const typeFilterRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const loadSummary = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await client.getPokedexSummary();
            setSummary(data);
        } catch (err) {
            setSummary(null);
            setError(err?.message || 'Failed to load living dex summary');
        } finally {
            setLoading(false);
        }
    }, [client]);

    useEffect(() => {
        loadSummary();
    }, [loadSummary]);

    const decorated = useMemo(() => (summary?.entries || []).map((row) => ({
        ...row,
        types: getSpeciesTypeList(row.species_id, { resolveFairy: true }),
        bst: getSpeciesBst(row.species_id),
    })), [summary]);

    const knownEntries = useMemo(
        () => decorated.filter((row) => (row.seen || row.caught) && row.bst !== 0),
        [decorated],
    );

    const typeOptions = useMemo(() => {
        const set = new Set();
        knownEntries.forEach((row) => row.types.forEach((t) => set.add(t)));
        return [...set].sort();
    }, [knownEntries]);

    const handleSort = useCallback((key) => {
        if (sortKey === key) {
            setSortDir((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir(key === 'name' ? 'asc' : 'desc');
        }
    }, [sortKey]);

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

    const filteredEntries = useMemo(() => {
        let rows = filter === 'caught'
            ? knownEntries.filter((row) => row.caught)
            : filter === 'seen_only'
                ? knownEntries.filter((row) => row.seen && !row.caught)
                : knownEntries;

        if (typeFilters.length > 0) {
            rows = rows.filter((row) => row.types.some((t) => typeFilters.includes(t)));
        }

        const q = search.trim().toLowerCase();
        if (q) {
            rows = rows.filter((row) =>
                row.species_name.toLowerCase().includes(q)
                || String(row.species_id).includes(q));
        }
        const dir = sortDir === 'asc' ? 1 : -1;
        const valueOf = (row) => {
            switch (sortKey) {
            case 'name': return row.species_name.toLowerCase();
            case 'status': return row.caught ? 2 : 1;
            case 'bst': return row.bst ?? 0;
            case 'dex':
            default: return row.species_id;
            }
        };
        return [...rows].sort((a, b) => {
            const av = valueOf(a);
            const bv = valueOf(b);
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return a.species_id - b.species_id;
        });
    }, [knownEntries, filter, typeFilters, search, sortKey, sortDir]);

    if (loading && !summary) {
        return (
            <div className="py-16 text-center text-slate-400 animate-pulse">
                Loading living dex...
            </div>
        );
    }

    if (error && !summary) {
        return (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center space-y-3">
                <p className="text-sm text-rose-200">{error}</p>
                <button
                    type="button"
                    onClick={loadSummary}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold"
                >
                    <RefreshCw size={14} />
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-5 pb-28">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <BookOpen size={18} className="text-violet-300" />
                    <div>
                        <h2 className="text-lg font-bold text-slate-100">Living Dex</h2>
                        <p className="text-xs text-slate-400">
                            Caught/seen flags from save block 1 (CFRU layout)
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={loadSummary}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-800/80 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <ProgressCard
                    label="Seen"
                    count={summary?.seen_count ?? 0}
                    total={summary?.total ?? 0}
                    percent={summary?.seen_percent ?? 0}
                    barClass="bg-sky-400"
                    textClass="text-sky-300"
                />
                <ProgressCard
                    label="Caught"
                    count={summary?.caught_count ?? 0}
                    total={summary?.total ?? 0}
                    percent={summary?.caught_percent ?? 0}
                    barClass="bg-emerald-400"
                    textClass="text-emerald-300"
                />
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {FILTERS.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => setFilter(item.id)}
                        className={`rounded-xl px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide border ${
                            filter === item.id
                                ? 'border-violet-400/50 bg-violet-500/20 text-violet-100'
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
            </div>

            <div className="relative">
                <Search className="absolute left-3 top-3 text-slate-500" size={16} />
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name or species ID..."
                    className="w-full rounded-xl border border-white/10 bg-slate-900 py-3 pl-10 pr-4 text-sm outline-none focus:border-violet-500/50"
                />
            </div>

            <p className="text-[10px] text-slate-500">
                Showing {filteredEntries.length} species. Click a row to open it in the Unbound Dex.
            </p>

            <div className="rounded-2xl border border-white/10 bg-slate-900/40 max-h-[55vh] overflow-y-auto overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-white/10">
                            <th className="sticky top-0 z-10 w-14 bg-slate-900/95 backdrop-blur px-3 py-2.5 text-center">
                                <SortHeader column="dex" label="#" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                            </th>
                            <th className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur px-3 py-2.5 text-left">
                                <SortHeader column="name" label="Pokémon" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-start" />
                            </th>
                            <th className="sticky top-0 z-10 w-36 bg-slate-900/95 backdrop-blur px-3 py-2.5 text-center">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Type</span>
                            </th>
                            <th className="sticky top-0 z-10 w-16 bg-slate-900/95 backdrop-blur px-3 py-2.5 text-center">
                                <SortHeader column="bst" label="BST" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                            </th>
                            <th className="sticky top-0 z-10 w-24 bg-slate-900/95 backdrop-blur px-3 py-2.5 text-center">
                                <SortHeader column="status" label="Status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredEntries.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="py-16 text-center text-slate-500 italic">
                                    No species match this filter.
                                </td>
                            </tr>
                        ) : (
                            filteredEntries.map((entry) => {
                                const dexUrl = buildUnboundDexSpeciesPageUrl(entry.species_id, entry.species_name);
                                return (
                                    <tr
                                        key={entry.species_id}
                                        onClick={() => window.open(dexUrl, '_blank', 'noopener,noreferrer')}
                                        title="Open in Unbound Dex"
                                        className="border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
                                    >
                                        <td className="px-3 py-3 text-center font-mono text-[11px] text-slate-500">#{entry.species_id}</td>
                                        <td className="px-3 py-3 text-left">
                                            <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
                                                entry.caught ? 'text-slate-100' : 'text-slate-300'
                                            }`}>
                                                {entry.species_name}
                                                <ExternalLink size={11} className="shrink-0 text-violet-300" />
                                            </span>
                                        </td>
                                        <td className="px-3 py-3 text-center">
                                            {entry.types.length === 0 ? (
                                                <span className="text-slate-600">{'—'}</span>
                                            ) : (
                                                <div className="flex flex-wrap justify-center gap-1">
                                                    {entry.types.map((t) => (
                                                        <span
                                                            key={t}
                                                            className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide border ${typeBadgeClass(t)}`}
                                                        >
                                                            {t}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-3 py-3 text-center font-mono text-[11px] text-slate-400">
                                            {entry.bst ?? '—'}
                                        </td>
                                        <td className={`px-3 py-3 text-center text-[10px] font-bold uppercase tracking-wide ${
                                            entry.caught ? 'text-emerald-300' : 'text-sky-300'
                                        }`}>
                                            {entry.caught ? 'Caught' : 'Seen'}
                                        </td>
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
