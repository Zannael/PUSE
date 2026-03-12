import React, { useState } from 'react';
import { Upload, LayoutGrid, Users, Briefcase, Save, Edit3, X } from 'lucide-react';
import PartyGrid from './components/PartyGrid';
import PCGrid from './components/PCGrid';
import BagView from "./components/BagView.jsx";
import {PokemonEditorModal} from "./components/PokemonEditorModal.jsx";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

const App = () => {
    const [activeTab, setActiveTab] = useState('party');
    const [isLoaded, setIsLoaded] = useState(false);
    const [money, setMoney] = useState(0);
    const [showMoneyModal, setShowMoneyModal] = useState(false);
    const [moneyInput, setMoneyInput] = useState('0');

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
            if (res.ok) {
                const mRes = await fetch(`${API_BASE}/money`);
                const mData = await mRes.json();
                setMoney(mData.money);
                setMoneyInput(String(mData.money ?? 0));
                setIsLoaded(true);
            }
        } catch {
            alert("Upload failed.");
        }
    };

    const [selectedPokemon, setSelectedPokemon] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const handleSavePokemon = async (updatedPk) => {
        try {
            const statsBase = {
                hp: updatedPk.ivs.HP, atk: updatedPk.ivs.Atk, dfe: updatedPk.ivs.Def,
                spa: updatedPk.ivs.SpA, spd: updatedPk.ivs.SpD, spe: updatedPk.ivs.Spe || updatedPk.ivs.Spd
            };

            await fetch(`${API_BASE}/party/${updatedPk.index}/ivs`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(statsBase)
            });
            await fetch(`${API_BASE}/party/${updatedPk.index}/evs`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(statsBase)
            });

            await fetch(`${API_BASE}/party/${updatedPk.index}/moves`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ moves: updatedPk.moves })
            });

            await fetch(`${API_BASE}/party/${updatedPk.index}/ability-switch`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ability_index: updatedPk.current_ability_index })
            });

            await fetch(`${API_BASE}/party/${updatedPk.index}/nature`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nature_id: updatedPk.nature_id })
            });

            await fetch(`${API_BASE}/party/${updatedPk.index}/item`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_id: updatedPk.item_id })
            });

            await fetch(`${API_BASE}/save-all`, { method: 'POST' });

            setSelectedPokemon(null);
            setRefreshKey(prev => prev + 1);
            alert("Pokemon updated and saved successfully!");
        } catch {
            alert("Failed to save all changes.");
        }
    };

    const handleSavePC = async (updatedPk) => {
        try {
            const payload = {
                box: updatedPk.box,
                slot: updatedPk.slot,
                moves: updatedPk.moves,
                item_id: updatedPk.item_id,
                ivs: updatedPk.ivs,
                evs: updatedPk.evs,
                nature_id: updatedPk.nature_id,
                exp: updatedPk.exp
            };

            const res = await fetch(`${API_BASE}/pc/edit-full`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                await fetch(`${API_BASE}/save-all`, { method: 'POST' });
                setSelectedPokemon(null);
                setRefreshKey(prev => prev + 1);
                alert("PC Box updated successfully!");
            }
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
            const res = await fetch(`${API_BASE}/money/update?amount=${amount}`, { method: 'POST' });
            if (!res.ok) {
                throw new Error('money update failed');
            }
            setMoney(amount);
            setShowMoneyModal(false);
            alert('Money updated successfully!');
        } catch (err) {
            console.error(err);
            alert('Failed to update money.');
        }
    };

    return (
        <div className="min-h-screen bg-[#0f172a] text-slate-100 flex flex-col items-center">
            <header className="w-full bg-[#1e293b]/80 backdrop-blur-md border-b border-white/5 sticky top-0 z-50">
                <div className="max-w-6xl mx-auto p-4 flex justify-between items-center">
                    <h1 className="text-xl font-black text-blue-400 tracking-tighter uppercase">Unbound Editor</h1>
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
                            <a
                                href={`${API_BASE}/download`}
                                download
                                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-full text-xs font-bold transition-all"
                            >
                                <Save size={14} /> DOWNLOAD .SAV
                            </a>
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
                                onEditPokemon={(pk) => setSelectedPokemon(pk)}
                            />
                        )}
                        {activeTab === 'pc' && <PCGrid
                            key={`pc-${refreshKey}`}
                            onEditPokemon={(pk) => {
                                setSelectedPokemon({ ...pk, isPC: true });
                            }}
                        />}
                        {activeTab === 'bag' && <BagView />}
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
                    pokemon={selectedPokemon}
                    onClose={() => setSelectedPokemon(null)}
                    onSave={selectedPokemon?.isPC ? handleSavePC : handleSavePokemon}
                />
            )}

            {isLoaded && (
                <nav className="fixed bottom-6 w-[90%] max-w-md bg-[#1e293b]/95 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-2 shadow-2xl flex justify-around z-50">
                    <TabItem icon={<LayoutGrid size={20}/>} label="Party" active={activeTab === 'party'} onClick={() => setActiveTab('party')} />
                    <TabItem icon={<Users size={20}/>} label="PC Box" active={activeTab === 'pc'} onClick={() => setActiveTab('pc')} />
                    <TabItem icon={<Briefcase size={20}/>} label="Bag" active={activeTab === 'bag'} onClick={() => setActiveTab('bag')} />
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
