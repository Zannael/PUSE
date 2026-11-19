"""ROM graphics only: no save parsing, mutation, or game-specific dispatch.

Descriptors select an engine reader; the portable pack keeps native IDs. PNGs
are content-addressed so normal/shiny icons and repeated placeholders dedupe.
"""
import hashlib
import json
import re
import struct
import zlib
from pathlib import Path

REGISTRY_PATH = Path(__file__).resolve().parents[1] / 'data/graphics/roms.json'
MAX_ROM_SIZE = 32 * 1024 * 1024


def registry():
    return json.loads(REGISTRY_PATH.read_text())


def descriptor(sha256, profile_id=None):
    data = registry()
    entry = next((r for r in data['roms'] if r['sha256'] == sha256), None)
    if entry is None or (profile_id is not None and entry['profile_id'] != profile_id):
        raise ValueError('ROM not registered for this game/version; no resources were installed')
    return entry, data['engines'][entry['engine']]


def decompress_lz(rom, offset, expected_sizes):
    """Bounded BIOS-style LZ77; report nonstandard markers, never patch input."""
    if offset < 0 or offset + 4 > len(rom):
        raise ValueError('Compressed resource pointer outside ROM')
    size = int.from_bytes(rom[offset + 1:offset + 4], 'little')
    if size not in expected_sizes:
        raise ValueError(f'Unexpected decompressed size: {size}')
    out = bytearray()
    pos = offset + 4
    while len(out) < size:
        if pos >= len(rom):
            raise ValueError('Truncated compressed resource')
        flags = rom[pos]
        pos += 1
        for bit in range(7, -1, -1):
            if len(out) == size:
                break
            if flags & (1 << bit):
                if pos + 2 > len(rom):
                    raise ValueError('Truncated LZ reference')
                a, b = rom[pos:pos + 2]
                pos += 2
                length, distance = (a >> 4) + 3, ((a & 15) << 8) + b + 1
                if distance > len(out):
                    raise ValueError('Invalid LZ reference')
                # Some shipped streams end with a reference beyond the logical
                # size. Keep only the declared resource, never write past it.
                for _ in range(min(length, size - len(out))):
                    out.append(out[-distance])
            else:
                if pos >= len(rom):
                    raise ValueError('Truncated LZ literal')
                out.append(rom[pos])
                pos += 1
    return bytes(out)


def rgba_tiles(tiles, palette, width, height):
    if width % 8 or height % 8 or len(tiles) != width * height // 2 or len(palette) != 32:
        raise ValueError('Invalid 4bpp resource dimensions')
    colors = []
    for i in range(16):
        c = int.from_bytes(palette[i * 2:i * 2 + 2], 'little')
        colors.append(bytes(((c & 31) * 255 // 31, ((c >> 5) & 31) * 255 // 31,
                             ((c >> 10) & 31) * 255 // 31, 255 if i else 0)))
    rgba = bytearray()
    for y in range(height):
        for x in range(width):
            pos = ((y // 8) * (width // 8) + x // 8) * 32 + (y % 8) * 4 + (x % 8) // 2
            rgba.extend(colors[(tiles[pos] >> (4 * (x % 2))) & 15])
    return bytes(rgba)


def encode_png(rgba, width, height):
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
    scanlines = b''.join(b'\0' + rgba[y * width * 4:(y + 1) * width * 4] for y in range(height))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(scanlines)) + chunk(b'IEND', b''))


def extract_dpe(rom, spec, engine, emit):
    def raw(offset, size):
        if offset < 0 or offset + size > len(rom):
            raise ValueError('Resource outside ROM')
        return rom[offset:offset + size]

    def pointer(offset):
        value = int.from_bytes(raw(offset, 4), 'little') - 0x08000000
        raw(value, 1)
        return value

    tables = {name: pointer(offset) for name, offset in engine['tables'].items()}
    signature = bytes.fromhex(engine['item_accessor_signature'])
    if raw(engine['item_accessor_signature_offset'], len(signature)) != signature:
        raise ValueError('Item accessor does not match declared engine')
    item_table = pointer(engine['item_table_pointer'])
    warnings = []

    def decoded(offset, sizes):
        result = decompress_lz(rom, offset, sizes)
        if rom[offset] != 0x10:
            warnings.append(f'Nonstandard LZ marker at 0x{offset:x}; decoded with BIOS semantics')
        return result

    for sid in range(spec['species_count']):
        palettes = {kind: decoded(pointer(tables[kind] + sid * 8), (32, 128)) for kind in ('normal', 'shiny')}
        for view in ('front', 'back'):
            tiles = decoded(pointer(tables[view] + sid * 8), (2048, 8192))
            multi = sid in engine['multi_frame_species']
            if len(tiles) != (8192 if multi else 2048):
                raise ValueError('Undeclared multi-frame resource')
            for frame in range(len(tiles) // 2048):
                for kind, pal in palettes.items():
                    start = frame * 32 if multi else 0
                    emit(f'pokemon/{sid}/{kind}/{view}/{frame}', tiles[frame * 2048:(frame + 1) * 2048], pal[start:start + 32], 64, 64)
        icon = pointer(tables['icons'] + sid * 4)
        palette_index = raw(tables['icon_indices'] + sid, 1)[0]
        if palette_index >= 6:
            raise ValueError('Invalid icon palette index')
        pal = raw(pointer(tables['icon_palettes'] + palette_index * 8), 32)
        for frame in range(2):
            tiles = raw(icon + frame * 512, 512)
            for kind in ('normal', 'shiny'):
                emit(f'pokemon/{sid}/{kind}/icon/{frame}', tiles, pal, 32, 32)
    for iid in range(spec['item_count']):
        tiles = decoded(pointer(item_table + iid * 8), (288,))
        pal = decoded(pointer(item_table + iid * 8 + 4), (32,))
        emit(f'items/{iid}', tiles, pal, 24, 24)
    return sorted(set(warnings))


ENGINE_READERS = {'gen3-dpe-v1': extract_dpe}


def extract_pack(rom, profile_id=None):
    if not 0 < len(rom) <= MAX_ROM_SIZE:
        raise ValueError('ROM must be between 1 byte and 32 MiB')
    sha = hashlib.sha256(rom).hexdigest()
    spec, engine = descriptor(sha, profile_id)
    assets, files = {}, {}

    def emit(key, tiles, pal, width, height):
        png = encode_png(rgba_tiles(tiles, pal, width, height), width, height)
        path = 'assets/' + hashlib.sha256(png).hexdigest() + '.png'
        assets[key] = path
        files[path] = png

    warnings = ENGINE_READERS[spec['engine']](rom, spec, engine, emit)
    manifest = {'schema_version': 1, 'profile_id': spec['profile_id'], 'rom_sha256': sha,
                'engine': spec['engine'], 'species_count': spec['species_count'], 'item_count': spec['item_count'],
                'appearance': {'female_species': engine['female_species'], 'unown': engine['unown']},
                'limitations': ['Spinda personality spots are not applied; extracted base artwork is shown.',
                                'Battle-only forms are exported; save previews use frame 0.'],
                'warnings': warnings, 'assets': assets}
    files['manifest.json'] = (json.dumps(manifest, sort_keys=True, separators=(',', ':')) + '\n').encode()
    lines = [f"PUSE-GRAPHICS\t1\t{spec['profile_id']}\t{sha}"]
    lines += [f'@female\t{k}\t{v}' for k, v in engine['female_species'].items()]
    unown = engine['unown']
    lines.append(f"@unown\t{unown['species']}\t{unown['first_alternate']}")
    lines += [f'{key}\t{path}' for key, path in sorted(assets.items())]
    files['resources.tsv'] = ('\n'.join(lines) + '\n').encode()
    return manifest, files


def pokemon_key(species_id, appearance, *, shiny=False, gender='', pid=None, view='front', frame=0):
    sid = int(species_id)
    if gender == 'female':
        sid = appearance.get('female_species', {}).get(str(sid), sid)
    rule = appearance.get('unown', {})
    if sid == rule.get('species') and pid is not None:
        pid = int(pid) & 0xffffffff
        letter = (((pid & 0x03000000) >> 18) | ((pid & 0x00030000) >> 12)
                  | ((pid & 0x300) >> 6) | (pid & 3)) % 28
        if letter:
            sid = rule['first_alternate'] + letter - 1
    return f"pokemon/{sid}/{'shiny' if shiny else 'normal'}/{view}/{int(frame)}"


class GraphicsPack:
    def __init__(self, root, profile_id):
        self.root = Path(root).resolve()
        self.manifest = json.loads((self.root / 'manifest.json').read_text())
        m = self.manifest
        if m.get('schema_version') != 1 or m.get('profile_id') != profile_id:
            raise ValueError('Incompatible graphics pack')
        spec, engine = descriptor(m['rom_sha256'], profile_id)
        if (not isinstance(m.get('assets'), dict) or len(m['assets']) > 40000
                or not isinstance(m.get('warnings'), list)
                or m.get('species_count') != spec['species_count'] or m.get('item_count') != spec['item_count']
                or m.get('appearance') != {'female_species': engine['female_species'], 'unown': engine['unown']}):
            raise ValueError('Invalid graphics manifest')

    def resolve(self, key):
        name = self.manifest['assets'].get(key, '')
        if not isinstance(name, str) or not re.fullmatch(r'assets/[0-9a-f]{64}\.png', name):
            return None
        path = self.root / name
        if not path.is_file() or path.is_symlink():
            return None
        if hashlib.sha256(path.read_bytes()).hexdigest() != path.stem:
            return None
        return path
