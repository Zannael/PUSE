#!/usr/bin/env python3
"""Map unambiguous native catalog names onto existing shared assets.

No fuzzy matching or cross-ROM numeric IDs. Duplicate display names (forms)
are deliberately omitted. Optional full shared PNG directory expands coverage.
"""
import argparse
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def normalize(value):
    return re.sub('[^a-z0-9]', '', unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower())


def read_names(path):
    return {int(k): v for line in path.read_text().splitlines() if ':' in line for k, v in [line.split(':', 1)]}


def generate(pokemon_assets=None):
    old = json.loads((ROOT / 'frontend/src/data/pokemon-icon-manifest.json').read_text())
    filenames = set(old.values())
    if pokemon_assets:
        filenames.update(p.name for p in pokemon_assets.glob('*.png'))
    shared = defaultdict(set)
    for filename in filenames:
        token = re.sub(r'^gFrontSprite[0-9]*', '', filename.removesuffix('.png'))
        shared[normalize(token)].add(filename)
    item_manifest = json.loads((ROOT / 'frontend/src/data/item-icon-manifest.json').read_text())
    item_names = read_names(ROOT / 'backend/data/items.txt')
    item_shared = defaultdict(set)
    for iid, filename in item_manifest.items():
        if int(iid) in item_names:
            item_shared[normalize(item_names[int(iid)])].add(filename)
    result = {}
    for path in sorted((ROOT / 'backend/data/profiles').glob('*.json')):
        profile = json.loads(path.read_text())
        base = ROOT / 'backend/data' / profile.get('catalog_base', '')
        mapped = {}
        for kind, name, assets in [('pokemon', 'pokemon.txt', shared), ('items', 'items.txt', item_shared)]:
            rows = read_names(base / name)
            counts = Counter(normalize(v) for v in rows.values())
            mapped[kind] = {str(i): next(iter(assets[normalize(v)])) for i, v in rows.items()
                            if i > 0 and counts[normalize(v)] == 1 and len(assets[normalize(v)]) == 1}
        # Preserve existing verified Unbound manifest coverage and form aliases.
        if profile['id'] == 'unbound-2.1.1.1':
            mapped = {'pokemon': old, 'items': item_manifest}
        result[profile['id']] = mapped
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pokemon-assets', type=Path)
    args = parser.parse_args()
    output = ROOT / 'backend/data/graphics/fallbacks.json'
    output.write_text(json.dumps(generate(args.pokemon_assets), indent=2, sort_keys=True) + '\n')
