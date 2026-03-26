import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, Download } from 'lucide-react';
import { clampLevel, parseShowdownSet, resolveShowdownSet } from '../core/showdownImport.js';


export default function AddPcPokemonModal({ client, target, onClose, onConfirm, legitMode = false }) {
    const boxLabel = Number(target?.box) === 26 ? 'Preset' : `Box ${target?.box}`;
    const [allSpecies, setAllSpecies] = useState([]);
    const [allMoves, setAllMoves] = useState([]);
    const [allItems, setAllItems] = useState([]);
    const [allAbilities, setAllAbilities] = useState([]);

    const [speciesSearch, setSpeciesSearch] = useState('');
    const [speciesId, setSpeciesId] = useState(null);
    const [nickname, setNickname] = useState('');
    const [level, setLevel] = useState('5');

    const [showImport, setShowImport] = useState(false);
    const [setImportText, setSetImportText] = useState('');
    const [setImportErrors, setSetImportErrors] = useState([]);
    const [setImportWarnings, setSetImportWarnings] = useState([]);
    const [importDraft, setImportDraft] = useState(null);
    const [isApplying, setIsApplying] = useState(false);

    useEffect(() => {
        Promise.all([
            client.getSpecies(),
            client.getMoves(),
            client.getItems(),
            client.getAbilities(),
        ]).then(([species, moves, items, abilities]) => {
            const speciesRows = species || [];
            setAllSpecies(speciesRows);
            setAllMoves(moves || []);
            setAllItems(items || []);
            setAllAbilities(abilities || []);
            if (!speciesId && speciesRows.length > 0) {
                setSpeciesId(Number(speciesRows[0].id));
                const firstName = speciesRows[0].display_name || speciesRows[0].name || '';
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

    const applyShowdownImport = () => {
        if (!allSpecies.length || !allMoves.length || !allItems.length || !allAbilities.length) {
            setSetImportErrors(['Catalogs are still loading. Try again in a second.']);
            setSetImportWarnings([]);
            return;
        }

        const { parsed, errors } = parseShowdownSet(setImportText);
        const { errors: resolvedErrors, warnings, resolved } = resolveShowdownSet({
            parsed,
            catalogs: {
                species: allSpecies,
                items: allItems,
                moves: allMoves,
                abilities: allAbilities,
            },
            legitMode,
            levelFallback: 5,
        });

        const blocking = [...errors, ...resolvedErrors];
        if (blocking.length > 0) {
            setSetImportErrors(blocking);
            setSetImportWarnings(warnings);
            return;
        }

        const { speciesRow, itemRow, moveRows, natureId, abilityIndex, levelToApply } = resolved;
        if (speciesRow) {
            setSpeciesId(Number(speciesRow.id));
            if (parsed.nickname) {
                setNickname(parsed.nickname.slice(0, 10));
            } else {
                setNickname((speciesRow.display_name || speciesRow.name || '').slice(0, 10));
            }
        }

        if (levelToApply !== null) {
            setLevel(String(levelToApply));
        }

        const nextDraft = {};
        if (itemRow) nextDraft.item_id = Number(itemRow.id);
        if (moveRows.length > 0) {
            const ids = [0, 0, 0, 0];
            moveRows.forEach((m, idx) => { if (idx < 4) ids[idx] = Number(m.id); });
            nextDraft.moves = ids;
        }
        if (parsed.evs) nextDraft.evs = { ...parsed.evs };
        if (parsed.ivs) nextDraft.ivs = { ...parsed.ivs };
        if (natureId !== null) nextDraft.nature_id = natureId;
        if (abilityIndex !== null) nextDraft.current_ability_index = abilityIndex;
        if (parsed.shiny !== null) nextDraft.shiny = Boolean(parsed.shiny);

        setImportDraft(nextDraft);
        setSetImportErrors([]);
        setSetImportWarnings([
            ...warnings,
            'Set parsed successfully. Review fields and click Add Pokemon to commit.',
        ]);
    };

    const handleAddPokemon = async () => {
        if (!selectedSpecies) {
            return;
        }
        setIsApplying(true);
        try {
            const payload = {
                box: target.box,
                slot: target.slot,
                species_id: Number(selectedSpecies.id),
                nickname,
                level: clampLevel(level, 5),
                ...(importDraft || {}),
            };
            await Promise.resolve(onConfirm(payload));
        } finally {
            setIsApplying(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={isApplying ? undefined : onClose}
        >
            <div
                className="relative w-full max-w-xl bg-[#0f172a] border border-white/10 rounded-[2rem] p-6"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold">Add Pokemon to {boxLabel}</h3>
                        <p className="text-xs text-slate-400">Target slot: {target.slot}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setShowImport((prev) => !prev)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-[10px] font-bold uppercase tracking-widest"
                            title="Paste a Showdown/Smogon set"
                        >
                            <Download size={12} /> FROM SMOGON
                        </button>
                        <button onClick={onClose} disabled={isApplying} className="text-slate-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="space-y-4">
                    {showImport && (
                        <div className="bg-slate-800/40 p-4 rounded-2xl border border-white/5 space-y-3">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Smogon/Showdown Import</h4>
                            <textarea
                                value={setImportText}
                                onChange={(e) => setSetImportText(e.target.value)}
                                placeholder="Terrakion @ Choice Band\nAbility: Justified\nEVs: 252 Atk / 4 SpD / 252 Spe\nJolly Nature\n- Stone Edge\n- Close Combat\n- Earthquake\n- Quick Attack"
                                className="w-full h-36 bg-slate-900 border border-white/10 rounded-xl p-3 text-xs font-mono outline-none focus:border-blue-500/50"
                            />
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={applyShowdownImport}
                                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
                                >
                                    Parse & Fill Fields
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSetImportText('');
                                        setSetImportErrors([]);
                                        setSetImportWarnings([]);
                                        setImportDraft(null);
                                    }}
                                    className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-xs font-bold"
                                >
                                    Clear
                                </button>
                            </div>
                            {setImportErrors.length > 0 && (
                                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200 space-y-1">
                                    {setImportErrors.map((msg, idx) => (
                                        <p key={`${msg}-${idx}`}>- {msg}</p>
                                    ))}
                                </div>
                            )}
                            {setImportWarnings.length > 0 && (
                                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 space-y-1">
                                    {setImportWarnings.map((msg, idx) => (
                                        <p key={`${msg}-${idx}`}>- {msg}</p>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

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
                                            setNickname((s.display_name || s.name || '').slice(0, 10));
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
                                onBlur={() => setLevel(String(clampLevel(level, 5)))}
                                className="mt-2 w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm"
                            />
                            <p className="mt-2 text-[10px] text-slate-500">Level is capped to 1-100.</p>
                        </div>
                    </div>

                    <div className="pt-2 flex gap-3">
                        <button
                            onClick={onClose}
                            disabled={isApplying}
                            className="flex-1 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleAddPokemon}
                            disabled={isApplying}
                            className="flex-1 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Add Pokemon
                        </button>
                    </div>
                </div>

                {isApplying && (
                    <div className="absolute inset-0 z-20 bg-black/70 backdrop-blur-sm flex items-center justify-center rounded-[2rem]">
                        <div className="bg-slate-900 border border-white/10 rounded-2xl px-6 py-5 text-center space-y-2 min-w-[260px]">
                            <div className="w-7 h-7 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto" />
                            <p className="text-sm font-bold text-emerald-300">Adding Pokemon</p>
                            <p className="text-xs text-slate-400">Applying set data, inserting slot, and saving...</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
