import React, { useState, useEffect, useCallback } from 'react';
import PokemonCard from './PokemonCard';
import { Loader2 } from 'lucide-react';
import { partySelectionKey, isSelectionKeyActive } from '../core/exportSelection.js';

const PartyGrid = ({ client, onEditPokemon, exportSelection = [], onToggleExportSelection }) => {
    const [party, setParty] = useState([]);
    const [loading, setLoading] = useState(true);
    const fetchParty = useCallback(async () => {
        try {
            const data = await client.getParty();
            setParty(data);
        } catch (err) {
            console.error("Party fetch error", err);
        } finally {
            setLoading(false);
        }
    }, [client]);

    useEffect(() => {
        fetchParty();
    }, [fetchParty]);

    if (loading) return (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <Loader2 className="animate-spin mb-4" size={48} />
            <p>Syncing party...</p>
        </div>
    );

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {party.map((pk) => (
                <PokemonCard
                    key={pk.index}
                    pokemon={pk}
                    getPokemonIconUrl={client.getPokemonIconUrl}
                    onEdit={() => onEditPokemon(pk)}
                    exportSelected={isSelectionKeyActive(exportSelection, partySelectionKey(pk.index))}
                    onToggleExport={() => onToggleExportSelection?.(partySelectionKey(pk.index))}
                />
            ))}
        </div>
    );
};

export default PartyGrid;
