#!/usr/bin/env python3
"""Extract Pokemon Unbound species names from ROM.

The ROM stores species names in a fixed-size table (11 bytes per entry, 0xFF-terminated
with 0xFF padding). This tool locates the table using Bulbasaur/Ivysaur anchors,
then extracts sequential species names.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


SPECIES_NAME_ENTRY_SIZE = 11


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


def _is_valid_species_name_entry(entry: bytes) -> bool:
    if len(entry) != SPECIES_NAME_ENTRY_SIZE:
        return False
    if 0xFF not in entry:
        return False
    term = entry.index(0xFF)
    payload = entry[:term]
    padding = entry[term + 1 :]
    if len(payload) == 0:
        return False
    if any(b != 0xFF for b in padding):
        return False
    allowed = set(DECODE.keys())
    allowed.discard(0xFF)
    if any(b not in allowed for b in payload):
        return False
    name = decode_name(entry)
    return bool(name)


def infer_species_count_from_rom(rom: bytes, base: int, max_scan: int = 4096, invalid_streak_stop: int = 128) -> int:
    last_valid = 0
    invalid_streak = 0
    for idx in range(1, max_scan + 1):
        off = base + (idx - 1) * SPECIES_NAME_ENTRY_SIZE
        if off + SPECIES_NAME_ENTRY_SIZE > len(rom):
            break
        entry = rom[off : off + SPECIES_NAME_ENTRY_SIZE]
        if _is_valid_species_name_entry(entry):
            last_valid = idx
            invalid_streak = 0
        else:
            invalid_streak += 1
            if invalid_streak >= invalid_streak_stop and last_valid > 0:
                break
    if last_valid <= 0:
        raise RuntimeError("Could not infer species count from ROM table")
    return last_valid


def find_species_table_base(rom: bytes) -> int:
    a1 = encode_name("Bulbasaur")
    a2 = encode_name("Ivysaur")

    cursor = 0
    while True:
        pos = rom.find(a1, cursor)
        if pos < 0:
            break
        nxt = pos + SPECIES_NAME_ENTRY_SIZE
        if nxt + len(a2) <= len(rom) and rom[nxt: nxt + len(a2)] == a2:
            return pos
        cursor = pos + 1

    raise RuntimeError("Could not locate species-name table base in ROM")


def extract_species(rom: bytes, base: int, species_count: int) -> list[dict]:
    out: list[dict] = []
    for species_id in range(1, species_count + 1):
        off = base + (species_id - 1) * SPECIES_NAME_ENTRY_SIZE
        if off + SPECIES_NAME_ENTRY_SIZE > len(rom):
            break
        entry = rom[off: off + SPECIES_NAME_ENTRY_SIZE]
        out.append(
            {
                "species_id": species_id,
                "offset": off,
                "name": decode_name(entry),
                "raw_hex": entry.hex(),
            }
        )
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract Unbound species names from ROM")
    parser.add_argument("rom", type=Path, help="Path to Unbound.gba")
    parser.add_argument(
        "--count",
        type=int,
        default=None,
        help="Number of species IDs to extract (default: infer directly from ROM)",
    )
    parser.add_argument(
        "--out-json",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "species_table_from_rom.json",
        help="Diagnostic JSON output path",
    )
    parser.add_argument(
        "--out-txt",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "pokemon.txt",
        help="Canonical output text path (id:name lines)",
    )
    args = parser.parse_args()

    rom = args.rom.read_bytes()
    base = find_species_table_base(rom)
    if args.count is None:
        species_count = infer_species_count_from_rom(rom, base)
    else:
        species_count = int(args.count)
    rows = extract_species(rom, base, species_count)

    payload = {
        "source_rom": str(args.rom),
        "table_base": base,
        "entry_size": SPECIES_NAME_ENTRY_SIZE,
        "species_count": len(rows),
        "species": rows,
    }

    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    lines = ["0:NONE"] + [f"{row['species_id']}:{row['name']}" for row in rows]
    args.out_txt.parent.mkdir(parents=True, exist_ok=True)
    args.out_txt.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"[OK] Species table base: 0x{base:X}")
    print(f"[OK] Extracted species: {len(rows)}")
    print(f"[OK] Wrote JSON: {args.out_json}")
    print(f"[OK] Wrote canonical species TXT: {args.out_txt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
