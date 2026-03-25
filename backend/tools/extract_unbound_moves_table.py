#!/usr/bin/env python3
"""Extract Pokemon Unbound move names from ROM.

The ROM stores move names in a fixed-size table (13 bytes per entry, 0xFF-terminated
with 0xFF padding). This tool locates the table using a Pound/Karate Chop anchor,
then extracts move names for sequential IDs.

By default, move count is inferred directly from ROM by scanning contiguous valid
entries starting at the detected table base.
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


def _is_valid_move_name_entry(entry: bytes) -> bool:
    if len(entry) != MOVE_NAME_ENTRY_SIZE:
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
    if not name:
        return False
    if "?" in name:
        return False
    return True


def infer_move_count_from_rom(rom: bytes, base: int, max_scan: int = 4096, invalid_streak_stop: int = 8) -> int:
    last_valid = 0
    invalid_streak = 0

    for idx in range(1, max_scan + 1):
        off = base + (idx - 1) * MOVE_NAME_ENTRY_SIZE
        if off + MOVE_NAME_ENTRY_SIZE > len(rom):
            break
        entry = rom[off : off + MOVE_NAME_ENTRY_SIZE]
        if _is_valid_move_name_entry(entry):
            last_valid = idx
            invalid_streak = 0
        else:
            invalid_streak += 1
            if invalid_streak >= invalid_streak_stop and last_valid > 0:
                break

    if last_valid <= 0:
        raise RuntimeError("Could not infer move count from ROM table")
    return last_valid


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


def load_pp_by_move_id(path: Path) -> dict[int, int]:
    if not path.exists():
        return {}

    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and isinstance(raw.get("moves"), dict):
        raw = raw["moves"]

    out: dict[int, int] = {}
    if not isinstance(raw, dict):
        return out

    for k, v in raw.items():
        ks = str(k)
        if not ks.isdigit():
            continue
        if isinstance(v, dict):
            vv = v.get("base_pp", v.get("pp"))
        else:
            vv = v
        try:
            move_id = int(ks)
            pp = int(vv)
        except (TypeError, ValueError):
            continue
        if move_id <= 0 or pp < 0 or pp > 255:
            continue
        out[move_id] = pp
    return out


def extract_moves(rom: bytes, base: int, move_count: int, pp_by_move_id: dict[int, int] | None = None) -> list[dict]:
    out: list[dict] = []
    for move_id in range(1, move_count + 1):
        off = base + (move_id - 1) * MOVE_NAME_ENTRY_SIZE
        if off + MOVE_NAME_ENTRY_SIZE > len(rom):
            break
        entry = rom[off: off + MOVE_NAME_ENTRY_SIZE]
        row = {
            "move_id": move_id,
            "offset": off,
            "name": decode_name(entry),
            "raw_hex": entry.hex(),
        }
        if pp_by_move_id and move_id in pp_by_move_id:
            row["base_pp"] = int(pp_by_move_id[move_id])
        out.append(row)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract Unbound move names from ROM")
    parser.add_argument("rom", type=Path, help="Path to Unbound.gba")
    parser.add_argument(
        "--count",
        type=int,
        default=None,
        help="Number of move IDs to extract (default: infer directly from ROM)",
    )
    parser.add_argument(
        "--count-from-txt",
        action="store_true",
        help="Use backend/data/moves.txt to determine count when --count is omitted",
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
    parser.add_argument(
        "--pp-json",
        type=Path,
        default=None,
        help="Optional move->PP JSON to merge as base_pp into move_table_from_rom output",
    )
    args = parser.parse_args()

    rom = args.rom.read_bytes()
    base = find_moves_table_base(rom)
    if args.count is not None:
        move_count = int(args.count)
    elif args.count_from_txt:
        fallback_moves_txt = Path(__file__).resolve().parents[1] / "data" / "moves.txt"
        move_count = load_move_count_from_txt(fallback_moves_txt)
    else:
        move_count = infer_move_count_from_rom(rom, base)

    pp_by_move_id = load_pp_by_move_id(args.pp_json) if args.pp_json else {}
    rows = extract_moves(rom, base, move_count, pp_by_move_id=pp_by_move_id)

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
    if pp_by_move_id:
        print(f"[OK] Merged base_pp from: {args.pp_json}")
    print(f"[OK] Wrote JSON: {args.out_json}")
    print(f"[OK] Wrote canonical moves TXT: {args.out_txt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
