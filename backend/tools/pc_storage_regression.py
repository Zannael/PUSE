#!/usr/bin/env python3
"""Byte-level Unbound PC regression; synthetic fixtures stay in ignored tmp dirs.

Run from repository root: python3 backend/tools/pc_storage_regression.py
No personal saves, ROMs or network services are required.
"""
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from modules import pc

# Independent serialization oracle: storage RAM blocks mapped through save sectors.
# First block = 19 boxes, auxiliary block = 3 boxes, saveblock1 tail = 2 boxes.
LENGTHS = [4076] + [4080] * 7 + [424, 1252, 3968, 216, 3264]
IDS = list(range(5, 14)) + [30, 31, 2, 3]
STARTS = [4] + [0] * 8 + [2828, 0, 3864, 0]
DOMAIN = {0: 3876, 4: 3480, 13: 1104}


def checksum(data):
    total = sum(struct.unpack('<' + 'I' * (len(data) // 4), data)) & 0xFFFFFFFF
    return ((total >> 16) + (total & 65535)) & 65535


def slot_offsets(slot, rotation):
    return {sid: (slot * 14 + (sid + rotation) % 14) * 4096 for sid in range(14)}


def locations(offsets):
    return [(offsets[sid] + start if sid < 14 else sid * 4096 + start, length)
            for sid, start, length in zip(IDS, STARTS, LENGTHS)]


def scatter(save, offsets, stream):
    cursor = 0
    for off, length in locations(offsets):
        save[off:off + length] = stream[cursor:cursor + length]
        cursor += length
    assert cursor == len(stream) == 41760


def refresh(save, offsets):
    for sid, off in offsets.items():
        struct.pack_into('<H', save, off + 4086, checksum(save[off:off + DOMAIN.get(sid, 4080)]))


def fixture(counters=(40, 41), rotations=(7, 3)):
    save = bytearray([0xA5] * 131088)
    stream = bytearray(41760)
    for i in range(720):
        raw = bytearray((i * 17 + j * 13) % 256 for j in range(58))
        struct.pack_into('<H', raw, 28, i % 1200 + 1)
        struct.pack_into('<I', raw, 32, i + 1000)
        stream[i * 58:(i + 1) * 58] = raw
    # Explicit empties, including slots next to each boundary.
    for i in {0, 719} | {sum(LENGTHS[:j]) // 58 + 1 for j in range(1, len(LENGTHS))}:
        if i < 720: stream[i * 58:(i + 1) * 58] = bytes(58)
    all_offsets = []
    for slot in range(2):
        offsets = slot_offsets(slot, rotations[slot]); all_offsets.append(offsets)
        for sid, off in offsets.items():
            save[off:off + 4096] = bytes(4096)
            # Distinct footer word must never become PC data or checksum input.
            struct.pack_into('<IHHII', save, off + 4080, 0xAABBCCDD, sid, 0, 0x01121999, counters[slot])
        scatter(save, offsets, stream)
        # Populate disputed section-0 checksum range and the opaque section-4 tail.
        save[offsets[0] + 0xADC:offsets[0] + 0xF24] = bytes([7]) * (0xF24 - 0xADC)
        save[offsets[4] + 0xD98:offsets[4] + 0xFF0] = bytes([11]) * (0xFF0 - 0xD98)
        refresh(save, offsets)
    return save, stream, all_offsets


def backend_result(source, edited=None):
    out = bytearray(source)
    sectors = pc.get_active_pc_sectors(out)
    if not sectors: return None, None
    try:
        stream, headers, originals, preset = pc.rebuild_buffer(out, sectors)
    except ValueError:
        return None, None
    gathered = bytes(stream)
    if edited is not None: stream[:] = edited
    pc.write_save_HYBRID(out, sectors, stream, headers, originals, None, preset)
    return bytes(out), gathered


def main():
    ports = ['switch-homebrew', '3ds-homebrew']
    for port in ports:
        existing = ROOT / port / 'artifacts/tmp'
        if existing.exists() and any(existing.iterdir()):
            raise RuntimeError(f'{existing} is not empty; preserve existing parity artifacts before running')
    for port in ports:
        subprocess.run([str(ROOT / port / 'scripts/parity_tmp.sh'), 'init'], check=True)
    tmp = ROOT / ports[0] / 'artifacts/tmp'
    try:
        binaries = []
        for port in ports:
            binary = ROOT / port / 'artifacts/tmp/port/pc_storage'
            subprocess.run(['g++', '-std=c++17', '-O1', '-I' + str(ROOT / port / 'include'),
                *[str(ROOT / port / f'source/core/{name}.cpp') for name in ['Pc', 'Party', 'SaveSections', 'Money', 'Bag']],
                str(ROOT / port / 'source/io/DataLoader.cpp'), str(ROOT / port / 'tests/pc_storage_parity.cpp'),
                '-o', str(binary)], check=True)
            binaries.append(binary)
        source, stream, offsets = fixture()
        from core.sections import refresh_checksum
        protected = bytearray(source)
        for off in (offsets[1][4], 30 * 4096, 31 * 4096): refresh_checksum(protected, off)
        assert protected == source, 'Opaque and auxiliary reconciliation must be a no-op'
        edits = bytearray(stream)
        crossing = {sum(LENGTHS[:j]) // 58 for j in range(1, len(LENGTHS))}
        for index in crossing:
            # Replace entire occupied crossing record, including both fragments.
            assert pc.UnboundPCMon(stream[index * 58:(index + 1) * 58], 0, 0).is_valid
            edits[index * 58:(index + 1) * 58] = bytes(58)
        edits[0:58] = stream[58:116]  # Insert into an explicitly empty slot.
        cases = [('noop', source, None, offsets[1]), ('boundaries', source, edits, offsets[1])]
        rollover, _, roll_offsets = fixture((0xFFFFFFFF, 0))
        cases.append(('rollover', rollover, edits, roll_offsets[1]))
        wrapped, _, wrapped_offsets = fixture((0xFFFFFFFE, 1), (0, 13))
        cases.append(('wrapped-rotation', wrapped, edits, wrapped_offsets[1]))
        reverse, _, reverse_offsets = fixture((41, 40), (13, 0))
        cases.append(('first-slot-newer', reverse, edits, reverse_offsets[0]))
        truncated = bytearray(source[:31 * 4096])
        cases.append(('truncated-auxiliary', truncated, None, None))
        for kind in ['checksum', 'signature', 'duplicate', 'counter']:
            bad = bytearray(source); off = offsets[1][6]
            if kind == 'checksum': bad[off + 3] ^= 1
            elif kind == 'signature': struct.pack_into('<I', bad, off + 0xFF8, 0)
            elif kind == 'duplicate': struct.pack_into('<H', bad, off + 0xFF4, 5)
            else: struct.pack_into('<I', bad, off + 0xFFC, 99)
            cases.append((kind, bad, edits, offsets[0]))
        opaque = bytearray(source); opaque[offsets[1][4] + 0xE89] ^= 0x20
        cases.append(('opaque', opaque, None, offsets[1]))
        invalid = bytearray(source)
        for slot in offsets: struct.pack_into('<I', invalid, slot[5] + 0xFF8, 0)
        cases.append(('invalid', invalid, None, None))
        for name, data, changed, chosen in cases:
            inp = tmp / 'source/input.sav'; inp.write_bytes(data)
            patch = tmp / 'source/edit.bin'
            if changed is not None: patch.write_bytes(changed)
            expected, gathered = backend_result(data, changed)
            if chosen is None: assert expected is None
            else:
                assert gathered == stream, name
                oracle = bytearray(data)
                if changed is not None:
                    scatter(oracle, chosen, changed)
                    # Only domains containing changes get new checksums.
                    for sid in range(14):
                        off = chosen[sid]
                        if oracle[off:off + 4080] != data[off:off + 4080]:
                            struct.pack_into('<H', oracle, off + 4086, checksum(oracle[off:off + DOMAIN.get(sid, 4080)]))
                assert expected == oracle, name
                assert expected[-16:] == data[-16:]
                (tmp / 'source/expected.sav').write_bytes(expected)
            commands = [[ 'node', str(ROOT / 'frontend/scripts/pc-storage-runner.mjs')]] + [[str(binary)] for binary in binaries]
            for n, command in enumerate(commands):
                out = tmp / f'port/result{n}.sav'
                result = subprocess.run(command + [str(inp), str(patch) if changed is not None else 'noop', str(out)], capture_output=True)
                if chosen is None: assert result.returncode == 3, (name, command, result.stderr)
                else:
                    assert result.returncode == 0, (name, command, result.stderr)
                    assert Path(str(out) + '.stream').read_bytes() == gathered
                    expected_counts = [sum(pc.UnboundPCMon(gathered[(box*30+slot)*58:(box*30+slot+1)*58], box+1, slot+1).is_valid for slot in range(30)) for box in range(24)]
                    assert list(map(int, Path(str(out)+'.counts').read_text().split())) == expected_counts, (name, command, '24-box readers')
                    subprocess.run([str(ROOT / ports[0] / 'scripts/parity_tmp.sh'), 'compare',
                        str(tmp / 'source/expected.sav'), str(out)], check=True, stdout=subprocess.DEVNULL)
            print('PASS:', name)
        # Whole-save reconciliation must keep the PC generation across other features.
        import contextlib, io
        from core.sections import active_sections
        from modules import money, bag
        with contextlib.redirect_stdout(io.StringIO()):
            from main import _finalize_save_bytes
        for name, data, _, chosen in cases:
            if chosen is None: continue
            data = bytearray(data)
            for slot_no, offmap in enumerate(offsets if name not in ('rollover', 'wrapped-rotation', 'first-slot-newer') else
                                             (roll_offsets if name == 'rollover' else wrapped_offsets if name == 'wrapped-rotation' else reverse_offsets)):
                struct.pack_into('<I', data, offmap[1] + 0x290, 10000 + slot_no)
                struct.pack_into('<HH', data, offmap[13]+0x1A8, 1, 2)
                struct.pack_into('<H', data, offmap[13]+0xFF6, checksum(data[offmap[13]:offmap[13]+1104]))
                # Preserve deliberate damaged section 6 while updating trainer integrity.
                struct.pack_into('<H', data, offmap[1] + 0xFF6, checksum(data[offmap[1]:offmap[1]+4080]))
            original = bytes(data)
            selected = active_sections(data)
            assert next(sec['off'] for sec in selected if sec['id'] == 1) == chosen[1], name
            expected_money = pc.ru32(data, chosen[1]+0x290)
            with contextlib.redirect_stdout(io.StringIO()):
                candidate = bytearray(data)
                bag.write_slot(candidate, chosen[13]+0x1A8, 1, 9, "id_qty")
                assert pc.active_pc_slot(candidate)[1]["offset"] == chosen[1], name
                expected = bytearray(money.patch_money_everywhere(candidate, 123456))
                _finalize_save_bytes(expected, {})
            inactive = 14*4096 if chosen[1] < 14*4096 else 0
            assert expected[inactive:inactive+14*4096] == original[inactive:inactive+14*4096], name
            assert pc.active_pc_slot(expected)[1]['offset'] == chosen[1], name
            inp.write_bytes(data)
            for n, command in enumerate(commands):
                result_path = tmp / f'port/finalized{n}.sav'
                result = subprocess.run(command+[str(inp), 'finalize', str(result_path)], capture_output=True)
                assert result.returncode == 0, (name, command, result.stderr)
                assert result_path.read_bytes() == expected, (name, command, 'finalization bytes')
                assert Path(str(result_path)+'.money').read_text() == str(expected_money), name
            print('PASS: shared selection and save-all:', name)
        # Preset merging and disputed domains: unchanged edits made after PC load survive.
        out = bytearray(source); sectors = pc.get_active_pc_sectors(out)
        buf, headers, originals, preset = pc.rebuild_buffer(out, sectors)
        preset[0xB0 + 25] = 70
        off0 = offsets[1][0]; out[off0 + 0xAE0] ^= 1
        pc.write_save_HYBRID(out, sectors, buf, headers, originals, None, preset)
        assert out[off0 + 0xAE0] == (source[off0 + 0xAE0] ^ 1)
        assert pc.ru16(out, off0 + 0xFF6) == checksum(out[off0:off0 + 0xF24])
        assert checksum(out[off0:off0 + 0xADC]) != pc.ru16(out, off0 + 0xFF6)
        inp.write_bytes(source)
        result_path = tmp / 'port/preset.sav'
        subprocess.run(['node', str(ROOT / 'frontend/scripts/pc-storage-runner.mjs'),
            str(inp), 'preset', str(result_path)], check=True)
        assert result_path.read_bytes() == out
        from modules.save_health import build_save_report
        report = build_save_report(source, out)
        assert all(row['status'] in ('ok', 'opaque') for row in report['checksums'])
        # Controlled input changes distinguish covered bytes from parasite/footer tails.
        for sid, covered, excluded in [(0, 0xADC, 0xF24), (13, 0x44C, 0x450), (5, 0xFEC, 0xFF0)]:
            off = offsets[1][sid]; original_chk = pc.ru16(source, off + 0xFF6)
            inside = bytearray(source); inside[off + covered] ^= 1
            outside = bytearray(source); outside[off + excluded] ^= 1
            assert checksum(inside[off:off + DOMAIN.get(sid, 4080)]) != original_chk
            assert checksum(outside[off:off + DOMAIN.get(sid, 4080)]) == original_chk
        print('PASS: preset merge, disputed checksum domains, and footer exclusions')
        print('All PC storage byte regressions passed across four runtimes.')
    finally:
        for port in ports: subprocess.run([str(ROOT / port / 'scripts/parity_tmp.sh'), 'cleanup'], check=True)


if __name__ == '__main__': main()
