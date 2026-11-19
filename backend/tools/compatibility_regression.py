#!/usr/bin/env python3
"""Four-runtime compatibility preflight and rejected-session immutability."""
import asyncio
import contextlib
import copy
import io
import json
from pathlib import Path
import random
import struct
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from core.profile import build_compatibility_report, choose_profile, get_profile, select_profile
from tools.mutation_property_regression import fixture

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
            binary = ROOT / port / 'artifacts/tmp/port/compatibility'
            subprocess.run(['g++', '-std=c++17', '-O1', '-I' + str(ROOT / port / 'include'),
                str(ROOT / port / 'source/core/SaveSections.cpp'), str(ROOT / port / 'source/core/SaveSession.cpp'),
                str(ROOT / 'backend/tools/compatibility_native.cpp'), '-o', str(binary)], check=True)
            binaries.append((port, binary))
        tmp = ROOT / PORTS[0] / 'artifacts/tmp'
        baseline, _ = fixture(get_profile('unbound-2.1.1.1'), random.Random(98), (40, 41), (7, 3), 0)
        baseline_path = tmp / 'source/baseline.sav'
        baseline_path.write_bytes(baseline)
        cases = []
        for profile_id in ('unbound-2.1.1.1', 'radical-red-4.1'):
            profile = get_profile(profile_id)
            for counters in ((40, 41), (0xFFFFFFFF, 0), (41, 40), (40, 40), (0, 0x80000000)):
                for trailer in (0, 16):
                    source, maps = fixture(profile, random.Random(99), counters, (7, 3), trailer)
                    chosen = 1 if 0 < ((counters[1] - counters[0]) & 0xFFFFFFFF) < 0x80000000 else 0
                    cases.append((source, profile_id, True, counters[chosen], False, 'intact'))
            source, maps = fixture(profile, random.Random(100), (40, 41), (7, 3), 0)
            cases.append((source, '', profile_id.startswith('unbound'), 41, False, 'automatic'))
            opaque = bytearray(source)
            for mapping in maps: opaque[mapping[4] + 3] ^= 1
            unbound = profile_id.startswith('unbound')
            cases.append((opaque, profile_id, unbound, 41 if unbound else None, False, 'profile-specific section 4 verification'))
            bad = bytearray(source); bad[maps[1][6] + 3] ^= 1
            cases.append((bad, profile_id, True, 40, True, 'older fallback'))
            bad = bytearray(bad); bad[maps[0][6] + 3] ^= 1
            cases.append((bad, profile_id, False, None, False, 'both checksums corrupt'))
            for label, offset, fmt, value in [('signature', 0xFF8, '<I', 0), ('duplicate id', 0xFF4, '<H', 6), ('counter incoherence', 0xFFC, '<I', 99)]:
                bad = bytearray(source)
                for mapping in maps: struct.pack_into(fmt, bad, mapping[5] + offset, value)
                cases.append((bad, profile_id, False, None, False, label))
            cases.append((source[:-1], profile_id, False, 41, False, 'truncated auxiliary storage'))
            cases.append((source + b'x', profile_id, False, 41, False, 'unexpected trailer'))
            other = 'radical-red-4.1' if profile_id.startswith('unbound') else 'unbound-2.1.1.1'
            cases.append((source, other, False, None, False, 'wrong declared profile'))
            cases.append((source, 'unknown', False, None, False, 'unregistered profile'))
        for size in (0, 10, 28 * 4096, 131072):
            cases.append((bytearray(size), '', False, None, False, 'unknown layout'))
        for number, (source, requested, allowed, generation, fallback, label) in enumerate(cases):
            select_profile('unbound-2.1.1.1')
            original = bytes(source)
            report = build_compatibility_report(source, requested or None)
            assert report['mutations_allowed'] == allowed, (label, report)
            assert report['editable_generation'] == generation, (label, report)
            assert report['uses_older_generation'] == fallback, (label, report)
            assert report['exact_rom_version_confirmed'] is False
            assert get_profile()['id'] == 'unbound-2.1.1.1'
            try: chosen = choose_profile(source, requested or None)
            except ValueError: assert not allowed
            else: assert allowed and chosen == report['profile_id']
            input_path = tmp / 'source/input.sav'
            input_path.write_bytes(source)
            commands = [('browser', ['node', str(ROOT / 'frontend/scripts/compatibility-runner.mjs')])]
            commands += [(port, [str(binary)]) for port, binary in binaries]
            for name, command in commands:
                result = subprocess.run(command + [str(input_path), requested, str(int(allowed)), str(baseline_path)], capture_output=True, check=True)
                actual = json.loads(result.stdout)
                assert actual == report, (name, label, actual, report)
                expected_path, actual_path = tmp / 'source/expected.json', tmp / 'port/actual.json'
                expected_path.write_text(json.dumps(report, sort_keys=True))
                actual_path.write_text(json.dumps(actual, sort_keys=True))
                subprocess.run([str(ROOT / PORTS[0] / 'scripts/parity_tmp.sh'), 'compare', str(expected_path), str(actual_path)], check=True, stdout=subprocess.DEVNULL)
            assert bytes(source) == original == input_path.read_bytes()
            print(f'PASS {number + 1}: {requested or "auto"}, {label}', flush=True)
        with contextlib.redirect_stdout(io.StringIO()):
            import main as api
        from fastapi import HTTPException, UploadFile
        def upload(data):
            stream = tempfile.SpooledTemporaryFile()
            stream.write(data)
            stream.seek(0)
            return UploadFile(filename='synthetic.sav', file=stream)
        asyncio.run(api.upload_save(upload(bytes(baseline)), 'unbound-2.1.1.1'))
        api.current_save['pc_context']['pending_test_marker'] = True
        saved = copy.deepcopy(api.current_save)
        for source, requested, allowed, _, _, label in cases:
            expected = build_compatibility_report(source, requested or None)
            actual = asyncio.run(api.inspect_compatibility(upload(bytes(source)), requested or None))
            assert actual == expected, label
            assert api.current_save == saved
            if not allowed:
                try: asyncio.run(api.upload_save(upload(bytes(source)), requested or None))
                except HTTPException as error:
                    assert error.status_code == 409 and error.detail['compatibility'] == expected
                else: raise AssertionError('Incompatible API upload accepted')
                assert api.current_save == saved
        print(f'PASS {len(cases)} four-runtime reports; API preflight and rejected uploads preserve existing session and pending PC edits')
    finally:
        select_profile('unbound-2.1.1.1')
        for port in initialized:
            subprocess.run([str(ROOT / port / 'scripts/parity_tmp.sh'), 'cleanup'], check=True)


if __name__ == '__main__':
    main()
