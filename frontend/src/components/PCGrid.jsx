import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Package } from 'lucide-react';

// 1. DEFINISCI IL NUMERO TOTALE DI BOX (Unbound ne ha 26)
const TOTAL_BOXES = 26;

const PCGrid = ({ onEditPokemon }) => {
    const [boxId, setBoxId] = useState(1);
    const [pokemon, setPokemon] = useState([]);
    const [loading, setLoading] = useState(false);
    const [pcLoaded, setPcLoaded] = useState(false);
    const API_BASE = import.meta.env.VITE_API_BASE_URL;

    const fetchBox = async (id) => {
        setLoading(true);
        try {
            // 2. CARICA IL PC IN MEMORIA SOLO SE NON È GIÀ STATO FATTO
            if (!pcLoaded) {
                await fetch(`${API_BASE}/pc/load`);
                setPcLoaded(true);
            }

            const res = await fetch(`${API_BASE}/pc/box/${id}`);
            const data = await res.json();
            setPokemon(data);
        } catch (err) {
            console.error("Errore caricamento box", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBox(boxId);
    }, [boxId]);

    // 3. LOGICA CIRCOLARE CORRETTA
    const handlePrevBox = () => {
        setBoxId(prev => (prev === 1 ? TOTAL_BOXES : prev - 1));
    };

    const handleNextBox = () => {
        setBoxId(prev => (prev === TOTAL_BOXES ? 1 : prev + 1));
    };

    return (
        <div className="space-y-6">
            {/* Selettore Box Circolare */}
            <div className="flex items-center justify-between bg-slate-800/50 p-4 rounded-3xl border border-white/5 shadow-inner">
                <button
                    onClick={handlePrevBox}
                    className="p-3 bg-slate-700/50 hover:bg-blue-600 hover:text-white rounded-2xl transition-all active:scale-90 shadow-lg"
                >
                    <ChevronLeft size={24} />
                </button>

                <div className="text-center">
                    <h2 className="text-xl font-black text-blue-400 uppercase tracking-tighter">
                        Box {boxId}
                    </h2>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                        {pokemon.length} / 30 Pokémon
                    </p>
                </div>

                <button
                    onClick={handleNextBox}
                    className="p-3 bg-slate-700/50 hover:bg-blue-600 hover:text-white rounded-2xl transition-all active:scale-90 shadow-lg"
                >
                    <ChevronRight size={24} />
                </button>
            </div>

            {/* Griglia PC */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                {loading ? (
                    <div className="col-span-full py-20 text-center text-slate-500 animate-pulse">
                        Sincronizzazione Box...
                    </div>
                ) : (
                    pokemon.map((pk) => (
                        <div
                            key={pk.slot}
                            onClick={() => onEditPokemon(pk)} // <--- Trigger click
                            className="group bg-[#1e293b] border border-white/5 p-4 rounded-3xl hover:border-blue-500/50 transition-all cursor-pointer"
                        >
                            <div className="relative w-full aspect-square bg-slate-800/50 rounded-2xl flex items-center justify-center mb-3 overflow-hidden">
                                <img
                                    src={`${API_BASE}/pokemon-icon/${pk.species_id}`}
                                    alt={pk.nickname}
                                    className="w-16 h-16 object-contain pixelated group-hover:scale-110 transition-transform"
                                />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-bold truncate">{pk.nickname}</p>
                                <p className="text-[10px] text-slate-500 font-mono uppercase">Slot {pk.slot}</p>
                            </div>
                        </div>
                    ))
                )}

                {!loading && pokemon.length === 0 && (
                    <div className="col-span-full py-20 text-center bg-slate-800/20 rounded-[2rem] border border-dashed border-white/10">
                        <Package className="mx-auto text-slate-700 mb-2" size={48} />
                        <p className="text-slate-500 italic">Questo box è vuoto</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PCGrid;
