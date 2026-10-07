#!/usr/bin/env python3
"""Optional game validation using a private ROM/save and the headless mGBA probe.

Requires the verified English 2.1.1.1 ROM and the locally used overworld fixture
whose Start menu initially selects Pokedex. Never modifies supplied inputs.
Build unbound_emulator_probe.c first (instructions in the implementation plan).
"""
import argparse
import hashlib
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core.sections import active_unbound_slot, refresh_checksum
from modules import pc

ROM_SHA256 = '7aa25bbf568f7cfcf6ee1cf2e9e6ff637350b3d0705c2375cabb6baa7d9739f7'
BOOT = 'frames 1800 0\nframes 8 8\nframes 180 0\nframes 8 1\nframes 600 0\n'
SAVE_GAME = ('frames 8 8\nframes 60 0\n' + 'frames 8 16\nframes 30 0\n' * 4 +
             'frames 8 1\nframes 90 0\nframes 8 1\nframes 120 0\nframes 8 64\n'
             'frames 30 0\nframes 8 1\nframes 900 0\n')
RAM_BLOCKS = [(0x02029318, 33060, 'main'), (0x0203CB44, 5220, 'auxiliary'),
              (0x02027434, 3480, 'tail'), (0x02024638, 1740, 'preset'),
              (0x020315F5, 9, 'preset_name')]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', required=True, type=Path)
    parser.add_argument('--save', required=True, type=Path)
    parser.add_argument('--probe', required=True, type=Path)
    parser.add_argument('--keep-tmp', action='store_true')
    args = parser.parse_args()
    assert hashlib.sha256(args.rom.read_bytes()).hexdigest() == ROM_SHA256, 'Unverified ROM'
    source = args.save.read_bytes()
    tmp = Path(tempfile.mkdtemp(prefix='puse-unbound-game-'))
    try:
        def run(data, name, save_game=False, acknowledge=False):
            inp = tmp / f'{name}.sav'
            inp.write_bytes(data)
            commands = BOOT
            if acknowledge:
                commands += 'frames 8 1\nframes 120 0\nframes 8 1\nframes 120 0\n'
            commands += ''.join(f'read {address:x} {size} {tmp / label}.bin\n'
                                for address, size, label in RAM_BLOCKS)
            if save_game:
                commands += SAVE_GAME + f'save {tmp / "roundtrip.sav"}\n'
            subprocess.run([str(args.probe.resolve()), str(args.rom.resolve()), str(inp)],
                           input=(commands + 'quit\n').encode(), check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            stream, _, _, preset = pc.rebuild_buffer(data, pc.get_active_pc_sectors(data))
            actual = b''.join((tmp / f'{label}.bin').read_bytes() for label in ('main', 'auxiliary', 'tail'))
            assert actual == stream, f'{name}: game PC RAM differs'
            assert (tmp / 'preset.bin').read_bytes() == preset[0xB0:0x77C], f'{name}: preset RAM differs'
            assert pc.decode_text((tmp / 'preset_name.bin').read_bytes()) == 'Preset', 'Final box label'
            print('PASS:', name)

        run(source, 'baseline')
        data = bytearray(source)
        sectors = pc.get_active_pc_sectors(data)
        stream, headers, originals, preset = pc.rebuild_buffer(data, sectors)
        record = stream[58:116]
        assert pc.UnboundPCMon(record, 1, 2).is_valid, 'Fixture needs an occupied Box 1 slot 2'
        lengths = [end - start for _, start, end in pc.PC_REGIONS]
        for index in {sum(lengths[:j]) // 58 for j in range(1, len(lengths))}:
            stream[index * 58:(index + 1) * 58] = record
            stream[index * 58 + 25] = index % 256
        preset[0xB0:0xB0 + 58] = record
        preset[0xB0 + 25] = 71
        pc.write_save_HYBRID(data, sectors, stream, headers, originals, None, preset)
        run(data, 'boundary-and-preset-edits', save_game=True)
        roundtrip = (tmp / 'roundtrip.sav').read_bytes()
        slot = active_unbound_slot(roundtrip)
        assert slot[0]['idx'] != sectors[0]['idx'], 'Game did not save; fixture/menu sequence unsupported'
        gathered, _, _, final = pc.rebuild_buffer(roundtrip, pc.get_active_pc_sectors(roundtrip))
        assert gathered == stream and final[0xB0:0x77C] == preset[0xB0:0x77C], 'Game save lost records'
        run(roundtrip, 'fresh-reboot')
        for name in ('damaged-new', 'rollover', 'wrapped-gap', 'included-stale', 'included-fixed', 'excluded', 'signature-1998'):
            candidate = bytearray(source)
            slot = active_unbound_slot(candidate)
            off = slot[0]['offset']
            base = off // (14 * 4096) * (14 * 4096)
            if name == 'damaged-new':
                candidate[slot[6]['offset'] + 3] ^= 1
            elif name in ('rollover', 'wrapped-gap'):
                for block in (0, 14 * 4096):
                    for i in range(14):
                        struct.pack_into('<I', candidate, block + i * 4096 + 0xFFC,
                                         (0 if block == base else 0xFFFFFFFF) if name == 'rollover' else
                                         (1 if block == base else 0xFFFFFFFE))
            elif name.startswith('included'):
                candidate[off + 0xADC] ^= 1
                if name == 'included-fixed': refresh_checksum(candidate, off)
            elif name == 'excluded':
                candidate[off + 0xF24] ^= 1
            else:
                for block in (0, 14 * 4096):
                    for i in range(14):
                        struct.pack_into('<I', candidate, block + i * 4096 + 0xFF8, 0x01121998)
            run(candidate, name, acknowledge=True)
        print('Game validation passed; source ROM/save were read only.')
    finally:
        if args.keep_tmp: print('Private temporary artifacts:', tmp)
        else: shutil.rmtree(tmp)


if __name__ == '__main__': main()
