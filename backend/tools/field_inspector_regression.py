#!/usr/bin/env python3
"""Known-field semantics, physical offsets, API and four-runtime read-only parity."""
import asyncio
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
from modules.field_inspector import build_field_report
from modules import game_progress
from tools.mutation_property_regression import fixture, refresh

PORTS = ('switch-homebrew', '3ds-homebrew')


def main():
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
            binary = ROOT / port / 'artifacts/tmp/port/inspector'
            subprocess.run(['g++', '-std=c++17', '-O1', '-I' + str(ROOT / port / 'include'),
                *[str(ROOT / port / f'source/core/{name}.cpp') for name in ('FieldInspector', 'SaveSections', 'Party')],
                str(ROOT / port / 'source/io/DataLoader.cpp'),
                str(ROOT / 'backend/tools/field_inspector_native.cpp'), '-o', str(binary)], check=True)
            binaries.append((port, binary))
        tmp = ROOT / PORTS[0] / 'artifacts/tmp'
        cases = 0
        for profile_id in ('unbound-2.1.1.1', 'radical-red-4.1'):
            select_profile(profile_id)
            profile = get_profile()
            for layout, (counters, rotations, chosen) in enumerate([
                    ((40, 41), (7, 3), 1), ((41, 40), (13, 0), 0),
                    ((0xFFFFFFFF, 0), (0, 13), 1), ((99, 100), (2, 11), 0)]):
                source, maps = fixture(profile, random.Random(918 + layout), counters, rotations, layout % 2 * 16)
                for offsets in maps:
                    off0, off1 = offsets[0], offsets[1]
                    source[off0:off0 + 7] = bytes([0xBB, 0xB4, 0xBC, 0x00, 0xA1, 0xFF, 0xEE])
                    source[off0 + 8] = 255  # Do not assign an invented enum meaning.
                    struct.pack_into('<I', source, off0 + 0xA, 0xFEDC1234)
                    struct.pack_into('<I', source, off1 + 0x34, 6)
                    key = 0xDEADBEEF if profile_id == 'radical-red-4.1' else 0
                    if key: struct.pack_into('<I', source, off0 + 0xF20, key)
                    struct.pack_into('<I', source, off1 + 0x290, 123456 ^ key)
                    if not key:
                        # Independent known locations near section 1's tail;
                        # DexNav uses opaque section 4's expanded-flag tail.
                        source[offsets[1] + 0xFE4] = 0x55
                        source[offsets[1] + 0xFE5] = 0x10
                        source[offsets[4] + 0xD9B] = 0x40
                    refresh(source, profile, offsets)
                if layout == 3: source[maps[1][6] + 3] ^= 1
                before = bytes(source)
                report = build_field_report(source)
                assert bytes(source) == before
                assert report['read_only'] and not report['exact_rom_version_confirmed']
                assert report['save_index'] == counters[chosen]
                fields = {field['id']: field for field in report['fields']}
                assert fields['trainer.name']['decoded'] == "A'B 0"
                assert fields['trainer.tid']['decoded'] == '4660'
                assert fields['trainer.sid']['decoded'] == '65244'
                assert fields['trainer.gender']['decoded'] == '255'
                assert fields['trainer.gender']['confidence'] == 'layout-only'
                assert fields['money.value']['decoded'] == '123456'
                assert fields['party.count']['decoded'] == '6'
                assert len(fields) == (7 if key else 16)
                for field in report['fields']:
                    assert field['file_offset'] == maps[chosen][field['section_id']] + field['relative_offset']
                    start = field['file_offset']
                    assert field['raw_hex'] == source[start:start + field['width']].hex()
                if not key:
                    assert [fields[f'badge.{n}']['decoded'] for n in range(1, 9)] == ['true', 'false'] * 4
                    assert sum(fields[f'badge.{n}']['decoded'] == 'true' for n in range(1, 9)) == game_progress.count_badges(source)
                    assert fields['progress.champion']['decoded'] == str(game_progress.is_champion(source)).lower() == 'true'
                    assert fields['progress.dexnav']['decoded'] == 'true'
                for invalid in (False, True):
                    attempted = bytearray(source)
                    if invalid:
                        for offsets in maps: struct.pack_into('<I', attempted, offsets[5] + 0xFF8, 0)
                    input_path = tmp / 'source/input.sav'
                    input_path.write_bytes(attempted)
                    original = bytes(attempted)
                    if invalid:
                        try: build_field_report(attempted)
                        except ValueError: pass
                        else: raise AssertionError('Invalid generation inspected')
                    commands = [('browser', ['node', str(ROOT / 'frontend/scripts/field-inspector-runner.mjs')])]
                    commands += [(port, [str(binary)]) for port, binary in binaries]
                    for name, command in commands:
                        result = subprocess.run(command + [str(input_path), profile_id], capture_output=True)
                        assert result.returncode == (3 if invalid else 0), (name, result.stderr)
                        if not invalid:
                            actual = json.loads(result.stdout)
                            assert actual == report, (profile_id, layout, name, actual, report)
                            expected_path = tmp / 'source/expected.json'
                            actual_path = tmp / 'port/actual.json'
                            expected_path.write_text(json.dumps(report, sort_keys=True))
                            actual_path.write_text(json.dumps(actual, sort_keys=True))
                            subprocess.run([str(ROOT / PORTS[0] / 'scripts/parity_tmp.sh'), 'compare', str(expected_path), str(actual_path)], check=True, stdout=subprocess.DEVNULL)
                    assert bytes(attempted) == original and input_path.read_bytes() == original
                    cases += 1
                print(f'PASS {profile_id}: layout {layout}, raw/decoded fields, read-only parity and invalid rejection', flush=True)
        # Smoke the endpoint itself, including no-upload and invalid-layout errors.
        select_profile('unbound-2.1.1.1')
        with contextlib.redirect_stdout(io.StringIO()):
            import main as api
        select_profile(profile_id)
        api.current_save['profile_id'] = profile_id
        from fastapi import HTTPException
        api.current_save['data'] = None
        async def rejects():
            try: await api.inspect_known_fields()
            except HTTPException as error: assert error.status_code == 400
            else: raise AssertionError('Missing/invalid save accepted by API')
        asyncio.run(rejects())
        api.current_save['data'] = bytearray(source)
        assert asyncio.run(api.inspect_known_fields()) == report
        assert api.current_save['data'] == source
        api.current_save['data'] = bytearray(10)
        asyncio.run(rejects())
        print(f'PASS: {cases} profile/layout validity cases across four runtimes and API smoke')
    finally:
        select_profile('unbound-2.1.1.1')
        for port in initialized:
            subprocess.run([str(ROOT / port / 'scripts/parity_tmp.sh'), 'cleanup'], check=True)


if __name__ == '__main__':
    main()
