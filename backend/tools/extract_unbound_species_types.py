#!/usr/bin/env python3
"""Extract species type data from Pokemon Unbound ROM.

Unbound/CFRU keeps the Gen 3 type ids, with Fairy added at 0x17. The gaps
between Dark and Fairy are intentional and must not be collapsed.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from core.data_loader import backend_root, data_path


SPECIES_STRUCT_SIZE = 0x1C
OFF_TYPE1 = 0x06
OFF_TYPE2 = 0x07

TYPE_NAMES = {
    0x00: "Normal",
    0x01: "Fighting",
    0x02: "Flying",
    0x03: "Poison",
    0x04: "Ground",
    0x05: "Rock",
    0x06: "Bug",
    0x07: "Ghost",
    0x08: "Steel",
    0x09: "Mystery",
    0x0A: "Fire",
    0x0B: "Water",
    0x0C: "Grass",
    0x0D: "Electric",
    0x0E: "Psychic",
    0x0F: "Ice",
    0x10: "Dragon",
    0x11: "Dark",
    0x17: "Fairy",
}

FRONTEND_CORE = backend_root().parent / "frontend" / "src" / "core"


def load_species_ids() -> list[int]:
    path = data_path("species_table_from_rom.json")
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("species")
        if isinstance(rows, list):
            ids = [int(row["species_id"]) for row in rows if "species_id" in row]
            if ids:
                return sorted(set(ids))

    ids: list[int] = []
    for raw in data_path("pokemon.txt").read_text(
        encoding="utf-8",
        errors="ignore",
    ).splitlines():
        line = raw.strip()
        if not line or ":" not in line:
            continue
        left = line.split(":", 1)[0].strip()
        if left.isdigit():
            ids.append(int(left))
    return sorted(set(ids))


def find_species_table_base(rom: bytes) -> int:
    bulbasaur = bytes([45, 49, 49, 45, 65, 65])
    ivysaur = bytes([60, 62, 63, 60, 80, 80])
    venusaur = bytes([80, 82, 83, 80, 100, 100])
    charmander = bytes([39, 52, 43, 65, 60, 50])

    start = 0
    while True:
        pos = rom.find(bulbasaur, start)
        if pos < 0:
            break

        checks = [ivysaur, venusaur, charmander]
        if all(
            rom[
                pos + (idx * SPECIES_STRUCT_SIZE):
                pos + (idx * SPECIES_STRUCT_SIZE) + len(expected)
            ] == expected
            for idx, expected in enumerate(checks, start=1)
        ):
            return pos

        start = pos + 1

    raise RuntimeError("Species base stat table not found in ROM")


def type_name(type_id: int) -> str:
    try:
        return TYPE_NAMES[type_id]
    except KeyError as exc:
        raise RuntimeError(f"Unknown species type id 0x{type_id:02X}") from exc


def extract_species_types(rom: bytes, table_base: int, species_ids: list[int]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for species_id in species_ids:
        offset = table_base + ((species_id - 1) * SPECIES_STRUCT_SIZE)
        if offset + SPECIES_STRUCT_SIZE > len(rom):
            continue

        type1_id = int(rom[offset + OFF_TYPE1]) & 0xFF
        type2_id = int(rom[offset + OFF_TYPE2]) & 0xFF
        type1 = type_name(type1_id)
        type2 = type_name(type2_id)
        types = [type1]
        if type2_id != type1_id and type2 != "Mystery":
            types.append(type2)

        out[str(species_id)] = {
            "type1": type1,
            "type2": type2,
            "types": types,
            "type1_id": type1_id,
            "type2_id": type2_id,
        }
    return out


def write_json(path: Path, payload: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract Unbound species types")
    parser.add_argument("rom", type=Path, help="Path to Unbound.gba")
    parser.add_argument(
        "--backend-out",
        type=Path,
        default=data_path("species_types.json"),
        help="Canonical backend output path",
    )
    parser.add_argument(
        "--frontend-out",
        type=Path,
        default=FRONTEND_CORE / "speciesTypes.json",
        help="Frontend mirror output path",
    )
    parser.add_argument(
        "--no-frontend",
        action="store_true",
        help="Only write the canonical backend data file",
    )
    args = parser.parse_args()

    rom = args.rom.read_bytes()
    table_base = find_species_table_base(rom)
    payload = extract_species_types(rom, table_base, load_species_ids())
    write_json(args.backend_out, payload)
    print(f"[OK] Found species table base at 0x{table_base:X}")
    print(f"[OK] Wrote {len(payload)} species type entries -> {args.backend_out}")

    if not args.no_frontend:
        write_json(args.frontend_out, payload)
        print(f"[OK] Mirrored species types -> {args.frontend_out}")


if __name__ == "__main__":
    main()
