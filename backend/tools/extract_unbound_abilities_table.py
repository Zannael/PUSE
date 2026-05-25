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


ABILITY_NAME_ENTRY_SIZE = 17
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


def _is_valid_ability_name_entry(entry: bytes) -> bool:
    if len(entry) != ABILITY_NAME_ENTRY_SIZE:
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
    return bool(name and "?" not in name)


def infer_ability_count_from_rom(rom: bytes, base: int, max_scan: int = 512, invalid_streak_stop: int = 6) -> int:
    last_valid = 0
    invalid_streak = 0
    for idx in range(1, max_scan + 1):
        off = base + (idx - 1) * ABILITY_NAME_ENTRY_SIZE
        if off + ABILITY_NAME_ENTRY_SIZE > len(rom):
            break
        entry = rom[off : off + ABILITY_NAME_ENTRY_SIZE]
        if _is_valid_ability_name_entry(entry):
            last_valid = idx
            invalid_streak = 0
        else:
            invalid_streak += 1
            if invalid_streak >= invalid_streak_stop and last_valid > 0:
                break
    if last_valid <= 0:
        raise RuntimeError("Could not infer ability count from ROM table")
    return last_valid


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
        help="Number of ability IDs to extract (default: infer directly from ROM)",
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
    base = find_abilities_table_base(rom)

    if args.count is None:
        ability_count = infer_ability_count_from_rom(rom, base)
    else:
        ability_count = int(args.count)

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
