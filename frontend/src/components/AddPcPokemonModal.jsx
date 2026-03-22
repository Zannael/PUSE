import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, Download } from 'lucide-react';
import speciesAbilitiesMeta from '../core/speciesAbilitiesMeta.json' with { type: 'json' };
import abilitiesCatalog from '../core/abilitiesCatalog.json' with { type: 'json' };

const MIN_LEVEL = 1;
const MAX_LEVEL = 100;
const IV_STAT_MAX = 31;
const EV_STAT_MAX = 252;
const EV_TOTAL_MAX = 510;
const NATURES = [
    'Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty',
    'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax',
    'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive',
    'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash',
    'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky',
];

const normalizeName = (value) =>
    String(value || '')
        .toLowerCase()
        .replace(/[’']/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

const clampLevel = (value, fallback = 5) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, parsed));
};

const parseSetStatToken = (rawToken) => {
    const token = String(rawToken || '').replace(/[^A-Za-z]/g, '');
    const lower = token.toLowerCase();
    if (token === 'HP' || lower === 'hp') return 'HP';
    if (token === 'Atk' || lower === 'atk' || lower === 'attack') return 'Atk';
    if (token === 'Def' || lower === 'def' || lower === 'defense') return 'Def';
    if (token === 'SpA' || lower === 'spa' || lower === 'spatk' || lower === 'specialattack' || lower === 'specialatk') return 'SpA';
    if (token === 'SpD' || lower === 'spd' || lower === 'spdef' || lower === 'specialdefense' || lower === 'specialdef') return 'SpD';
    if (token === 'Spe' || token === 'Spd' || lower === 'spe' || lower === 'speed') return 'Spe';
    return null;
};

const parseShowdownSet = (rawText) => {
    const text = String(rawText || '').replace(/\r/g, '');
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const parsed = {
        nickname: '',
        speciesName: '',
        itemName: '',
        abilityName: '',
        natureName: '',
        level: null,
        shiny: null,
        evs: null,
        ivs: null,
        moves: [],
        warnings: [],
    };
    const errors = [];

    if (lines.length === 0) {
        errors.push('Set text is empty.');
        return { parsed, errors };
    }

    const header = lines[0];
    const atIndex = header.indexOf('@');
    const headerLeft = atIndex >= 0 ? header.slice(0, atIndex).trim() : header.trim();
    if (atIndex >= 0) {
        parsed.itemName = header.slice(atIndex + 1).trim();
    }

    const nickSpeciesMatch = headerLeft.match(/^(.*?)\(([^)]+)\)\s*$/);
    if (nickSpeciesMatch) {
        parsed.nickname = nickSpeciesMatch[1].trim();
        parsed.speciesName = nickSpeciesMatch[2].trim();
    } else {
        parsed.speciesName = headerLeft;
    }

    if (!parsed.speciesName) {
        errors.push('Could not parse species from first line.');
    }

    lines.slice(1).forEach((line) => {
        if (line.startsWith('Ability:')) {
            parsed.abilityName = line.slice('Ability:'.length).trim();
            return;
        }
        if (line.startsWith('EVs:')) {
            const evs = { HP: 0, Atk: 0, Def: 0, SpA: 0, SpD: 0, Spe: 0 };
            line.slice('EVs:'.length).split('/').forEach((chunk) => {
                const m = chunk.trim().match(/^(\d+)\s+(.+)$/);
                if (!m) return;
                const statKey = parseSetStatToken(m[2]);
                if (!statKey) return;
                evs[statKey] = Number.parseInt(m[1], 10);
            });
            parsed.evs = evs;
            return;
        }
        if (line.startsWith('IVs:')) {
            const ivs = { HP: IV_STAT_MAX, Atk: IV_STAT_MAX, Def: IV_STAT_MAX, SpA: IV_STAT_MAX, SpD: IV_STAT_MAX, Spe: IV_STAT_MAX };
            line.slice('IVs:'.length).split('/').forEach((chunk) => {
                const m = chunk.trim().match(/^(\d+)\s+(.+)$/);
                if (!m) return;
                const statKey = parseSetStatToken(m[2]);
                if (!statKey) return;
                ivs[statKey] = Number.parseInt(m[1], 10);
            });
            parsed.ivs = ivs;
            return;
        }
        if (line.startsWith('Level:')) {
            const n = Number.parseInt(line.slice('Level:'.length).trim(), 10);
            if (Number.isFinite(n)) parsed.level = n;
            return;
        }
        if (line.startsWith('Shiny:')) {
            parsed.shiny = normalizeName(line.slice('Shiny:'.length)) === 'yes';
            return;
        }
        if (line.endsWith(' Nature')) {
            parsed.natureName = line.replace(/\s+Nature$/, '').trim();
            return;
        }
        if (line.startsWith('-')) {
            const moveName = line.replace(/^-+\s*/, '').trim();
            if (moveName) parsed.moves.push(moveName);
            return;
        }
        if (line.startsWith('Tera Type:')) {
            parsed.warnings.push('Tera Type is ignored in this save format.');
            return;
        }
        parsed.warnings.push(`Ignored line: ${line}`);
    });

    if (parsed.moves.length > 4) {
        parsed.warnings.push(`Only first 4 moves are used (received ${parsed.moves.length}).`);
        parsed.moves = parsed.moves.slice(0, 4);
    }

    return { parsed, errors };
};

const buildLookup = (rows, namesForRow) => {
    const byNorm = new Map();
    rows.forEach((row) => {
        namesForRow(row).forEach((name) => {
            const norm = normalizeName(name);
            if (!norm) return;
            if (!byNorm.has(norm)) byNorm.set(norm, new Map());
            byNorm.get(norm).set(Number(row.id), row);
        });
    });
    return byNorm;
};

export default function AddPcPokemonModal({ client, target, onClose, onConfirm, legitMode = false }) {
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
        const blocking = [...errors];
        const warnings = [...parsed.warnings];

        const speciesLookup = buildLookup(allSpecies, (s) => [s.label, s.display_name, s.name, String(s.id)]);
        const itemLookup = buildLookup(allItems, (i) => [i.name, String(i.id)]);
        const moveLookup = buildLookup(allMoves, (m) => [m.name, String(m.id)]);
        const abilityLookup = buildLookup(allAbilities, (a) => [a.name, String(a.id)]);

        const pickOne = (lookup, inputName, kind) => {
            if (!inputName) return null;
            const norm = normalizeName(inputName);
            const candidates = Array.from((lookup.get(norm) || new Map()).values());
            if (candidates.length === 0) {
                blocking.push(`${kind} not found in Unbound catalogs: ${inputName}`);
                return null;
            }
            if (candidates.length > 1) {
                blocking.push(`${kind} is ambiguous: ${inputName}`);
                return null;
            }
            return candidates[0];
        };

        const speciesRow = pickOne(speciesLookup, parsed.speciesName, 'Species');
        const itemRow = parsed.itemName ? pickOne(itemLookup, parsed.itemName, 'Item') : null;
        const abilityRow = parsed.abilityName ? pickOne(abilityLookup, parsed.abilityName, 'Ability') : null;

        const moveRows = [];
        parsed.moves.forEach((name) => {
            const moveRow = pickOne(moveLookup, name, 'Move');
            if (moveRow) moveRows.push(moveRow);
        });

        let abilityIndex = null;
        if (abilityRow && speciesRow) {
            const meta = speciesAbilitiesMeta?.[String(speciesRow.id)] || {};
            const a1Name = abilitiesCatalog[String(meta.ability_1_id || 0)] || '';
            const a2Name = abilitiesCatalog[String(meta.ability_2_id || 0)] || '';
            const haName = abilitiesCatalog[String(meta.hidden_ability_id || 0)] || '';
            const wanted = normalizeName(abilityRow.name);
            if (normalizeName(a1Name) === wanted) abilityIndex = 0;
            else if (normalizeName(a2Name) === wanted) abilityIndex = 1;
            else if (normalizeName(haName) === wanted) abilityIndex = 2;
            else blocking.push(`Ability ${abilityRow.name} is not available for ${speciesRow.label || speciesRow.name}.`);
        }

        let natureId = null;
        if (parsed.natureName) {
            const idx = NATURES.findIndex((name) => normalizeName(name) === normalizeName(parsed.natureName));
            if (idx < 0) blocking.push(`Nature not found: ${parsed.natureName}`);
            else natureId = idx;
        }

        if (parsed.evs) {
            const vals = Object.values(parsed.evs).map((x) => Number(x || 0));
            if (vals.some((x) => x < 0 || x > EV_STAT_MAX)) {
                blocking.push('EVs must stay in range 0..252 per stat.');
            }
            const total = vals.reduce((a, b) => a + b, 0);
            if (legitMode && total > EV_TOTAL_MAX) {
                blocking.push(`Legit mode is ON: EV total ${total} exceeds 510.`);
            }
        }

        if (parsed.ivs) {
            const vals = Object.values(parsed.ivs).map((x) => Number(x || 0));
            if (vals.some((x) => x < 0 || x > IV_STAT_MAX)) {
                blocking.push('IVs must stay in range 0..31 per stat.');
            }
        }

        let levelToApply = null;
        if (parsed.level !== null && Number.isFinite(parsed.level)) {
            levelToApply = clampLevel(parsed.level, 5);
            if (levelToApply !== parsed.level) {
                warnings.push(`Level ${parsed.level} was clamped to ${levelToApply}.`);
            }
        }

        if (blocking.length > 0) {
            setSetImportErrors(blocking);
            setSetImportWarnings(warnings);
            return;
        }

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
                        <h3 className="text-lg font-bold">Add Pokemon to Box {target.box}</h3>
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
