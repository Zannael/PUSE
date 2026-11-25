import { allProfiles, supports, PROFILE } from './core/profile.js';
import React, { lazy, Suspense, useCallback, useMemo, useState, useEffect, useRef } from 'react';
import {
    Upload,
    LayoutGrid,
    Users,
    Briefcase,
    BookOpen,
    Save,
    Edit3,
    X,
    Sparkles,
    Github,
    CheckCircle2,
    ArrowRight,
    Shield,
    Cpu,
    Database,
    Menu,
    UserRound,
    ListFilter,
    Undo2,
} from 'lucide-react';
import { createApiClient, getInitialRuntimeMode, persistRuntimeMode, RUNTIME_MODES } from './services/apiClient.js';
import { getExpAtLevel, getSpeciesGrowthRate } from './core/growth.js';
import GraphicsResources from './components/GraphicsResources.jsx';
import SaveTools from './components/SaveTools.jsx';
import Dialog from './components/Dialog.jsx';
import ChangeLedgerPanel from './components/ChangeLedgerPanel.jsx';

const PartyGrid = lazy(() => import('./components/PartyGrid'));
const PCGrid = lazy(() => import('./components/PCGrid'));
const AllPokemonTable = lazy(() => import('./components/AllPokemonTable.jsx'));
const FieldInspector = lazy(() => import('./components/FieldInspector.jsx'));
const BagView = lazy(() => import('./components/BagView.jsx'));
const LivingDexPanel = lazy(() => import('./components/LivingDexPanel.jsx'));
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
    const mainContent = useRef(null);
    const [compatibility, setCompatibility] = useState(null);
    const [pendingUpload, setPendingUpload] = useState(null);
    const [uploadBusy, setUploadBusy] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [showMenu, setShowMenu] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [runtimeMode, setRuntimeMode] = useState(getInitialRuntimeMode);
    const [legitMode, setLegitMode] = useState(getInitialLegitMode);
    const [activeTab, setActiveTab] = useState('party');
    const [isLoaded, setIsLoaded] = useState(false);
    const [saveExt, setSaveExt] = useState('.sav');
    const [trainer, setTrainer] = useState(null);
    const [money, setMoney] = useState(0);
    const [bp, setBp] = useState(0);
    const [saveReport, setSaveReport] = useState(null);
    const [saveReportLoading, setSaveReportLoading] = useState(false);
    const [saveReportError, setSaveReportError] = useState('');
    const [showSaveReport, setShowSaveReport] = useState(false);
    const [moneyInput, setMoneyInput] = useState('0');
    const [bpInput, setBpInput] = useState('0');
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

    const uploadSaveFile = async (file, requestedProfile = null) => {
        if (!file || uploadBusy) return;
        setUploadBusy(true);
        setUploadError('');
        try {
            const report = await client.inspectCompatibility(file, requestedProfile);
            setCompatibility({ report, filename: file.name });
            if (!report.mutations_allowed) {
                if (!requestedProfile && report.candidates.length &&
                    (report.candidates.length > 1 || (report.blockers.length === 1 && report.blockers[0] === 'explicit_selection_required'))) {
                    setPendingUpload({ file, candidates: report.candidates });
                }
                if (requestedProfile) setUploadError(`This file cannot be opened for editing: ${report.blockers.join(', ')}. Choose another supported save.`);
                return;
            }
            await client.uploadSave(file, requestedProfile);
            setPendingUpload(null);
            setBagHasUnsavedChanges(false);
            setTrainer(await client.getTrainer());
            setActiveTab('party');
            setPcBoxId(1);
            const [mData, bpData] = await Promise.all([client.getMoney(), supports('bp') ? client.getBp() : Promise.resolve({bp: 0})]);
            setMoney(Number(mData.money ?? 0));
            setBp(Number(bpData.bp ?? 0));
            setMoneyInput(String(mData.money ?? 0));
            setBpInput(String(bpData.bp ?? 0));
            setSaveExt(file.name.toLowerCase().endsWith('.srm') ? '.srm' : '.sav');
            setIsLoaded(true);
            await refreshHistory();
        } catch (err) {
            setUploadError(err.message || 'Upload failed for current runtime mode.');
        } finally {
            setUploadBusy(false);
        }
    };

    const handleUpload = async (e) => {
        const input = e.currentTarget;
        const file = input.files?.[0];
        try {
            await uploadSaveFile(file);
        } finally {
            // A retry must fire change even when the same file is selected
            // after correcting the game version or runtime mode.
            input.value = '';
        }
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
    const [history, setHistory] = useState({
        entries: [],
        can_undo: false,
        can_reset: false,
        total_changed_bytes: 0,
        max_entries: 50,
    });
    const [historyBusy, setHistoryBusy] = useState(false);

    const refreshHistory = useCallback(async () => {
        if (!client?.getHistory) return null;
        try {
            const [nextHistory, sessionStatus] = await Promise.all([
                client.getHistory(),
                client.getSessionStatus ? client.getSessionStatus() : Promise.resolve(null),
            ]);
            if (nextHistory) {
                setHistory(nextHistory);
            }
            if (sessionStatus && typeof sessionStatus.bag_dirty === 'boolean') {
                setBagHasUnsavedChanges(sessionStatus.bag_dirty);
            }
            return nextHistory;
        } catch (err) {
            console.error(err);
            return null;
        }
    }, [client]);

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
            const payload = {};

            if (!sameStats(updatedPk.ivs, original.ivs)) {
                payload.ivs = mapStatsForApi(updatedPk.ivs, 31);
            }

            if (!sameStats(updatedPk.evs, original.evs)) {
                payload.evs = mapStatsForApi(updatedPk.evs, 252);
            }

            const movesChanged = !sameMoves(updatedPk.moves, original.moves);
            const movePpChanged = !sameMovePp(updatedPk.move_pp, original.move_pp);
            const movePpUpsChanged = !sameMovePp(updatedPk.move_pp_ups, original.move_pp_ups);
            if (movesChanged || movePpChanged || movePpUpsChanged) {
                payload.moves = updatedPk.moves;
                payload.move_pp = updatedPk.move_pp;
                payload.move_pp_ups = updatedPk.move_pp_ups;
            }

            if (Number(updatedPk.nature_id) !== Number(original.nature_id)) {
                payload.nature_id = Number(updatedPk.nature_id);
            }

            if (Number(updatedPk.item_id) !== Number(original.item_id)) {
                payload.item_id = Number(updatedPk.item_id);
            }

            if (Number(updatedPk.ball_id) !== Number(original.ball_id)) {
                payload.ball_id = Number(updatedPk.ball_id);
            }

            if (Number(updatedPk.happiness) !== Number(original.happiness)) {
                payload.happiness = Number(updatedPk.happiness);
            }

            if (updatedPk.species_id !== selectedPokemon?.species_id) {
                payload.species_id = Number(updatedPk.species_id);
            }

            if (String(updatedPk.ot_name || '').trim() !== String(original.ot_name || '').trim()) {
                payload.ot_name = updatedPk.ot_name;
            }

            if (String(updatedPk.nickname || '').trim() !== String(original.nickname || '').trim()) {
                payload.nickname = updatedPk.nickname || '';
            }

            if (Number(updatedPk.current_ability_index) !== Number(original.current_ability_index)) {
                payload.current_ability_index = Number(updatedPk.current_ability_index);
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
                payload.level_edit = updatedPk.level_edit;
            }

            await client.editPartyFull(updatedPk.index, payload);
            await client.saveAll();
            await refreshHistory();

            setSelectedPokemon(null);
            setRefreshKey(prev => prev + 1);
            alert("Pokemon updated and saved successfully!");
        } catch (err) {
            alert(err?.message || "Failed to save all changes.");
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

            if (Number(updatedPk.ball_id) !== Number(original.ball_id)) {
                payload.ball_id = Number(updatedPk.ball_id);
            }

            if (Number(updatedPk.happiness) !== Number(original.happiness)) {
                payload.happiness = Number(updatedPk.happiness);
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

            if (String(updatedPk.ot_name || '').trim() !== String(original.ot_name || '').trim()) {
                payload.ot_name = updatedPk.ot_name;
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
            await refreshHistory();
            setSelectedPokemon(null);
            setRefreshKey(prev => prev + 1);
            alert("PC Box updated successfully!");
        } catch (err) {
            alert(err?.message || "Failed to save PC Box.");
        }
    };

    const handleInsertPcPokemon = async (payload) => {
        try {
            await client.insertPc(payload);
            await client.saveAll();
            await refreshHistory();
            setPcInsertTarget(null);
            setRefreshKey(prev => prev + 1);
            alert('Pokemon inserted successfully!');
        } catch (err) {
            alert(err?.message || 'Failed to add Pokemon to PC box.');
        }
    };

    const handleReleasePC = async ({ box, slot, pokemon }) => {
        const label = pokemon?.nickname || pokemon?.species_name || 'this Pokemon';
        if (!window.confirm(`Release ${label} from ${Number(box) === 26 ? 'Preset' : `Box ${box}`} slot ${slot}?`)) {
            return;
        }
        try {
            await client.releasePc({ box, slot });
            await client.saveAll();
            await refreshHistory();
            setRefreshKey(prev => prev + 1);
            alert('Pokemon released successfully.');
        } catch (err) {
            alert(err?.message || 'Failed to release Pokemon.');
        }
    };

    const handleUpdateResources = async () => {
        const amount = Math.max(0, Math.min(999999999, parseInt(moneyInput, 10) || 0));
        const bpAmount = Math.max(0, Math.min(65535, parseInt(bpInput, 10) || 0));
        let groupStarted = false;
        try {
            if (client.beginHistoryGroup) {
                await client.beginHistoryGroup('resources_edit', 'Update Money / BP');
                groupStarted = true;
            }
            await client.updateMoney(amount);
            if (supports('bp')) {
                await client.updateBp(bpAmount);
            }
            if (groupStarted && client.commitHistoryGroup) {
                await client.commitHistoryGroup();
                groupStarted = false;
            }
            const [mData, bpData] = await Promise.all([client.getMoney(), supports('bp') ? client.getBp() : Promise.resolve({bp: 0})]);
            setMoney(Number(mData.money ?? amount));
            setBp(Number(bpData.bp ?? bpAmount));
            setMoneyInput(String(mData.money ?? amount));
            setBpInput(String(bpData.bp ?? bpAmount));
            await refreshHistory();
            alert('Trainer currencies updated successfully!');
        } catch (err) {
            console.error(err);
            if (groupStarted && client.abortHistoryGroup) {
                await client.abortHistoryGroup().catch(() => {});
            }
            const [mData, bpData] = await Promise.all([
                client.getMoney().catch(() => null),
                supports('bp') ? client.getBp().catch(() => null) : Promise.resolve({bp: 0}),
            ]);
            if (mData) {
                setMoney(Number(mData.money ?? 0));
                setMoneyInput(String(mData.money ?? 0));
            }
            if (bpData) {
                setBp(Number(bpData.bp ?? 0));
                setBpInput(String(bpData.bp ?? 0));
            }
            await refreshHistory();
            alert(err?.message || 'Failed to update trainer currencies.');
        }
    };

    const syncLoadedStateAfterHistoryChange = async (result) => {
        if (result) {
            setHistory(result);
        } else {
            await refreshHistory();
        }
        if (result?.session && typeof result.session.bag_dirty === 'boolean') {
            setBagHasUnsavedChanges(result.session.bag_dirty);
        }
        setSelectedPokemon(null);
        setPcInsertTarget(null);
        const [trainerData, mData, bpData] = await Promise.all([
            client.getTrainer().catch(() => null),
            client.getMoney().catch(() => null),
            supports('bp') ? client.getBp().catch(() => null) : Promise.resolve({bp: 0}),
        ]);
        if (trainerData) setTrainer(trainerData);
        if (mData) {
            setMoney(Number(mData.money ?? 0));
            setMoneyInput(String(mData.money ?? 0));
        }
        if (bpData) {
            setBp(Number(bpData.bp ?? 0));
            setBpInput(String(bpData.bp ?? 0));
        }
        setRefreshKey(prev => prev + 1);
        if (showSaveReport) {
            setSaveReportLoading(true);
            try {
                setSaveReport(await client.getSaveReport());
            } catch (err) {
                console.error(err);
                setSaveReportError('Could not inspect this save. Try again before downloading.');
            } finally {
                setSaveReportLoading(false);
            }
        }
    };

    const handleUndoLastChange = async () => {
        if (historyBusy || !history.can_undo) return;
        setHistoryBusy(true);
        try {
            const result = await client.undoLastChange();
            await syncLoadedStateAfterHistoryChange(result);
        } catch (err) {
            alert(err?.message || 'Failed to undo last change.');
        } finally {
            setHistoryBusy(false);
        }
    };

    const handleResetToOriginal = async () => {
        if (historyBusy || !history.can_reset) return;
        if (!window.confirm('Reset the loaded save back to the original uploaded file? This clears all edits made in this session.')) {
            return;
        }
        setHistoryBusy(true);
        try {
            const result = await client.resetSaveToOriginal();
            await syncLoadedStateAfterHistoryChange(result);
        } catch (err) {
            alert(err?.message || 'Failed to reset save to original.');
        } finally {
            setHistoryBusy(false);
        }
    };

    const handleDownload = async () => {
        setShowSaveReport(true);
        setSaveReport(null);
        setSaveReportError('');
        setSaveReportLoading(true);
        try {
            const [report] = await Promise.all([client.getSaveReport(), refreshHistory()]);
            setSaveReport(report);
        } catch (err) {
            console.error(err);
            setSaveReportError('Could not inspect this save. Try again before downloading.');
        } finally {
            setSaveReportLoading(false);
        }
    };

    const confirmDownload = async () => {
        if (!saveReport) return;
        try {
            await client.downloadSave();
            await refreshHistory();
            setShowSaveReport(false);
        } catch (err) {
            console.error(err);
            setSaveReportError('Download failed. Your in-memory save is still loaded.');
        }
    };

    const handleRestartApp = () => {
        window.location.reload();
    };

    useEffect(() => {
        if (!showSaveReport) return;
        const onKeyDown = (event) => {
            if (event.key === 'Escape') setShowSaveReport(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [showSaveReport]);


    const trainerPanel = <section className="max-w-xl space-y-6">
        <div><h2 className="text-2xl font-bold">Trainer</h2><p className="mt-1 text-sm text-slate-400">Trainer identity is read-only. Apply currency changes before downloading your save.</p></div>
        <dl className="grid grid-cols-2 gap-4 rounded-xl bg-slate-800 p-5">
            {[['Name', trainer?.name], ['Game', PROFILE.identity.game], ['Trainer ID', trainer?.tid], ['Secret ID', trainer?.sid]].map(([label, value]) => <div key={label}><dt className="text-sm text-slate-400">{label}</dt><dd className="mt-1 font-semibold">{value ?? '—'}</dd></div>)}
        </dl>
        <div className="space-y-3">
            <div>
                <label htmlFor="trainer-money" className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">Money</label>
                <input
                    id="trainer-money"
                    type="number"
                    step="1"
                    min="0"
                    max="999999999"
                    value={moneyInput}
                    onChange={(event) => {
                        const value = event.target.value;
                        if (value.length <= 9) setMoneyInput(value);
                    }}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 font-mono text-emerald-400 outline-none focus:border-blue-500"
                />
            </div>
            {supports('bp') && <div>
                <label htmlFor="trainer-bp" className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">Battle Points</label>
                <input
                    id="trainer-bp"
                    type="number"
                    step="1"
                    min="0"
                    max="65535"
                    value={bpInput}
                    onChange={(event) => {
                        const value = event.target.value;
                        if (value.length <= 5) setBpInput(value);
                    }}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 font-mono text-amber-300 outline-none focus:border-blue-500"
                />
            </div>}
        </div>
        <p className="text-[11px] text-slate-400">
            Money: 0–999,999,999.{supports('bp') && ' Battle Points: 0–65,535.'}
        </p>

        <div className="flex gap-3">
            <button type="button" onClick={() => { setMoneyInput(String(money)); setBpInput(String(bp)); }} className="rounded-xl bg-slate-800 px-4 py-2 hover:bg-slate-700">Reset fields</button>
            <button type="button" onClick={handleUpdateResources} className="rounded-xl bg-blue-600 px-4 py-2 font-semibold hover:bg-blue-500">Apply changes</button>
        </div>
    </section>;

    useEffect(() => {
        if (isLoaded) {
            mainContent.current?.focus({ preventScroll: true });
            window.scrollTo({ top: 0, behavior: 'instant' });
            refreshHistory();
        }
    }, [activeTab, isLoaded, refreshKey, refreshHistory]);

    const editorNavigation = <>
        <TabItem icon={<LayoutGrid size={20} />} label="Party" active={activeTab === 'party'} onClick={() => handleTabChange('party')} />
        <TabItem icon={<Users size={20} />} label="PC" active={activeTab === 'pc'} onClick={() => handleTabChange('pc')} />
        {supports('roster_export') && <TabItem icon={<ListFilter size={20} />} label="All Pokémon" active={activeTab === 'all'} onClick={() => handleTabChange('all')} />}
        <TabItem icon={<Briefcase size={20} />} label="Bag" active={activeTab === 'bag'} onClick={() => handleTabChange('bag')} />
        {supports('pokedex') && <TabItem icon={<BookOpen size={20} />} label="Pokédex" active={activeTab === 'dex'} onClick={() => handleTabChange('dex')} />}
        <TabItem icon={<UserRound size={20} />} label="Trainer" active={activeTab === 'trainer'} onClick={() => handleTabChange('trainer')} />
    </>;
    const openSection = (section) => {
        setShowMenu(false);
        handleTabChange(section);
    };

    return (
        <div className="min-h-screen bg-[#0f172a] text-slate-100 flex flex-col items-center">
            <header className="w-full bg-[#1e293b]/80 backdrop-blur-md border-b border-white/5 sticky top-0 z-50">
                <div className="max-w-6xl mx-auto px-3 py-3 flex justify-between items-center gap-2 md:px-8">
                    <h1 className="text-xl font-black text-blue-400 tracking-tighter">PUSE</h1>
                    <div className="flex items-center gap-2">
                        <button type="button" aria-pressed={legitMode} onClick={() => setLegitMode(prev => !prev)}
                            className={`h-10 whitespace-nowrap rounded-lg border px-2 py-2 text-xs font-semibold ${legitMode ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-white/10 text-slate-300'}`}>
                            Legit {legitMode ? 'ON' : 'OFF'}
                        </button>
                        {isLoaded && <button type="button" onClick={handleDownload} className="inline-flex h-10 items-center gap-1 rounded-lg bg-blue-600 px-2 py-2 text-xs font-semibold md:gap-2 md:px-3 md:text-sm hover:bg-blue-500">
                            <Save size={16} /><span className="lg:hidden">Download</span><span className="hidden lg:inline">Review / download {saveExt}</span>
                        </button>}
                        <div className="app-header-actions items-center gap-1" aria-label="App tools">
                            {isLoaded && <>
                                <button
                                    type="button"
                                    onClick={handleUndoLastChange}
                                    disabled={!history.can_undo || historyBusy}
                                    title={history.can_undo ? `Undo: ${history.entries[0]?.label || 'last change'}` : 'No changes to undo'}
                                    className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs lg:px-3 lg:text-sm text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    <Undo2 size={15} />
                                    <span>Undo</span>
                                </button>
                                <button type="button" onClick={() => openSection('graphics')} aria-current={activeTab === 'graphics' ? 'page' : undefined} className="rounded-lg px-2 py-2 text-xs lg:px-3 lg:text-sm text-slate-300 hover:bg-slate-700">Graphics</button>
                                <button type="button" onClick={() => openSection('tools')} aria-current={['tools', 'inspector'].includes(activeTab) ? 'page' : undefined} className="rounded-lg px-2 py-2 text-xs lg:px-3 lg:text-sm text-slate-300 hover:bg-slate-700">Tools</button>
                            </>}
                            <button type="button" onClick={() => setShowSettings(true)} className="rounded-lg px-2 py-2 text-xs lg:px-3 lg:text-sm text-slate-300 hover:bg-slate-700">Settings</button>
                            {isLoaded && <button type="button" onClick={handleRestartApp} aria-label="Load another save" className="rounded-lg px-2 py-2 text-xs lg:px-3 lg:text-sm text-slate-300 hover:bg-slate-700">Load save</button>}
                        </div>
                        <button type="button" onClick={() => setShowMenu(true)} aria-label="Menu" aria-haspopup="dialog" className="app-mobile-menu h-10 items-center gap-1 rounded-lg border border-white/10 px-2 py-2 text-xs hover:bg-slate-700"><Menu size={18} /><span className="hidden min-[360px]:inline">Menu</span></button>
                    </div>
                </div>
            </header>

            <main ref={mainContent} tabIndex={-1} className="outline-none w-full max-w-6xl px-4 pt-4 pb-48 md:px-8 md:pt-8 md:pb-48">
                {compatibility && !pendingUpload && <details key={JSON.stringify(compatibility)} open={!compatibility.report.mutations_allowed || compatibility.report.uses_older_generation} className="mb-5 rounded-xl border border-slate-600 bg-slate-900 p-4">
                    <summary className="cursor-pointer text-sm font-semibold">Save compatibility · {!compatibility.report.mutations_allowed ? 'Editing blocked' : compatibility.report.uses_older_generation ? 'Using older intact save' : 'Ready to edit'}</summary>
                    <div className="mt-3 space-y-2 text-sm text-slate-300" aria-label="Save compatibility report">
                        <p className="break-words">File: {compatibility.filename}</p>
                        <p>Profile: {compatibility.report.profile_id || 'Unknown layout'} · {compatibility.report.size} bytes</p>
                        <p>Container candidates: {compatibility.report.candidates.join(', ') || 'None'}. Structural evidence does not confirm the ROM version. Editing assumes the declared game/version.</p>
                        <p>Newest structural generation: {compatibility.report.structural_generation ?? 'None'} · Intact generation: {compatibility.report.editable_generation ?? 'None'}.</p>
                        {compatibility.report.uses_older_generation && <p>Using the older intact generation because the newer generation failed checksum validation.</p>}
                        {!!compatibility.report.opaque_section_ids.length && <p>Unverified checksum sections: {compatibility.report.opaque_section_ids.join(', ')}. Shared auxiliary data has no verified historical snapshot.</p>}
                        {!compatibility.report.mutations_allowed && <p role="alert">Blocked: {compatibility.report.blockers.join(', ')}. Check that your game/version is supported and choose another file. Unknown layouts remain available for structural inspection only.</p>}
                    </div>
                </details>}
                {uploadError && !pendingUpload && <p role="alert" className="mb-4 rounded-xl border border-rose-500/40 p-4 text-rose-200">{uploadError}</p>}
                {isLoaded && <GraphicsResources client={client} profileId={PROFILE.id} compact={activeTab !== 'graphics'} onManage={() => handleTabChange('graphics')} onChanged={() => setRefreshKey(key => key + 1)} />}
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
                                            <label className="mt-4 inline-flex items-center gap-2 focus-within:ring-2 focus-within:ring-blue-300 bg-blue-600 hover:bg-blue-500 px-5 py-2.5 rounded-xl cursor-pointer font-bold transition-all shadow-lg active:scale-95 text-xs md:text-sm">
                                                {uploadBusy ? 'Checking save…' : 'Select save file'} <ArrowRight size={14} />
                                                <input type="file" className="sr-only" disabled={uploadBusy} aria-label="Select save file" onChange={handleUpload} accept=".sav,.srm" />
                                            </label>
                                        </div>

                                        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-400">
                                            <span>{runtimeMode === RUNTIME_MODES.local ? 'Local mode · In your browser' : 'Backend mode · FastAPI'}</span>
                                            <button type="button" onClick={() => setShowSettings(true)} className="rounded-lg px-2 py-1 text-blue-300 hover:bg-slate-800">Change runtime</button>
                                        </div>
                                    </div>

                                    <SaveTools client={client} />
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
                                    description="Re-enable Unbound's in-game Time Fixer with a validated one-byte edit, or use pair repair as an advanced fallback."
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
                            {['pc', 'all'].includes(activeTab) && <div className="space-y-5">
                                {supports('roster_export') && <div role="group" aria-label="PC view" className="inline-flex gap-1 rounded-xl bg-slate-800 p-1">
                                    {[['boxes', 'Boxes'], ['all', 'All Pokémon']].map(([value, label]) => <button key={value} type="button" aria-pressed={activeTab === (value === 'boxes' ? 'pc' : 'all')} onClick={() => handleTabChange(value === 'boxes' ? 'pc' : 'all')} className={`rounded-lg px-4 py-2 text-sm ${activeTab === (value === 'boxes' ? 'pc' : 'all') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>{label}</button>)}
                                </div>}
                                {activeTab === 'pc' ? <PCGrid
                                key={`pc-${refreshKey}`}
                                client={client}
                                boxId={pcBoxId}
                                onBoxChange={setPcBoxId}
                                onEditPokemon={(pk) => {
                                    setSelectedPokemon({ ...pk, isPC: true });
                                }}
                                onAddPokemon={(target) => setPcInsertTarget(target)}
                                onReleasePokemon={handleReleasePC}
                            /> : <AllPokemonTable key={`all-${refreshKey}`} client={client} />}
                            </div>}
                            {activeTab === 'bag' && <BagView key={`bag-${refreshKey}`} client={client} initialUnsaved={bagHasUnsavedChanges} onDirtyChange={setBagHasUnsavedChanges} onChanged={refreshHistory} />}
                            {activeTab === 'tools' && <section className="space-y-5">
                                <h2 className="text-2xl font-bold">Save tools</h2>
                                <ChangeLedgerPanel history={history} busy={historyBusy} onUndo={handleUndoLastChange} onReset={handleResetToOriginal} />
                                <SaveTools client={client} />
                                <button type="button" onClick={() => handleTabChange('inspector')} className="rounded-xl border border-slate-600 px-4 py-3 hover:bg-slate-800">Inspect save fields · Advanced</button>
                            </section>}
                            {activeTab === 'trainer' && trainerPanel}
                            {activeTab === 'inspector' && <FieldInspector key={runtimeMode} client={client} />}
                            {supports('pokedex') && activeTab === 'dex' && <LivingDexPanel key={`dex-${refreshKey}`} client={client} />}
                        </Suspense>
                    </div>
                )}
            </main>

            {showSaveReport && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4" role="presentation">
                    <section role="dialog" aria-modal="true" aria-labelledby="save-report-title"
                        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-600 bg-slate-900 p-5 shadow-2xl">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 id="save-report-title" className="text-xl font-bold text-white">Review save before download</h2>
                                <p className="mt-1 text-sm text-slate-400">This report inspects the proposed download without changing your loaded save.</p>
                            </div>
                            <button type="button" autoFocus onClick={() => setShowSaveReport(false)} aria-label="Close save report" className="rounded-lg p-2 text-slate-300 hover:bg-slate-700"><X size={18} /></button>
                        </div>
                        {saveReportLoading && <p role="status" className="mt-5 text-slate-300">Checking save layout and checksums…</p>}
                        {saveReportError && <p role="alert" className="mt-5 rounded-lg border border-rose-500/50 bg-rose-500/10 p-3 text-rose-200">{saveReportError}</p>}
                        {saveReport && <div className="mt-5 space-y-5 text-sm">
                            <div className="grid gap-2 sm:grid-cols-3">
                                <p className="rounded-lg bg-slate-800 p-3"><span className="block text-slate-400">Active save index</span><strong>{saveReport.layout.active_save_index ?? 'Unknown'}</strong></p>
                                <p className="rounded-lg bg-slate-800 p-3"><span className="block text-slate-400">Checked sections</span><strong>{saveReport.checksums.filter((row) => row.status !== 'opaque').length}</strong></p>
                                <p className="rounded-lg bg-slate-800 p-3"><span className="block text-slate-400">Changed bytes</span><strong>{saveReport.changes.changed_bytes}</strong></p>
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-100">Loaded save warnings</h3>
                                {saveReport.source_warnings.length ? <ul className="mt-2 space-y-1 text-amber-200">
                                    {saveReport.source_warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>• {warning.message}</li>)}
                                </ul> : <p className="mt-1 text-emerald-300">No layout or active-section checksum warnings in the loaded file.</p>}
                                <h3 className="mt-3 font-semibold text-slate-100">Proposed download warnings</h3>
                                {saveReport.warnings.length ? <ul className="mt-2 space-y-1 text-amber-200">
                                    {saveReport.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>• {warning.message}</li>)}
                                </ul> : <p className="mt-1 text-emerald-300">No layout or active-section checksum warnings in the proposed download.</p>}
                                <p className="mt-1 text-xs text-slate-400">Opaque section 4 is excluded from generic checksum validation.</p>
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-100">Changes since upload</h3>
                                {saveReport.changes.sectors.length ? <ul className="mt-2 max-h-60 space-y-2 overflow-y-auto">
                                    {saveReport.changes.sectors.map((sector) => <li key={sector.index} className="rounded-lg bg-slate-800 p-3">
                                        <strong>Sector {sector.index} · ID {sector.id ?? 'unknown'}</strong>
                                        <span className="ml-2 text-slate-400">{sector.payload_bytes} data / {sector.footer_bytes} footer bytes</span>
                                        {sector.fields.length > 0 && <p className="mt-1 text-xs text-slate-300">{sector.fields.map((field) => `${field.name} (${field.changed_bytes})`).join(' · ')}</p>}
                                    </li>)}
                                </ul> : <p className="mt-1 text-slate-400">No sector changes since upload.</p>}
                            </div>
                            <ChangeLedgerPanel history={history} busy={historyBusy} onUndo={handleUndoLastChange} onReset={handleResetToOriginal} compact />
                        </div>}
                        <div className="mt-6 flex justify-end gap-2">
                            <button type="button" onClick={() => setShowSaveReport(false)} className="rounded-lg border border-slate-600 px-4 py-2 text-slate-100 hover:bg-slate-800">Cancel</button>
                            <button type="button" onClick={confirmDownload} disabled={!saveReport || saveReportLoading}
                                className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500 disabled:opacity-50">Download {saveExt.toUpperCase()}</button>
                        </div>
                    </section>
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
                        onChanged={refreshHistory}
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

            {isLoaded && <nav aria-label="Editor sections" className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] w-[92%] max-w-xl z-50 flex justify-around rounded-[2.5rem] border border-white/10 bg-[#1e293b]/95 p-2 shadow-2xl backdrop-blur-xl">{editorNavigation}</nav>}

            {showMenu && <Dialog title="Menu" onClose={() => setShowMenu(false)}>
                <div className="grid gap-2">
                    {isLoaded && <>
                        <button type="button" onClick={() => { setShowMenu(false); handleUndoLastChange(); }} disabled={!history.can_undo || historyBusy} className="rounded-xl bg-slate-800 p-4 text-left hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">Undo last change<span className="block text-sm text-slate-400">{history.can_undo ? history.entries[0]?.label : 'No recorded changes yet'}</span></button>
                        <button type="button" onClick={() => openSection('graphics')} className="rounded-xl bg-slate-800 p-4 text-left hover:bg-slate-700">Graphics<span className="block text-sm text-slate-400">Import images from your ROM or manage your pack</span></button>
                        <button type="button" onClick={() => openSection('tools')} className="rounded-xl bg-slate-800 p-4 text-left hover:bg-slate-700">Save tools<span className="block text-sm text-slate-400">Change history, Time Fixer, conversion, advanced inspection</span></button>
                    </>}
                    <button type="button" onClick={() => { setShowMenu(false); setShowSettings(true); }} className="rounded-xl bg-slate-800 p-4 text-left hover:bg-slate-700">Settings<span className="block text-sm text-slate-400">Runtime and Legit mode help</span></button>
                    {isLoaded && <button type="button" onClick={handleRestartApp} className="rounded-xl border border-slate-600 p-4 text-left hover:bg-slate-800">Load another save</button>}
                </div>
            </Dialog>}
            {showSettings && <Dialog title="Settings" onClose={() => setShowSettings(false)}>
                <label className="block text-sm">Runtime
                    <select value={runtimeMode} disabled={isLoaded || uploadBusy || !!pendingUpload} onChange={e => { setRuntimeMode(e.target.value); setCompatibility(null); setUploadError(''); }} className="mt-2 block w-full rounded-xl border border-slate-600 bg-slate-800 p-3">
                        <option value={RUNTIME_MODES.backend}>Backend mode</option><option value={RUNTIME_MODES.local}>Local mode</option>
                    </select>
                </label>
                <p className="mt-2 text-sm text-slate-400">Local mode runs in your browser. Backend mode uses FastAPI. Choose your runtime before loading a save.</p>
                {isLoaded && <p className="mt-2 text-sm text-slate-300">To switch runtime, use “Load another save” after downloading your edits.</p>}
                <h3 className="mt-6 font-semibold">Legit mode {legitMode ? 'ON' : 'OFF'}</h3>
                <p className="mt-2 text-sm text-slate-300">Legit mode enforces the 510 total EV limit and explicit level edits within 1–100. Toggle it in the header.</p>
            </Dialog>}
            {pendingUpload && <Dialog title="Confirm game / version" onClose={() => { setPendingUpload(null); setCompatibility(null); setUploadError(''); }} closeDisabled={uploadBusy}>
                <p className="break-words font-semibold">{pendingUpload.file.name}</p>
                <p className="mt-3 text-sm text-slate-300">The save structure is compatible with the following {pendingUpload.candidates.length === 1 ? 'profile' : 'profiles'}. It does not confirm the exact ROM version. Select the game/version you used.</p>
                <div className="mt-4 grid gap-2">
                    {allProfiles().filter(profile => pendingUpload.candidates.includes(profile.id)).map(profile => <button key={profile.id} type="button" disabled={uploadBusy} onClick={() => uploadSaveFile(pendingUpload.file, profile.id)} className="rounded-xl bg-blue-600 p-3 text-left font-semibold hover:bg-blue-500 disabled:opacity-50">{uploadBusy ? 'Checking…' : `Confirm ${profile.identity.game} ${profile.identity.versions.join(' / ')}`}</button>)}
                </div>
                {uploadError && <p role="alert" className="mt-3 text-rose-300">{uploadError}</p>}
                <p className="mt-3 text-xs text-slate-400">If your version is different, cancel and choose a supported save. You do not need to select this file again to confirm.</p>
            </Dialog>}

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
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={`flex flex-col items-center justify-center min-w-0 flex-1 gap-1 py-2 rounded-[2rem] sm:py-3 transition-all duration-300 ${
            active ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/40' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
        }`}
    >
        {icon}
        <span className="flex min-h-6 items-center justify-center text-center text-[10px] font-semibold leading-tight">{label}</span>
    </button>
);

export default App;
