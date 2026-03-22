import React from 'react';
import { Zap, Shield, Heart, Target, Wind, Activity } from 'lucide-react';
import { POKEMON_ICON_FALLBACK_URL } from '../core/iconResolver.js';

const PokemonCard = ({ pokemon, onEdit, getPokemonIconUrl }) => {
    // Funzione per il colore delle barre IV (0-31)
    const getIvColor = (val) => {
        if (val === 31) return 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]';
        if (val >= 20) return 'bg-blue-400';
        if (val >= 10) return 'bg-amber-400';
        return 'bg-rose-500';
    };

    const stats = [
        { label: 'HP', val: pokemon.ivs.HP, icon: <Heart size={12}/> },
        { label: 'ATK', val: pokemon.ivs.Atk, icon: <Target size={12}/> },
        { label: 'DEF', val: pokemon.ivs.Def, icon: <Shield size={12}/> },
        { label: 'SPA', val: pokemon.ivs.SpA, icon: <Zap size={12}/> },
        { label: 'SPD', val: pokemon.ivs.SpD, icon: <Activity size={12}/> },
        { label: 'SPE', val: pokemon.ivs.Spd || pokemon.ivs.Spe, icon: <Wind size={12}/> },
    ];
    return (
        <div
            onClick={() => onEdit(pokemon)}
            className="cursor-pointer bg-[#1e293b] border border-white/5 rounded-[2rem] p-5 hover:border-blue-500/50 transition-all group shadow-xl active:scale-[0.98]"
        >
            <div className="flex items-center gap-5 mb-6">
                {/* Icona Pokemon */}
                <div className="relative">
                    <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full group-hover:bg-blue-500/40 transition-colors"></div>
                    <div
                        className="relative w-20 h-20 bg-slate-800/80 rounded-3xl flex items-center justify-center border border-white/10 overflow-hidden ring-1 ring-white/5">
                        <img
                            // Interroga il backend passando solo l'ID numerico
                            src={getPokemonIconUrl(pokemon.species_id)}
                            alt={pokemon.species_name}
                            className="w-16 h-16 object-contain pixelated"
                            onError={(e) => {
                                if (e.currentTarget.src !== POKEMON_ICON_FALLBACK_URL) {
                                    e.currentTarget.src = POKEMON_ICON_FALLBACK_URL;
                                }
                            }}
                        />
                    </div>
                </div>

                <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-bold truncate group-hover:text-blue-400 transition-colors">
                        {pokemon.nickname}
                    </h3>
                    <div className="flex flex-wrap gap-2 mt-2">
                        <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2.5 py-1 rounded-lg font-black uppercase tracking-widest border border-blue-500/20">
                            Lv. {pokemon.level}
                        </span>
                        <span className="text-[10px] bg-slate-700/50 text-slate-300 px-2.5 py-1 rounded-lg font-bold uppercase border border-white/5">
                            {pokemon.nature}
                        </span>
                        <span className="text-[10px] bg-slate-700/50 text-slate-300 px-2.5 py-1 rounded-lg font-bold border border-white/5">
                            {pokemon.ability_label_current || 'Ability'}
                        </span>
                    </div>
                </div>

                {pokemon.is_hidden_ability && (
                    <div className="bg-amber-500/20 text-amber-500 p-2 rounded-xl border border-amber-500/20">
                        <Zap size={16} fill="currentColor" />
                    </div>
                )}
            </div>

            {/* Statistiche IVs */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                {stats.map((s) => (
                    <div key={s.label} className="space-y-1.5">
                        <div className="flex justify-between items-center">
                            <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                                {s.icon} {s.label}
                            </span>
                            <span className={`text-[10px] font-mono font-bold ${s.val === 31 ? "text-emerald-400" : "text-slate-300"}`}>
                                {s.val}
                            </span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-900 rounded-full p-[1px]">
                            <div
                                className={`h-full rounded-full transition-all duration-1000 ease-out ${getIvColor(s.val)}`}
                                style={{ width: `${(s.val / 31) * 100}%` }}
                            ></div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default PokemonCard;
