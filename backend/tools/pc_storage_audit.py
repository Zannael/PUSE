#!/usr/bin/env python3
"""Read-only, aggregate PC evidence; never print record/owner contents or write inputs."""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from modules import pc


def references(data, pointer):
    needle = struct.pack('<I', pointer)
    return [hex(off) for off in range(0, len(data) - 3, 4) if data[off:off + 4] == needle]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path)
    parser.add_argument('saves', nargs='*', type=Path)
    args = parser.parse_args()
    result = {'method': 'Read-only ROM table references and aggregate save-boundary comparison', 'saves': []}
    if args.rom:
        data = args.rom.read_bytes()
        rows = [(0, 0xF24), (0, 0xFF0), (0xFF0, 0xFF0), (0x1FE0, 0xFF0), (0x2FD0, 0xD98)]
        rows += [(i * 0xFF0, 0xFF0) for i in range(8)] + [(0x7F80, 0x450)]
        pattern = b''.join(struct.pack('<HH', *row) for row in rows)
        tables = []
        start = 0
        while (start := data.find(pattern, start)) >= 0:
            tables.append({'offset': hex(start), 'aligned_references': references(data, 0x08000000 + start)})
            start += 1
        result['rom'] = {'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data), 'save_size_tables': tables,
            'box_pointer_table_references': references(data, 0x08A6CB2C),
            'version_note': 'A hash/table match alone is not a save version detector; see milestone evidence.'}
    for path in args.saves:
        data = path.read_bytes()
        sectors = pc.get_active_pc_sectors(data)
        entry = {'fixture': path.name, 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}
        if sectors:
            stream, _, _, preset = pc.rebuild_buffer(data, sectors)
            offsets = {sec['id']: sec['offset'] for sec in sectors}
            legacy = b''.join(data[offsets[sid] + 4:offsets[sid] + 0xFF4] for sid in range(5, 13))
            entry.update(counter=sectors[0]['idx'], slot=sectors[0]['offset'] // (14 * 4096),
                legacy_differing_records=[i + 1 for i in range(len(legacy) // 58)
                    if legacy[i * 58:(i + 1) * 58] != stream[i * 58:(i + 1) * 58]],
                occupied_counts=[sum(pc.UnboundPCMon(stream[(box * 30 + slot) * 58:(box * 30 + slot + 1) * 58], box + 1, slot + 1).is_valid
                    for slot in range(30)) for box in range(24)],
                preset_occupied=sum(pc.UnboundPCMon(preset[0xB0 + slot * 58:0xB0 + (slot + 1) * 58], 26, slot + 1).is_valid for slot in range(30)),
                section0_disputed_range_nonzero=any(preset[0xADC:0xF24]))
        else:
            entry['error'] = 'No intact coherent PC slot'
        result['saves'].append(entry)
    print(json.dumps(result, indent=2))


if __name__ == '__main__': main()
