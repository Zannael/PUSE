import React, { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, X } from 'lucide-react';
import { MAX_TRACKED_DEX_ID } from '../core/pokedexCatalog.js';

export default function PokedexFlagsControls({ client, speciesId, speciesLabel }) {
    const [flags, setFlags] = useState(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(null);
    const [error, setError] = useState(null);

    const sid = Number(speciesId);
    const label = speciesLabel || `Species ${sid}`;

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            if (!Number.isInteger(sid) || sid <= 0) {
                setFlags(null);
                setLoading(false);
                return;
            }
            setLoading(true);
            setError(null);
            try {
                const data = await client.getPokedexFlags(sid);
                if (!cancelled) setFlags(data);
            } catch (err) {
                if (!cancelled) {
                    setFlags(null);
                    setError(err?.message || 'Failed to load Pokédex flags.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [client, sid]);

    const updateFlag = async (flag, value) => {
        const action = value ? 'Mark' : 'Clear';
        if (!window.confirm(`${action} ${flag} for ${label}?\n\nThis writes directly to the loaded save's Pokédex flags.`)) {
            return;
        }
        setUpdating(flag);
        setError(null);
        try {
            setFlags(await client.updatePokedexFlag(sid, { flag, value }));
        } catch (err) {
            setError(err?.message || 'Failed to update Pokédex flags.');
        } finally {
            setUpdating(null);
        }
    };

    if (loading) {
        return <p className="text-xs text-slate-400">Loading Pokédex flags...</p>;
    }

    if (!flags?.trackable) {
        return (
            <p className="text-xs text-slate-500">
                This species is not mapped to one of the {MAX_TRACKED_DEX_ID} Pokédex entries in this save layout.
            </p>
        );
    }

    const seen = Boolean(flags.seen);
    const caught = Boolean(flags.caught);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <StatusPill label="Seen" active={seen} icon={seen ? <Eye size={12} /> : <EyeOff size={12} />} />
                <StatusPill label="Caught" active={caught} icon={caught ? <Check size={12} /> : <X size={12} />} />
            </div>
            <div className="flex flex-wrap gap-2">
                <FlagButton label={seen ? 'Clear Seen' : 'Mark Seen'} disabled={updating !== null} onClick={() => updateFlag('seen', !seen)} />
                <FlagButton label={caught ? 'Clear Caught' : 'Mark Caught'} disabled={updating !== null} onClick={() => updateFlag('caught', !caught)} />
            </div>
            {updating && <p className="text-[10px] text-slate-400">Updating {updating}...</p>}
            {error && <p className="text-[10px] text-rose-300">{error}</p>}
            <p className="text-[10px] text-slate-500">Marking Caught also marks Seen. Download the save to keep this change.</p>
        </div>
    );
}

function StatusPill({ label, active, icon }) {
    return (
        <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
            active ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200' : 'border-white/10 bg-slate-900/60 text-slate-400'
        }`}
        >
            {icon}
            {label}
        </span>
    );
}

function FlagButton({ label, onClick, disabled }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="rounded-lg border border-white/10 bg-slate-900/80 px-3 py-1.5 text-[10px] font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
            {label}
        </button>
    );
}
