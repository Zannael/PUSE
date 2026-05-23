#!/usr/bin/env python3
import argparse
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from modules.party import (
    Pokemon,
    TRAINER_SECTION_ID,
    calculate_section_checksum,
    ru16,
    ru32,
    wu16,
)

SECTION_SIZE = 0x1000
PARTY_OFFSET = 0x38
PARTY_MON_SIZE = 100


def fix_save(src_path, out_path):
    data = bytearray(Path(src_path).read_bytes())

    trainer_sections = []
    for sec_idx in range(len(data) // SECTION_SIZE):
        sec_off = sec_idx * SECTION_SIZE
        sec_id = ru16(data, sec_off + 0xFF4)
        if sec_id == TRAINER_SECTION_ID:
            save_idx = ru32(data, sec_off + 0xFFC)
            trainer_sections.append((save_idx, sec_off))

    if not trainer_sections:
        raise RuntimeError("No trainer sections found")

    trainer_sections.sort(reverse=True)
    active_off = trainer_sections[0][1]
    team_count = min(6, ru32(data, active_off + 0x34))

    packed_party = []
    for i in range(team_count):
        mon_off = active_off + PARTY_OFFSET + i * PARTY_MON_SIZE
        pk = Pokemon(data[mon_off:mon_off + PARTY_MON_SIZE])
        packed_party.append(pk.pack_data())

    # Mirror same fixed team data in every trainer-section copy.
    for _, sec_off in trainer_sections:
        section = bytearray(data[sec_off:sec_off + SECTION_SIZE])
        for i, mon_raw in enumerate(packed_party):
            dst = PARTY_OFFSET + i * PARTY_MON_SIZE
            section[dst:dst + PARTY_MON_SIZE] = mon_raw
        new_chk = calculate_section_checksum(section)
        wu16(section, 0xFF6, new_chk)
        data[sec_off:sec_off + SECTION_SIZE] = section

    Path(out_path).write_bytes(data)


def main():
    parser = argparse.ArgumentParser(description="Fix party mon checksums in a .sav file")
    parser.add_argument("src", help="Input .sav")
    parser.add_argument("out", help="Output .sav")
    args = parser.parse_args()

    fix_save(args.src, args.out)
    print(f"Wrote fixed save: {args.out}")


if __name__ == "__main__":
    main()
