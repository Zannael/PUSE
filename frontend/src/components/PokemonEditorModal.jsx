import React, { useState, useEffect } from 'react';
import { X, Zap, Save, Search, Download } from 'lucide-react';
import { calcCurrentLevel, GROWTH_OPTIONS } from '../core/growth.js';
import { ITEM_ICON_FALLBACK_URL, POKEMON_ICON_FALLBACK_URL } from '../core/iconResolver.js';
import { NATURES, normalizeName, parseShowdownSet, resolveShowdownSet } from '../core/showdownImport.js';

const EV_STAT_MAX = 252;
const EV_TOTAL_MAX = 510;
const MIN_LEVEL = 1;
const MAX_LEVEL = 100;
const clampNumber = (value, min, max) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return min;
    return Math.max(min, Math.min(max, parsed));
};

const getSpeedStatValue = (stats = {}) =>
    Number(stats.Spd ?? stats.Spe ?? 0);

const getTotalEvs = (evs = {}) =>
    Number(evs.HP ?? 0) +
    Number(evs.Atk ?? 0) +
    Number(evs.Def ?? 0) +
    Number(evs.SpA ?? 0) +
    Number(evs.SpD ?? 0) +
    getSpeedStatValue(evs);

export const PokemonEditorModal = ({ client, pokemon, legitMode = false, onClose, onSave }) => {
    const isPcMon = Boolean(pokemon?.isPC);
    const SAFE_IMPORT_NOTE = 'Existing Pokemon import applies item, moves, IVs, EVs, nature, and ability (if valid). Species, level, and identity metadata are preserved.';
    const initialGrowthMode = 'auto';
    const inferredSpeciesGrowth = Number.isInteger(Number(pokemon?.species_growth_rate))
        ? Number(pokemon?.species_growth_rate)
        : 0;
    const initialLevel = pokemon?.level ?? (isPcMon ? calcCurrentLevel(inferredSpeciesGrowth, Number(pokemon?.exp || 0)) : 1);

    const [activeTab, setActiveTab] = useState('stats');
    const [localPk, setLocalPk] = useState({
        ...pokemon,
        moves: Array.isArray(pokemon?.moves) ? [...pokemon.moves].slice(0, 4) : [0, 0, 0, 0],
        move_pp: Array.isArray(pokemon?.move_pp) ? [...pokemon.move_pp].slice(0, 4) : [0, 0, 0, 0],
        move_pp_ups: Array.isArray(pokemon?.move_pp_ups) ? [...pokemon.move_pp_ups].slice(0, 4) : [0, 0, 0, 0],
    });
    const [allMoves, setAllMoves] = useState([]);
    const [allAbilities, setAllAbilities] = useState([]);
    const [searchTerm, setSearchTerm] = useState(['', '', '', '']);
    const [allItems, setAllItems] = useState([]);
    const [allSpecies, setAllSpecies] = useState([]);
    const [itemSearch, setItemSearch] = useState('');
    const [speciesSearch, setSpeciesSearch] = useState('');
    const [renameOnSpeciesChange, setRenameOnSpeciesChange] = useState(() => {
        const nick = String(pokemon?.nickname || '').trim().toLowerCase();
        const speciesDisplay = String(pokemon?.species_display_name || pokemon?.species_name || '').trim().toLowerCase();
        return Boolean(nick && speciesDisplay && nick === speciesDisplay);
    });
    const [levelInput, setLevelInput] = useState(String(initialLevel));
    const [levelGrowthMode, setLevelGrowthMode] = useState(initialGrowthMode);
    const [levelDirty, setLevelDirty] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [setImportText, setSetImportText] = useState('');
    const [setImportErrors, setSetImportErrors] = useState([]);
    const [setImportWarnings, setSetImportWarnings] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStage, setSaveStage] = useState('Applying changes...');

    const hasKnownItemName = (name) => {
        if (!name) return false;
        const low = name.toLowerCase();
        return !low.startsWith('item ') && !low.startsWith('id ') && name !== '--- EMPTY ---';
    };

    const currentItem = allItems.find(i => i.id === localPk.item_id);
    const currentItemName = currentItem?.name || `ID ${localPk.item_id}`;
    const currentSpecies = allSpecies.find(s => s.id === localPk.species_id);
    const currentSpeciesName = currentSpecies?.label || currentSpecies?.name || `Species ${localPk.species_id}`;
    const canShowItemIcon =
        localPk.item_id > 0 &&
        !!currentItem &&
        hasKnownItemName(currentItem.name);

    useEffect(() => {
        client.getMoves()
            .then(data => setAllMoves(data));
    }, [client]);

    useEffect(() => {
        client.getAbilities()
            .then(data => setAllAbilities(data));
    }, [client]);

    const updateStat = (type, stat, val) => {
        setLocalPk((prev) => {
            const nextGroup = { ...(prev[type] || {}) };

            if (type === 'ivs') {
                nextGroup[stat] = clampNumber(val, 0, 31);
            } else if (type === 'evs') {
                let nextEv = clampNumber(val, 0, EV_STAT_MAX);
                if (legitMode) {
                    const currentTotal = getTotalEvs(prev.evs || {});
                    const currentStat = Number((prev.evs || {})[stat] ?? 0);
                    const totalWithoutCurrent = currentTotal - currentStat;
                    const remainingForCurrent = Math.max(0, EV_TOTAL_MAX - totalWithoutCurrent);
                    nextEv = Math.min(nextEv, remainingForCurrent);
                }
                nextGroup[stat] = nextEv;
            } else {
                nextGroup[stat] = clampNumber(val, 0, Number.MAX_SAFE_INTEGER);
            }

            return {
                ...prev,
                [type]: nextGroup,
            };
        });
    };

    const updateMove = (slotIndex, moveId) => {
        const nextMoveId = Number.parseInt(moveId, 10) || 0;
        const newMoves = [...(localPk.moves || [0, 0, 0, 0])];
        const newMovePp = [...(localPk.move_pp || [0, 0, 0, 0])];
        const newMovePpUps = [...(localPk.move_pp_ups || [0, 0, 0, 0])];
        newMoves[slotIndex] = nextMoveId;

        if (nextMoveId <= 0) {
            newMovePpUps[slotIndex] = 0;
            newMovePp[slotIndex] = 0;
        } else {
            const moveEntry = allMoves.find((m) => Number(m.id) === nextMoveId);
            const basePp = Number(moveEntry?.base_pp || 0);
            const ppUp = Math.max(0, Math.min(3, Number(newMovePpUps[slotIndex] || 0)));
            const maxPp = basePp > 0 ? basePp + Math.floor((basePp * ppUp) / 5) : 0;
            newMovePp[slotIndex] = maxPp;
        }

        setLocalPk({ ...localPk, moves: newMoves, move_pp: newMovePp, move_pp_ups: newMovePpUps });

        const newSearch = [...searchTerm];
        newSearch[slotIndex] = '';
        setSearchTerm(newSearch);
    };

    const getSlotMaxPp = (slotIndex) => {
        const moveId = Number(localPk.moves?.[slotIndex] || 0);
        if (moveId <= 0) return 0;
        const moveEntry = allMoves.find((m) => Number(m.id) === moveId);
        const basePp = Number(moveEntry?.base_pp || 0);
        const ppUp = Math.max(0, Math.min(3, Number(localPk.move_pp_ups?.[slotIndex] || 0)));
        if (!Number.isFinite(basePp) || basePp <= 0) return 0;
        return basePp + Math.floor((basePp * ppUp) / 5);
    };

    const updateMovePp = (slotIndex, value) => {
        const maxPp = getSlotMaxPp(slotIndex);
        const next = [...(localPk.move_pp || [0, 0, 0, 0])];
        next[slotIndex] = Math.max(0, Math.min(maxPp, clampNumber(value, 0, maxPp || 0)));
        setLocalPk({ ...localPk, move_pp: next });
    };

    const updateMovePpUps = (slotIndex, value) => {
        const moveId = Number(localPk.moves?.[slotIndex] || 0);
        const nextUps = [...(localPk.move_pp_ups || [0, 0, 0, 0])];
        if (moveId <= 0) {
            nextUps[slotIndex] = 0;
            const nextPp = [...(localPk.move_pp || [0, 0, 0, 0])];
            nextPp[slotIndex] = 0;
            setLocalPk({ ...localPk, move_pp_ups: nextUps, move_pp: nextPp });
            return;
        }

        nextUps[slotIndex] = Math.max(0, Math.min(3, clampNumber(value, 0, 3)));
        const basePp = Number(allMoves.find((m) => Number(m.id) === moveId)?.base_pp || 0);
        const nextMax = basePp > 0 ? basePp + Math.floor((basePp * nextUps[slotIndex]) / 5) : 0;
        const nextPp = [...(localPk.move_pp || [0, 0, 0, 0])];
        if (isPcMon) {
            nextPp[slotIndex] = nextMax;
        } else {
            nextPp[slotIndex] = Math.max(0, Math.min(nextMax, Number(nextPp[slotIndex] || 0)));
        }
        setLocalPk({ ...localPk, move_pp_ups: nextUps, move_pp: nextPp });
    };

    const setMoveMaxPp = (slotIndex) => {
        const moveId = Number(localPk.moves?.[slotIndex] || 0);
        const nextUps = [...(localPk.move_pp_ups || [0, 0, 0, 0])];
        const nextPp = [...(localPk.move_pp || [0, 0, 0, 0])];
        if (moveId <= 0) {
            nextUps[slotIndex] = 0;
            nextPp[slotIndex] = 0;
        } else {
            nextUps[slotIndex] = 3;
            const basePp = Number(allMoves.find((m) => Number(m.id) === moveId)?.base_pp || 0);
            const maxPp = basePp > 0 ? basePp + Math.floor((basePp * 3) / 5) : 0;
            nextPp[slotIndex] = maxPp;
        }
        setLocalPk({ ...localPk, move_pp_ups: nextUps, move_pp: nextPp });
    };

    useEffect(() => {
        client.getItems()
            .then(data => setAllItems(data));
    }, [client]);

    useEffect(() => {
        client.getSpecies()
            .then(data => setAllSpecies(data));
    }, [client]);

    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key === 'Escape' && !isSaving) {
                onClose();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose, isSaving]);

    const applySpeciesSelection = (species) => {
        const previousSpecies = allSpecies.find(s => s.id === localPk.species_id);
        const previousDisplay = previousSpecies?.display_name || previousSpecies?.name || '';
        const nextDisplay = species?.display_name || species?.name || '';
        const currentNick = String(localPk.nickname || '').trim();
        const shouldAutoRename =
            renameOnSpeciesChange ||
            (currentNick && previousDisplay && currentNick.toLowerCase() === previousDisplay.toLowerCase());

        setLocalPk({
            ...localPk,
            species_id: species.id,
            nickname: shouldAutoRename && nextDisplay ? nextDisplay : localPk.nickname,
        });
        setSpeciesSearch('');
    };

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
            levelFallback: Number(localPk.level || initialLevel || 1),
        });

        const blocking = [...errors, ...resolvedErrors];
        if (blocking.length > 0) {
            setSetImportErrors(blocking);
            setSetImportWarnings(warnings);
            return;
        }

        const mapImportedStats = (source, speedKey, fallback = 0) => ({
            HP: Number(source.HP ?? fallback),
            Atk: Number(source.Atk ?? fallback),
            Def: Number(source.Def ?? fallback),
            SpA: Number(source.SpA ?? fallback),
            SpD: Number(source.SpD ?? fallback),
            [speedKey]: Number(source.Spe ?? source.Spd ?? fallback),
        });

        const speedIvKey = Object.prototype.hasOwnProperty.call(localPk.ivs || {}, 'Spe') ? 'Spe' : 'Spd';
        const speedEvKey = Object.prototype.hasOwnProperty.call(localPk.evs || {}, 'Spe') ? 'Spe' : 'Spd';
        const nextState = { ...localPk };
        const ignoredWarnings = [];

        if (resolved.speciesRow && Number(resolved.speciesRow.id) !== Number(localPk.species_id)) {
            ignoredWarnings.push(`Ignored imported species ${resolved.speciesRow.label || resolved.speciesRow.name || resolved.speciesRow.id}; existing species is preserved.`);
        }
        if (resolved.itemRow) {
            nextState.item_id = Number(resolved.itemRow.id);
        }
        if (parsed.evs) {
            nextState.evs = mapImportedStats(parsed.evs, speedEvKey, 0);
        }
        if (parsed.ivs) {
            nextState.ivs = mapImportedStats(parsed.ivs, speedIvKey, 31);
        }
        if (resolved.moveRows.length > 0) {
            const moveIds = [0, 0, 0, 0];
            const movePp = [0, 0, 0, 0];
            const movePpUps = [0, 0, 0, 0];
            resolved.moveRows.forEach((m, idx) => {
                if (idx < 4) {
                    moveIds[idx] = Number(m.id);
                    const basePp = Number(m.base_pp || 0);
                    movePp[idx] = basePp > 0 ? basePp : 0;
                }
            });
            nextState.moves = moveIds;
            nextState.move_pp = movePp;
            nextState.move_pp_ups = movePpUps;
        }
        if (resolved.natureId !== null) {
            nextState.nature_id = resolved.natureId;
        } else if (parsed.natureName) {
            ignoredWarnings.push('Ignored imported nature because it could not be resolved.');
        }
        if (parsed.abilityName) {
            const wanted = normalizeName(parsed.abilityName);
            const abilityOptions = [
                { idx: 0, name: nextState.ability_1_name },
                { idx: 1, name: nextState.ability_2_name },
                { idx: 2, name: nextState.ability_hidden_name },
            ];
            const matched = abilityOptions.find((opt) => normalizeName(opt.name || '') === wanted);
            if (matched) {
                nextState.current_ability_index = matched.idx;
                if (matched.idx === 0) nextState.ability_label_current = nextState.ability_1_name || 'Slot 1 (Standard)';
                else if (matched.idx === 1) nextState.ability_label_current = nextState.ability_2_name || 'Slot 2 (Standard)';
                else nextState.ability_label_current = nextState.ability_hidden_name || 'Hidden Ability';
            } else {
                ignoredWarnings.push('Ignored imported ability because it is not available for the current species.');
            }
        }
        if (parsed.shiny !== null) {
            ignoredWarnings.push('Ignored imported shiny flag; current identity metadata is preserved.');
        }
        if (resolved.levelToApply !== null) {
            ignoredWarnings.push('Ignored imported level; level/exp are preserved for existing Pokemon.');
        }
        if (parsed.nickname) {
            ignoredWarnings.push('Ignored imported nickname; current nickname is preserved.');
        }

        setLocalPk(nextState);
        setSetImportErrors([]);
        setSetImportWarnings([
            ...warnings,
            ...ignoredWarnings,
            SAFE_IMPORT_NOTE,
            'Set imported into editor. Review and click SAVE CHANGES to commit.',
        ]);
    };


    const handleSaveClick = async () => {
        setIsSaving(true);
        setSaveStage('Applying changes...');
        const payload = { ...localPk };
        if (levelDirty) {
            const parsedLevel = clampNumber(levelInput, MIN_LEVEL, MAX_LEVEL);
            payload.level = parsedLevel;
            payload.level_edit = {
                target_level: parsedLevel,
                growth_rate: levelGrowthMode === 'auto' ? null : parseInt(levelGrowthMode, 10),
            };
        }
        try {
            setSaveStage('Saving file...');
            await Promise.resolve(onSave(payload));
        } finally {
            setIsSaving(false);
        }
    };

    const levelClampFallback = Number(localPk.level || initialLevel || MIN_LEVEL);
    const totalEvs = getTotalEvs(localPk.evs || {});
    const remainingEvs = Math.max(0, EV_TOTAL_MAX - totalEvs);

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
            onClick={isSaving ? undefined : onClose}
        >
            <div
                className="relative bg-[#0f172a] border border-white/10 w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                onClick={(e) => e.stopPropagation()}
            >

                <div className="p-6 bg-[#1e293b] flex justify-between items-center border-b border-white/5">
                    <div className="flex items-center gap-4">
                        <img
                            src={client.getPokemonIconUrl(localPk.species_id)}
                            className="w-12 h-12 pixelated"
                            alt="icon"
                            onError={(e) => {
                                if (e.currentTarget.src !== POKEMON_ICON_FALLBACK_URL) {
                                    e.currentTarget.src = POKEMON_ICON_FALLBACK_URL;
                                }
                            }}
                        />
                        <div>
                            <h2 className="text-xl font-bold">{localPk.nickname}</h2>
                            <p className="text-xs text-slate-500 uppercase font-black">Pokemon Editor</p>
                        </div>
                        <div className="w-10 h-10 bg-slate-900 rounded-xl border border-white/10 flex items-center justify-center overflow-hidden">
                            {canShowItemIcon ? (
                                <img
                                    src={client.getItemIconUrl(localPk.item_id)}
                                    alt={currentItemName}
                                    className="w-7 h-7 object-contain"
                                    onError={(e) => {
                                        if (e.currentTarget.src !== ITEM_ICON_FALLBACK_URL) {
                                            e.currentTarget.src = ITEM_ICON_FALLBACK_URL;
                                        }
                                    }}
                                />
                            ) : (
                                <span className="text-[9px] font-mono text-slate-500">#{localPk.item_id}</span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setShowImport((prev) => !prev)}
                            disabled={isSaving}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-[10px] font-bold uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                            title={SAFE_IMPORT_NOTE}
                        >
                            <Download size={12} /> FROM SMOGON
                        </button>
                        <button onClick={onClose} disabled={isSaving} className="p-2 hover:bg-white/5 rounded-full disabled:opacity-40 disabled:cursor-not-allowed"><X /></button>
                    </div>
                </div>

                <div className="flex bg-[#1e293b]/50 p-2 gap-2 border-b border-white/5">
                    <EditorTab active={activeTab === 'stats'} label="Stats" onClick={() => setActiveTab('stats')} />
                    <EditorTab active={activeTab === 'moves'} label="Moves" onClick={() => setActiveTab('moves')} />
                    <EditorTab active={activeTab === 'info'} label="Info" onClick={() => setActiveTab('info')} />
                </div>

                <div className="flex-1 overflow-y-auto p-8">
                    {showImport && (
                        <div className="mb-6 bg-slate-800/40 p-4 rounded-2xl border border-white/5 space-y-3">
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
                                    Parse & Apply to Editor
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSetImportText('');
                                        setSetImportErrors([]);
                                        setSetImportWarnings([]);
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

                    {activeTab === 'stats' && (
                        <div className="space-y-8">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <StatGroup title="IVs (0-31)" type="ivs" data={localPk.ivs} update={updateStat} max={31} />
                                <div className="space-y-4">
                                    <StatGroup title="EVs (0-252)" type="evs" data={localPk.evs} update={updateStat} max={252} />
                                    <div className="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2 text-[10px] text-slate-300 space-y-1">
                                        <p>
                                            Legit Mode: <span className={`font-bold ${legitMode ? 'text-emerald-300' : 'text-slate-400'}`}>{legitMode ? 'ON' : 'OFF'}</span>
                                        </p>
                                        <p>
                                            Total EV: <span className={`font-bold ${legitMode && totalEvs >= EV_TOTAL_MAX ? 'text-amber-300' : 'text-blue-300'}`}>{totalEvs}/{EV_TOTAL_MAX}</span>
                                        </p>
                                        {legitMode ? (
                                            <p>
                                                Remaining: <span className="font-bold text-emerald-300">{remainingEvs}</span>
                                            </p>
                                        ) : (
                                            <p className="text-slate-400">Total cap is disabled while Legit Mode is OFF.</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-slate-800/40 p-6 rounded-2xl border border-white/5 space-y-4">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block text-center">
                                        Level Editor
                                    </label>
                                    <div className="space-y-3">
                                        <div className="bg-slate-900/70 border border-white/10 rounded-xl p-3">
                                            <p className="text-[10px] uppercase font-black text-slate-500 mb-2">Target Level</p>
                                            <input
                                                type="number"
                                                min="1"
                                                max="100"
                                                value={levelInput}
                                                onChange={(e) => {
                                                    setLevelInput(e.target.value);
                                                    setLevelDirty(true);
                                                }}
                                                onBlur={() => {
                                                    const normalized = clampNumber(levelInput, MIN_LEVEL, MAX_LEVEL);
                                                    setLevelInput(String(normalized || levelClampFallback));
                                                }}
                                                className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-blue-400 font-bold outline-none focus:border-blue-500/50"
                                            />
                                            <p className="mt-2 text-[10px] text-slate-500">Level is capped to 1-100.</p>
                                        </div>
                                        <div className="bg-slate-900/70 border border-white/10 rounded-xl p-3">
                                            <p className="text-[10px] uppercase font-black text-slate-500 mb-2">Growth Curve</p>
                                            <select
                                                value={levelGrowthMode}
                                                onChange={(e) => {
                                                    setLevelGrowthMode(e.target.value);
                                                    setLevelDirty(true);
                                                }}
                                                className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-300 outline-none focus:border-blue-500/50"
                                            >
                                                <option value="auto">Default from species (recommended)</option>
                                                {GROWTH_OPTIONS.map((opt) => (
                                                    <option key={opt.id} value={String(opt.id)}>{opt.id} - {opt.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    {isPcMon ? (
                                        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-200">
                                            PC boxes do not store a visual level byte like party Pokemon. Default mode uses ROM-truth species growth; choose manual only if needed.
                                        </div>
                                    ) : (
                                        <p className="text-[10px] text-slate-500 italic text-center">
                                            Default mode uses ROM-truth species growth and falls back to inference only when metadata is unavailable.
                                        </p>
                                    )}
                                </div>

                                <div className="bg-slate-800/40 p-6 rounded-2xl border border-white/5 space-y-4">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block text-center">
                                        Pokemon Nature
                                    </label>
                                    <select
                                        value={localPk.nature_id}
                                        onChange={(e) => setLocalPk({...localPk, nature_id: parseInt(e.target.value)})}
                                        className="w-full bg-slate-900 border border-white/10 rounded-xl p-3 text-sm text-blue-400 font-bold outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none cursor-pointer"
                                    >
                                        {NATURES.map((name, i) => (
                                            <option key={i} value={i}>{name}</option>
                                        ))}
                                    </select>
                                    <p className="text-[9px] text-center text-slate-500 italic">Changing nature will modify the Pokemon PID in the save file.</p>
                                </div>
                            </div>

                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-white/5 space-y-4">
                                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Ability Setup</h4>

                                <div className="flex bg-slate-900 p-1 rounded-xl gap-1">
                                    {[
                                        {id: 0, label: localPk.ability_1_name || 'Slot 1 (Standard)', disabled: !localPk.ability_1_id},
                                        {id: 1, label: localPk.ability_2_name || 'Slot 2 (Standard)', disabled: !localPk.ability_2_id},
                                        {
                                            id: 2,
                                            label: localPk.ability_hidden_name ? `${localPk.ability_hidden_name} (HA)` : 'Hidden Ability (HA)',
                                            disabled: !localPk.ability_hidden_id,
                                        }
                                    ].map((opt) => (
                                        <button
                                            key={opt.id}
                                            onClick={() => {
                                                if (opt.disabled) return;
                                                setLocalPk({...localPk, current_ability_index: opt.id});
                                            }}
                                            disabled={opt.disabled}
                                            className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${
                                                localPk.current_ability_index === opt.id
                                                    ? 'bg-blue-600 text-white shadow-lg'
                                                    : 'text-slate-500 hover:text-slate-300'
                                            } ${opt.disabled ? 'opacity-50 cursor-not-allowed hover:text-slate-500' : ''}`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[10px] text-center text-slate-400">
                                    Current: <span className="font-bold text-blue-300">{localPk.ability_label_current || 'Unknown Ability'}</span>
                                </p>
                                <p className="text-[9px] text-center text-slate-500 italic">
                                    {localPk.current_ability_index === 2
                                        ? "Hidden ability ignores the Pokemon PID."
                                        : "The system will change PID while keeping the same Nature."}
                                </p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'moves' && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {localPk.moves.map((moveId, idx) => (
                                    <div key={idx}
                                         className="bg-slate-800/40 p-4 rounded-2xl border border-white/5 space-y-3">
                                        <label
                                            className="text-[10px] font-black text-slate-500 uppercase">Move {idx + 1}</label>

                                        <div className="relative">
                                            <Search className="absolute left-3 top-2.5 text-slate-500" size={14}/>
                                            <input
                                                type="text"
                                                placeholder="Search by name or ID..."
                                                value={searchTerm[idx]}
                                                onChange={(e) => {
                                                    const s = [...searchTerm];
                                                    s[idx] = e.target.value;
                                                    setSearchTerm(s);
                                                }}
                                                className="w-full bg-slate-900 border border-white/10 rounded-xl py-2 pl-9 pr-4 text-xs"
                                            />
                                        </div>

                                        {searchTerm[idx].length > 1 ? (
                                            <div
                                                className="max-h-32 overflow-y-auto bg-slate-900 rounded-xl border border-blue-500/30">
                                                {allMoves
                                                    .filter(m => m.name.toLowerCase().includes(searchTerm[idx].toLowerCase()) || m.id.toString() === searchTerm[idx])
                                                    .slice(0, 10)
                                                    .map(m => (
                                                        <button
                                                            key={m.id}
                                                            onClick={() => updateMove(idx, m.id)}
                                                            className="w-full text-left px-4 py-2 text-xs hover:bg-blue-600 transition-colors border-b border-white/5"
                                                        >
                                                            <span
                                                                className="text-blue-400 font-mono mr-2">{m.id}</span> {m.name}
                                                        </button>
                                                    ))
                                                }
                                            </div>
                                        ) : (
                                            <div
                                                className="flex justify-between items-center bg-slate-900/50 p-2 rounded-lg border border-white/5">
                                                <span className="text-xs font-bold text-blue-400">
                                                    {allMoves.find(m => m.id === moveId)?.name || "--- Empty ---"}
                                                </span>
                                                <span
                                                    className="text-[10px] font-mono text-slate-600">ID: {moveId}</span>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="bg-slate-900/50 p-2 rounded-lg border border-white/5">
                                                <label className="text-[10px] uppercase text-slate-500 font-black">PP</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max={getSlotMaxPp(idx)}
                                                    value={Number(localPk.move_pp?.[idx] || 0)}
                                                    onChange={(e) => updateMovePp(idx, e.target.value)}
                                                    className="mt-1 w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-xs"
                                                    disabled={Number(moveId || 0) <= 0 || isPcMon}
                                                />
                                            </div>
                                            <div className="bg-slate-900/50 p-2 rounded-lg border border-white/5">
                                                <label className="text-[10px] uppercase text-slate-500 font-black">PP Up</label>
                                                <select
                                                    value={Number(localPk.move_pp_ups?.[idx] || 0)}
                                                    onChange={(e) => updateMovePpUps(idx, e.target.value)}
                                                    className="mt-1 w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-xs"
                                                    disabled={Number(moveId || 0) <= 0}
                                                >
                                                    <option value={0}>0</option>
                                                    <option value={1}>1</option>
                                                    <option value={2}>2</option>
                                                    <option value={3}>3</option>
                                                </select>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                                            <span>
                                                Usable: <span className="font-bold text-blue-300">{Number(localPk.move_pp?.[idx] || 0)}/{getSlotMaxPp(idx)}</span>
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setMoveMaxPp(idx)}
                                                disabled={Number(moveId || 0) <= 0}
                                                className="px-2 py-1 rounded-md bg-blue-600/80 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-[10px] font-bold"
                                            >
                                                MAX PP
                                            </button>
                                        </div>
                                        {isPcMon && (
                                            <p className="text-[9px] text-slate-500">PC boxes keep PP Up (max state). Current PP is restored from max when withdrawn.</p>
                                        )}
                                    </div>
                                ))}
                            </div>

                        </div>
                    )}

                    {activeTab === 'info' && (
                        <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">

                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-white/5 space-y-4">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block text-center">
                                    Nickname
                                </label>
                                <input
                                    type="text"
                                    maxLength={10}
                                    value={localPk.nickname || ''}
                                    onChange={(e) => setLocalPk({ ...localPk, nickname: e.target.value })}
                                    className="w-full bg-slate-900 border border-white/10 rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500/50"
                                    placeholder="Nickname (max 10 chars)"
                                />
                                <p className="text-[10px] text-slate-500 text-center">Stored directly in save text bytes (max 10 chars).</p>
                            </div>

                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-white/5 space-y-4">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block text-center">
                                    Species
                                </label>

                                <div className="relative">
                                    <Search className="absolute left-3 top-3 text-slate-500" size={16} />
                                    <input
                                        type="text"
                                        placeholder="Search species (e.g. 'Garchomp' or ID...)"
                                        value={speciesSearch}
                                        onChange={(e) => setSpeciesSearch(e.target.value)}
                                        className="w-full bg-slate-900 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm outline-none focus:border-blue-500/50"
                                    />
                                </div>

                                {speciesSearch.length > 1 ? (
                                    <div className="max-h-48 overflow-y-auto bg-slate-900 rounded-xl border border-blue-500/30 divide-y divide-white/5">
                                        {allSpecies
                                            .filter(species => {
                                                const q = speciesSearch.toLowerCase();
                                                return (
                                                    (species.label || '').toLowerCase().includes(q) ||
                                                    (species.name || '').toLowerCase().includes(q) ||
                                                    species.id.toString() === speciesSearch
                                                );
                                            })
                                            .slice(0, 15)
                                            .map(species => (
                                                <button
                                                    key={species.id}
                                                    onClick={() => applySpeciesSelection(species)}
                                                    className="w-full text-left px-4 py-3 text-sm hover:bg-blue-600 transition-colors flex justify-between items-center group"
                                                >
                                                    <span className="group-hover:text-white">{species.label || species.name}</span>
                                                    <span className="text-blue-400 font-mono text-[10px] bg-blue-500/10 px-2 py-0.5 rounded">ID {species.id}</span>
                                                </button>
                                            ))
                                        }
                                    </div>
                                ) : (
                                    <div className="flex justify-between items-center bg-slate-900/50 p-4 rounded-xl border border-blue-500/20">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-slate-500 uppercase font-black">Current Species</span>
                                            <span className="text-blue-400 font-bold text-sm">
                                                {currentSpeciesName}
                                            </span>
                                        </div>
                                        <img
                                            src={client.getPokemonIconUrl(localPk.species_id)}
                                            alt={currentSpeciesName}
                                            className="w-10 h-10 pixelated"
                                            onError={(e) => {
                                                if (e.currentTarget.src !== POKEMON_ICON_FALLBACK_URL) {
                                                    e.currentTarget.src = POKEMON_ICON_FALLBACK_URL;
                                                }
                                            }}
                                        />
                                    </div>
                                )}

                                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                                    <input
                                        type="checkbox"
                                        checked={renameOnSpeciesChange}
                                        onChange={(e) => setRenameOnSpeciesChange(e.target.checked)}
                                        className="accent-blue-500"
                                    />
                                    Rename nickname to selected species when changing species
                                </label>
                            </div>

                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-white/5 space-y-4">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block text-center">
                                        Identity (Shiny & Gender)
                                    </label>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div className="bg-slate-900/70 border border-white/10 rounded-xl p-3 space-y-2">
                                            <p className="text-[10px] uppercase font-black text-slate-500">Shiny</p>
                                            <button
                                                type="button"
                                                onClick={() => setLocalPk({ ...localPk, is_shiny: !localPk.is_shiny })}
                                                className={`w-full py-2 rounded-lg text-xs font-bold transition-colors ${localPk.is_shiny ? 'bg-amber-500/80 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                                            >
                                                {localPk.is_shiny ? 'Shiny Enabled' : 'Standard Palette'}
                                            </button>
                                        </div>

                                        <div className="bg-slate-900/70 border border-white/10 rounded-xl p-3 space-y-2">
                                            <p className="text-[10px] uppercase font-black text-slate-500">Gender</p>
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setLocalPk({ ...localPk, gender: 'male' })}
                                                    disabled={localPk.gender_mode !== 'dynamic'}
                                                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${localPk.gender === 'male' ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                                >
                                                    Male
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setLocalPk({ ...localPk, gender: 'female' })}
                                                    disabled={localPk.gender_mode !== 'dynamic'}
                                                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${localPk.gender === 'female' ? 'bg-rose-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                                >
                                                    Female
                                                </button>
                                            </div>
                                            {localPk.gender_mode !== 'dynamic' && (
                                                <p className="text-[10px] text-slate-500">
                                                    {localPk.gender_mode === 'genderless'
                                                        ? 'This species is genderless.'
                                                        : localPk.gender_mode === 'fixed_male'
                                                            ? 'This species is male-only.'
                                                            : localPk.gender_mode === 'fixed_female'
                                                                ? 'This species is female-only.'
                                                                : 'Gender metadata unavailable for this species.'}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-200">
                                        Identity edits rewrite PID. Nature and standard ability slot are preserved where possible.
                                    </div>
                                </div>

                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-white/5 space-y-4">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block text-center">
                                    Held Item
                                </label>

                                <div className="relative">
                                    <Search className="absolute left-3 top-3 text-slate-500" size={16} />
                                    <input
                                        type="text"
                                        placeholder="Search item (e.g. 'Master', 'Leftovers' or ID...)"
                                        value={itemSearch}
                                        onChange={(e) => setItemSearch(e.target.value)}
                                        className="w-full bg-slate-900 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm outline-none focus:border-blue-500/50"
                                    />
                                </div>

                                {itemSearch.length > 1 ? (
                                    <div className="max-h-48 overflow-y-auto bg-slate-900 rounded-xl border border-blue-500/30 divide-y divide-white/5">
                                        {allItems
                                            .filter(item =>
                                                item.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
                                                item.id.toString() === itemSearch
                                            )
                                            .slice(0, 15)
                                            .map(item => (
                                                <button
                                                    key={item.id}
                                                    onClick={() => {
                                                        setLocalPk({...localPk, item_id: item.id});
                                                        setItemSearch('');
                                                    }}
                                                    className="w-full text-left px-4 py-3 text-sm hover:bg-blue-600 transition-colors flex justify-between items-center group"
                                                >
                                                    <span className="group-hover:text-white">{item.name}</span>
                                                    <span className="text-blue-400 font-mono text-[10px] bg-blue-500/10 px-2 py-0.5 rounded">ID {item.id}</span>
                                                </button>
                                            ))
                                        }
                                    </div>
                                ) : (
                                    <div className="flex justify-between items-center bg-slate-900/50 p-4 rounded-xl border border-emerald-500/20">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-slate-500 uppercase font-black">Current Item</span>
                                            <span className="text-emerald-400 font-bold text-sm">
                            {currentItemName}
                        </span>
                                        </div>
                                        <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center text-emerald-500">
                                            {canShowItemIcon ? (
                                                <img
                                                    src={client.getItemIconUrl(localPk.item_id)}
                                                    alt={currentItemName}
                                                    className="w-7 h-7 object-contain"
                                                    onError={(e) => {
                                                        if (e.currentTarget.src !== ITEM_ICON_FALLBACK_URL) {
                                                            e.currentTarget.src = ITEM_ICON_FALLBACK_URL;
                                                        }
                                                    }}
                                                />
                                            ) : (
                                                <span className="text-[9px] font-mono text-slate-500">#{localPk.item_id}</span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}


                </div>

                <div className="p-6 bg-[#1e293b]/80 border-t border-white/5 flex justify-end">
                    <button onClick={handleSaveClick}
                            disabled={isSaving}
                            className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-8 py-3 rounded-2xl flex items-center gap-2 shadow-lg active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed">
                        <Save size={18}/> SAVE CHANGES
                    </button>
                </div>

                {isSaving && (
                    <div className="absolute inset-0 z-20 bg-black/70 backdrop-blur-sm flex items-center justify-center">
                        <div className="bg-slate-900 border border-white/10 rounded-2xl px-6 py-5 text-center space-y-2 min-w-[260px]">
                            <div className="w-7 h-7 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto" />
                            <p className="text-sm font-bold text-blue-300">Applying edits</p>
                            <p className="text-xs text-slate-400">{saveStage}</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};


const StatGroup = ({title, type, data, update, max}) => {
    const statsEntries = data ? Object.entries(data) : [];
    const statLabels = {
        HP: 'HP',
        Atk: 'ATK',
        Def: 'DEF',
        SpA: 'SPA',
        SpD: 'SPD',
        Spd: 'SPE',
        Spe: 'SPE',
    };
    const statOrder = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spd', 'Spe'];
    const orderedStatsEntries = statOrder
        .map((key) => (Object.prototype.hasOwnProperty.call(data || {}, key) ? [key, data[key]] : null))
        .filter(Boolean);

    return (
        <div className="space-y-4">
            <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest">{title}</h4>
            {(orderedStatsEntries.length > 0 ? orderedStatsEntries : statsEntries).map(([stat, val]) => (
                <div key={stat} className="flex items-center gap-4">
                    <span className="w-8 text-[10px] font-bold text-slate-400 uppercase">{statLabels[stat] || stat}</span>
                    <input
                        type="range" min="0" max={max} value={val}
                        onChange={(e) => update(type, stat, e.target.value)}
                        className="flex-1 accent-blue-500"
                    />
                    <input
                        type="number" min="0" max={max} value={val}
                        onChange={(e) => update(type, stat, e.target.value)}
                        className="w-14 bg-slate-900 border border-white/10 rounded-lg text-center text-xs py-1"
                    />
                </div>
            ))}
        </div>
    );
};

const EditorTab = ({ active, label, onClick }) => (
    <button
        onClick={onClick}
        className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold transition-all ${active ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:bg-white/5'}`}
    >
        {label}
    </button>
);
