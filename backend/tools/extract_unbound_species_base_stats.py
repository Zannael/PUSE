#!/usr/bin/env python3
"""Extract species base stats from Pokemon Unbound ROM.

The output is a JSON object keyed by species id (as strings), each value:
{ "hp", "atk", "def", "spe", "spa", "spd" }.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from core.data_loader import data_path


SPECIES_STRUCT_SIZE = 0x1C

# Gen 3 base-stat order in species table.
OFF_HP = 0
OFF_ATK = 1
OFF_DEF = 2
OFF_SPE = 3
OFF_SPA = 4
OFF_SPD = 5


def load_species_ids() -> list[int]:
    ids: list[int] = []
    text = data_path("pokemon.txt").read_text(encoding="utf-8", errors="ignore")
    for raw in text.splitlines():
        line = raw.strip()
        if not line or ":" not in line:
            continue
        left = line.split(":", 1)[0].strip()
        if not left.isdigit():
            continue
        sid = int(left)
        if sid > 0:
            ids.append(sid)
    return sorted(set(ids))


def find_species_table_base(rom: bytes) -> int:
    bulba = bytes([45, 49, 49, 45, 65, 65])
    ivysaur = bytes([60, 62, 63, 60, 80, 80])
    venusaur = bytes([80, 82, 83, 80, 100, 100])
    charmander = bytes([39, 52, 43, 65, 60, 50])

    start = 0
    while True:
        pos = rom.find(bulba, start)
        if pos < 0:
            break

        ok = True
        checks = [ivysaur, venusaur, charmander]
        for idx, expected in enumerate(checks, start=1):
            probe = pos + (idx * SPECIES_STRUCT_SIZE)
            if probe + len(expected) > len(rom) or rom[probe: probe + len(expected)] != expected:
                ok = False
                break

        if ok:
            return pos

        start = pos + 1

    raise RuntimeError("Species base stat table not found in ROM")


def extract_base_stats(rom: bytes, table_base: int, species_ids: list[int]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}

    for sid in species_ids:
        off = table_base + ((sid - 1) * SPECIES_STRUCT_SIZE)
        if off + SPECIES_STRUCT_SIZE > len(rom):
            continue

        out[str(sid)] = {
            "hp": rom[off + OFF_HP],
            "atk": rom[off + OFF_ATK],
            "def": rom[off + OFF_DEF],
            "spe": rom[off + OFF_SPE],
            "spa": rom[off + OFF_SPA],
            "spd": rom[off + OFF_SPD],
        }

    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract Unbound species base stats")
    parser.add_argument("rom", type=Path, help="Path to Unbound.gba")
    parser.add_argument(
        "--out",
        type=Path,
        default=data_path("species_base_stats.json"),
        help="Output JSON path",
    )
    args = parser.parse_args()

    rom = args.rom.read_bytes()
    species_ids = load_species_ids()
    base = find_species_table_base(rom)
    stats = extract_base_stats(rom, base, species_ids)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(stats, indent=2, sort_keys=True), encoding="utf-8")

    print(f"[OK] Found species table base at 0x{base:X}")
    print(f"[OK] Wrote {len(stats)} species base stat entries -> {args.out}")


if __name__ == "__main__":
    main()
