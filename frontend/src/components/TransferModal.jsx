import React, { useEffect, useState } from 'react';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react';
import { PROFILE } from '../core/profile.js';
import { POKEMON_ICON_FALLBACK_URL } from '../core/iconResolver.js';

const BOX_SLOTS = 30;

export default function TransferModal({ client, target, onClose, onCompleted }) {
    const isPartySource = target?.sourceType === 'party';
    const boxCount = Number(PROFILE.storage.pc.box_count);

    const [selectedBox, setSelectedBox] = useState(1);
    const [boxMons, setBoxMons] = useState([]);
    const [partyMons, setPartyMons] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && !submitting) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose, submitting]);

    useEffect(() => {
        let cancelled = false;
        async function loadTargets() {
            setLoading(true);
            setError('');
            try {
                if (isPartySource) {
                    await client.loadPc();
                    const rows = await client.getPcBox(selectedBox);
                    if (!cancelled) {
                        setBoxMons(Array.isArray(rows) ? rows : []);
                    }
                } else {
                    const rows = await client.getParty();
                    if (!cancelled) {
                        setPartyMons(Array.isArray(rows) ? rows : []);
                    }
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err?.message || 'Failed to load transfer targets.');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }
        loadTargets();
        return () => {
            cancelled = true;
        };
    }, [client, isPartySource, selectedBox]);

    const runTransfer = async (payload) => {
        if (submitting) return;
        setSubmitting(true);
        setError('');
        try {
            const result = await client.transferPartyPc(payload);
            await onCompleted?.(result);
        } catch (err) {
            setError(err?.message || 'Transfer failed.');
        } finally {
            setSubmitting(false);
        }
    };

    const partyCount = isPartySource ? Number(target?.partyCount || 0) : partyMons.length;
    const canMovePartyToPc = isPartySource && partyCount > 1;
    const canMovePcToParty = !isPartySource && partyMons.length < Number(PROFILE.storage.party.capacity || 6);

    const slotMap = new Map();
    boxMons.forEach((mon) => {
        const slotNum = Number(mon.slot);
        if (Number.isInteger(slotNum) && slotNum >= 1 && slotNum <= BOX_SLOTS) {
            slotMap.set(slotNum, mon);
        }
    });

    const sourcePokemon = target?.pokemon || {};
    const sourceLabel = sourcePokemon.nickname || sourcePokemon.species_name || 'Pokémon';
    const sourceSub = isPartySource
        ? `Party #${Number(sourcePokemon.index ?? 0) + 1} · Lv. ${sourcePokemon.level ?? '?'}`
        : `Box ${target?.box} Slot ${target?.slot} · Lv. ${sourcePokemon.level ?? '?'}`;

    return (
        <div
            role="presentation"
            onClick={(event) => {
                if (event.target === event.currentTarget && !submitting) {
                    onClose();
                }
            }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="transfer-modal-title"
                className="max-h-[88dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-600 bg-slate-900 p-5 text-slate-100 shadow-2xl"
            >
                <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="h-12 w-12 shrink-0 rounded-xl border border-white/10 bg-slate-800 flex items-center justify-center overflow-hidden">
                            <img
                                src={client.getPokemonIconUrl(sourcePokemon)}
                                alt={sourceLabel}
                                className="h-10 w-10 object-contain pixelated"
                                onError={(e) => {
                                    if (e.currentTarget.src !== POKEMON_ICON_FALLBACK_URL) {
                                        e.currentTarget.src = POKEMON_ICON_FALLBACK_URL;
                                    }
                                }}
                            />
                        </div>
                        <div className="min-w-0">
                            <h2 id="transfer-modal-title" className="text-lg font-bold text-white truncate">
                                {isPartySource ? `Transfer ${sourceLabel} to PC` : `Transfer ${sourceLabel} to Party`}
                            </h2>
                            <p className="text-xs text-slate-400">{sourceSub}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        disabled={submitting}
                        onClick={onClose}
                        aria-label="Close transfer dialog"
                        className="rounded-lg p-2 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                    >
                        <X size={18} />
                    </button>
                </div>

                {error && (
                    <p role="alert" className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                        {error}
                    </p>
                )}

                {isPartySource ? (
                    <div className="mt-4 space-y-4">
                        <div className="rounded-xl border border-white/10 bg-slate-800/50 p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="text-sm font-semibold text-white">Quick Deposit</p>
                                <p className="text-xs text-slate-400">
                                    {canMovePartyToPc
                                        ? `Move to the first open ordinary PC slot (Boxes 1–${boxCount}).`
                                        : 'Cannot move the last Pokémon out of your party — swap with a PC Pokémon below.'}
                                </p>
                            </div>
                            <button
                                type="button"
                                disabled={!canMovePartyToPc || submitting}
                                onClick={() => runTransfer({
                                    mode: 'party_to_pc',
                                    party_index: sourcePokemon.index,
                                    box: null,
                                    slot: null,
                                })}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
                            >
                                <Inbox size={16} />
                                First Empty PC Slot
                            </button>
                        </div>

                        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-800/40 px-3 py-2">
                            <button
                                type="button"
                                disabled={submitting}
                                onClick={() => setSelectedBox((prev) => (prev <= 1 ? boxCount : prev - 1))}
                                aria-label="Previous box"
                                className="rounded-lg p-2 hover:bg-slate-700 disabled:opacity-50"
                            >
                                <ChevronLeft size={18} />
                            </button>
                            <div className="flex items-center gap-2">
                                <label htmlFor="transfer-box-select" className="text-xs font-semibold text-slate-400">
                                    Destination
                                </label>
                                <select
                                    id="transfer-box-select"
                                    value={selectedBox}
                                    disabled={submitting}
                                    onChange={(e) => setSelectedBox(Number(e.target.value))}
                                    className="rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1 text-sm font-bold text-blue-300"
                                >
                                    {Array.from({ length: boxCount }, (_, i) => i + 1).map((b) => (
                                        <option key={b} value={b}>Box {b}</option>
                                    ))}
                                </select>
                            </div>
                            <button
                                type="button"
                                disabled={submitting}
                                onClick={() => setSelectedBox((prev) => (prev >= boxCount ? 1 : prev + 1))}
                                aria-label="Next box"
                                className="rounded-lg p-2 hover:bg-slate-700 disabled:opacity-50"
                            >
                                <ChevronRight size={18} />
                            </button>
                        </div>

                        {loading ? (
                            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
                                <Loader2 className="animate-spin" size={18} /> Loading Box {selectedBox}...
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                                {Array.from({ length: BOX_SLOTS }, (_, i) => i + 1).map((slotNum) => {
                                    const occupant = slotMap.get(slotNum) || null;
                                    const disabled = submitting || (!occupant && !canMovePartyToPc);
                                    return (
                                        <button
                                            key={slotNum}
                                            type="button"
                                            disabled={disabled}
                                            onClick={() => runTransfer({
                                                mode: occupant ? 'swap_party_pc' : 'party_to_pc',
                                                party_index: sourcePokemon.index,
                                                box: selectedBox,
                                                slot: slotNum,
                                            })}
                                            className={`flex flex-col items-center justify-center rounded-xl border p-2 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                                occupant
                                                    ? 'border-amber-500/30 bg-slate-800/80 hover:border-amber-400 hover:bg-slate-800'
                                                    : 'border-dashed border-white/15 bg-slate-900/60 hover:border-blue-400 hover:bg-slate-800/60'
                                            }`}
                                        >
                                            {occupant ? (
                                                <>
                                                    <img
                                                        src={client.getPokemonIconUrl(occupant)}
                                                        alt={occupant.nickname || occupant.species_name}
                                                        className="h-9 w-9 object-contain pixelated"
                                                        onError={(e) => {
                                                            if (e.currentTarget.src !== POKEMON_ICON_FALLBACK_URL) {
                                                                e.currentTarget.src = POKEMON_ICON_FALLBACK_URL;
                                                            }
                                                        }}
                                                    />
                                                    <span className="mt-1 w-full truncate text-[11px] font-semibold text-slate-100">
                                                        {occupant.nickname || occupant.species_name}
                                                    </span>
                                                    <span className="text-[10px] font-bold uppercase text-amber-300">
                                                        Slot {slotNum} · Swap
                                                    </span>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="text-[11px] font-semibold text-slate-300">
                                                        Slot {slotNum}
                                                    </span>
                                                    <span className="mt-1 text-[10px] font-bold uppercase text-blue-300">
                                                        {canMovePartyToPc ? 'Move here' : 'Swap only'}
                                                    </span>
                                                </>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="mt-4 space-y-4">
                        <div className="rounded-xl border border-white/10 bg-slate-800/50 p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="text-sm font-semibold text-white">Add to Party</p>
                                <p className="text-xs text-slate-400">
                                    {loading
                                        ? 'Checking party slots...'
                                        : canMovePcToParty
                                            ? `Move into open party slot #${partyMons.length + 1}.`
                                            : 'Party is full (6/6) — choose a party Pokémon below to swap.'}
                                </p>
                            </div>
                            <button
                                type="button"
                                disabled={loading || !canMovePcToParty || submitting}
                                onClick={() => runTransfer({
                                    mode: 'pc_to_party',
                                    party_index: null,
                                    box: target.box,
                                    slot: target.slot,
                                })}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
                            >
                                <ArrowLeftRight size={16} />
                                Move to Party
                            </button>
                        </div>

                        <div>
                            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                                Or swap with a Party Pokémon
                            </h3>
                            {loading ? (
                                <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
                                    <Loader2 className="animate-spin" size={18} /> Loading Party...
                                </div>
                            ) : (
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {partyMons.map((pk) => (
                                        <button
                                            key={pk.index}
                                            type="button"
                                            disabled={submitting}
                                            onClick={() => runTransfer({
                                                mode: 'swap_party_pc',
                                                party_index: pk.index,
                                                box: target.box,
                                                slot: target.slot,
                                            })}
                                            className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-800/70 p-2.5 text-left hover:border-amber-400 hover:bg-slate-800 disabled:opacity-50"
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <img
                                                    src={client.getPokemonIconUrl(pk)}
                                                    alt={pk.nickname || pk.species_name}
                                                    className="h-10 w-10 shrink-0 object-contain pixelated"
                                                    onError={(e) => {
                                                        if (e.currentTarget.src !== POKEMON_ICON_FALLBACK_URL) {
                                                            e.currentTarget.src = POKEMON_ICON_FALLBACK_URL;
                                                        }
                                                    }}
                                                />
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-bold text-slate-100">
                                                        {pk.nickname || pk.species_name}
                                                    </p>
                                                    <p className="text-xs text-slate-400">
                                                        Party #{pk.index + 1} · Lv. {pk.level}
                                                    </p>
                                                </div>
                                            </div>
                                            <span className="shrink-0 rounded-lg bg-amber-500/20 px-2.5 py-1 text-xs font-bold text-amber-300">
                                                Swap
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
