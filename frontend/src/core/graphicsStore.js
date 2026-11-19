import { pokemonKey } from './graphicsCodec.js';
import { graphicsRegistry as registry } from './graphicsData.js';

const packs = new Map(), urls = new Map();
function database() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('puse-graphics', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('packs');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
async function stored(profileId, pack, remove = false) {
    const db = await database();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('packs', pack || remove ? 'readwrite' : 'readonly'), store = tx.objectStore('packs');
            const request = remove ? store.delete(profileId) : pack ? store.put(pack, profileId) : store.get(profileId);
            tx.oncomplete = () => resolve(request.result);
            tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
        });
    } finally { db.close(); }
}
function install(profileId, pack) {
    const m = pack.manifest;
    const spec = registry.roms.find(r => r.profile_id === profileId && r.sha256 === m.rom_sha256);
    if (m.schema_version !== 1 || m.profile_id !== profileId || !spec || !m.assets || typeof m.assets !== 'object'
        || Object.keys(m.assets).length > 40000 || !Array.isArray(m.warnings) || !pack.files
        || m.species_count !== spec.species_count || m.item_count !== spec.item_count || !m.appearance?.unown
        || !m.appearance.female_species) throw new Error('Incompatible graphics pack');
    for (const [key, url] of urls) if (key.startsWith(profileId + ':')) { URL.revokeObjectURL(url); urls.delete(key); }
    packs.set(profileId, pack);
}
export async function restoreGraphics(profileId) {
    if (packs.has(profileId)) return;
    try { const pack = await stored(profileId); if (pack) install(profileId, pack); } catch { /* Optional cache unavailable: shared assets still work. */ }
}
export async function importGraphics(file, profileId, onProgress) {
    if (file.size > 32 * 1024 * 1024) throw new Error('ROM exceeds 32 MiB');
    const rom = await file.arrayBuffer(), worker = new Worker(new URL('./graphicsWorker.js', import.meta.url), { type: 'module' });
    const pack = await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => { if (data.error) reject(new Error(data.error)); else if (data.pack) resolve(data.pack); else onProgress?.(data.progress); };
        worker.onerror = () => reject(new Error('ROM extraction failed'));
        worker.postMessage({ rom, profileId }, [rom]);
    }).finally(() => worker.terminate());
    // Preserve the previous working pack if persistence fails.
    await stored(profileId, pack); install(profileId, pack); return pack.manifest;
}
export async function clearGraphics(profileId) {
    await stored(profileId, undefined, true);
    for (const [key, url] of urls) if (key.startsWith(profileId + ':')) { URL.revokeObjectURL(url); urls.delete(key); }
    packs.delete(profileId);
}
export function graphicsManifest(profileId) { return packs.get(profileId)?.manifest ?? null; }
export function graphicsPack(profileId) { return packs.get(profileId); }
export function graphicsUrl(profileId, kind, id, context = {}) {
    const pack = packs.get(profileId); if (!pack) return null;
    const key = kind === 'pokemon' ? pokemonKey(id, pack.manifest.appearance, context) : `items/${Number(id)}`;
    const path = pack.manifest.assets[key]; if (!/^assets\/[a-f0-9]{64}\.png$/.test(path || '') || !pack.files[path]) return null;
    const cacheKey = profileId + ':' + path;
    if (!urls.has(cacheKey)) urls.set(cacheKey, URL.createObjectURL(new Blob([pack.files[path]], { type: 'image/png' })));
    return urls.get(cacheKey);
}
