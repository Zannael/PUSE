import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { decompressLz, rgbaTiles, pokemonKey, extractGraphics } from '../src/core/graphicsCodec.js';
import registry from '../src/data/graphics/roms.json' with { type: 'json' };

assert.throws(() => decompressLz(new Uint8Array([16,32,0,0,128,0,0]), 0, [32]), /Invalid LZ/);
assert.throws(() => decompressLz(new Uint8Array([16,255,255,255]), 0, [32]), /size/);
assert.throws(() => decompressLz(new Uint8Array([16,32,0,0]), 0, [32]), /Truncated/);
const raw = new Uint8Array([10,1,0,0,0,42]);
assert.deepEqual([...decompressLz(raw, 0, [1])], [42]);
assert.equal(raw[0], 10);
assert.deepEqual([...decompressLz(new Uint8Array([16,2,0,0,64,42,0,0]),0,[2])], [42,42]);
assert.equal(pokemonKey(201, { unown: { species:201, first_alternate:413 } }, { pid:1 }), 'pokemon/413/normal/front/0');
assert.equal(pokemonKey(502, { female_species:{502:744} }, { gender:'female', is_shiny:true }), 'pokemon/744/shiny/front/0');
const tiles = new Uint8Array(32); tiles[0] = 0x21;
const pal = new Uint8Array(32); pal[2]=31; pal[4]=224; pal[5]=3;
const rgba = rgbaTiles(tiles,pal,8,8);
assert.deepEqual([...rgba.slice(0,8)], [255,0,0,255,0,255,0,255]);
await assert.rejects(extractGraphics(new Uint8Array([1]), 'unbound-2.1.1.1'), /not registered/);
if (process.argv[2]) {
    const bytes = new Uint8Array(await fs.readFile(process.argv[2]));
    const pack = await extractGraphics(bytes);
    const hash = data => crypto.createHash('sha256').update(data).digest('hex');
    // Write portable output for Python/C++ consumption; personal artifacts only.
    const out = process.argv[3];
    if (out) {
        await fs.mkdir(out,{recursive:true});
        for (const [name,content] of Object.entries(pack.files)) {
            const path = `${out}/${name}`; await fs.mkdir(path.slice(0,path.lastIndexOf('/')),{recursive:true}); await fs.writeFile(path,content);
        }
    }
    assert.equal(pack.manifest.species_count, registry.roms.find(r=>r.sha256===hash(bytes)).species_count);
    console.log(`ROM extraction: ${pack.manifest.profile_id}, ${Object.keys(pack.manifest.assets).length} resource keys`);
}
console.log('Graphics JS regression passed');
