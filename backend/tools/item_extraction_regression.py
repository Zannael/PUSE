#!/usr/bin/env python3
"""ROM-independent item discovery tests, plus optional private-ROM verification."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile

from extract_unbound_item_table import (
    ITEM_STRUCT_SIZE, ITEM_TABLE_POINTER_OFFSET, ROM_ADDRESS_BASE,
    build_pocket_map, encode_name, extract_all_ids, find_live_item_base,
    read_row, runtime_pocket_map,
)


def rejects(action):
    try:
        action()
    except ValueError:
        return
    raise AssertionError('Invalid ROM metadata was accepted')


def synthetic_tests():
    rom = bytearray(0x24000)
    live, stale = 0x8000, 0x1000
    names = {1: 'Master Ball', 2: 'Ultra Ball', 92: 'Magma Stone',
             348: 'Costume Box', 349: 'Parcel', 437: 'HM01'}

    def row(base, iid, name, pocket, native_id=None):
        off = base + iid * ITEM_STRUCT_SIZE
        encoded = encode_name(name)
        rom[off:off + len(encoded)] = encoded
        rom[off + 14:off + 16] = (iid if native_id is None else native_id).to_bytes(2, 'little')
        rom[off + 26] = pocket

    # Both tables have valid opening anchors; a string search chooses the stale one.
    for base in (stale, live):
        for iid, name in names.items():
            row(base, iid, name, 3 if iid < 3 else 2)
    row(stale, 92, 'Magma Stone', 1)
    row(live, 437, 'HM01', 4, native_id=339)  # TM/HM IDs may be aliases.
    rom[ITEM_TABLE_POINTER_OFFSET:ITEM_TABLE_POINTER_OFFSET + 4] = (ROM_ADDRESS_BASE + live).to_bytes(4, 'little')
    assert find_live_item_base(rom, max(names)) == live
    entries = extract_all_ids(rom, names, live)
    assert entries[92]['offset'] == live + 92 * 44
    assert entries[92]['pocket_code'] == 2
    assert entries[437]['item_id_field'] == 339

    # Pointer-form names must be decoded from their target, not the pointer bytes.
    name_offset = 0x22000
    encoded = encode_name('Magma Stone')
    rom[name_offset:name_offset + len(encoded)] = encoded
    off = live + 92 * 44
    rom[off:off + 4] = (ROM_ADDRESS_BASE + name_offset).to_bytes(4, 'little')
    assert read_row(rom, off)['rom_name'] == 'Magma Stone'
    rom[off:off + 4] = (ROM_ADDRESS_BASE + len(rom)).to_bytes(4, 'little')
    rejects(lambda: read_row(rom, off))
    rom[off:off + 4] = (ROM_ADDRESS_BASE + name_offset).to_bytes(4, 'little')
    rom[name_offset:name_offset + 128] = b'\0' * 128
    rejects(lambda: read_row(rom, off))
    row(live, 92, 'Magma Stone', 12)
    rejects(lambda: extract_all_ids(rom, names, live))
    rejects(lambda: find_live_item_base(rom[:100], max(names)))
    rejects(lambda: find_live_item_base(rom[:live + 100], max(names)))
    for pointer in (0, ROM_ADDRESS_BASE + len(rom), ROM_ADDRESS_BASE + live + 1,
                    ROM_ADDRESS_BASE + stale):
        broken = bytearray(rom)
        broken[ITEM_TABLE_POINTER_OFFSET:ITEM_TABLE_POINTER_OFFSET + 4] = pointer.to_bytes(4, 'little')
        if pointer == ROM_ADDRESS_BASE + stale:
            # A stale opening pair alone cannot validate the continuous live table.
            broken[stale + 348 * 44:stale + 348 * 44 + 44] = bytes(44)
        rejects(lambda: find_live_item_base(broken, max(names)))

    records = [
        {'item_id': 92, 'pocket_type': 'key', 'rom_name': 'Magma Stone'},
        {'item_id': 437, 'pocket_type': 'tmhm', 'rom_name': 'HM01'},
        {'item_id': 289, 'pocket_type': 'tmhm', 'rom_name': 'TM01'},
        {'item_id': 175, 'pocket_type': 'unused', 'rom_name': ''},
    ]
    result = runtime_pocket_map(records)['pockets']
    assert result['key']['ids'] == [92]
    assert result['tm']['ids'] == [289] and result['hm']['ids'] == [437]
    rejects(lambda: runtime_pocket_map([{'item_id': 1, 'pocket_type': 'unresolved'}]))
    print('PASS: live pointer beats legacy anchors; corrupt pointers/rows fail; indirect names and native aliases survive')


def verify_rom(rom_path):
    root = Path(__file__).resolve().parents[2]
    committed = json.loads((root / 'backend/data/item_table_from_rom.json').read_text())
    rom = rom_path.read_bytes()
    with tempfile.TemporaryDirectory(prefix='puse-items-') as temp:
        output = Path(temp) / 'items.json'
        subprocess.run([sys.executable, str(Path(__file__).with_name('extract_unbound_item_table.py')),
                        str(rom_path), '--out', str(output)], check=True)
        actual = json.loads(output.read_text())
    actual['rom'] = committed['rom']  # Paths differ; content hashes must not.
    assert actual == committed, 'Canonical item table does not reproduce from the ROM'
    base = int(actual['bases']['live'], 16)
    for entry in actual['items']:
        off = base + entry['item_id'] * 44
        assert entry['offset'] == off
        assert entry['pocket_code'] == rom[off + 26]
    by_id = {e['item_id']: e for e in actual['items']}
    labels, _ = build_pocket_map(by_id)
    for iid, family in [(92, 'key'), (61, 'ball'), (62, 'ball'), (182, 'key'),
                        (276, 'main'), (277, 'main'), (286, 'main'), (287, 'main')]:
        assert labels[by_id[iid]['pocket_code']] == family
    assert by_id[92]['rom_name'] == 'Magma Stone'
    assert by_id[92]['item_id_field'] == 92
    subprocess.run([sys.executable, str(Path(__file__).with_name('sync_item_pocket_data.py')), '--check'], check=True)
    print(f'PASS: all {len(by_id)} records reproduce from ROM bytes; all runtime maps/fallbacks reproduce from records')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path)
    args = parser.parse_args()
    synthetic_tests()
    if args.rom:
        verify_rom(args.rom)
