import React, { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

export default function AddPcPokemonModal({ client, target, onClose, onConfirm }) {
    const [allSpecies, setAllSpecies] = useState([]);
    const [speciesSearch, setSpeciesSearch] = useState('');
    const [speciesId, setSpeciesId] = useState(null);
    const [nickname, setNickname] = useState('');
    const [level, setLevel] = useState('5');

    useEffect(() => {
        client.getSpecies().then((rows) => {
            setAllSpecies(rows || []);
            if (!speciesId && rows && rows.length > 0) {
                setSpeciesId(Number(rows[0].id));
                const firstName = rows[0].display_name || rows[0].name || '';
                setNickname(firstName);
            }
        });
    }, [client, speciesId]);

    const filteredSpecies = useMemo(() => {
        const q = speciesSearch.trim().toLowerCase();
        if (!q) {
            return allSpecies.slice(0, 24);
        }
        return allSpecies
            .filter((s) => {
                const name = String(s.label || s.display_name || s.name || '').toLowerCase();
                return name.includes(q) || String(s.id) === q;
            })
            .slice(0, 24);
    }, [allSpecies, speciesSearch]);

    const selectedSpecies = allSpecies.find((s) => Number(s.id) === Number(speciesId)) || null;

    return (
        <div
            className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-xl bg-[#0f172a] border border-white/10 rounded-[2rem] p-6"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold">Add Pokemon to Box {target.box}</h3>
                        <p className="text-xs text-slate-400">Target slot: {target.slot}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white">
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Species</label>
                        <div className="relative mt-2">
                            <Search className="absolute left-3 top-2.5 text-slate-500" size={14} />
                            <input
                                type="text"
                                value={speciesSearch}
                                onChange={(e) => setSpeciesSearch(e.target.value)}
                                placeholder="Search by name or ID"
                                className="w-full bg-slate-900 border border-white/10 rounded-xl py-2 pl-9 pr-4 text-xs"
                            />
                        </div>
                        <div className="mt-2 max-h-44 overflow-y-auto bg-slate-900 rounded-xl border border-white/10">
                            {filteredSpecies.map((s) => {
                                const active = Number(s.id) === Number(speciesId);
                                const label = s.label || s.display_name || s.name;
                                return (
                                    <button
                                        key={s.id}
                                        onClick={() => {
                                            setSpeciesId(Number(s.id));
                                            setNickname(s.display_name || s.name || '');
                                            setSpeciesSearch('');
                                        }}
                                        className={`w-full text-left px-3 py-2 text-xs border-b border-white/5 ${
                                            active ? 'bg-blue-600/30 text-blue-200' : 'hover:bg-slate-800 text-slate-200'
                                        }`}
                                    >
                                        <span className="text-blue-400 font-mono mr-2">{s.id}</span>
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Nickname</label>
                            <input
                                type="text"
                                value={nickname}
                                onChange={(e) => setNickname(e.target.value)}
                                maxLength={10}
                                className="mt-2 w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Level</label>
                            <input
                                type="number"
                                min="1"
                                max="100"
                                value={level}
                                onChange={(e) => setLevel(e.target.value)}
                                className="mt-2 w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm"
                            />
                        </div>
                    </div>

                    <div className="pt-2 flex gap-3">
                        <button
                            onClick={onClose}
                            className="flex-1 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => {
                                if (!selectedSpecies) {
                                    return;
                                }
                                onConfirm({
                                    box: target.box,
                                    slot: target.slot,
                                    species_id: Number(selectedSpecies.id),
                                    nickname,
                                    level: Math.max(1, Math.min(100, Number(level) || 5)),
                                });
                            }}
                            className="flex-1 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold"
                        >
                            Add Pokemon
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
