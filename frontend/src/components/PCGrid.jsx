import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Package } from 'lucide-react';
import { POKEMON_ICON_FALLBACK_URL } from '../core/iconResolver.js';

const VISIBLE_BOX_SEQUENCE = [...Array.from({ length: 24 }, (_, idx) => idx + 1), 26];
const BOX_SLOTS = 30;

function getBoxLabel(boxId) {
    return Number(boxId) === 26 ? 'Preset' : `Box ${boxId}`;
}

const PCGrid = ({ client, boxId, onBoxChange, onEditPokemon, onAddPokemon }) => {
    const [pokemon, setPokemon] = useState([]);
    const [writableSlots, setWritableSlots] = useState(new Set());
    const [loading, setLoading] = useState(false);
    const [pcLoaded, setPcLoaded] = useState(false);
    const fetchBox = useCallback(async (id) => {
        setLoading(true);
        try {
            if (!pcLoaded) {
                await client.loadPc();
                setPcLoaded(true);
            }

            const [data, writable] = await Promise.all([
                client.getPcBox(id),
                client.getPcWritableSlots(id),
            ]);
            setPokemon(data);
            setWritableSlots(new Set((writable?.writable_slots || []).map((slot) => Number(slot))));
        } catch (err) {
            console.error("Box loading error", err);
            setWritableSlots(new Set());
        } finally {
            setLoading(false);
        }
    }, [client, pcLoaded]);

    useEffect(() => {
        fetchBox(boxId);
    }, [boxId, fetchBox]);

    useEffect(() => {
        setPcLoaded(false);
    }, [client]);

    useEffect(() => {
        if (!VISIBLE_BOX_SEQUENCE.includes(Number(boxId))) {
            onBoxChange(1);
        }
    }, [boxId, onBoxChange]);

    const handlePrevBox = () => {
        const idx = VISIBLE_BOX_SEQUENCE.indexOf(Number(boxId));
        const curr = idx >= 0 ? idx : 0;
        const prev = (curr - 1 + VISIBLE_BOX_SEQUENCE.length) % VISIBLE_BOX_SEQUENCE.length;
        onBoxChange(VISIBLE_BOX_SEQUENCE[prev]);
    };

    const handleNextBox = () => {
        const idx = VISIBLE_BOX_SEQUENCE.indexOf(Number(boxId));
        const curr = idx >= 0 ? idx : 0;
        const next = (curr + 1) % VISIBLE_BOX_SEQUENCE.length;
        onBoxChange(VISIBLE_BOX_SEQUENCE[next]);
    };

    const normalizedSlots = Array.from({ length: BOX_SLOTS }, (_, idx) => {
        const slot = idx + 1;
        return {
            slot,
            pokemon: null,
        };
    });

    pokemon.forEach((pk) => {
        const rawSlot = Number(pk.slot);
        const normalizedSlot = Number.isFinite(rawSlot)
            ? (rawSlot >= 1 && rawSlot <= BOX_SLOTS ? rawSlot : (rawSlot >= 0 && rawSlot < BOX_SLOTS ? rawSlot + 1 : null))
            : null;
        if (!normalizedSlot) return;
        normalizedSlots[normalizedSlot - 1] = {
            slot: normalizedSlot,
            pokemon: pk,
        };
    });

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between bg-slate-800/50 p-4 rounded-3xl border border-white/5 shadow-inner">
                <button
                    onClick={handlePrevBox}
                    className="p-3 bg-slate-700/50 hover:bg-blue-600 hover:text-white rounded-2xl transition-all active:scale-90 shadow-lg"
                >
                    <ChevronLeft size={24} />
                </button>

                <div className="text-center">
                    <h2 className="text-xl font-black text-blue-400 uppercase tracking-tighter">
                        {getBoxLabel(boxId)}
                    </h2>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                        {pokemon.length} / {BOX_SLOTS} Pokemon
                    </p>
                </div>

                <button
                    onClick={handleNextBox}
                    className="p-3 bg-slate-700/50 hover:bg-blue-600 hover:text-white rounded-2xl transition-all active:scale-90 shadow-lg"
                >
                    <ChevronRight size={24} />
                </button>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {loading ? (
                    <div className="col-span-full py-20 text-center text-slate-500 animate-pulse">
                        Syncing box...
                    </div>
                ) : (
                    normalizedSlots.map(({ slot, pokemon: pk }) => {
                        const writable = writableSlots.has(slot);
                        return (
                        <div
                            key={slot}
                            onClick={() => {
                                if (!pk) {
                                    if (!writable) {
                                        return;
                                    }
                                    onAddPokemon?.({ box: boxId, slot });
                                    return;
                                }
                                onEditPokemon(pk);
                            }}
                            className={`group p-2.5 sm:p-3 rounded-2xl border transition-all ${
                                pk
                                    ? 'bg-[#1e293b] border-white/5 hover:border-blue-500/50 cursor-pointer'
                                    : writable
                                        ? 'bg-slate-900/40 border-dashed border-white/10 hover:border-emerald-400/40 cursor-pointer'
                                        : 'bg-slate-900/30 border-dashed border-white/5 opacity-60 cursor-not-allowed'
                            }`}
                        >
                            <div className="relative w-full aspect-square bg-slate-800/50 rounded-xl flex items-center justify-center mb-2 overflow-hidden">
                                {pk ? (
                                    <img
                                        src={client.getPokemonIconUrl(pk.species_id)}
                                        alt={pk.nickname}
                                        className="w-14 h-14 object-contain pixelated group-hover:scale-110 transition-transform"
                                        onError={(e) => {
                                            if (e.currentTarget.src !== POKEMON_ICON_FALLBACK_URL) {
                                                e.currentTarget.src = POKEMON_ICON_FALLBACK_URL;
                                            }
                                        }}
                                    />
                                ) : (
                                    <span className={`text-[10px] font-mono ${writable ? 'text-slate-500 group-hover:text-emerald-300' : 'text-slate-600'}`}>
                                        {writable ? '+ ADD' : 'LOCKED'}
                                    </span>
                                )}
                            </div>
                            <div className="text-center min-h-10">
                                <p className={`text-xs font-bold truncate ${pk ? 'text-slate-100' : 'text-slate-500'}`}>
                                    {pk ? pk.nickname : 'Empty Slot'}
                                </p>
                                <p className="text-[10px] text-slate-500 font-mono uppercase">
                                    Slot {slot}{!pk && !writable ? ' (N/A)' : ''}
                                </p>
                            </div>
                        </div>
                    )})
                )}
            </div>

                {!loading && pokemon.length === 0 && (
                    <div className="col-span-full py-20 text-center bg-slate-800/20 rounded-[2rem] border border-dashed border-white/10">
                        <Package className="mx-auto text-slate-700 mb-2" size={48} />
                        <p className="text-slate-500 italic">This box is empty</p>
                    </div>
                )}
        </div>
    );
};

export default PCGrid;
