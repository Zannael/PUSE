// Box 25 is not exposed by the editor: its slot layout is still unverified.
export const ALL_POKEMON_BOXES = [...Array.from({ length: 24 }, (_, index) => index + 1), 26];

export async function collectAllPokemon(client) {
    const party = await client.getParty();
    await client.loadPc();
    const boxes = await Promise.all(ALL_POKEMON_BOXES.map((box) => client.getPcBox(box)));

    return [
        ...party.filter((pokemon) => Number(pokemon.species_id) > 0).map((pokemon) => ({
            ...pokemon,
            rosterKey: `party:${pokemon.index}`,
            source: 'party',
            location: `Party ${Number(pokemon.index) + 1}`,
            partyIndex: Number(pokemon.index),
        })),
        ...boxes.flatMap((pokemonInBox, index) => pokemonInBox.filter((pokemon) =>
            Number(pokemon.species_id) > 0 && Number(pokemon.slot) >= 1 && Number(pokemon.slot) <= 30
        ).map((pokemon) => {
            const box = ALL_POKEMON_BOXES[index];
            const slot = Number(pokemon.slot);
            return {
                ...pokemon,
                rosterKey: `pc:${box}:${slot}`,
                source: 'pc',
                location: `${box === 26 ? 'Preset' : `Box ${box}`} · ${slot}`,
                box,
                slot,
            };
        })),
    ];
}
