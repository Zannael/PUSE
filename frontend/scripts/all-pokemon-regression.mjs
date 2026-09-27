import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { collectAllPokemon, ALL_POKEMON_BOXES } from '../src/services/allPokemon.js';
import { buildRoster, rosterMarkdown } from '../src/services/rosterExport.js';
import { getParty } from '../src/core/party.js';
import { getPcBox, loadPcContext } from '../src/core/pc.js';
import { loadCatalog } from '../src/core/catalog.js';

const savePath = path.resolve(process.cwd(), process.argv.includes('--save')
    ? process.argv[process.argv.indexOf('--save') + 1]
    : '../backend/local_artifacts/Unbound.sav');
const api = process.argv.includes('--api') ? process.argv[process.argv.indexOf('--api') + 1] : 'http://127.0.0.1:8001';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function request(pathname, options) {
    const response = await fetch(`${api}${pathname}`, options);
    if (!response.ok) throw new Error(`${pathname} returned ${response.status}`);
    return response.json();
}

function parseSpecies(text) {
    const species = new Map();
    for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^(\d+):\s*(.+)$/);
        if (match) species.set(Number(match[1]), match[2]);
    }
    return species;
}

function stableRow(row) {
    return {
        rosterKey: row.rosterKey,
        species_id: Number(row.species_id),
        nickname: row.nickname,
        level: Number(row.level),
        is_shiny: Boolean(row.is_shiny),
        location: row.location,
        nature_id: Number(row.nature_id),
    };
}

const bytes = new Uint8Array(await fs.readFile(savePath));
const speciesMap = parseSpecies(await fs.readFile('public/data/pokemon.txt', 'utf8'));
const before = Buffer.from(bytes);
const form = new FormData();
form.append('file', new Blob([bytes]), path.basename(savePath));
await request('/upload', { method: 'POST', body: form });

const backendRows = await collectAllPokemon({
    getParty: () => request('/party'),
    loadPc: () => request('/pc/load'),
    getPcBox: (box) => request(`/pc/box/${box}`),
});
const networkFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('/data/')) {
        return new Response(await fs.readFile(path.resolve('public', String(url).slice(1))), { status: 200 });
    }
    return networkFetch(url, options);
};
await loadCatalog();
globalThis.fetch = networkFetch;
const localContext = loadPcContext(bytes);
const localRows = await collectAllPokemon({
    getParty: async () => getParty(bytes, speciesMap),
    loadPc: async () => {},
    getPcBox: async (box) => getPcBox(localContext, box, speciesMap),
});

const backendStable = backendRows.map(stableRow);
const localStable = localRows.map(stableRow);
const mismatches = backendStable.flatMap((row, index) => JSON.stringify(row) === JSON.stringify(localStable[index])
    ? [] : [{ backend: row, local: localStable[index] }]);
const mismatch = mismatches.length ? backendStable.findIndex((row, index) => JSON.stringify(row) !== JSON.stringify(localStable[index])) : -1;
assert(mismatch < 0 && backendStable.length === localStable.length,
    `backend/local roster rows differ (backend=${backendStable.length}, local=${localStable.length}, count=${mismatches.length}, first=${mismatch}, examples=${JSON.stringify(mismatches.slice(0, 10))})`);
assert(backendRows.every((row) => row.source === 'party' || ALL_POKEMON_BOXES.includes(row.box)), 'unsupported PC box included');
assert(backendRows.every((row) => Number(row.species_id) > 0), 'empty slot included');
assert(backendRows.every((row) => row.source !== 'pc' || (row.slot >= 1 && row.slot <= 30)), 'invalid PC slot included');
const selectedPc = backendRows.filter((row) => row.source === 'pc').slice(0, 3).map((row) => row.rosterKey);
const backendRoster = buildRoster(backendRows, selectedPc);
const localRoster = buildRoster(localRows, selectedPc);
const exportMismatch = backendRoster.pokemon.findIndex((row, index) => JSON.stringify(row) !== JSON.stringify(localRoster.pokemon[index]));
assert(exportMismatch < 0 && backendRoster.pokemon.length === localRoster.pokemon.length,
    `backend/local roster export differs at row ${exportMismatch} (backend=${backendRoster.pokemon.length}, local=${localRoster.pokemon.length})`);
assert(rosterMarkdown(backendRoster) === rosterMarkdown(localRoster), 'backend/local Markdown roster differs');
assert(backendRoster.pokemon.length === backendRows.filter((row) => row.source === 'party').length + selectedPc.length,
    'selected roster size differs');
for (const [glyphByte, expected] of [[0xB5, '♂'], [0xB6, '♀']]) {
    const original = localContext.pcBuffer.slice(0x08, 0x12);
    localContext.pcBuffer[0x08] = glyphByte;
    localContext.pcBuffer[0x09] = 0xFF;
    assert(getPcBox(localContext, 1, speciesMap).find((row) => row.slot === 1)?.nickname === expected,
        `local PC nickname glyph ${expected} differs from backend`);
    localContext.pcBuffer.set(original, 0x08);
}
assert(Buffer.compare(before, Buffer.from(bytes)) === 0, 'roster read changed local save bytes');
console.log(`[PASS] ${backendRows.length} roster rows match across backend and local mode; empty/locked slots are excluded`);
