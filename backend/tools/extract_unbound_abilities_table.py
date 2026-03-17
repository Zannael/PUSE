#!/usr/bin/env python3
"""Extract Pokemon Unbound ability names from ROM.

Outputs:
- Diagnostic JSON table with offsets/raw bytes
- Canonical runtime TXT file (`id:name`)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from core.data_loader import data_path


ABILITY_NAME_ENTRY_SIZE = 17
SPECIES_STRUCT_SIZE = 0x1C
OFF_ABILITY_1 = 0x16
OFF_ABILITY_2 = 0x17


def build_charmap() -> dict[int, str]:
    decode: dict[int, str] = {
        0x00: " ",
        0xAE: "-",
        0xB4: "'",
        0xF0: ":",
        0xFF: "",
    }
    for i, c in enumerate("0123456789"):
        decode[0xA1 + i] = c
    for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
        decode[0xBB + i] = c
    for i, c in enumerate("abcdefghijklmnopqrstuvwxyz"):
        decode[0xD5 + i] = c
    return decode


DECODE = build_charmap()
ENCODE = {v: k for k, v in DECODE.items() if v and len(v) == 1}


def encode_name(name: str) -> bytes:
    out = []
    for ch in name:
        b = ENCODE.get(ch)
        if b is None:
            raise ValueError(f"Unsupported char {ch!r} for ROM encoding")
        out.append(b)
    out.append(0xFF)
    return bytes(out)


def decode_name(entry: bytes) -> str:
    out = []
    for b in entry:
        if b == 0xFF:
            break
        out.append(DECODE.get(b, "?"))
    return "".join(out).strip()


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


def infer_ability_count_from_species(rom: bytes, species_base: int, species_ids: list[int]) -> int:
    max_ability = 0
    for sid in species_ids:
        off = species_base + ((sid - 1) * SPECIES_STRUCT_SIZE)
        if off + SPECIES_STRUCT_SIZE > len(rom):
            continue
        a1 = int(rom[off + OFF_ABILITY_1]) & 0xFF
        a2 = int(rom[off + OFF_ABILITY_2]) & 0xFF
        max_ability = max(max_ability, a1, a2)
    if max_ability <= 0:
        raise RuntimeError("Could not infer ability count from species table")
    return max_ability


def find_abilities_table_base(rom: bytes) -> int:
    a1 = encode_name("Stench")
    a2 = encode_name("Drizzle")
    a3 = encode_name("Speed Boost")

    cursor = 0
    while True:
        pos = rom.find(a1, cursor)
        if pos < 0:
            break
        p2 = pos + ABILITY_NAME_ENTRY_SIZE
        p3 = p2 + ABILITY_NAME_ENTRY_SIZE
        if p3 + len(a3) > len(rom):
            break
        if rom[p2: p2 + len(a2)] == a2 and rom[p3: p3 + len(a3)] == a3:
            return pos
        cursor = pos + 1

    raise RuntimeError("Could not locate ability-name table base in ROM")


def extract_abilities(rom: bytes, base: int, ability_count: int) -> list[dict]:
    out: list[dict] = []
    for ability_id in range(1, ability_count + 1):
        off = base + (ability_id - 1) * ABILITY_NAME_ENTRY_SIZE
        if off + ABILITY_NAME_ENTRY_SIZE > len(rom):
            break
        entry = rom[off: off + ABILITY_NAME_ENTRY_SIZE]
        out.append(
            {
                "ability_id": ability_id,
                "offset": off,
                "name": decode_name(entry),
                "raw_hex": entry.hex(),
            }
        )
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract Unbound ability names from ROM")
    parser.add_argument("rom", type=Path, help="Path to Unbound.gba")
    parser.add_argument(
        "--count",
        type=int,
        default=None,
        help="Number of ability IDs to extract (default: infer from species ability usage)",
    )
    parser.add_argument(
        "--out-json",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "ability_table_from_rom.json",
        help="Output JSON path",
    )
    parser.add_argument(
        "--out-txt",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "abilities.txt",
        help="Canonical output text path (id:name lines)",
    )
    args = parser.parse_args()

    rom = args.rom.read_bytes()
    species_base = find_species_table_base(rom)
    species_ids = load_species_ids()

    if args.count is None:
        ability_count = infer_ability_count_from_species(rom, species_base, species_ids)
    else:
        ability_count = int(args.count)

    base = find_abilities_table_base(rom)
    rows = extract_abilities(rom, base, ability_count)

    payload = {
        "source_rom": str(args.rom),
        "table_base": base,
        "entry_size": ABILITY_NAME_ENTRY_SIZE,
        "ability_count": len(rows),
        "inferred_count": ability_count,
        "abilities": rows,
    }

    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    lines = [f"{row['ability_id']}:{row['name']}" for row in rows]
    args.out_txt.parent.mkdir(parents=True, exist_ok=True)
    args.out_txt.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"[OK] Ability table base: 0x{base:X}")
    print(f"[OK] Extracted abilities: {len(rows)}")
    print(f"[OK] Wrote JSON: {args.out_json}")
    print(f"[OK] Wrote canonical abilities TXT: {args.out_txt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
