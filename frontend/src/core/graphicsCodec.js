// Portable ROM reader/codec. No save parsing or browser UI dependencies.
import { zlibSync } from 'fflate';
import { graphicsRegistry as registry } from './graphicsData.js';

export async function sha256(bytes) {
    if (!globalThis.crypto?.subtle) throw new Error('Local ROM import requires HTTPS or localhost for SHA-256 verification');
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

export function decompressLz(rom, offset, sizes) {
    if (offset < 0 || offset + 4 > rom.length) throw new Error('Resource outside ROM');
    const size = rom[offset + 1] | rom[offset + 2] << 8 | rom[offset + 3] << 16;
    if (!sizes.includes(size)) throw new Error(`Unexpected decompressed size: ${size}`);
    const out = new Uint8Array(size);
    let pos = offset + 4, written = 0;
    while (written < size) {
        if (pos >= rom.length) throw new Error('Truncated compressed resource');
        const flags = rom[pos++];
        for (let bit = 7; bit >= 0 && written < size; bit--) {
            if (flags & (1 << bit)) {
                if (pos + 2 > rom.length) throw new Error('Truncated LZ reference');
                const a = rom[pos++], b = rom[pos++], length = (a >> 4) + 3, distance = ((a & 15) << 8) + b + 1;
                if (distance > written) throw new Error('Invalid LZ reference');
                const clipped = Math.min(length, size - written);
                for (let j = 0; j < clipped; j++) { out[written] = out[written - distance]; written++; }
            } else {
                if (pos >= rom.length) throw new Error('Truncated LZ literal');
                out[written++] = rom[pos++];
            }
        }
    }
    return out;
}

export function rgbaTiles(tiles, palette, width, height) {
    if (width % 8 || height % 8 || tiles.length !== width * height / 2 || palette.length !== 32) throw new Error('Invalid 4bpp dimensions');
    const out = new Uint8Array(width * height * 4), colors = [];
    for (let i = 0; i < 16; i++) {
        const c = palette[i * 2] | palette[i * 2 + 1] << 8;
        colors.push([Math.floor((c & 31) * 255 / 31), Math.floor(((c >> 5) & 31) * 255 / 31), Math.floor(((c >> 10) & 31) * 255 / 31), i ? 255 : 0]);
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const pos = (Math.floor(y / 8) * (width / 8) + Math.floor(x / 8)) * 32 + y % 8 * 4 + Math.floor(x % 8 / 2);
        out.set(colors[(tiles[pos] >> (4 * (x % 2))) & 15], (y * width + x) * 4);
    }
    return out;
}

function crc32(bytes) {
    let c = 0xffffffff;
    for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
    return (c ^ 0xffffffff) >>> 0;
}
function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
    let offset = 0; for (const b of parts) { out.set(b, offset); offset += b.length; } return out;
}
export function encodePng(rgba, width, height) {
    const chunk = (kind, payload) => {
        const type = new TextEncoder().encode(kind), out = new Uint8Array(payload.length + 12), view = new DataView(out.buffer);
        view.setUint32(0, payload.length); out.set(type, 4); out.set(payload, 8); view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4))); return out;
    };
    const ihdr = new Uint8Array(13), view = new DataView(ihdr.buffer);
    view.setUint32(0, width); view.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 6;
    const rows = new Uint8Array(height * (1 + width * 4));
    for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
    return concat([new Uint8Array([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(rows)), chunk('IEND', new Uint8Array())]);
}

export function pokemonKey(speciesId, appearance, context = {}) {
    let sid = Number(speciesId);
    if (context.gender === 'female') sid = appearance.female_species?.[sid] ?? sid;
    const rule = appearance.unown;
    if (sid === rule?.species && context.pid != null) {
        const pid = Number(context.pid) >>> 0;
        const letter = (((pid & 0x03000000) >>> 18) | ((pid & 0x00030000) >>> 12) | ((pid & 0x300) >>> 6) | (pid & 3)) % 28;
        if (letter) sid = rule.first_alternate + letter - 1;
    }
    return `pokemon/${sid}/${context.is_shiny ? 'shiny' : 'normal'}/${context.view || 'front'}/${context.frame || 0}`;
}

function dpeReader(rom, spec, engine, emit, progress) {
    const raw = (off, size) => { if (off < 0 || off + size > rom.length) throw new Error('Resource outside ROM'); return rom.subarray(off, off + size); };
    const pointer = off => { const bytes = raw(off, 4), value = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) - 0x08000000; raw(value, 1); return value; };
    const tables = Object.fromEntries(Object.entries(engine.tables).map(([k, off]) => [k, pointer(off)]));
    const sig = raw(engine.item_accessor_signature_offset, engine.item_accessor_signature.length / 2);
    if (Array.from(sig, v => v.toString(16).padStart(2, '0')).join('') !== engine.item_accessor_signature) throw new Error('Item accessor does not match declared engine');
    const itemTable = pointer(engine.item_table_pointer), warnings = new Set();
    const decoded = (off, sizes) => { const result = decompressLz(rom, off, sizes); if (rom[off] !== 16) warnings.add(`Nonstandard LZ marker at 0x${off.toString(16)}; decoded with BIOS semantics`); return result; };
    for (let sid = 0; sid < spec.species_count; sid++) {
        const palettes = Object.fromEntries(['normal', 'shiny'].map(kind => [kind, decoded(pointer(tables[kind] + sid * 8), [32, 128])]));
        for (const view of ['front', 'back']) {
            const tiles = decoded(pointer(tables[view] + sid * 8), [2048, 8192]), multi = engine.multi_frame_species.includes(sid);
            if (tiles.length !== (multi ? 8192 : 2048)) throw new Error('Undeclared multi-frame resource');
            for (let frame = 0; frame < tiles.length / 2048; frame++) for (const [kind, pal] of Object.entries(palettes)) {
                const start = multi ? frame * 32 : 0;
                emit(`pokemon/${sid}/${kind}/${view}/${frame}`, tiles.subarray(frame * 2048, (frame + 1) * 2048), pal.subarray(start, start + 32), 64, 64);
            }
        }
        const icon = pointer(tables.icons + sid * 4), index = raw(tables.icon_indices + sid, 1)[0];
        if (index >= 6) throw new Error('Invalid icon palette index');
        const pal = raw(pointer(tables.icon_palettes + index * 8), 32);
        for (let frame = 0; frame < 2; frame++) for (const kind of ['normal', 'shiny']) emit(`pokemon/${sid}/${kind}/icon/${frame}`, raw(icon + frame * 512, 512), pal, 32, 32);
        if (sid % 32 === 0) progress?.(sid / spec.species_count * 0.8);
    }
    for (let iid = 0; iid < spec.item_count; iid++) emit(`items/${iid}`, decoded(pointer(itemTable + iid * 8), [288]), decoded(pointer(itemTable + iid * 8 + 4), [32]), 24, 24);
    return [...warnings].sort();
}
const READERS = { 'gen3-dpe-v1': dpeReader };

export async function extractGraphics(rom, profileId, progress) {
    if (!rom.length || rom.length > 32 * 1024 * 1024) throw new Error('ROM must be between 1 byte and 32 MiB');
    const hash = await sha256(rom), spec = registry.roms.find(r => r.sha256 === hash && (!profileId || r.profile_id === profileId));
    if (!spec) throw new Error('ROM not registered for this game/version; no resources were installed');
    const engine = registry.engines[spec.engine], resources = [];
    const warnings = READERS[spec.engine](rom, spec, engine, (key, tiles, pal, w, h) => resources.push([key, encodePng(rgbaTiles(tiles, pal, w, h), w, h)]), progress);
    const assets = {}, files = {};
    for (let i = 0; i < resources.length; i++) {
        const [key, png] = resources[i], name = `assets/${await sha256(png)}.png`;
        assets[key] = name; files[name] = png;
        if (i % 128 === 0) progress?.(0.8 + i / resources.length * 0.2);
    }
    const manifest = { schema_version: 1, profile_id: spec.profile_id, rom_sha256: hash, engine: spec.engine,
        species_count: spec.species_count, item_count: spec.item_count, appearance: { female_species: engine.female_species, unown: engine.unown },
        limitations: ['Spinda personality spots are not applied; extracted base artwork is shown.', 'Battle-only forms are exported; save previews use frame 0.'], warnings, assets };
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
    const lines = [`PUSE-GRAPHICS\t1\t${spec.profile_id}\t${hash}`, ...Object.entries(engine.female_species).map(([a,b]) => `@female\t${a}\t${b}`),
        `@unown\t${engine.unown.species}\t${engine.unown.first_alternate}`, ...Object.entries(assets).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,path]) => `${key}\t${path}`)];
    files['resources.tsv'] = new TextEncoder().encode(lines.join('\n') + '\n');
    return { manifest, files };
}
