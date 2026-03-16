#!/usr/bin/env python3
"""Extract Pokemon Unbound move names from ROM.

The ROM stores move names in a fixed-size table (13 bytes per entry, 0xFF-terminated
with 0xFF padding). This tool locates the table using a Pound/Karate Chop anchor,
then extracts move names for sequential IDs.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


MOVE_NAME_ENTRY_SIZE = 13


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


def load_move_count_from_txt(path: Path) -> int:
    max_id = 0
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or ":" not in line:
            continue
        left = line.split(":", 1)[0].strip()
        if left.isdigit():
            max_id = max(max_id, int(left))
    if max_id <= 0:
        raise RuntimeError(f"Could not infer move count from {path}")
    return max_id


def find_moves_table_base(rom: bytes) -> int:
    a1 = encode_name("Pound")
    a2 = encode_name("Karate Chop")

    cursor = 0
    while True:
        pos = rom.find(a1, cursor)
        if pos < 0:
            break
        nxt = pos + MOVE_NAME_ENTRY_SIZE
        if nxt + len(a2) <= len(rom) and rom[nxt: nxt + len(a2)] == a2:
            return pos
        cursor = pos + 1

    raise RuntimeError("Could not locate move-name table base in ROM")


def extract_moves(rom: bytes, base: int, move_count: int) -> list[dict]:
    out: list[dict] = []
    for move_id in range(1, move_count + 1):
        off = base + (move_id - 1) * MOVE_NAME_ENTRY_SIZE
        if off + MOVE_NAME_ENTRY_SIZE > len(rom):
            break
        entry = rom[off: off + MOVE_NAME_ENTRY_SIZE]
        out.append(
            {
                "move_id": move_id,
                "offset": off,
                "name": decode_name(entry),
                "raw_hex": entry.hex(),
            }
        )
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract Unbound move names from ROM")
    parser.add_argument("rom", type=Path, help="Path to Unbound.gba")
    parser.add_argument(
        "--count",
        type=int,
        default=None,
        help="Number of move IDs to extract (default: infer from backend/data/moves.txt)",
    )
    parser.add_argument(
        "--out-json",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "move_table_from_rom.json",
        help="Output JSON path",
    )
    parser.add_argument(
        "--out-txt",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "moves.txt",
        help="Canonical output text path (id:name lines)",
    )
    args = parser.parse_args()

    rom = args.rom.read_bytes()
    if args.count is None:
        fallback_moves_txt = Path(__file__).resolve().parents[1] / "data" / "moves.txt"
        move_count = load_move_count_from_txt(fallback_moves_txt)
    else:
        move_count = int(args.count)

    base = find_moves_table_base(rom)
    rows = extract_moves(rom, base, move_count)

    payload = {
        "source_rom": str(args.rom),
        "table_base": base,
        "entry_size": MOVE_NAME_ENTRY_SIZE,
        "move_count": len(rows),
        "moves": rows,
    }

    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    lines = [f"{row['move_id']}:{row['name']}" for row in rows]
    args.out_txt.parent.mkdir(parents=True, exist_ok=True)
    args.out_txt.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"[OK] Move table base: 0x{base:X}")
    print(f"[OK] Extracted moves: {len(rows)}")
    print(f"[OK] Wrote JSON: {args.out_json}")
    print(f"[OK] Wrote canonical moves TXT: {args.out_txt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
