import React, { useState, useEffect } from 'react';
import { X, Zap, Save, Search } from 'lucide-react';
import { calcCurrentLevel, GROWTH_OPTIONS } from '../core/growth.js';
import { ITEM_ICON_FALLBACK_URL, POKEMON_ICON_FALLBACK_URL } from '../core/iconResolver.js';

export const PokemonEditorModal = ({ client, pokemon, onClose, onSave }) => {
    const isPcMon = Boolean(pokemon?.isPC);
    const initialGrowthMode = isPcMon ? '0' : 'auto';
    const initialLevel = pokemon?.level ?? (isPcMon ? calcCurrentLevel(0, Number(pokemon?.exp || 0)) : 1);

    const [activeTab, setActiveTab] = useState('stats');
    const [localPk, setLocalPk] = useState({ ...pokemon });
    const [allMoves, setAllMoves] = useState([]);
    const [searchTerm, setSearchTerm] = useState(['', '', '', '']);
    const [allItems, setAllItems] = useState([]);
    const [itemSearch, setItemSearch] = useState('');
    const [levelInput, setLevelInput] = useState(String(initialLevel));
    const [levelGrowthMode, setLevelGrowthMode] = useState(initialGrowthMode);
    const [levelDirty, setLevelDirty] = useState(false);

    const hasKnownItemName = (name) => {
        if (!name) return false;
        const low = name.toLowerCase();
        return !low.startsWith('item ') && !low.startsWith('id ') && name !== '--- EMPTY ---';
    };

    const currentItem = allItems.find(i => i.id === localPk.item_id);
    const currentItemName = currentItem?.name || `ID ${localPk.item_id}`;
    const canShowItemIcon =
        localPk.item_id > 0 &&
        !!currentItem &&
        hasKnownItemName(currentItem.name);

    useEffect(() => {
        client.getMoves()
            .then(data => setAllMoves(data));
    }, [client]);

    const updateStat = (type, stat, val) => {
        setLocalPk(prev => ({
            ...prev,
            [type]: { ...prev[type], [stat]: parseInt(val) }
        }));
    };

    const updateMove = (slotIndex, moveId) => {
        const newMoves = [...localPk.moves];
        newMoves[slotIndex] = parseInt(moveId);
        setLocalPk({ ...localPk, moves: newMoves });

        const newSearch = [...searchTerm];
        newSearch[slotIndex] = '';
        setSearchTerm(newSearch);
    };

    useEffect(() => {
        client.getItems()
            .then(data => setAllItems(data));
    }, [client]);

    const handleSaveClick = () => {
        const payload = { ...localPk };
        if (levelDirty) {
            const parsedLevel = Math.max(1, Math.min(100, parseInt(levelInput, 10) || localPk.level || 1));
            payload.level = parsedLevel;
            payload.level_edit = {
                target_level: parsedLevel,
                growth_rate: levelGrowthMode === 'auto' ? null : parseInt(levelGrowthMode, 10),
            };
        }
        onSave(payload);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-[#0f172a] border border-white/10 w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

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
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full"><X /></button>
                </div>

                <div className="flex bg-[#1e293b]/50 p-2 gap-2 border-b border-white/5">
                    <EditorTab active={activeTab === 'stats'} label="IVs & EVs" onClick={() => setActiveTab('stats')} />
                    <EditorTab active={activeTab === 'moves'} label="Moves & Ability" onClick={() => setActiveTab('moves')} />
                    <EditorTab active={activeTab === 'info'} label="LV, Nature & Item" onClick={() => setActiveTab('info')} />
                </div>

                <div className="flex-1 overflow-y-auto p-8">
                    {activeTab === 'stats' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <StatGroup title="IVs (0-31)" type="ivs" data={localPk.ivs} update={updateStat} max={31} />
                            <StatGroup title="EVs (0-252)" type="evs" data={localPk.evs} update={updateStat} max={252} />
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
                                    </div>
                                ))}
                            </div>

                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-white/5 space-y-4">
                                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Ability
                                    Setup</h4>

                                <div className="flex bg-slate-900 p-1 rounded-xl gap-1">
                                    {[
                                        {id: 0, label: 'Slot 1 (Standard)'},
                                        {id: 1, label: 'Slot 2 (Standard)'},
                                        {id: 2, label: 'Hidden (HA)'}
                                    ].map((opt) => (
                                        <button
                                            key={opt.id}
                                            onClick={() => setLocalPk({...localPk, current_ability_index: opt.id})}
                                            className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${
                                                localPk.current_ability_index === opt.id
                                                    ? 'bg-blue-600 text-white shadow-lg'
                                                    : 'text-slate-500 hover:text-slate-300'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[9px] text-center text-slate-500 italic">
                                    {localPk.current_ability_index === 2
                                        ? "Hidden ability ignores the Pokemon PID."
                                        : "The system will change PID while keeping the same Nature."}
                                </p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'info' && (
                        <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">

                            <div className="bg-slate-800/40 p-6 rounded-2xl border border-white/5 space-y-4">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block text-center">
                                    Level Editor
                                </label>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                                            className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-blue-400 font-bold outline-none focus:border-blue-500/50"
                                        />
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
                                            {!isPcMon && <option value="auto">Auto detect (recommended)</option>}
                                            {GROWTH_OPTIONS.map((opt) => (
                                                <option key={opt.id} value={String(opt.id)}>{opt.id} - {opt.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                {isPcMon ? (
                                    <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-200">
                                        PC boxes do not store a visual level byte like party Pokemon. Choose the growth curve manually first, then set target level.
                                    </div>
                                ) : (
                                    <p className="text-[10px] text-slate-500 italic text-center">
                                        Auto mode infers the growth curve from current EXP and displayed level. Use manual mode only if needed.
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
                                    {[
                                        "Hardy", "Lonely", "Brave", "Adamant", "Naughty",
                                        "Bold", "Docile", "Relaxed", "Impish", "Lax",
                                        "Timid", "Hasty", "Serious", "Jolly", "Naive",
                                        "Modest", "Mild", "Quiet", "Bashful", "Rash",
                                        "Calm", "Gentle", "Sassy", "Careful", "Quirky"
                                    ].map((name, i) => (
                                        <option key={i} value={i}>{name}</option>
                                    ))}
                                </select>
                                <p className="text-[9px] text-center text-slate-500 italic">Changing nature will modify the Pokemon PID in the save file.</p>
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
                            className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-8 py-3 rounded-2xl flex items-center gap-2 shadow-lg active:scale-95 transition-all">
                        <Save size={18}/> SAVE CHANGES
                    </button>
                </div>
            </div>
        </div>
    );
};


const StatGroup = ({title, type, data, update, max}) => {
    const statsEntries = data ? Object.entries(data) : [];

    return (
        <div className="space-y-4">
            <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest">{title}</h4>
            {statsEntries.map(([stat, val]) => (
                <div key={stat} className="flex items-center gap-4">
                    <span className="w-8 text-[10px] font-bold text-slate-400 uppercase">{stat}</span>
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
