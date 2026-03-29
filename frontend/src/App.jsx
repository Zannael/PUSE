import React, { lazy, Suspense, useMemo, useState, useEffect } from 'react';
import {
    Upload,
    LayoutGrid,
    Users,
    Briefcase,
    Save,
    Edit3,
    X,
    RotateCcw,
    Sparkles,
    ShieldAlert,
    CircleHelp,
    Github,
    CheckCircle2,
    ArrowRight,
    Shield,
    Cpu,
    Database,
} from 'lucide-react';
import { createApiClient, getInitialRuntimeMode, persistRuntimeMode, RUNTIME_MODES } from './services/apiClient.js';
import { getExpAtLevel, getSpeciesGrowthRate } from './core/growth.js';

const PartyGrid = lazy(() => import('./components/PartyGrid'));
const PCGrid = lazy(() => import('./components/PCGrid'));
const BagView = lazy(() => import('./components/BagView.jsx'));
const PokemonEditorModal = lazy(() =>
    import('./components/PokemonEditorModal.jsx').then((mod) => ({ default: mod.PokemonEditorModal }))
);
const AddPcPokemonModal = lazy(() => import('./components/AddPcPokemonModal.jsx'));

const LEGIT_MODE_STORAGE_KEY = 'puse_legit_mode';

const getInitialLegitMode = () => {
    try {
        return window.localStorage.getItem(LEGIT_MODE_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
};

const App = () => {
    const [runtimeMode, setRuntimeMode] = useState(getInitialRuntimeMode);
    const [legitMode, setLegitMode] = useState(getInitialLegitMode);
    const [activeTab, setActiveTab] = useState('party');
    const [isLoaded, setIsLoaded] = useState(false);
    const [saveExt, setSaveExt] = useState('.sav');
    const [money, setMoney] = useState(0);
    const [showMoneyModal, setShowMoneyModal] = useState(false);
    const [moneyInput, setMoneyInput] = useState('0');
    const client = useMemo(() => createApiClient(runtimeMode), [runtimeMode]);

    useEffect(() => {
        persistRuntimeMode(runtimeMode);
    }, [runtimeMode]);

    useEffect(() => {
        try {
            window.localStorage.setItem(LEGIT_MODE_STORAGE_KEY, legitMode ? '1' : '0');
        } catch {
            // ignore storage failures
        }
    }, [legitMode]);

    const uploadSaveFile = async (file) => {
        if (!file) return;

        try {
            await client.uploadSave(file);
            const mData = await client.getMoney();
            setMoney(mData.money);
            setMoneyInput(String(mData.money ?? 0));
            setSaveExt(file.name.toLowerCase().endsWith('.srm') ? '.srm' : '.sav');
            setIsLoaded(true);
        } catch {
            alert("Upload failed for current runtime mode.");
        }
    };

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        await uploadSaveFile(file);
    };

    const handleDropUpload = async (e) => {
        e.preventDefault();
        const file = e.dataTransfer?.files?.[0];
        await uploadSaveFile(file);
    };

    const [selectedPokemon, setSelectedPokemon] = useState(null);
    const [pcInsertTarget, setPcInsertTarget] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [pcBoxId, setPcBoxId] = useState(1);
    const [bagHasUnsavedChanges, setBagHasUnsavedChanges] = useState(false);
    const [rtcBrokenFile, setRtcBrokenFile] = useState(null);
    const [rtcFixedFile, setRtcFixedFile] = useState(null);
    const [rtcQuickFile, setRtcQuickFile] = useState(null);
    const [rtcTab, setRtcTab] = useState('pair');
    const [rtcBusy, setRtcBusy] = useState(false);
    const [showLegitHelp, setShowLegitHelp] = useState(false);

    const handleRtcFixPack = async () => {
        if (!rtcBrokenFile || !rtcFixedFile) {
            alert('Please select both files: tampered save and NPC-fixed save.');
            return;
        }

        try {
            setRtcBusy(true);
            await client.generateRtcRepairPack(rtcBrokenFile, rtcFixedFile);
            alert('RTC repair pack downloaded. Test candidates in the provided order JSON.');
        } catch {
            alert('Failed to generate RTC repair pack.');
        } finally {
            setRtcBusy(false);
        }
    };

    const handleRtcQuickFixPack = async () => {
        if (!rtcQuickFile) {
            alert('Please select one tampered save file.');
            return;
        }

        try {
            setRtcBusy(true);
            await client.generateRtcQuickFixPack(rtcQuickFile);
            alert('RTC quick-fix pack downloaded. Test candidates in order and stop at first valid save.');
        } catch {
            alert('Failed to generate RTC quick-fix pack.');
        } finally {
            setRtcBusy(false);
        }
    };

    const handleTabChange = (nextTab) => {
        if (nextTab === activeTab) return;
        if (activeTab === 'bag' && nextTab !== 'bag' && bagHasUnsavedChanges) {
            const shouldLeave = window.confirm(
                'You have unsaved bag edits. Leave anyway?\n\nYour changes stay in memory, but the .sav file is not updated until you click SAVE BAG CHANGES in Bag.'
            );
            if (!shouldLeave) return;
        }
        setActiveTab(nextTab);
    };

    const clamp = (value, min, max) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return min;
        return Math.max(min, Math.min(max, n));
    };

    const mapStatsForApi = (stats, max) => ({
        hp: clamp(stats?.HP, 0, max),
        atk: clamp(stats?.Atk, 0, max),
        dfe: clamp(stats?.Def, 0, max),
        spa: clamp(stats?.SpA, 0, max),
        spd: clamp(stats?.SpD, 0, max),
        spe: clamp(stats?.Spe ?? stats?.Spd, 0, max),
    });

    const sameMoves = (a = [], b = []) =>
        a.length === b.length && a.every((val, idx) => Number(val) === Number(b[idx]));

    const sameMovePp = (a = [], b = []) =>
        a.length === b.length && a.every((val, idx) => Number(val) === Number(b[idx]));

    const sameStats = (a = {}, b = {}) =>
        Number(a.HP ?? 0) === Number(b.HP ?? 0) &&
        Number(a.Atk ?? 0) === Number(b.Atk ?? 0) &&
        Number(a.Def ?? 0) === Number(b.Def ?? 0) &&
        Number(a.SpA ?? 0) === Number(b.SpA ?? 0) &&
        Number(a.SpD ?? 0) === Number(b.SpD ?? 0) &&
        Number(a.Spd ?? a.Spe ?? 0) === Number(b.Spd ?? b.Spe ?? 0);

    const handleSavePokemon = async (updatedPk) => {
        try {
            const original = selectedPokemon || {};

            if (!sameStats(updatedPk.ivs, original.ivs)) {
                const ivPayload = mapStatsForApi(updatedPk.ivs, 31);
                await client.updatePartyIvs(updatedPk.index, ivPayload);
            }

            if (!sameStats(updatedPk.evs, original.evs)) {
                const evPayload = mapStatsForApi(updatedPk.evs, 252);
                await client.updatePartyEvs(updatedPk.index, evPayload);
            }

            const movesChanged = !sameMoves(updatedPk.moves, original.moves);
            const movePpChanged = !sameMovePp(updatedPk.move_pp, original.move_pp);
            const movePpUpsChanged = !sameMovePp(updatedPk.move_pp_ups, original.move_pp_ups);
            if (movesChanged || movePpChanged || movePpUpsChanged) {
                await client.updatePartyMoves(updatedPk.index, {
                    moves: updatedPk.moves,
                    move_pp: updatedPk.move_pp,
                    move_pp_ups: updatedPk.move_pp_ups,
                });
            }

            if (Number(updatedPk.nature_id) !== Number(original.nature_id)) {
                await client.updatePartyNature(updatedPk.index, { nature_id: updatedPk.nature_id });
            }

            if (Number(updatedPk.item_id) !== Number(original.item_id)) {
                await client.updatePartyItem(updatedPk.index, { item_id: updatedPk.item_id });
            }

            if (String(updatedPk.nickname || '').trim() !== String(original.nickname || '').trim()) {
                await client.updatePartyNickname(updatedPk.index, { nickname: updatedPk.nickname || '' });
            }

            if (updatedPk.species_id !== selectedPokemon?.species_id) {
                await client.updatePartySpecies(updatedPk.index, { species_id: updatedPk.species_id });
            }

            if (Number(updatedPk.current_ability_index) !== Number(original.current_ability_index)) {
                await client.updatePartyAbilitySwitch(updatedPk.index, { ability_index: updatedPk.current_ability_index });
            }

            const identityPayload = {};
            if (Boolean(updatedPk.is_shiny) !== Boolean(original.is_shiny)) {
                identityPayload.shiny = Boolean(updatedPk.is_shiny);
            }
            if (
                typeof updatedPk.gender === 'string' &&
                updatedPk.gender !== original.gender &&
                (updatedPk.gender === 'male' || updatedPk.gender === 'female' || updatedPk.gender === 'genderless')
            ) {
                identityPayload.gender = updatedPk.gender;
            }
            if (Object.keys(identityPayload).length > 0) {
                await client.updatePartyIdentity(updatedPk.index, identityPayload);
            }

            if (updatedPk.level_edit) {
                await client.updatePartyLevel(updatedPk.index, updatedPk.level_edit);
            }
            await client.saveAll();

            setSelectedPokemon(null);
            setRefreshKey(prev => prev + 1);
            alert("Pokemon updated and saved successfully!");
        } catch {
            alert("Failed to save all changes.");
        }
    };

    const handleSavePC = async (updatedPk) => {
        try {
            const original = selectedPokemon || {};
            const payload = {
                box: updatedPk.box,
                slot: updatedPk.slot,
            };

            if (!sameMoves(updatedPk.moves, original.moves)) {
                payload.moves = updatedPk.moves;
            }
            if (!sameMovePp(updatedPk.move_pp, original.move_pp)) {
                payload.move_pp = updatedPk.move_pp;
            }
            if (!sameMovePp(updatedPk.move_pp_ups, original.move_pp_ups)) {
                payload.move_pp_ups = updatedPk.move_pp_ups;
            }

            if (Number(updatedPk.item_id) !== Number(original.item_id)) {
                payload.item_id = updatedPk.item_id;
            }

            if (!sameStats(updatedPk.ivs, original.ivs)) {
                payload.ivs = updatedPk.ivs;
            }

            if (!sameStats(updatedPk.evs, original.evs)) {
                payload.evs = updatedPk.evs;
            }

            if (Number(updatedPk.nature_id) !== Number(original.nature_id)) {
                payload.nature_id = updatedPk.nature_id;
            }

            if (Number(updatedPk.exp) !== Number(original.exp)) {
                payload.exp = updatedPk.exp;
            }

            if (String(updatedPk.nickname || '').trim() !== String(original.nickname || '').trim()) {
                payload.nickname = updatedPk.nickname || '';
            }

            if (Number(updatedPk.current_ability_index) !== Number(original.current_ability_index)) {
                payload.current_ability_index = Number(updatedPk.current_ability_index);
            }

            if (updatedPk.species_id !== selectedPokemon?.species_id) {
                payload.species_id = updatedPk.species_id;
            }

            if (Boolean(updatedPk.is_shiny) !== Boolean(original.is_shiny)) {
                payload.shiny = Boolean(updatedPk.is_shiny);
            }

            if (
                typeof updatedPk.gender === 'string' &&
                updatedPk.gender !== original.gender &&
                (updatedPk.gender === 'male' || updatedPk.gender === 'female' || updatedPk.gender === 'genderless')
            ) {
                payload.gender = updatedPk.gender;
            }

            if (updatedPk.level_edit) {
                const targetLevel = Math.max(1, Math.min(100, Number(updatedPk.level_edit.target_level || 1)));
                let growthRate;
                if (updatedPk.level_edit.growth_rate === null || updatedPk.level_edit.growth_rate === undefined || updatedPk.level_edit.growth_rate === '') {
                    const speciesGrowth = getSpeciesGrowthRate(updatedPk.species_id);
                    growthRate = speciesGrowth === null ? 0 : speciesGrowth;
                } else {
                    growthRate = Math.max(0, Math.min(5, Number(updatedPk.level_edit.growth_rate)));
                }
                payload.exp = getExpAtLevel(growthRate, targetLevel);
            }

            await client.editPcFull(payload);
            await client.saveAll();
            setSelectedPokemon(null);
            setRefreshKey(prev => prev + 1);
            alert("PC Box updated successfully!");
        } catch {
            alert("Failed to save PC Box.");
        }
    };

    const handleInsertPcPokemon = async (payload) => {
        try {
            await client.insertPc(payload);
            await client.saveAll();
            setPcInsertTarget(null);
            setRefreshKey(prev => prev + 1);
            alert('Pokemon inserted successfully!');
        } catch {
            alert('Failed to add Pokemon to PC box.');
        }
    };

    const openMoneyModal = () => {
        setMoneyInput(String(money ?? 0));
        setShowMoneyModal(true);
    };

    const handleUpdateMoney = async () => {
        const amount = Math.max(0, parseInt(moneyInput, 10) || 0);
        try {
            await client.updateMoney(amount);
            setMoney(amount);
            setShowMoneyModal(false);
            alert('Money updated successfully!');
        } catch (err) {
            console.error(err);
            alert('Failed to update money.');
        }
    };

    const handleDownload = async () => {
        try {
            await client.downloadSave();
        } catch (err) {
            console.error(err);
            alert('Download is not available in this runtime mode yet.');
        }
    };

    const handleRestartApp = () => {
        window.location.reload();
    };

    useEffect(() => {
        if (!showMoneyModal) return;
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                setShowMoneyModal(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [showMoneyModal]);

    return (
        <div className="min-h-screen bg-[#0f172a] text-slate-100 flex flex-col items-center">
            <header className="w-full bg-[#1e293b]/80 backdrop-blur-md border-b border-white/5 sticky top-0 z-50">
                <div className="max-w-6xl mx-auto p-4 flex justify-between items-center gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <h1 className="text-xl font-black text-blue-400 tracking-tighter uppercase">
                            <span className="md:hidden">PUSE</span>
                            <span className="hidden md:inline">PUSE - Pokemon Unbound Save Editor</span>
                        </h1>
                        <select
                            value={runtimeMode}
                            onChange={(e) => setRuntimeMode(e.target.value)}
                            className="bg-slate-900 border border-white/10 rounded-xl px-2 py-1 text-[10px] uppercase tracking-widest text-slate-300 min-w-[116px]"
                        >
                            <option value={RUNTIME_MODES.backend}>Backend mode</option>
                            <option value={RUNTIME_MODES.local}>Local mode</option>
                        </select>
                        <button
                            type="button"
                            onClick={() => setLegitMode((prev) => !prev)}
                            className={`px-3 py-1 rounded-xl text-[10px] uppercase tracking-widest font-bold border transition-colors ${
                                legitMode
                                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                    : 'bg-slate-900 border-white/10 text-slate-300 hover:bg-slate-800'
                            }`}
                        >
                            Legit: {legitMode ? 'ON' : 'OFF'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowLegitHelp((prev) => !prev)}
                            className="p-1.5 rounded-lg bg-slate-900 border border-white/10 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                            aria-expanded={showLegitHelp}
                            aria-label="Show legit mode help"
                        >
                            <CircleHelp size={13} />
                        </button>
                    </div>
                    {isLoaded && (
                        <div className="flex items-center gap-2 md:gap-3 flex-wrap justify-end">
                            <div className="bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full text-emerald-400 font-mono text-sm">
                                ${money.toLocaleString()}
                            </div>
                            <button
                                onClick={openMoneyModal}
                                className="p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                                aria-label="Edit money"
                            >
                                <Edit3 size={14} />
                            </button>
                            <button
                                onClick={handleRestartApp}
                                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-full text-[11px] font-bold transition-all"
                            >
                                <RotateCcw size={14} /> RESTART / LOAD NEW FILE
                            </button>
                            <button
                                onClick={handleDownload}
                                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-full text-xs font-bold transition-all"
                            >
                                <Save size={14} /> DOWNLOAD {saveExt.toUpperCase()}
                            </button>
                        </div>
                    )}
                </div>
                {showLegitHelp && (
                    <div className="max-w-6xl mx-auto px-4 pb-3">
                        <p className="text-[11px] text-slate-300 bg-slate-900/70 border border-white/10 rounded-xl px-3 py-2">
                            Legit Mode enforces 510 total EV cap and keeps level edits explicit in the 1-100 range.
                        </p>
                    </div>
                )}
            </header>

            <main className="w-full max-w-6xl p-4 md:p-8 pb-36">
                {!isLoaded ? (
                    <div className="space-y-10 md:space-y-14 pb-8">
                        <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#1e293b]/95 via-[#16243c]/95 to-[#0f172a] p-5 md:p-8">
                            <div className="pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full bg-blue-500/15 blur-3xl" />
                            <div className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-cyan-500/10 blur-3xl" />
                            <div className="relative grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6 md:gap-8 items-start">
                                <div className="space-y-5 md:space-y-6">
                                    <p className="inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-[10px] md:text-xs font-black uppercase tracking-[0.16em] text-blue-300">
                                        <Sparkles size={12} /> Save editor for Pokemon Unbound
                                    </p>
                                    <h2 className="text-3xl md:text-5xl font-black leading-tight tracking-tight text-white">
                                        Edit your team, PC, bag, and money in a clean web workflow.
                                    </h2>
                                    <p className="text-slate-200/90 text-sm md:text-base max-w-2xl leading-relaxed">
                                        PUSE is a checksum-safe save editor focused on real CFRU + DPE flows. Load a <span className="font-mono">.sav</span> or <span className="font-mono">.srm</span>, edit what you need, and export your updated file.
                                    </p>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs md:text-sm">
                                        <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-3">
                                            <p className="text-slate-400 uppercase tracking-widest text-[10px]">Runtime</p>
                                            <p className="mt-1 font-semibold text-slate-100">Local in-browser or Backend API</p>
                                        </div>
                                        <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-3">
                                            <p className="text-slate-400 uppercase tracking-widest text-[10px]">Safety</p>
                                            <p className="mt-1 font-semibold text-slate-100">Checksum recalculation on save</p>
                                        </div>
                                        <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-3">
                                            <p className="text-slate-400 uppercase tracking-widest text-[10px]">Scope</p>
                                            <p className="mt-1 font-semibold text-slate-100">Party, PC, Bag, Money, RTC tools</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4 md:space-y-5">
                                    <div
                                        className="rounded-[1.75rem] border border-blue-500/30 bg-slate-950/50 p-5 md:p-6"
                                        onDrop={handleDropUpload}
                                        onDragOver={(e) => e.preventDefault()}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="h-12 w-12 rounded-xl bg-blue-600/20 border border-blue-400/40 flex items-center justify-center">
                                                <Upload className="text-blue-300" size={22} />
                                            </div>
                                            <div>
                                                <p className="text-xs uppercase tracking-widest text-blue-200 font-black">Start here</p>
                                                <h3 className="text-lg font-bold">Load Save File</h3>
                                            </div>
                                        </div>

                                        <div className="mt-4 rounded-2xl border border-dashed border-blue-400/40 bg-slate-900/60 px-4 py-6 text-center">
                                            <p className="text-xs text-slate-300">Drag and drop your file here</p>
                                            <p className="mt-1 text-[11px] text-slate-500">Accepted: <span className="font-mono">.sav</span> and <span className="font-mono">.srm</span></p>
                                            <label className="mt-4 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 px-5 py-2.5 rounded-xl cursor-pointer font-bold transition-all shadow-lg active:scale-95 text-xs md:text-sm">
                                                SELECT SAVE FILE <ArrowRight size={14} />
                                                <input type="file" className="hidden" onChange={handleUpload} accept=".sav,.srm" />
                                            </label>
                                        </div>

                                        <p className="mt-4 text-[11px] text-slate-400 leading-relaxed">
                                            Tip: Local mode runs entirely in your browser. Backend mode uses FastAPI endpoints.
                                        </p>
                                    </div>

                                    <details className="group rounded-[1.75rem] border border-amber-500/30 bg-amber-500/5 p-5 md:p-6">
                                        <summary className="list-none cursor-pointer flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">Advanced tools</p>
                                                <h3 className="mt-1 text-lg font-bold text-slate-100">RTC Metadata Recovery</h3>
                                                <p className="mt-1 text-xs text-slate-300">Fix RTC tampering issue without Frozen Heights NPC.</p>
                                            </div>
                                            <div className="text-[10px] text-amber-200 uppercase tracking-widest group-open:hidden">Open</div>
                                            <div className="text-[10px] text-amber-200 uppercase tracking-widest hidden group-open:block">Close</div>
                                        </summary>

                                        <div className="mt-5 border-t border-amber-500/20 pt-5">
                                            <div className="inline-flex rounded-xl border border-white/10 bg-slate-900/60 p-1 text-[10px] uppercase tracking-widest font-bold">
                                                <button
                                                    type="button"
                                                    onClick={() => setRtcTab('pair')}
                                                    className={`px-3 py-1 rounded-lg transition-colors ${
                                                        rtcTab === 'pair' ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-white/5'
                                                    }`}
                                                >
                                                    Pair Repair
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setRtcTab('quick')}
                                                    className={`px-3 py-1 rounded-lg transition-colors ${
                                                        rtcTab === 'quick' ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-white/5'
                                                    }`}
                                                >
                                                    Quick Fix
                                                </button>
                                            </div>

                                            {rtcTab === 'pair' ? (
                                                <>
                                                    <p className="mt-3 text-sm text-slate-200">
                                                        Build a repair pack using a tampered save and one NPC-fixed save.
                                                    </p>
                                                    <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-slate-300">
                                                        <label className="block">
                                                            <span className="block mb-1 text-slate-400">Tampered save (.sav)</span>
                                                            <input
                                                                type="file"
                                                                accept=".sav"
                                                                onChange={(e) => setRtcBrokenFile(e.target.files?.[0] || null)}
                                                                className="w-full text-xs"
                                                            />
                                                        </label>
                                                        <label className="block">
                                                            <span className="block mb-1 text-slate-400">NPC-fixed save (.sav)</span>
                                                            <input
                                                                type="file"
                                                                accept=".sav"
                                                                onChange={(e) => setRtcFixedFile(e.target.files?.[0] || null)}
                                                                className="w-full text-xs"
                                                            />
                                                        </label>
                                                    </div>
                                                    <button
                                                        onClick={handleRtcFixPack}
                                                        disabled={rtcBusy}
                                                        className="mt-4 inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900/60 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all"
                                                    >
                                                        <ShieldAlert size={14} /> {rtcBusy ? 'GENERATING...' : 'GENERATE PAIR REPAIR PACK'}
                                                    </button>
                                                    <p className="mt-2 text-[11px] text-slate-400">
                                                        Downloads manifest and fallback candidates in recommended order.
                                                    </p>
                                                </>
                                            ) : (
                                                <>
                                                    <p className="mt-3 text-sm text-slate-200">
                                                        Quick single-file RTC repair for known tampering signatures.
                                                    </p>
                                                    <p className="mt-2 text-[11px] text-amber-300">
                                                        Use only when you are confident the issue is RTC tampering.
                                                    </p>
                                                    <div className="mt-3 text-xs text-slate-300">
                                                        <label className="block">
                                                            <span className="block mb-1 text-slate-400">Tampered save (.sav)</span>
                                                            <input
                                                                type="file"
                                                                accept=".sav"
                                                                onChange={(e) => setRtcQuickFile(e.target.files?.[0] || null)}
                                                                className="w-full text-xs"
                                                            />
                                                        </label>
                                                    </div>
                                                    <button
                                                        onClick={handleRtcQuickFixPack}
                                                        disabled={rtcBusy}
                                                        className="mt-4 inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900/60 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all"
                                                    >
                                                        <ShieldAlert size={14} /> {rtcBusy ? 'GENERATING...' : 'GENERATE QUICK FIX PACK'}
                                                    </button>
                                                    <p className="mt-2 text-[11px] text-slate-400">
                                                        Downloads quick-fix candidates with ordered fallback hints.
                                                    </p>
                                                </>
                                            )}
                                        </div>
                                    </details>
                                </div>
                            </div>
                        </section>

                        <section className="space-y-4">
                            <div className="flex items-center gap-2 text-slate-300">
                                <CheckCircle2 size={16} className="text-emerald-400" />
                                <h3 className="text-lg md:text-xl font-bold">What You Can Do Right Now</h3>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                                <FeatureCard
                                    icon={<LayoutGrid size={18} className="text-blue-300" />}
                                    title="Party Editing"
                                    description="Edit species, nickname, level, nature, item, IV/EV spread, moves, PP/PP Ups, and ability slot."
                                />
                                <FeatureCard
                                    icon={<Users size={18} className="text-blue-300" />}
                                    title="PC Management"
                                    description="Browse boxes, edit stored Pokemon, and add new Pokemon directly into writable empty slots."
                                />
                                <FeatureCard
                                    icon={<Briefcase size={18} className="text-blue-300" />}
                                    title="Bag Workflows"
                                    description="Open pockets quickly, search fallback pockets reliably, then apply edits with explicit save-to-file flow."
                                />
                                <FeatureCard
                                    icon={<Edit3 size={18} className="text-blue-300" />}
                                    title="Identity Safety"
                                    description="Shiny and gender editing includes PID-aware validation to preserve legal game behavior when possible."
                                />
                                <FeatureCard
                                    icon={<Save size={18} className="text-blue-300" />}
                                    title="Checksum-Safe Export"
                                    description="Download your updated save with checksum recalculation handled during write flows."
                                />
                                <FeatureCard
                                    icon={<Shield size={18} className="text-blue-300" />}
                                    title="Recovery Tools"
                                    description="Use RTC pair repair and quick-fix candidate generation for known tampering recovery scenarios."
                                />
                            </div>
                        </section>

                        <section className="rounded-[2rem] border border-white/10 bg-[#1e293b]/50 p-5 md:p-6">
                            <div className="flex items-center gap-2 mb-4 text-slate-200">
                                <Sparkles size={16} className="text-blue-300" />
                                <h3 className="text-lg md:text-xl font-bold">How It Works</h3>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
                                <StepCard index="1" title="Load Save" description="Upload your .sav or .srm file and choose local or backend runtime mode." />
                                <StepCard index="2" title="Edit Data" description="Use Party, PC, and Bag editors to update stats, species, items, and resources." />
                                <StepCard index="3" title="Export" description="Download the edited save file after checksum-safe write operations complete." />
                            </div>
                        </section>

                        <section className="space-y-4">
                            <div className="flex items-center gap-2 text-slate-300">
                                <Cpu size={16} className="text-cyan-300" />
                                <h3 className="text-lg md:text-xl font-bold">UI Preview (Static)</h3>
                            </div>
                            <p className="text-xs md:text-sm text-slate-400">
                                These are non-interactive preview panels showing common workflows available after upload.
                            </p>
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-5">
                                <PartyPreviewPanel />
                                <EditorPreviewPanel />
                                <PcPreviewPanel />
                                <BagPreviewPanel />
                            </div>
                        </section>

                        <footer className="rounded-[2rem] border border-white/10 bg-[#1e293b]/40 px-5 py-5 md:px-6 md:py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div>
                                <p className="text-sm font-bold text-slate-100">PUSE - Pokemon Unbound Save Editor</p>
                                <p className="text-[11px] text-slate-400 mt-1">
                                    Unofficial fan utility. Always edit copies of your save files.
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                <a
                                    href="https://github.com/Zannael/PUSE"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-slate-900/70 px-3 py-2 hover:bg-slate-800"
                                >
                                    <Github size={14} /> GitHub
                                </a>
                                <a
                                    href="https://github.com/Zannael/PUSE/blob/master/CHANGELOG.md"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-slate-900/70 px-3 py-2 hover:bg-slate-800"
                                >
                                    <Database size={14} /> Changelog
                                </a>
                            </div>
                        </footer>
                    </div>
                ) : (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <Suspense fallback={<div className="py-16 text-center text-slate-400 animate-pulse">Loading editor section...</div>}>
                            {activeTab === 'party' && (
                                <PartyGrid
                                    key={`party-${refreshKey}`}
                                    client={client}
                                    onEditPokemon={(pk) => setSelectedPokemon(pk)}
                                />
                            )}
                            {activeTab === 'pc' && <PCGrid
                                key={`pc-${refreshKey}`}
                                client={client}
                                boxId={pcBoxId}
                                onBoxChange={setPcBoxId}
                                onEditPokemon={(pk) => {
                                    setSelectedPokemon({ ...pk, isPC: true });
                                }}
                                onAddPokemon={(target) => setPcInsertTarget(target)}
                            />}
                            {activeTab === 'bag' && <BagView client={client} initialUnsaved={bagHasUnsavedChanges} onDirtyChange={setBagHasUnsavedChanges} />}
                        </Suspense>
                    </div>
                )}
            </main>

            {showMoneyModal && (
                <div
                    className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setShowMoneyModal(false)}
                >
                    <div
                        className="w-full max-w-sm bg-[#0f172a] border border-white/10 rounded-[2rem] p-6 space-y-5"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold">Edit Money</h3>
                            <button onClick={() => setShowMoneyModal(false)} className="text-slate-500 hover:text-white">
                                <X size={18} />
                            </button>
                        </div>
                        <input
                            type="number"
                            step="1"
                            min="0"
                            max="999999"
                            value={moneyInput}
                            onChange={(event) => {
                                const value = event.target.value;
                                if (value.length <= 6) setMoneyInput(value);
                            }}
                            className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 font-mono text-emerald-400 outline-none focus:border-blue-500"
                        />
                        <p
                            className="text-[11px] text-slate-400"
                        >
                            Money is always clamped server-side to the legal range 0..999999, even if a larger value is entered.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowMoneyModal(false)}
                                className="flex-1 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUpdateMoney}
                                className="flex-1 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold"
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {selectedPokemon && (
                <Suspense fallback={null}>
                    <PokemonEditorModal
                        client={client}
                        pokemon={selectedPokemon}
                        legitMode={legitMode}
                        onClose={() => setSelectedPokemon(null)}
                        onSave={selectedPokemon?.isPC ? handleSavePC : handleSavePokemon}
                    />
                </Suspense>
            )}

            {pcInsertTarget && (
                <Suspense fallback={null}>
                    <AddPcPokemonModal
                        client={client}
                        target={pcInsertTarget}
                        legitMode={legitMode}
                        onClose={() => setPcInsertTarget(null)}
                        onConfirm={handleInsertPcPokemon}
                    />
                </Suspense>
            )}

            {isLoaded && (
                <nav className="fixed bottom-6 w-[90%] max-w-md bg-[#1e293b]/95 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-2 shadow-2xl flex justify-around z-50">
                    <TabItem icon={<LayoutGrid size={20}/>} label="Party" active={activeTab === 'party'} onClick={() => handleTabChange('party')} />
                    <TabItem icon={<Users size={20}/>} label="PC Box" active={activeTab === 'pc'} onClick={() => handleTabChange('pc')} />
                    <TabItem icon={<Briefcase size={20}/>} label="Bag" active={activeTab === 'bag'} onClick={() => handleTabChange('bag')} />
                </nav>
            )}

        </div>
    );
};

const FeatureCard = ({ icon, title, description }) => (
    <article className="rounded-3xl border border-white/10 bg-[#1e293b]/50 p-4 md:p-5">
        <div className="h-9 w-9 rounded-xl border border-blue-400/30 bg-blue-500/10 flex items-center justify-center">
            {icon}
        </div>
        <h4 className="mt-3 text-base font-bold text-slate-100">{title}</h4>
        <p className="mt-1 text-xs md:text-sm text-slate-300 leading-relaxed">{description}</p>
    </article>
);

const StepCard = ({ index, title, description }) => (
    <article className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
        <p className="text-[10px] text-blue-300 font-black uppercase tracking-[0.18em]">Step {index}</p>
        <h4 className="mt-1 text-sm md:text-base font-bold text-slate-100">{title}</h4>
        <p className="mt-1 text-xs text-slate-400">{description}</p>
    </article>
);

const PartyPreviewPanel = () => (
    <article className="rounded-[1.75rem] border border-white/10 bg-[#1e293b]/50 p-4 md:p-5">
        <p className="text-[10px] uppercase tracking-[0.15em] text-slate-400 font-black">Party preview</p>
        <h4 className="mt-1 text-base font-bold">Team Cards + Fast Editing</h4>
        <div className="mt-3 rounded-2xl border border-white/10 bg-slate-900/50 p-3">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <p className="font-semibold text-sm">Garchomp</p>
                    <p className="text-[11px] text-slate-400">Lv. 78 | Rough Skin</p>
                </div>
                <span className="text-[10px] px-2 py-1 rounded-md bg-blue-500/20 text-blue-300">Jolly</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
                {[
                    ['HP', 31],
                    ['ATK', 31],
                    ['DEF', 28],
                    ['SPA', 9],
                    ['SPD', 24],
                    ['SPE', 31],
                ].map(([stat, value]) => (
                    <div key={stat} className="rounded-lg border border-white/10 bg-slate-950/50 px-2 py-1.5">
                        <p className="text-[9px] text-slate-500 uppercase tracking-wider">{stat}</p>
                        <p className="text-xs font-bold text-slate-200">{value}</p>
                    </div>
                ))}
            </div>
        </div>
    </article>
);

const EditorPreviewPanel = () => (
    <article className="rounded-[1.75rem] border border-white/10 bg-[#1e293b]/50 p-4 md:p-5">
        <p className="text-[10px] uppercase tracking-[0.15em] text-slate-400 font-black">Editor preview</p>
        <h4 className="mt-1 text-base font-bold">Species, Moves, EV/IV, Identity</h4>
        <div className="mt-3 rounded-2xl border border-white/10 bg-slate-900/50 p-3 space-y-2">
            <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-lg bg-slate-950/60 border border-white/10 px-2 py-1.5 text-slate-300">Species</div>
                <div className="rounded-lg bg-blue-500/15 border border-blue-400/30 px-2 py-1.5 text-blue-300">Stats</div>
                <div className="rounded-lg bg-slate-950/60 border border-white/10 px-2 py-1.5 text-slate-300">Moves</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-slate-950/60 border border-white/10 p-2 text-slate-300">EV Total: 508 / 510</div>
                <div className="rounded-lg bg-slate-950/60 border border-white/10 p-2 text-slate-300">Shiny: ON | Gender: M</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-slate-950/60 border border-white/10 p-2 text-slate-300">Earthquake (16/16)</div>
                <div className="rounded-lg bg-slate-950/60 border border-white/10 p-2 text-slate-300">Dragon Claw (24/24)</div>
            </div>
        </div>
    </article>
);

const PcPreviewPanel = () => (
    <article className="rounded-[1.75rem] border border-white/10 bg-[#1e293b]/50 p-4 md:p-5">
        <p className="text-[10px] uppercase tracking-[0.15em] text-slate-400 font-black">PC preview</p>
        <h4 className="mt-1 text-base font-bold">Box Navigation + Insert Flow</h4>
        <div className="mt-3 rounded-2xl border border-white/10 bg-slate-900/50 p-3">
            <div className="flex items-center justify-between text-xs text-slate-300">
                <span className="font-bold text-blue-300">Box 12</span>
                <span>21 / 30 Pokemon</span>
            </div>
            <div className="mt-3 grid grid-cols-6 gap-1.5">
                {Array.from({ length: 18 }, (_, idx) => idx).map((slot) => (
                    <div
                        key={slot}
                        className={`aspect-square rounded-md border ${slot % 5 === 0 ? 'border-emerald-400/30 bg-emerald-500/10' : 'border-white/10 bg-slate-950/50'}`}
                    />
                ))}
            </div>
        </div>
    </article>
);

const BagPreviewPanel = () => (
    <article className="rounded-[1.75rem] border border-white/10 bg-[#1e293b]/50 p-4 md:p-5">
        <p className="text-[10px] uppercase tracking-[0.15em] text-slate-400 font-black">Bag preview</p>
        <h4 className="mt-1 text-base font-bold">Quick Pockets + Explicit Save</h4>
        <div className="mt-3 rounded-2xl border border-white/10 bg-slate-900/50 p-3 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-1.5 text-emerald-300">Main ready</div>
                <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-1.5 text-emerald-300">Ball ready</div>
                <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1.5 text-amber-300">Berry locked</div>
                <div className="rounded-lg border border-white/10 bg-slate-950/50 px-2 py-1.5 text-slate-400">TM search</div>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                Unsaved edits pending: click SAVE BAG CHANGES.
            </div>
        </div>
    </article>
);

const TabItem = ({ icon, label, active, onClick }) => (
    <button
        onClick={onClick}
        className={`flex flex-col items-center justify-center flex-1 py-3 rounded-[2rem] transition-all duration-300 ${
            active ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/40' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
        }`}
    >
        {icon}
        <span className="text-[10px] font-bold uppercase mt-1.5 tracking-tighter sm:block hidden">{label}</span>
    </button>
);

export default App;
