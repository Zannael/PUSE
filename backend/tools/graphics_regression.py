#!/usr/bin/env python3
"""Synthetic corruption/parity tests; optional private ROM extraction checks."""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from core.graphics import decompress_lz, encode_png, rgba_tiles, pokemon_key, GraphicsPack, extract_pack, registry


def pixels(png):
    pos, payload = 8, bytearray()
    while pos < len(png):
        size = int.from_bytes(png[pos:pos + 4], 'big')
        if png[pos + 4:pos + 8] == b'IDAT': payload.extend(png[pos + 8:pos + 8 + size])
        pos += size + 12
    return zlib.decompress(payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, action='append', default=[])
    args = parser.parse_args()
    assert json.loads((ROOT/'frontend/src/data/graphics/roms.json').read_text()) == registry()
    fallback = json.loads((ROOT/'backend/data/graphics/fallbacks.json').read_text())
    assert json.loads((ROOT/'frontend/src/data/graphics/fallbacks.json').read_text()) == fallback
    assert '1274' not in fallback['radical-red-4.1']['pokemon']  # Custom Blitzle shares its display name.
    assert '1370' in fallback['radical-red-4.1']['pokemon']  # Unique exact Terapagos artwork.
    for port in ('switch-homebrew','3ds-homebrew'):
        assert (ROOT/port/'include/puse/core/GraphicsPack.hpp').read_bytes() == (ROOT/'shared/graphics/GraphicsPack.hpp').read_bytes()
        assert (ROOT/port/'romfs/data/graphics/roms.json').read_bytes() == (ROOT/'backend/data/graphics/roms.json').read_bytes()
        trust = (ROOT/port/'include/puse/core/GraphicsRegistry.hpp').read_text()
        for rom in registry()['roms']:
            assert rom['profile_id'] in trust and rom['sha256'] in trust
    for raw in (bytes([16,32,0,0]), bytes([16,32,0,0,128,0,0]), bytes([16,255,255,255])):
        try: decompress_lz(raw, 0, (32,))
        except ValueError: pass
        else: raise AssertionError('Invalid LZ accepted')
    raw = bytes([10,1,0,0,0,42]); assert decompress_lz(raw,0,(1,)) == bytes([42]) and raw[0] == 10
    assert decompress_lz(bytes([16,2,0,0,64,42,0,0]),0,(2,)) == bytes([42,42])
    tiles = bytes([0x21]) + bytes(31); pal = bytes([0,0,31,0,224,3]) + bytes(26)
    assert rgba_tiles(tiles,pal,8,8)[:8] == bytes([255,0,0,255,0,255,0,255])
    appearance = {'female_species': {'502':744}, 'unown': {'species':201,'first_alternate':413}}
    assert pokemon_key(502,appearance,shiny=True,gender='female') == 'pokemon/744/shiny/front/0'
    assert pokemon_key(201,appearance,pid=1) == 'pokemon/413/normal/front/0'
    with tempfile.TemporaryDirectory(prefix='puse-graphics-') as directory:
        temp = Path(directory); png = encode_png(rgba_tiles(tiles,pal,8,8),8,8)
        name = 'assets/' + hashlib.sha256(png).hexdigest() + '.png'
        (temp / 'assets').mkdir(); (temp / name).write_bytes(png)
        profile = registry()['roms'][0]
        keys = ['pokemon/1/normal/front/0','pokemon/1/shiny/front/0','pokemon/744/normal/front/0','pokemon/413/normal/front/0','items/503']
        engine=registry()['engines'][profile['engine']]
        appearance={'female_species':engine['female_species'],'unown':engine['unown']}
        manifest = {'schema_version':1,'profile_id':profile['profile_id'],'rom_sha256':profile['sha256'],'appearance':appearance,'assets':dict.fromkeys(keys,name),
                    'species_count':profile['species_count'],'item_count':profile['item_count'],'warnings':[]}
        (temp / 'manifest.json').write_text(json.dumps(manifest))
        index = f"PUSE-GRAPHICS\t1\t{profile['profile_id']}\t{profile['sha256']}\n@female\t502\t744\n@unown\t201\t413\n" + ''.join(f'{key}\t{name}\n' for key in keys)
        (temp / 'resources.tsv').write_text(index)
        pack = GraphicsPack(temp,profile['profile_id']); assert pack.resolve(keys[0]) == temp / name
        for port in ('switch-homebrew','3ds-homebrew'):
            executable = temp / (port+'-probe')
            subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-I'+str(ROOT / port / 'include'),str(ROOT/'shared/graphics/pack_probe.cpp'),'-o',str(executable)],check=True)
            result = subprocess.check_output([str(executable),str(temp),profile['profile_id']],text=True)
            assert result.splitlines() == [str(temp / name)] * 5
            assert subprocess.run([str(executable),str(temp),'radical-red-4.1'],stdout=subprocess.DEVNULL).returncode == 3
            (temp/'resources.tsv').write_text(index+'bad\t../../outside.png\n')
            assert subprocess.run([str(executable),str(temp),profile['profile_id']],stdout=subprocess.DEVNULL).returncode == 3
            (temp/'resources.tsv').write_text(index)
        manifest['assets'][keys[0]] = '../outside.png'; (temp/'manifest.json').write_text(json.dumps(manifest))
        assert GraphicsPack(temp,profile['profile_id']).resolve(keys[0]) is None
        for rom in args.rom:
            before = hashlib.sha256(rom.read_bytes()).hexdigest()
            manifest, files = extract_pack(rom.read_bytes())
            js_out = temp / 'browser'
            subprocess.run(['node',str(ROOT/'frontend/scripts/graphics-regression.mjs'),str(rom.resolve()),str(js_out)],check=True)
            js = json.loads((js_out/'manifest.json').read_text())
            assert manifest['appearance'] == js['appearance'] and manifest['warnings'] == js['warnings']
            assert manifest['assets'].keys() == js['assets'].keys()
            # Compare every PNG's decoded pixels, independent of zlib implementation.
            memo = set()
            for key,name in manifest['assets'].items():
                other=js['assets'][key]
                if (name,other) not in memo:
                    assert pixels(files[name]) == pixels((js_out/other).read_bytes()), key
                    memo.add((name,other))
            assert before == hashlib.sha256(rom.read_bytes()).hexdigest()
            print(f"Python/browser pixel parity: {manifest['profile_id']} ({len(manifest['assets'])} resources)")
            import shutil
            shutil.rmtree(js_out)
    print('Graphics Python + both native pack readers passed')


if __name__ == '__main__': main()
