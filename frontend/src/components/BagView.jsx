import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Package, Edit3, Filter, X, ArrowLeft, Star, Save } from 'lucide-react';

const BagView = () => {
    const isTmHmItemId = (id) =>
        (id >= 289 && id <= 346) ||
        (id >= 375 && id <= 444);

    const [searchId, setSearchId] = useState(44);
    const [query, setQuery] = useState("");
    const [allItems, setAllItems] = useState([]);
    const [filteredResults, setFilteredResults] = useState([]);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    const [candidates, setCandidates] = useState([]);
    const [selectedCand, setSelectedCand] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [itemFilter, setItemFilter] = useState("");
    const [quickPockets, setQuickPockets] = useState({});
    const [quickLoading, setQuickLoading] = useState(false);

    const dropdownRef = useRef(null);
    const API_BASE = import.meta.env.VITE_API_BASE_URL;

    const hasKnownItemName = (name) => {
        if (!name) return false;
        const low = name.toLowerCase();
        return !low.startsWith('item ') && !low.startsWith('id ') && name !== '--- EMPTY ---';
    };

    const itemIconUrl = (itemId) => `${API_BASE}/item-icon/${itemId}`;

    useEffect(() => {
        const fetchItems = async () => {
            try {
                const res = await fetch(`${API_BASE}/items`);
                const data = await res.json();
                setAllItems(data);
            } catch (err) { console.error("Items DB error", err); }
        };
        fetchItems();
    }, [API_BASE]);

    const loadQuickPockets = useCallback(async () => {
        setQuickLoading(true);
        try {
            const res = await fetch(`${API_BASE}/bag/pockets/bootstrap`);
            if (!res.ok) {
                setQuickPockets({});
                return;
            }
            const data = await res.json();
            setQuickPockets(data?.pockets || {});
        } catch (err) {
            console.error("Quick pockets error", err);
            setQuickPockets({});
        } finally {
            setQuickLoading(false);
        }
    }, [API_BASE]);

    useEffect(() => {
        loadQuickPockets();
    }, [loadQuickPockets]);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleQueryChange = (e) => {
        const val = e.target.value;
        setQuery(val);
        if (val.length > 1) {
            const filtered = allItems.filter(it =>
                it.name.toLowerCase().includes(val.toLowerCase())
            ).slice(0, 10);
            setFilteredResults(filtered);
            setIsDropdownOpen(true);
        } else {
            setIsDropdownOpen(false);
        }
    };

    const selectItem = (item) => {
        setSearchId(item.id);
        setQuery(item.name);
        setIsDropdownOpen(false);
    };

    const scanBag = async () => {
        if (!searchId) return;
        setLoading(true);
        setSelectedCand(null);
        setItems([]);
        setCandidates([]);
        try {
            const res = await fetch(`${API_BASE}/bag/scan/${searchId}`);
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                setCandidates(data.results);
            } else {
                alert("No sector found.");
            }
        } catch (err) {
            console.error(err);
            alert("Backend error");
        }
        finally { setLoading(false); }
    };

    const loadPocket = async (cand) => {
        setSelectedCand(cand);
        setLoading(true);
        try {
            const res = await fetch(
                `${API_BASE}/bag/pocket?anchor_offset=${cand.anchor_offset}&_ts=${Date.now()}`,
                { cache: "no-store" }
            );
            if (!res.ok) {
                throw new Error("Pocket loading error");
            }
            const data = await res.json();
            setItems(data);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    const openQuickPocket = (pocket) => {
        if (!pocket || !pocket.anchor_offset) return;
        loadPocket({
            anchor_offset: pocket.anchor_offset,
            quality: pocket.quality,
            score: pocket.score,
            slot_count: pocket.slot_count,
            pocket_type: pocket.pocket_type,
            source: pocket.source,
            confidence: pocket.confidence,
            is_active: true,
            sect_id: null,
            sector: null,
        });
    };

    const [editingItem, setEditingItem] = useState(null);
    const [editQty, setEditQty] = useState(0);
    const [editItemId, setEditItemId] = useState(0);
    const [modalSearch, setModalSearch] = useState("");

    const handleUpdateSlot = async () => {
        if (!editingItem) return;

        const isTmPocket = selectedCand?.pocket_type === 'tm';
        const quantityToWrite = isTmPocket || isTmHmItemId(editItemId) ? 1 : editQty;

        try {
            const res = await fetch(`${API_BASE}/bag/item/update`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    offset: editingItem.offset,
                    item_id: editItemId,
                    quantity: quantityToWrite,
                    encoding: editingItem.encoding || null
                })
            });

            if (!res.ok) {
                throw new Error("Slot update error");
            }

            const saveRes = await fetch(`${API_BASE}/save-all`, { method: "POST" });
            if (!saveRes.ok) {
                throw new Error("Save-all error");
            }

            const newName = allItems.find((it) => it.id === editItemId)?.name || `Item ${editItemId}`;
            setItems((prev) => prev.map((it) => {
                if (it.offset !== editingItem.offset) return it;
                return {
                    ...it,
                    id: editItemId,
                    qty: quantityToWrite,
                    name: editItemId === 0 ? '--- EMPTY ---' : newName
                };
            }));

            if (selectedCand) {
                await loadPocket(selectedCand);
            }

            setEditingItem(null);
            setModalSearch("");
            alert("Edit applied and file updated!");
        } catch (err) {
            console.error(err);
            alert("Error while updating and saving.");
        }
    };

    const handleFinalSave = async () => {
        try {
            const res = await fetch(`${API_BASE}/save-all`, { method: "POST" });
            if (res.ok) {
                alert("Bag saved and checksum recalculated successfully!");
            }
        } catch (err) {
            console.error(err);
            alert("Final save error");
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* SEARCH BAR */}
            {!selectedCand && (
                <div className="relative max-w-2xl mx-auto w-full" ref={dropdownRef}>
                    <div className="group relative flex items-center">
                        <div className="absolute left-5 text-slate-500 group-focus-within:text-blue-400 transition-colors">
                            <Search size={20} />
                        </div>
                        <input
                            type="text"
                            value={query}
                            onChange={handleQueryChange}
                            onFocus={() => query.length > 1 && setIsDropdownOpen(true)}
                            placeholder="Search item by name..."
                            className="w-full bg-[#1e293b] border border-white/10 rounded-[2rem] pl-14 pr-32 py-5 outline-none focus:border-blue-500/50 transition-all text-lg shadow-2xl"
                        />
                        <div className="absolute right-3 flex items-center gap-2">
                            {query && (
                                <button onClick={() => {setQuery(""); setSearchId(null);}} className="p-2 text-slate-500 hover:text-white">
                                    <X size={18} />
                                </button>
                            )}
                            <button
                                onClick={scanBag}
                                disabled={loading || !searchId}
                                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white font-bold px-6 py-3 rounded-full transition-all active:scale-95 shadow-lg"
                            >
                                {loading ? "..." : "GO"}
                            </button>
                        </div>
                    </div>

                    {isDropdownOpen && filteredResults.length > 0 && (
                        <div className="absolute top-full left-0 w-full mt-3 bg-[#1e293b] border border-white/10 rounded-[1.5rem] shadow-2xl overflow-hidden z-[100]">
                            {filteredResults.map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => selectItem(item)}
                                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-blue-500/10 transition-colors border-b border-white/5 last:border-0"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center text-[10px] font-mono text-slate-500 overflow-hidden">
                                            {item.id > 0 && hasKnownItemName(item.name) ? (
                                                <img
                                                    src={itemIconUrl(item.id)}
                                                    alt={item.name}
                                                    className="w-8 h-8 object-contain"
                                                    onError={(e) => {
                                                        e.currentTarget.style.display = 'none';
                                                    }}
                                                />
                                            ) : (
                                                `#${item.id}`
                                            )}
                                        </div>
                                        <span className="font-bold text-slate-200">{item.name}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* SELEZIONE CANDIDATI */}
            {!selectedCand && (
                <div className="bg-[#1e293b] border border-white/10 rounded-3xl p-5 md:p-6 space-y-4">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Quick Pockets</p>
                            <p className="text-xs text-slate-400 mt-1">Quick access validated with fallback. Item search remains the most stable method.</p>
                        </div>
                        <button
                            onClick={loadQuickPockets}
                            disabled={quickLoading}
                            className="px-3 py-2 text-[11px] font-bold rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
                        >
                            {quickLoading ? "..." : "Refresh"}
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {[
                            { key: "main", label: "Main Pocket" },
                            { key: "ball", label: "Ball Pocket" },
                            { key: "berry", label: "Berry Pouch" },
                            { key: "tm", label: "TM Case" },
                        ].map((cfg) => {
                            const pocket = quickPockets?.[cfg.key] || null;
                            const ready = !!pocket?.anchor_offset;
                            return (
                                <button
                                    key={cfg.key}
                                    onClick={() => openQuickPocket(pocket)}
                                    disabled={!ready || loading}
                                    className="text-left p-4 rounded-2xl border border-white/10 bg-slate-900/60 hover:bg-slate-800/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    <p className="text-xs font-black uppercase tracking-wider text-slate-300">{cfg.label}</p>
                                    <p className="text-[10px] font-mono text-slate-500 mt-2">
                                        {ready ? `anchor ${pocket.anchor_offset}` : "not found"}
                                    </p>
                                    <p className="text-[10px] mt-1 text-slate-400">
                                        {ready ? `${pocket.source} | ${pocket.confidence}` : "use manual search"}
                                    </p>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {candidates.length > 0 && !selectedCand && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in slide-in-from-top-4">
                    {candidates.map((cand, idx) => (
                        <button
                            key={idx}
                            onClick={() => loadPocket(cand)}
                            className={`p-5 rounded-3xl border text-left transition-all relative overflow-hidden group ${
                                cand.is_active ? 'bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/50' : 'bg-slate-800/50 border-white/5 opacity-60 hover:opacity-100'
                            }`}
                        >
                            <div className="flex justify-between items-center relative z-10">
                                <div>
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Sector {cand.sector} (ID {cand.sect_id})</p>
                                    <p className="text-sm font-mono text-slate-300 mt-1">{cand.anchor_offset}</p>
                                    <p className="text-[10px] font-mono text-slate-400 mt-1">
                                        {cand.quality || 'n/a'} | slots: {cand.slot_count ?? '-'} | score: {cand.score ?? '-'}
                                    </p>
                                    {cand.pocket_type && (
                                        <p className="text-[10px] font-mono text-slate-500 mt-1">type: {cand.pocket_type}</p>
                                    )}
                                </div>
                                {cand.is_active && <span className="bg-emerald-500 text-[10px] font-black px-2 py-0.5 rounded text-emerald-950">ACTIVE</span>}
                            </div>
                            {cand.is_main_pocket && (
                                <div className="mt-4 flex items-center gap-2 text-blue-400">
                                    <Star size={12} fill="currentColor" />
                                    <span className="text-[10px] font-black uppercase tracking-tighter">Main Items Pocket</span>
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            )}

            {/* VISUALIZZAZIONE TASCA */}
            {items.length > 0 && selectedCand && (
                <div className="space-y-4">
                    <div className="bg-[#1e293b] rounded-[2.5rem] border border-white/5 overflow-hidden shadow-2xl animate-in zoom-in-95">
                        <div className="p-6 border-b border-white/5 bg-white/5 flex flex-col md:flex-row justify-between items-center gap-4">
                            <div className="flex items-center gap-4">
                                <button onClick={() => setSelectedCand(null)} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 transition-colors">
                                    <ArrowLeft size={20} />
                                </button>
                                <div>
                                    <h3 className="font-bold uppercase tracking-tight flex items-center gap-2">
                                        <Package size={18} className="text-blue-400" /> Pocket Contents
                                    </h3>
                                    <p className="text-[10px] text-slate-500 font-mono">{selectedCand.anchor_offset}</p>
                                    {selectedCand.pocket_type && (
                                        <p className="text-[10px] text-slate-500 font-mono">type: {selectedCand.pocket_type}</p>
                                    )}
                                </div>
                            </div>
                            <input
                                type="text"
                                placeholder="Filter items..."
                                value={itemFilter}
                                onChange={(e) => setItemFilter(e.target.value)}
                                className="bg-slate-900 border border-white/10 rounded-xl px-4 py-2 text-xs outline-none focus:border-blue-500/50"
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[1px] bg-white/5">
                            {items.filter(i => i.name.toLowerCase().includes(itemFilter.toLowerCase())).map((item, idx) => (
                                <div key={idx} className="bg-[#1e293b] p-4 flex items-center justify-between hover:bg-slate-800 transition-colors group">
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center border border-white/5 flex-shrink-0 overflow-hidden">
                                            {item.id > 0 && hasKnownItemName(item.name) ? (
                                                <img
                                                    src={itemIconUrl(item.id)}
                                                    alt={item.name}
                                                    className="w-8 h-8 object-contain"
                                                    onError={(e) => {
                                                        e.currentTarget.style.display = 'none';
                                                    }}
                                                />
                                            ) : (
                                                <span className="text-[10px] font-mono text-slate-500">#{item.id}</span>
                                            )}
                                        </div>
                                        <div className="overflow-hidden">
                                            <p className="text-sm font-bold truncate text-slate-200">{item.name}</p>
                                            <p className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-tighter">Quantity: {item.qty}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setEditingItem(item);
                                            setEditQty(item.qty);
                                            setEditItemId(item.id);
                                        }}
                                        className="p-2 opacity-0 group-hover:opacity-100 hover:bg-blue-500/20 rounded-lg text-blue-400 transition-all"
                                    >
                                        <Edit3 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-end p-4">
                        <button
                            onClick={handleFinalSave}
                            className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-8 py-4 rounded-2xl flex items-center gap-2 shadow-xl transition-all active:scale-95"
                        >
                            <Save size={20} /> SAVE BAG CHANGES
                        </button>
                    </div>

                    {editingItem && (
                        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                            <div className="bg-[#0f172a] border border-white/10 p-8 rounded-[2.5rem] w-full max-w-md shadow-2xl space-y-6">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-xl font-bold flex items-center gap-2">
                                        <Edit3 className="text-blue-400" /> Edit Slot
                                    </h3>
                                    <button onClick={() => { setEditingItem(null); setModalSearch(""); }} className="text-slate-500 hover:text-white">
                                        <X />
                                    </button>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] font-black text-slate-500 uppercase">Quantity (0-999)</label>
                                        <input
                                            type="number"
                                            value={editQty}
                                            onChange={(e) => setEditQty(Math.min(999, parseInt(e.target.value) || 0))}
                                            disabled={selectedCand?.pocket_type === 'tm' || isTmHmItemId(editItemId)}
                                            className="w-full bg-slate-900 border border-white/10 rounded-xl p-3 mt-1 text-emerald-400 font-bold outline-none focus:border-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                                        />
                                        {(selectedCand?.pocket_type === 'tm' || isTmHmItemId(editItemId)) && (
                                            <p className="text-[10px] text-slate-500 mt-1">Reusable TM/HM: quantity forced to 1.</p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="text-[10px] font-black text-slate-500 uppercase">Search Item</label>
                                        <input
                                            type="text"
                                            value={modalSearch}
                                            onChange={(e) => setModalSearch(e.target.value)}
                                            placeholder="Search new item..."
                                            className="w-full bg-slate-900 border border-white/10 rounded-xl p-3 mt-1 text-sm outline-none focus:border-blue-500"
                                        />

                                        <div className="mt-2 max-h-40 overflow-y-auto bg-slate-900/50 rounded-xl border border-white/5 divide-y divide-white/5">
                                            {allItems
                                                .filter(it => it?.name?.toLowerCase().includes(modalSearch.toLowerCase()))
                                                .slice(0, 20)
                                                .map(it => (
                                                    <button
                                                        key={it.id}
                                                        onClick={() => {
                                                            setEditItemId(it.id);
                                                            setModalSearch(it.name);
                                                        }}
                                                        className={`w-full text-left px-4 py-2 text-xs transition-colors flex items-center gap-2 ${editItemId === it.id ? 'bg-blue-600 text-white' : 'hover:bg-white/5 text-slate-300'}`}
                                                    >
                                                        {it.id > 0 && hasKnownItemName(it.name) && (
                                                            <img
                                                                src={itemIconUrl(it.id)}
                                                                alt={it.name}
                                                                className="w-5 h-5 object-contain"
                                                                onError={(e) => {
                                                                    e.currentTarget.style.display = 'none';
                                                                }}
                                                            />
                                                        )}
                                                        <span>#{it.id} - {it.name}</span>
                                                    </button>
                                                ))
                                            }
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-3 pt-4">
                                    <button onClick={() => { setEditingItem(null); setModalSearch(""); }} className="flex-1 px-6 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold transition-all">CANCEL</button>
                                    <button onClick={handleUpdateSlot} className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold shadow-lg transition-all active:scale-95">APPLY</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default BagView;
