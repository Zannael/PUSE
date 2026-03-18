import pokemonIconManifest from '../data/pokemon-icon-manifest.json';
import itemIconManifest from '../data/item-icon-manifest.json';

const DPE_GEN9_SHA = '5906aa4d4904e41393fd9184a16951c961e96263';
const POKEAPI_SPRITES_SHA = 'eb473a5fc7e6ccd1705d5498d4e5945c05815c74';

const DPE_POKEMON_BASE = `https://cdn.jsdelivr.net/gh/Shiny-Miner/Dynamic-Pokemon-Expansion-Gen-9@${DPE_GEN9_SHA}/graphics/frontspr`;
const POKEAPI_ITEMS_BASE = `https://cdn.jsdelivr.net/gh/PokeAPI/sprites@${POKEAPI_SPRITES_SHA}/sprites/items`;

export const POKEMON_ICON_FALLBACK_URL = `${import.meta.env.BASE_URL}icons/pokemon-placeholder.svg`;
export const ITEM_ICON_FALLBACK_URL = `${import.meta.env.BASE_URL}icons/item-placeholder.svg`;

function normalizePositiveInt(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        return null;
    }
    return n;
}

export function resolvePokemonIconUrl(speciesId, apiBase) {
    const id = normalizePositiveInt(speciesId);
    if (!id) {
        return POKEMON_ICON_FALLBACK_URL;
    }

    if (apiBase) {
        return `${apiBase}/pokemon-icon/${id}`;
    }

    const filename = pokemonIconManifest[String(id)];
    if (!filename) {
        return POKEMON_ICON_FALLBACK_URL;
    }

    return `${DPE_POKEMON_BASE}/${filename}`;
}

export function resolveItemIconUrl(itemId, apiBase) {
    const id = normalizePositiveInt(itemId);
    if (!id) {
        return ITEM_ICON_FALLBACK_URL;
    }

    if (apiBase) {
        return `${apiBase}/item-icon/${id}`;
    }

    const filename = itemIconManifest[String(id)];
    if (!filename) {
        return ITEM_ICON_FALLBACK_URL;
    }

    return `${POKEAPI_ITEMS_BASE}/${filename}`;
}
