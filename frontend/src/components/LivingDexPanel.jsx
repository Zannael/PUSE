import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, RefreshCw, Search } from 'lucide-react';

const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'caught', label: 'Caught' },
    { id: 'seen', label: 'Seen' },
    { id: 'missing', label: 'Missing' },
];

const statusLabel = (entry) => {
    if (entry.caught) return 'Caught';
    if (entry.seen) return 'Seen';
    return 'Missing';
};

const statusClass = (entry) => {
    if (entry.caught) return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25';
    if (entry.seen) return 'text-sky-300 bg-sky-500/10 border-sky-500/25';
    return 'text-slate-500 bg-slate-900/60 border-white/10';
};

export default function LivingDexPanel({ client }) {
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');

    const loadSummary = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setSummary(await client.getPokedexSummary());
        } catch (err) {
            setSummary(null);
            setError(err?.message || 'Failed to load Pokédex flags.');
        } finally {
            setLoading(false);
        }
    }, [client]);

    useEffect(() => {
        loadSummary();
    }, [loadSummary]);

    const entries = useMemo(() => {
        let rows = [...(summary?.entries || [])];
        if (filter === 'caught') {
            rows = rows.filter((entry) => entry.caught);
        } else if (filter === 'seen') {
            rows = rows.filter((entry) => entry.seen && !entry.caught);
        } else if (filter === 'missing') {
            rows = rows.filter((entry) => !entry.seen && !entry.caught);
        }

        const q = search.trim().toLowerCase();
        if (q) {
            rows = rows.filter((entry) =>
                String(entry.species_id).includes(q) ||
                String(entry.species_name || '').toLowerCase().includes(q)
            );
        }
        return rows;
    }, [summary, filter, search]);

    if (loading && !summary) {
        return <div className="py-16 text-center text-slate-400 animate-pulse">Loading Pokédex flags...</div>;
    }

    if (error && !summary) {
        return (
            <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-6 text-center space-y-4">
                <p className="text-sm text-rose-200">{error}</p>
                <button
                    type="button"
                    onClick={loadSummary}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold hover:bg-slate-700"
                >
                    <RefreshCw size={14} /> Retry
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-5 pb-28">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-2xl border border-blue-400/30 bg-blue-500/10 flex items-center justify-center">
                        <BookOpen size={18} className="text-blue-300" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-100">Pokédex Flags</h2>
                        <p className="text-xs text-slate-400">Seen and caught bits read from the loaded save.</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={loadSummary}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-800/80 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ProgressCard label="Seen" count={summary?.seen_count || 0} total={summary?.total || 0} percent={summary?.seen_percent || 0} color="bg-sky-400" />
                <ProgressCard label="Caught" count={summary?.caught_count || 0} total={summary?.total || 0} percent={summary?.caught_percent || 0} color="bg-emerald-400" />
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {FILTERS.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => setFilter(item.id)}
                        className={`rounded-xl border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors ${
                            filter === item.id
                                ? 'border-blue-400/50 bg-blue-500/20 text-blue-100'
                                : 'border-white/10 bg-slate-900/60 text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            <div className="relative">
                <Search className="absolute left-3 top-3 text-slate-500" size={16} />
                <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search by name or species ID..."
                    className="w-full rounded-xl border border-white/10 bg-slate-900 py-3 pl-10 pr-4 text-sm outline-none focus:border-blue-500/50"
                />
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#1e293b]/50 overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <span>Showing {entries.length} / {summary?.total || 0}</span>
                    <span>Layout: {summary?.layout || 'unknown'}</span>
                </div>
                <div className="max-h-[58vh] overflow-y-auto divide-y divide-white/5">
                    {entries.length === 0 ? (
                        <p className="py-12 text-center text-sm text-slate-500">No entries match this filter.</p>
                    ) : entries.map((entry) => (
                        <div key={entry.species_id} className="grid grid-cols-[72px_1fr_auto] items-center gap-3 px-4 py-3 hover:bg-white/5">
                            <span className="font-mono text-xs text-slate-500">#{entry.species_id}</span>
                            <span className="min-w-0 truncate text-sm font-semibold text-slate-200">{entry.species_name}</span>
                            <span className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${statusClass(entry)}`}>
                                {statusLabel(entry)}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function ProgressCard({ label, count, total, percent, color }) {
    const width = total > 0 ? Math.min(100, (count / total) * 100) : 0;
    return (
        <div className="rounded-3xl border border-white/10 bg-[#1e293b]/50 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
                <p className="text-sm font-bold text-slate-100">{percent}%</p>
            </div>
            <div className="h-2 rounded-full bg-slate-950 overflow-hidden">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
            </div>
            <p className="text-xs text-slate-400">{count} / {total} entries</p>
        </div>
    );
}
