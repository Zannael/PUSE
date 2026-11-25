#!/usr/bin/env python3
"""Cross-runtime ChangeLedger parity regression (Python, JS, Switch C++, 3DS C++)."""
import argparse
import json
from pathlib import Path
import random
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
sys.path.insert(0, str(ROOT / 'backend/tools'))

from core.profile import get_profile, select_profile
from core.sections import active_unbound_slot, refresh_checksum
from modules import bag as bag_mod, money as money_mod, party as party_mod, pc as pc_mod
from modules.change_ledger import ChangeLedger
from tools.mutation_property_regression import fixture

PORTS = ('switch-homebrew', '3ds-homebrew')


def run_python(source: bytes, profile_id: str, bag_off: int, out_prefix: Path):
    select_profile(profile_id)
    profile = get_profile()
    is_unbound = profile_id == 'unbound-2.1.1.1'
    buf = bytearray(source)
    ledger = ChangeLedger()

    # Step 1: Party happiness
    before = bytes(buf)
    party_mod.edit_party_mon_full(buf, 0, {'happiness': 200})
    assert ledger.record(before, buf, 'party_edit', 'Edit Party slot 1') is not None
    out_prefix.with_name(f'{out_prefix.name}-step1.sav').write_bytes(bytes(buf))

    # Step 2: PC slot 1 item
    before = bytes(buf)
    sectors = pc_mod.get_active_pc_sectors(buf)
    stream, headers, originals, preset = pc_mod.rebuild_buffer(buf, sectors)
    slot_raw = bytearray(stream[0:58])
    mon = pc_mod.UnboundPCMon(slot_raw, 1, 1)
    mon.set_item_id(17)
    stream[0:58] = mon.raw
    pc_mod.write_save_HYBRID(buf, sectors, stream, headers, originals, None, preset_buffer=preset)
    assert ledger.record(before, buf, 'pc_edit', 'Edit Box 1 slot 1 item') is not None
    out_prefix.with_name(f'{out_prefix.name}-step2.sav').write_bytes(bytes(buf))

    # Step 3a: Aborted group
    entries_before_abort = len(ledger.summary(buf, source)['entries'])
    ledger.begin_group(buf, 'resources_edit', 'Aborted group')
    buf[:] = money_mod.patch_money_everywhere(bytes(buf), money_mod.clamp_money(777777))
    assert ledger.abort_group(buf) is True
    assert len(ledger.summary(buf, source)['entries']) == entries_before_abort
    out_prefix.with_name(f'{out_prefix.name}-aborted.sav').write_bytes(bytes(buf))

    # Step 3b: Committed group
    ledger.begin_group(buf, 'resources_edit', 'Update Money / BP')
    buf[:] = money_mod.patch_money_everywhere(bytes(buf), money_mod.clamp_money(88888))
    if is_unbound:
        offsets = active_unbound_slot(buf)
        sec4_off = offsets[profile['storage']['resources']['bp_section_id']]['offset']
        party_mod.wu16(buf, sec4_off + profile['storage']['resources']['bp_offset'], 777)
    assert ledger.commit_group(buf) is not None
    out_prefix.with_name(f'{out_prefix.name}-step3.sav').write_bytes(bytes(buf))

    if is_unbound:
        before = bytes(buf)
        bag_mod.write_slot(buf, bag_off, 13, 12, encoding='id_qty')
        assert ledger.record(before, buf, 'bag_edit', 'Edit Bag slot 1') is not None
        assert ledger.has_uncommitted_bag_changes() is True
        ledger.mark_saved()
        assert ledger.has_uncommitted_bag_changes() is False

        before = bytes(buf)
        bag_mod.write_slot(buf, bag_off, 13, 20, encoding='id_qty')
        assert ledger.record(before, buf, 'bag_edit', 'Edit Bag slot 2') is not None
        assert ledger.has_uncommitted_bag_changes() is True
        out_prefix.with_name(f'{out_prefix.name}-step4.sav').write_bytes(bytes(buf))

        ledger.undo(buf)
        out_prefix.with_name(f'{out_prefix.name}-undo4.sav').write_bytes(bytes(buf))
        ledger.undo(buf)

    ledger.undo(buf)
    out_prefix.with_name(f'{out_prefix.name}-undo3.sav').write_bytes(bytes(buf))
    ledger.undo(buf)
    out_prefix.with_name(f'{out_prefix.name}-undo2.sav').write_bytes(bytes(buf))
    ledger.undo(buf)
    assert bytes(buf) == source
    assert not ledger.summary(buf, source)['can_undo']
    out_prefix.with_name(f'{out_prefix.name}-undo1.sav').write_bytes(bytes(buf))

    # Bounded capacity eviction + reset
    small_ledger = ChangeLedger(max_entries=3)
    sbuf = bytearray(source)
    for i in range(6):
        prev = bytes(sbuf)
        sbuf[:] = money_mod.patch_money_everywhere(bytes(sbuf), money_mod.clamp_money(10000 + i))
        small_ledger.record(prev, sbuf, 'bag_edit' if i == 0 else 'money_edit', 'Bounded edit')
    assert len(small_ledger.summary(sbuf, source)['entries']) == 3
    assert small_ledger.has_uncommitted_bag_changes() is True
    small_ledger.reset(sbuf, source)
    assert bytes(sbuf) == source
    assert small_ledger.has_uncommitted_bag_changes() is False

    # Reset after re-edit
    before = bytes(buf)
    buf[:] = money_mod.patch_money_everywhere(bytes(buf), money_mod.clamp_money(424242))
    assert ledger.record(before, buf, 'money_edit', 'Pre-reset edit') is not None
    assert ledger.summary(buf, source)['can_reset'] is True
    ledger.reset(buf, source)
    assert bytes(buf) == source
    out_prefix.with_name(f'{out_prefix.name}-reset.sav').write_bytes(bytes(buf))

    stages = ['step1', 'step2', 'aborted', 'step3']
    if is_unbound:
        stages.extend(['step4', 'undo4'])
    stages.extend(['undo3', 'undo2', 'undo1', 'reset'])
    return stages


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=int, default=20261125)
    args = parser.parse_args()
    rng = random.Random(args.seed)

    select_profile('unbound-2.1.1.1')
    party_mod.load_static_data()
    pc_mod.load_static_data()

    initialized = []
    try:
        for port in PORTS:
            tmp = ROOT / port / 'artifacts/tmp'
            if tmp.exists() and any(tmp.iterdir()):
                raise RuntimeError(f'Preserve existing parity artifacts: {tmp}')
        binaries = []
        core_sources = ('SaveSections', 'SaveHealth', 'ChangeLedger', 'SaveSession', 'Party', 'Pc', 'Money', 'Bag')
        for port in PORTS:
            subprocess.run([str(ROOT / port / 'scripts/parity_tmp.sh'), 'init'], check=True)
            initialized.append(port)
            binary = ROOT / port / 'artifacts/tmp/port/change-ledger'
            subprocess.run([
                'g++', '-std=c++17', '-O1', '-I' + str(ROOT / port / 'include'),
                *[str(ROOT / port / f'source/core/{name}.cpp') for name in core_sources],
                str(ROOT / port / 'source/io/DataLoader.cpp'),
                str(ROOT / 'backend/tools/change_ledger_native.cpp'),
                '-o', str(binary),
            ], check=True)
            binaries.append((port, binary))

        tmp = ROOT / PORTS[0] / 'artifacts/tmp'
        js_cases = []
        expected_stages = []

        for profile_id in ('unbound-2.1.1.1', 'radical-red-4.1'):
            select_profile(profile_id)
            profile = get_profile()
            source_buf, _ = fixture(profile, rng, (40, 41), (7, 3), 16)
            offsets = active_unbound_slot(source_buf)
            sec1_off = offsets[1]['offset']
            # Seed deterministic valid money + BCD so all runtimes choose 0x290 identically on Unbound.
            if profile_id == 'unbound-2.1.1.1':
                source_buf[sec1_off + 0x28D:sec1_off + 0x290] = bytes.fromhex('001000')
                party_mod.wu32(source_buf, sec1_off + 0x290, 1000)
                refresh_checksum(source_buf, sec1_off)
            bag_off = offsets[13]['offset'] + 0x100
            party_mod.wu16(source_buf, bag_off, 13)
            party_mod.wu16(source_buf, bag_off + 2, 3)
            bag_mod.recalculate_checksum(source_buf, bag_off)
            source = bytes(source_buf)

            inp = tmp / f'source/{profile_id}.sav'
            inp.write_bytes(source)

            py_prefix = tmp / f'source/py-{profile_id}'
            stages = run_python(source, profile_id, bag_off, py_prefix)

            for port, binary in binaries:
                port_prefix = ROOT / port / f'artifacts/tmp/port/native-{profile_id}'
                subprocess.run(
                    [str(binary), str(inp), str(port_prefix), profile_id, str(bag_off)],
                    cwd=ROOT / port,
                    check=True,
                )
                for stage in stages:
                    expected_path = py_prefix.with_name(f'{py_prefix.name}-{stage}.sav')
                    actual_path = port_prefix.with_name(f'{port_prefix.name}-{stage}.sav')
                    subprocess.run(
                        [str(ROOT / port / 'scripts/parity_tmp.sh'), 'compare', str(expected_path), str(actual_path)],
                        check=True,
                        stdout=subprocess.DEVNULL,
                    )

            js_prefix = tmp / f'port/js-{profile_id}'
            js_cases.append({
                'profile': profile_id,
                'filename': f'{profile_id}.sav',
                'input': str(inp),
                'bag_offset': bag_off,
                'out_prefix': str(js_prefix),
            })
            expected_stages.append((py_prefix, js_prefix, stages, profile_id))

        manifest_path = tmp / 'source/ledger_cases.json'
        manifest_path.write_text(json.dumps(js_cases))
        subprocess.run(['node', str(ROOT / 'frontend/scripts/change-ledger-runner.mjs'), str(manifest_path)], check=True)
        for py_prefix, js_prefix, stages, profile_id in expected_stages:
            for stage in stages:
                expected = py_prefix.with_name(f'{py_prefix.name}-{stage}.sav').read_bytes()
                actual = js_prefix.with_name(f'{js_prefix.name}-{stage}.sav').read_bytes()
                assert actual == expected, f'JS mismatch at {profile_id}/{stage}'

        print(f'PASS: ChangeLedger parity verified across all 4 runtimes ({len(js_cases)} profiles x all undo/reset/group stages).')
    finally:
        select_profile('unbound-2.1.1.1')
        for port in initialized:
            subprocess.run([str(ROOT / port / 'scripts/parity_tmp.sh'), 'cleanup'], check=True)


if __name__ == '__main__':
    main()
