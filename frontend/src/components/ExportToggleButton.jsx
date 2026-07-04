import React from 'react';
import { ListPlus, ListChecks } from 'lucide-react';

export default function ExportToggleButton({ active = false, onToggle, className = '' }) {
    return (
        <button
            type="button"
            onClick={(event) => {
                event.stopPropagation();
                onToggle?.();
            }}
            className={`p-1.5 rounded-lg border text-[10px] font-black uppercase tracking-widest transition-colors ${
                active
                    ? 'bg-violet-600/25 border-violet-400/50 text-violet-200'
                    : 'bg-slate-900/80 border-white/10 text-slate-400 hover:text-violet-200 hover:border-violet-400/30'
            } ${className}`}
            title={active ? 'Remove from export selection' : 'Add to export selection'}
            aria-pressed={active}
            aria-label={active ? 'Remove from export selection' : 'Add to export selection'}
        >
            {active ? <ListChecks size={12} /> : <ListPlus size={12} />}
        </button>
    );
}
