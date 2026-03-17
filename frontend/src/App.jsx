import React, { useMemo, useState, useEffect } from 'react';
import { Upload, LayoutGrid, Users, Briefcase, Save, Edit3, X } from 'lucide-react';
import PartyGrid from './components/PartyGrid';
import PCGrid from './components/PCGrid';
import BagView from "./components/BagView.jsx";
import {PokemonEditorModal} from "./components/PokemonEditorModal.jsx";
import { createApiClient, getInitialRuntimeMode, persistRuntimeMode, RUNTIME_MODES } from './services/apiClient.js';
import { getExpAtLevel } from './core/growth.js';

const App = () => {
    const [runtimeMode, setRuntimeMode] = useState(getInitialRuntimeMode);
    const [activeTab, setActiveTab] = useState('party');
    const [isLoaded, setIsLoaded] = useState(false);
    const [money, setMoney] = useState(0);
    const [showMoneyModal, setShowMoneyModal] = useState(false);
    const [moneyInput, setMoneyInput] = useState('0');
    const client = useMemo(() => createApiClient(runtimeMode), [runtimeMode]);

    useEffect(() => {
        persistRuntimeMode(runtimeMode);
    }, [runtimeMode]);

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            await client.uploadSave(file);
            const mData = await client.getMoney();
            setMoney(mData.money);
            setMoneyInput(String(mData.money ?? 0));
            setIsLoaded(true);
        } catch {
            alert("Upload failed for current runtime mode.");
        }
    };

    const [selectedPokemon, setSelectedPokemon] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [bagHasUnsavedChanges, setBagHasUnsavedChanges] = useState(false);

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

            if (!sameMoves(updatedPk.moves, original.moves)) {
                await client.updatePartyMoves(updatedPk.index, { moves: updatedPk.moves });
            }

            if (Number(updatedPk.current_ability_index) !== Number(original.current_ability_index)) {
                await client.updatePartyAbilitySwitch(updatedPk.index, { ability_index: updatedPk.current_ability_index });
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

            if (updatedPk.species_id !== selectedPokemon?.species_id) {
                payload.species_id = updatedPk.species_id;
            }

            if (updatedPk.level_edit) {
                const targetLevel = Math.max(1, Math.min(100, Number(updatedPk.level_edit.target_level || 1)));
                const growthRate = Math.max(0, Math.min(5, Number(updatedPk.level_edit.growth_rate || 0)));
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

    const handleDownload = () => {
        try {
            client.downloadSave();
        } catch (err) {
            console.error(err);
            alert('Download is not available in this runtime mode yet.');
        }
    };

    return (
        <div className="min-h-screen bg-[#0f172a] text-slate-100 flex flex-col items-center">
            <header className="w-full bg-[#1e293b]/80 backdrop-blur-md border-b border-white/5 sticky top-0 z-50">
                <div className="max-w-6xl mx-auto p-4 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl font-black text-blue-400 tracking-tighter uppercase">Unbound Editor</h1>
                        <select
                            value={runtimeMode}
                            onChange={(e) => setRuntimeMode(e.target.value)}
                            className="bg-slate-900 border border-white/10 rounded-xl px-2 py-1 text-[10px] uppercase tracking-widest text-slate-300"
                        >
                            <option value={RUNTIME_MODES.backend}>Backend mode</option>
                            <option value={RUNTIME_MODES.local}>Local mode</option>
                        </select>
                    </div>
                    {isLoaded && (
                        <div className="flex items-center gap-4">
                            <div className="bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full text-emerald-400 font-mono text-sm">
                                ${money.toLocaleString()}
                            </div>
                            <button
                                onClick={openMoneyModal}
                                className="p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                                title="Edit money"
                            >
                                <Edit3 size={14} />
                            </button>
                            <button
                                onClick={handleDownload}
                                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-full text-xs font-bold transition-all"
                            >
                                <Save size={14} /> DOWNLOAD .SAV
                            </button>
                        </div>
                    )}
                </div>
            </header>

            <main className="w-full max-w-6xl p-4 md:p-8 pb-32">
                {!isLoaded ? (
                    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                        <div className="w-20 h-20 bg-blue-600/20 rounded-3xl flex items-center justify-center mb-6 border border-blue-500/30">
                            <Upload className="text-blue-500" size={32} />
                        </div>
                        <h2 className="text-3xl font-bold mb-2">Welcome Trainer</h2>
                        <label className="bg-blue-600 hover:bg-blue-500 px-10 py-4 rounded-2xl cursor-pointer font-bold transition-all shadow-lg active:scale-95">
                            SELECT SAVE FILE
                            <input type="file" className="hidden" onChange={handleUpload} accept=".sav" />
                        </label>
                    </div>
                ) : (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
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
                            onEditPokemon={(pk) => {
                                setSelectedPokemon({ ...pk, isPC: true });
                            }}
                        />}
                        {activeTab === 'bag' && <BagView client={client} initialUnsaved={bagHasUnsavedChanges} onDirtyChange={setBagHasUnsavedChanges} />}
                    </div>
                )}
            </main>

            {showMoneyModal && (
                <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-sm bg-[#0f172a] border border-white/10 rounded-[2rem] p-6 space-y-5">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold">Edit Money</h3>
                            <button onClick={() => setShowMoneyModal(false)} className="text-slate-500 hover:text-white">
                                <X size={18} />
                            </button>
                        </div>
                        <input
                            type="number"
                            min="0"
                            value={moneyInput}
                            onChange={(e) => setMoneyInput(e.target.value)}
                            className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 font-mono text-emerald-400 outline-none focus:border-blue-500"
                        />
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
                <PokemonEditorModal
                    client={client}
                    pokemon={selectedPokemon}
                    onClose={() => setSelectedPokemon(null)}
                    onSave={selectedPokemon?.isPC ? handleSavePC : handleSavePokemon}
                />
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
