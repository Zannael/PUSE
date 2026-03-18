import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DPE_SHA = 'cdfc053a56326a13dc5311b24488445e17536b7e';
const POKEAPI_SPRITES_SHA = 'eb473a5fc7e6ccd1705d5498d4e5945c05815c74';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.resolve(__dirname, '..');
const POKEMON_DATA_PATH = path.join(FRONTEND_DIR, 'public', 'data', 'pokemon.txt');
const SPECIES_ID_PATH = path.resolve(FRONTEND_DIR, '..', 'backend', 'data', 'species_id.txt');
const ITEM_DATA_PATH = path.join(FRONTEND_DIR, 'public', 'data', 'items.txt');
const POKEMON_OUT_PATH = path.join(FRONTEND_DIR, 'src', 'data', 'pokemon-icon-manifest.json');
const ITEM_OUT_PATH = path.join(FRONTEND_DIR, 'src', 'data', 'item-icon-manifest.json');

const UNKNOWN_ITEM_PATTERNS = [/^unknown$/i, /^item\s+\d+/i, /^id\s+\d+/i, /^---\s*empty\s*---$/i, /^---\s*vuoto\s*---$/i];

function normalize(text) {
    return String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function parseIdNameText(content) {
    const out = [];
    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        const splitIdx = trimmed.indexOf(':');
        if (splitIdx <= 0) {
            continue;
        }
        const id = Number.parseInt(trimmed.slice(0, splitIdx), 10);
        const name = trimmed.slice(splitIdx + 1).trim();
        if (!Number.isNaN(id) && name) {
            out.push({ id, name });
        }
    }
    return out;
}

function parseSpeciesIdTokens(content) {
    const out = new Map();
    for (const raw of content.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line.startsWith('SPECIES_')) {
            continue;
        }
        const parts = line.split(/\s+/);
        const token = parts[0].slice('SPECIES_'.length);
        const hex = parts.find((p) => /^0x[0-9a-f]+$/i.test(p));
        if (!hex) {
            continue;
        }
        const id = Number.parseInt(hex, 16);
        if (Number.isNaN(id) || id < 0) {
            continue;
        }
        out.set(id, token);
    }
    return out;
}

const SPECIAL_SPRITE_BY_TOKEN = {
    FLAPPLE_GIGA: 'gFrontSpriteGigaFlappletun.png',
    APPLETUN_GIGA: 'gFrontSpriteGigaFlappletun.png',
    TOXTRICITY_LOW_KEY_GIGA: 'gFrontSpriteGigaToxtricity.png',
};

function toPascalFromToken(token) {
    return String(token || '')
        .split('_')
        .filter(Boolean)
        .map((chunk) => chunk.charAt(0) + chunk.slice(1).toLowerCase())
        .join('');
}

function candidatesFromSpeciesToken(token) {
    if (!token) {
        return [];
    }
    if (SPECIAL_SPRITE_BY_TOKEN[token]) {
        return [SPECIAL_SPRITE_BY_TOKEN[token]];
    }
    if (token.endsWith('_GIGA')) {
        const baseToken = token.slice(0, -'_GIGA'.length);
        return [`gFrontSpriteGiga${toPascalFromToken(baseToken)}.png`];
    }
    return [];
}

async function fetchJson(url) {
    const res = await fetch(url, {
        headers: {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'pokemon-icon-manifest-generator',
        },
    });
    if (!res.ok) {
        throw new Error(`Failed GET ${url}: ${res.status}`);
    }
    return res.json();
}

async function fetchRepoTree(owner, repo, sha) {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`;
    const json = await fetchJson(url);
    if (!Array.isArray(json.tree)) {
        throw new Error(`Tree payload invalid for ${owner}/${repo}@${sha}`);
    }
    if (json.truncated) {
        throw new Error(`Tree payload truncated for ${owner}/${repo}@${sha}`);
    }
    return json.tree;
}

function buildPokemonManifest(speciesRows, dpeTree, speciesTokensById) {
    const byId = new Map();
    const availableFilenames = new Set();

    for (const node of dpeTree) {
        if (node.type !== 'blob') {
            continue;
        }
        if (!node.path.startsWith('graphics/frontspr/gFrontSprite') || !node.path.endsWith('.png')) {
            continue;
        }
        const filename = node.path.split('/').pop();
        availableFilenames.add(filename);
        const match = /^gFrontSprite(\d{3,4})(.+)\.png$/i.exec(filename);
        if (!match) {
            continue;
        }
        const id = Number.parseInt(match[1], 10);
        if (Number.isNaN(id) || id <= 0) {
            continue;
        }
        const suffix = match[2] || '';
        const curr = byId.get(id) || [];
        curr.push({ filename, suffix });
        byId.set(id, curr);
    }

    const manifest = {};
    const unresolved = [];

    for (const species of speciesRows) {
        const candidates = byId.get(species.id) || [];
        if (candidates.length === 0) {
            const token = speciesTokensById.get(species.id);
            const tokenCandidates = candidatesFromSpeciesToken(token);
            const picked = tokenCandidates.find((f) => availableFilenames.has(f));
            if (picked) {
                manifest[String(species.id)] = picked;
                continue;
            }
            unresolved.push(species);
            continue;
        }

        candidates.sort((a, b) => {
            if (a.filename.length !== b.filename.length) {
                return a.filename.length - b.filename.length;
            }
            return a.filename.localeCompare(b.filename);
        });

        manifest[String(species.id)] = candidates[0].filename;
    }

    return { manifest, unresolved };
}

function isUnknownItemName(name) {
    return UNKNOWN_ITEM_PATTERNS.some((pattern) => pattern.test(name));
}

function isTmHmLike(name) {
    return /\b(?:tm|hm)\s*\d{1,3}\b/i.test(name);
}

function buildItemManifest(itemRows, pokeapiTree) {
    const stemToFilename = new Map();

    for (const node of pokeapiTree) {
        if (node.type !== 'blob') {
            continue;
        }
        if (!node.path.startsWith('sprites/items/') || !node.path.endsWith('.png')) {
            continue;
        }
        const relative = node.path.slice('sprites/items/'.length);
        if (relative.includes('/')) {
            continue;
        }

        const stem = relative.slice(0, -4);
        const key = normalize(stem);
        if (!key) {
            continue;
        }
        if (!stemToFilename.has(key)) {
            stemToFilename.set(key, relative);
        }
    }

    const aliases = {
        ssticket: 's-s-ticket.png',
        xattack: 'x-attack.png',
        xdefense: 'x-defense.png',
        xspeed: 'x-speed.png',
        xaccuracy: 'x-accuracy.png',
        xspatk: 'x-sp-atk.png',
        xspdef: 'x-sp-def.png',
        hpup: 'hp-up.png',
        ppup: 'pp-up.png',
        ppmax: 'pp-max.png',
        kingsrock: 'kings-rock.png',
        blackglasses: 'black-glasses.png',
        nevermeltice: 'never-melt-ice.png',
        twistedspoon: 'twisted-spoon.png',
    };

    const manifest = {};
    const unresolved = [];

    for (const item of itemRows) {
        if (item.id <= 0 || isUnknownItemName(item.name) || isTmHmLike(item.name)) {
            continue;
        }

        const key = normalize(item.name);
        if (!key) {
            continue;
        }

        let filename = null;
        const aliased = aliases[key];
        if (aliased) {
            filename = aliased;
        } else if (stemToFilename.has(key)) {
            filename = stemToFilename.get(key);
        }

        if (!filename) {
            unresolved.push(item);
            continue;
        }
        manifest[String(item.id)] = filename;
    }

    return { manifest, unresolved };
}

function stableJson(obj) {
    const entries = Object.entries(obj).sort((a, b) => Number(a[0]) - Number(b[0]));
    return `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;
}

async function main() {
    const checkMode = process.argv.includes('--check');

    const [pokemonText, speciesIdText, itemText] = await Promise.all([
        fs.readFile(POKEMON_DATA_PATH, 'utf-8'),
        fs.readFile(SPECIES_ID_PATH, 'utf-8'),
        fs.readFile(ITEM_DATA_PATH, 'utf-8'),
    ]);

    const [dpeTree, pokeapiTree] = await Promise.all([
        fetchRepoTree('Skeli789', 'Dynamic-Pokemon-Expansion', DPE_SHA),
        fetchRepoTree('PokeAPI', 'sprites', POKEAPI_SPRITES_SHA),
    ]);

    const speciesRows = parseIdNameText(pokemonText);
    const speciesTokensById = parseSpeciesIdTokens(speciesIdText);

    // Add species IDs that exist in species_id.txt but not in pokemon.txt,
    // so non-numeric form sprites (e.g. many Gigantamax forms) can be mapped.
    const speciesKnown = new Set(speciesRows.map((s) => s.id));
    for (const [id, token] of speciesTokensById.entries()) {
        if (id <= 0 || speciesKnown.has(id)) {
            continue;
        }
        speciesRows.push({ id, name: token });
    }

    speciesRows.sort((a, b) => a.id - b.id);
    const itemRows = parseIdNameText(itemText);

    const pokemonResult = buildPokemonManifest(speciesRows, dpeTree, speciesTokensById);
    const itemResult = buildItemManifest(itemRows, pokeapiTree);

    const pokemonJson = stableJson(pokemonResult.manifest);
    const itemJson = stableJson(itemResult.manifest);

    if (checkMode) {
        const [existingPokemon, existingItems] = await Promise.all([
            fs.readFile(POKEMON_OUT_PATH, 'utf-8'),
            fs.readFile(ITEM_OUT_PATH, 'utf-8'),
        ]);
        const isPokemonEqual = existingPokemon === pokemonJson;
        const isItemsEqual = existingItems === itemJson;
        if (!isPokemonEqual || !isItemsEqual) {
            throw new Error('Icon manifests are out of date. Run: npm run icons:manifest');
        }
    } else {
        await Promise.all([
            fs.writeFile(POKEMON_OUT_PATH, pokemonJson, 'utf-8'),
            fs.writeFile(ITEM_OUT_PATH, itemJson, 'utf-8'),
        ]);
    }

    console.log(`Pokemon icon coverage: ${Object.keys(pokemonResult.manifest).length}/${speciesRows.length}`);
    console.log(`Item icon coverage: ${Object.keys(itemResult.manifest).length}/${itemRows.length}`);
    if (pokemonResult.unresolved.length > 0) {
        console.log(`Unresolved Pokemon IDs: ${pokemonResult.unresolved.slice(0, 20).map((p) => p.id).join(', ')}`);
    }
    if (itemResult.unresolved.length > 0) {
        console.log(`Unresolved Item IDs: ${itemResult.unresolved.slice(0, 20).map((i) => i.id).join(', ')}`);
    }
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
