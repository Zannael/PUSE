import React from 'react';
import { RotateCcw, Undo2 } from 'lucide-react';

export default function ChangeLedgerPanel({
    history,
    busy = false,
    onUndo,
    onReset,
    compact = false,
}) {
    const entries = history?.entries || [];
    const canUndo = Boolean(history?.can_undo) && !busy;
    const canReset = Boolean(history?.can_reset) && !busy;
    const totalChanged = Number(history?.total_changed_bytes || 0);

    return (
        <section
            aria-label="Change ledger"
            className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 md:p-5 space-y-4"
        >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h3 className="text-base font-bold text-slate-100">Change history</h3>
                    <p className="text-xs text-slate-400">
                        {entries.length} {entries.length === 1 ? 'entry' : 'entries'} recorded · {totalChanged} changed {totalChanged === 1 ? 'byte' : 'bytes'} vs. uploaded save
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={onUndo}
                        disabled={!canUndo}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-blue-400/40 bg-blue-600/20 px-3 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-600/35 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Undo2 size={14} /> Undo last
                    </button>
                    <button
                        type="button"
                        onClick={onReset}
                        disabled={!canReset}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/40 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <RotateCcw size={14} /> Reset to original
                    </button>
                </div>
            </div>

            {entries.length > 0 ? (
                <ul className={`space-y-2 overflow-y-auto ${compact ? 'max-h-44' : 'max-h-64'}`}>
                    {entries.map((entry, idx) => (
                        <li
                            key={entry.id}
                            className="rounded-xl border border-white/5 bg-slate-800/80 px-3 py-2.5 text-xs"
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-100">
                                    {idx === 0 ? 'Latest · ' : ''}{entry.label}
                                </span>
                                <span className="shrink-0 font-mono text-[11px] text-slate-400">
                                    {entry.changed_bytes} B
                                </span>
                            </div>
                            {Array.isArray(entry.regions) && entry.regions.length > 0 && (
                                <p className="mt-1 text-[11px] text-slate-300">
                                    {entry.regions.join(' · ')}
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-xs text-slate-400">
                    No edits recorded since the save was loaded.
                </p>
            )}
        </section>
    );
}
