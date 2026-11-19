#!/usr/bin/env python3
"""Seeded whole-save mutation properties across all four runtimes.

No ROM or personal save is required. The independent oracle writes only the
documented 8/16-bit fields and checksums; it does not call mutation/commit code.
Run: python3 backend/tools/mutation_property_regression.py [--seed N]
"""
import argparse
import contextlib
import io
import json
from pathlib import Path
import random
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from core.profile import get_profile, select_profile
from core.sections import active_unbound_slot
from modules import party, pc
from tools.pc_storage_regression import checksum, slot_offsets

PORTS = ('switch-homebrew', '3ds-homebrew')


def regions(profile, offsets):
    return [(offsets[sid] + start if sid < 14 else sid * 4096 + start, end - start)
            for sid, start, end in profile['storage']['pc']['regions']]


def physical_byte(profile, offsets, logical):
    for start, length in regions(profile, offsets):
        if logical < length:
            return start + logical
        logical -= length
    raise AssertionError('PC byte outside storage')


def refresh(save, profile, offsets):
    domains = profile['container']['checksum']['lengths']
    for sid, off in offsets.items():
        size = domains.get(str(sid), 4080)
        struct.pack_into('<H', save, off + 0xFF6, checksum(save[off:off + size]))


def fixture(profile, rng, counters, rotations, trailer):
    """Independent serialization, with all six party and all ordinary PC slots."""
    save = bytearray(rng.randbytes(131072 + trailer))
    maps = [slot_offsets(slot, rotations[slot]) for slot in range(2)]
    count = profile['storage']['pc']['box_count'] * 30
    stream = bytearray(rng.randbytes(count * 58))
    for record in range(count):
        struct.pack_into('<H', stream, record * 58 + 28, 1)
        struct.pack_into('<H', stream, record * 58 + 30, 0)
        struct.pack_into('<I', stream, record * 58 + 32, 1000)
        stream[record * 58 + 37] = 70
    for slot, offsets in enumerate(maps):
        for sid, off in offsets.items():
            struct.pack_into('<IHHII', save, off + 4080, 0xAABBCCDD, sid, 0,
                             profile['container']['signatures'][0], counters[slot])
        cursor = 0
        for off, length in regions(profile, offsets):
            save[off:off + length] = stream[cursor:cursor + length]
            cursor += length
        assert cursor == len(stream)
        base = offsets[1]
        struct.pack_into('<I', save, base + 0x34, 6)
        for index in range(6):
            start = base + 0x38 + index * 100
            struct.pack_into('<H', save, start + 0x20, 1)
            struct.pack_into('<H', save, start + 0x22, 0)
            save[start + 0x29] = 70
            # Stable party representation requires a zero runtime checksum word.
            struct.pack_into('<H', save, start + 0x1C, 0)
        refresh(save, profile, offsets)
    return save, maps


def backend(source, test):
    save = bytearray(source)
    sectors = pc.get_active_pc_sectors(save)
    stream, headers, originals, preset = pc.rebuild_buffer(save, sectors)
    start = active_unbound_slot(save)[1]['offset'] + 0x38 + test['index'] * 100
    mon = party.Pokemon(save[start:start + 100])
    position = ((test['box'] - 1) * 30 + test['slot'] - 1) * 58
    boxed = pc.UnboundPCMon(stream[position:position + 58], test['box'], test['slot'])
    mutations = [(mon, 'set_item'), (boxed, 'set_item_id')] if test['operation'] == 'item' else [(mon, 'set_happiness'), (boxed, 'set_happiness')]
    for record, method in mutations:
        # Party setters stage edits in decoded substructures, not raw bytes.
        # Inspect their packed state too, so a rejected staged edit cannot hide.
        before = bytes(record.pack_data() if record is mon else record.raw)
        try:
            getattr(record, method)(test['value'])
        except ValueError:
            assert test['reject'], test['name']
            assert bytes(record.pack_data() if record is mon else record.raw) == before, test['name']
        else:
            assert not test['reject'], test['name']
    if not test['reject']:
        save[start:start + 100] = mon.pack_data()
        # Independent checksum helper also used to serialize synthetic inputs.
        refresh(save, get_profile(), {1: start - 0x38 - test['index'] * 100})
        stream[position:position + 58] = boxed.raw
    pc.write_save_HYBRID(save, sectors, stream, headers, originals, None, preset)
    return bytes(save)


def oracle(source, profile, offsets, test):
    expected = bytearray(source)
    if test['reject']:
        return expected
    party_field, pc_field, width = (0x22, 30, 2) if test['operation'] == 'item' else (0x29, 37, 1)
    start = offsets[1] + 0x38 + test['index'] * 100 + party_field
    expected[start:start + width] = test['value'].to_bytes(width, 'little')
    logical = ((test['box'] - 1) * 30 + test['slot'] - 1) * 58 + pc_field
    for index, byte in enumerate(test['value'].to_bytes(width, 'little')):
        expected[physical_byte(profile, offsets, logical + index)] = byte
    touched = {offsets[1]}
    touched.update(physical_byte(profile, offsets, logical + i) // 4096 * 4096 for i in range(width))
    for sid, off in offsets.items():
        if off in touched:
            refresh(expected, profile, {sid: off})
    # Auxiliary footer/checksums are unverified and must remain unchanged.
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=int, default=20261119)
    args = parser.parse_args()
    rng = random.Random(args.seed)
    initialized = []
    try:
        for port in PORTS:
            tmp = ROOT / port / 'artifacts/tmp'
            if tmp.exists() and any(tmp.iterdir()):
                raise RuntimeError(f'Preserve existing parity artifacts: {tmp}')
        binaries = []
        for port in PORTS:
            subprocess.run([str(ROOT / port / 'scripts/parity_tmp.sh'), 'init'], check=True)
            initialized.append(port)
            binary = ROOT / port / 'artifacts/tmp/port/mutation-properties'
            subprocess.run(['g++', '-std=c++17', '-O1', '-I' + str(ROOT / port / 'include'),
                *[str(ROOT / port / f'source/core/{name}.cpp') for name in ('SaveSession', 'SaveSections', 'Party', 'Pc')],
                str(ROOT / port / 'source/io/DataLoader.cpp'),
                str(ROOT / 'backend/tools/mutation_property_native.cpp'), '-o', str(binary)], check=True)
            binaries.append((port, binary))
        tmp = ROOT / PORTS[0] / 'artifacts/tmp'
        manifest = []
        expected_outputs = []
        layouts = [((40, 41), (7, 3), 16, 1), ((41, 40), (13, 0), 0, 0),
                   ((0xFFFFFFFF, 0), (0, 13), 16, 1), ((99, 100), (2, 11), 0, 0)]
        for profile_id in ('unbound-2.1.1.1', 'radical-red-4.1'):
            select_profile(profile_id)
            profile = get_profile()
            for layout, (counters, rotations, trailer, selected) in enumerate(layouts):
                source, maps = fixture(profile, rng, counters, rotations, trailer)
                if layout == 3:  # Corrupt newest generation; mutations must fall back.
                    source[maps[1][6] + 3] ^= 1
                assert active_unbound_slot(source)[1]['offset'] == maps[selected][1]
                inp = tmp / f'source/{profile_id}-{layout}.sav'
                inp.write_bytes(source)
                lengths = [length for _, length in regions(profile, maps[selected])]
                boundaries = [sum(lengths[:i]) // 58 for i in range(1, len(lengths))]
                targets = [0, profile['storage']['pc']['box_count'] * 30 - 1, *boundaries]
                values = [('happiness', v) for v in (0, 1, 70, 254, 255, rng.randrange(256), -1, 256)]
                values += [('item', v) for v in (0, 1, 255, 256, 65535, rng.randrange(65536), rng.randrange(65536))]
                cases = [(operation, value, targets[n % len(targets)]) for n, (operation, value) in enumerate(values)]
                # Exercise both byte widths at every fragmented-storage boundary,
                # including the last ordinary box and RR's extra section-0 block.
                cases += [(operation, rng.randrange(limit), target)
                          for target in targets for operation, limit in [('happiness', 256), ('item', 65536)]]
                for number, (operation, value, target) in enumerate(cases):
                    box, slot = target // 30 + 1, target % 30 + 1
                    name = f'{profile_id}/layout-{layout}/{operation}/{value}/box-{box}-slot-{slot}'
                    case_id = len(manifest)
                    test = dict(name=name, profile=profile_id, operation=operation, value=value,
                                index=number % 6, box=box, slot=slot,
                                reject=operation == 'happiness' and not 0 <= value <= 255,
                                input=str(inp), output=str(tmp / f'port/browser-{case_id}.sav'))
                    expected = bytes(oracle(source, profile, maps[selected], test))
                    with contextlib.redirect_stdout(io.StringIO()):
                        actual = backend(source, test)
                    assert actual == expected, f'Python independent byte oracle: {name}'
                    expected_path = tmp / f'source/expected-{case_id}.sav'
                    expected_path.write_bytes(expected)
                    for port, binary in binaries:
                        out = ROOT / port / f'artifacts/tmp/port/case-{case_id}.sav'
                        subprocess.run([str(binary), str(inp), str(out), profile_id, operation,
                                        str(test['index']), str(box), str(slot), str(value),
                                        'reject' if test['reject'] else 'accept'], cwd=ROOT / port, check=True)
                        subprocess.run([str(ROOT / port / 'scripts/parity_tmp.sh'), 'compare',
                                        str(expected_path), str(out)], check=True, stdout=subprocess.DEVNULL)
                    manifest.append(test)
                    expected_outputs.append(expected)
                print(f'PASS seed={args.seed}: {profile_id}, layout {layout}, {len(cases)} cases', flush=True)
        manifest_path = tmp / 'source/cases.json'
        manifest_path.write_text(json.dumps(manifest))
        subprocess.run(['node', str(ROOT / 'frontend/scripts/mutation-property-runner.mjs'), str(manifest_path)], check=True)
        for test, expected in zip(manifest, expected_outputs):
            assert Path(test['output']).read_bytes() == expected, f'JavaScript byte oracle: {test["name"]}'
        print(f'PASS: {len(manifest)} cases x four runtimes; field widths, identity/unrelated bytes, checksums, rejection immutability.')
    finally:
        select_profile('unbound-2.1.1.1')
        for port in initialized:
            subprocess.run([str(ROOT / port / 'scripts/parity_tmp.sh'), 'cleanup'], check=True)


if __name__ == '__main__':
    main()
