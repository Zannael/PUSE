import React, { useCallback, useEffect, useState } from 'react';
import { Check, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { MAX_TRACKED_DEX_ID } from '../core/pokedexFlags.js';

function confirmFlagChange(speciesLabel, flag, nextValue) {
    const action = nextValue ? 'set' : 'clear';
    const flagLabel = flag === 'caught' ? 'Caught' : 'Seen';
    return window.confirm(
        `${action === 'set' ? 'Mark' : 'Clear'} ${flagLabel} for ${speciesLabel}?\n\nThis writes directly to your save dex flags.`,
    );
}

export default function PokedexFlagsControls({
    client,
    speciesId,
    speciesLabel = '',
    compact = false,
    onUpdated,
}) {
    const [flags, setFlags] = useState(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(null);
    const [error, setError] = useState(null);

    const sid = Number(speciesId);
    const label = speciesLabel || `Species ${sid}`;

    const loadFlags = useCallback(async () => {
        if (!client || !Number.isFinite(sid) || sid <= 0) {
            setFlags(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const data = await client.getPokedexSpeciesFlags(sid);
            setFlags(data);
        } catch (err) {
            setFlags(null);
            setError(err?.message || 'Failed to load dex flags');
        } finally {
            setLoading(false);
        }
    }, [client, sid]);

    useEffect(() => {
        loadFlags();
    }, [loadFlags]);

    const handleToggle = async (flag, nextValue) => {
        if (!confirmFlagChange(label, flag, nextValue)) {
            return;
        }
        setUpdating(flag);
        setError(null);
        try {
            const updated = await client.updatePokedexFlags(sid, { [flag]: nextValue });
            setFlags(updated);
            if (typeof onUpdated === 'function') {
                onUpdated(updated);
            }
        } catch (err) {
            setError(err?.message || 'Failed to update dex flags');
        } finally {
            setUpdating(null);
        }
    };

    if (loading) {
        return (
            <div className={`flex items-center gap-2 text-slate-400 ${compact ? 'text-[10px]' : 'text-xs'}`}>
                <Loader2 size={14} className="animate-spin" />
                Loading dex flags...
            </div>
        );
    }

    if (!flags?.trackable) {
        return (
            <p className={`text-slate-500 ${compact ? 'text-[10px]' : 'text-xs'}`}>
                Dex flags are only stored for species IDs 1–{MAX_TRACKED_DEX_ID}. This species is outside the save bitfield.
            </p>
        );
    }

    const seenActive = Boolean(flags.seen);
    const caughtActive = Boolean(flags.caught);

    return (
        <div className={`space-y-2 ${compact ? '' : 'rounded-2xl border border-white/10 bg-slate-800/40 p-4'}`}>
            {!compact && (
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Living Dex flags
                </p>
            )}
            <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'justify-between'}`}>
                <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                        label="Seen"
                        active={seenActive}
                        icon={seenActive ? <Eye size={12} /> : <EyeOff size={12} />}
                    />
                    <StatusPill
                        label="Caught"
                        active={caughtActive}
                        icon={caughtActive ? <Check size={12} /> : <X size={12} />}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <FlagButton
                        label={seenActive ? 'Clear seen' : 'Mark seen'}
                        disabled={updating !== null}
                        onClick={() => handleToggle('seen', !seenActive)}
                        compact={compact}
                    />
                    <FlagButton
                        label={caughtActive ? 'Clear caught' : 'Mark caught'}
                        disabled={updating !== null}
                        onClick={() => handleToggle('caught', !caughtActive)}
                        compact={compact}
                    />
                </div>
            </div>
            {updating && (
                <p className="text-[10px] text-slate-400">Updating {updating}...</p>
            )}
            {error && (
                <p className="text-[10px] text-rose-300">{error}</p>
            )}
            {!compact && (
                <p className="text-[10px] text-slate-500">
                    Marking Caught also sets Seen (matches in-game behavior). Changes apply to the loaded save; download to keep them.
                </p>
            )}
        </div>
    );
}

function StatusPill({ label, active, icon }) {
    return (
        <span
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                active
                    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                    : 'border-white/10 bg-slate-900/60 text-slate-400'
            }`}
        >
            {icon}
            {label}
        </span>
    );
}

function FlagButton({ label, onClick, disabled, compact }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`rounded-lg border border-white/10 bg-slate-900/80 font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50 ${
                compact ? 'px-2 py-1 text-[9px]' : 'px-3 py-1.5 text-[10px]'
            }`}
        >
            {label}
        </button>
    );
}
