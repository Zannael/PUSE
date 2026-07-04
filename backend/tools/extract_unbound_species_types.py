#!/usr/bin/env python3
"""Extract species types from Pokemon Unbound ROM species data table."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from core.data_loader import data_path

SPECIES_STRUCT_SIZE = 0x1C
OFF_TYPE1 = 0x06
OFF_TYPE2 = 0x07

G3_TYPE_NAMES = [
    "Normal",
    "Fighting",
    "Flying",
    "Poison",
    "Ground",
    "Rock",
    "Bug",
    "Ghost",
    "Steel",
    "Mystery",
    "Fire",
    "Water",
    "Grass",
    "Electric",
    "Psychic",
    "Ice",
    "Dragon",
    "Dark",
    "Fairy",
]


def load_species_ids() -> list[int]:
    payload = json.loads(data_path("species_table_from_rom.json").read_text(encoding="utf-8"))
    count = int(payload.get("species_count") or 0)
    if count > 0:
        return list(range(1, count + 1))
    ids: list[int] = []
    text = data_path("pokemon.txt").read_text(encoding="utf-8", errors="ignore")
    for raw in text.splitlines():
        line = raw.strip()
        if not line or ":" not in line:
            continue
        left = line.split(":", 1)[0].strip()
        if left.isdigit():
            ids.append(int(left))
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
        for idx, expected in enumerate([ivysaur, venusaur, charmander], start=1):
            probe = pos + (idx * SPECIES_STRUCT_SIZE)
            if probe + len(expected) > len(rom) or rom[probe: probe + len(expected)] != expected:
                ok = False
                break
        if ok:
            return pos
        start = pos + 1
    raise RuntimeError("Species base stat table not found in ROM")


def type_name(type_id: int) -> str:
    if 0 <= type_id < len(G3_TYPE_NAMES):
        return G3_TYPE_NAMES[type_id]
    return f"Unknown({type_id})"


def extract_species_types(rom: bytes, table_base: int, species_ids: list[int]) -> dict[str, dict[str, str | list[str]]]:
    out: dict[str, dict[str, str | list[str]]] = {}
    for sid in species_ids:
        off = table_base + ((sid - 1) * SPECIES_STRUCT_SIZE)
        if off + OFF_TYPE2 >= len(rom):
            continue
        type1 = int(rom[off + OFF_TYPE1]) & 0xFF
        type2 = int(rom[off + OFF_TYPE2]) & 0xFF
        types = [type_name(type1)]
        if type2 != type1 and type2 != 0xFF and type_name(type2) != "Mystery":
            types.append(type_name(type2))
        out[str(sid)] = {
            "type1": type_name(type1),
            "type2": type_name(type2) if type2 != type1 else type_name(type1),
            "types": types,
        }
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract Unbound species types")
    parser.add_argument("rom", type=Path, help="Path to Unbound.gba")
    parser.add_argument(
        "--out",
        type=Path,
        default=data_path("species_types.json"),
        help="Output JSON path",
    )
    args = parser.parse_args()

    rom = args.rom.read_bytes()
    species_ids = load_species_ids()
    table_base = find_species_table_base(rom)
    types = extract_species_types(rom, table_base, species_ids)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(types, indent=2, sort_keys=True), encoding="utf-8")
    print(f"[OK] Found species table base at 0x{table_base:X}")
    print(f"[OK] Wrote {len(types)} species type entries -> {args.out}")


if __name__ == "__main__":
    main()
