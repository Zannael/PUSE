import React, { useState, useEffect } from 'react';
import PokemonCard from './PokemonCard';
import { Loader2 } from 'lucide-react';

const PartyGrid = ({ onEditPokemon }) => {
    const [party, setParty] = useState([]);
    const [loading, setLoading] = useState(true);
    const API_BASE = import.meta.env.VITE_API_BASE_URL;

    const fetchParty = async () => {
        try {
            const res = await fetch(`${API_BASE}/party`);
            const data = await res.json();
            setParty(data);
        } catch (err) {
            console.error("Party fetch error", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchParty();
    }, []);

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
                    onEdit={() => onEditPokemon(pk)}
                />
            ))}
        </div>
    );
};

export default PartyGrid;
