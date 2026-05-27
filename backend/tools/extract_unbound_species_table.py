#!/usr/bin/env python3
"""Extract Pokemon Unbound species names from ROM.

The ROM stores species names in a fixed-size table (11 bytes per entry, 0xFF-terminated
with 0xFF padding). This tool locates the table using Bulbasaur/Ivysaur anchors,
then extracts sequential species names.
"""

from __future__ import annotations

import argparse
import json
import re
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
SPECIAL_SPECIES_NAMES = {"Egg", "MISSINGNO?", "?"}
SPECIES_NAME_RE = re.compile(r"^[A-Z][A-Za-z0-9'\-.♀♂ ]{0,10}$")


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


def _is_plausible_species_name(name: str) -> bool:
    if not name:
        return False
    if name in SPECIAL_SPECIES_NAMES:
        return True
    if not SPECIES_NAME_RE.fullmatch(name):
        return False
    # Avoid obvious fragment/plain-word drift from unrelated text blocks.
    if name.islower():
        return False
    return True


def _is_valid_species_name_entry(entry: bytes) -> bool:
    if len(entry) != SPECIES_NAME_ENTRY_SIZE:
        return False
    term_idx = None
    for i, b in enumerate(entry):
        if b in (0xFF, 0x00):
            term_idx = i
            break
    if term_idx is None:
        return False
    payload = entry[:term_idx]
    padding = entry[term_idx + 1 :]
    if len(payload) == 0:
        return False
    if any(b not in (0xFF, 0x00) for b in padding):
        return False
    allowed = set(DECODE.keys())
    allowed.discard(0xFF)
    if any(b not in allowed for b in payload):
        return False
    name = decode_name(entry)
    return _is_plausible_species_name(name)


def infer_species_count_from_rom(rom: bytes, base: int, max_scan: int = 4096, invalid_streak_stop: int = 128) -> int:
    names: list[str] = []
    valid_mask: list[bool] = []

    for idx in range(1, max_scan + 1):
        off = base + (idx - 1) * SPECIES_NAME_ENTRY_SIZE
        if off + SPECIES_NAME_ENTRY_SIZE > len(rom):
            break
        entry = rom[off : off + SPECIES_NAME_ENTRY_SIZE]
        name = decode_name(entry)
        valid = _is_valid_species_name_entry(entry)
        names.append(name)
        valid_mask.append(valid)

    if not valid_mask:
        raise RuntimeError("Could not infer species count from ROM table")

    # Phase 1: locate first strong contiguous run to lock onto actual species zone.
    seed_run = 24
    seed_start = None
    run = 0
    for i, ok in enumerate(valid_mask):
        if ok:
            run += 1
            if run >= seed_run:
                seed_start = i - run + 1
                break
        else:
            run = 0
    if seed_start is None:
        raise RuntimeError("Could not find stable seed run for species table")

    # Phase 2: rolling quality boundary detection to avoid bleeding into move text.
    window = 32
    min_good = 0.70
    max_frag = 0.35
    min_len = 3
    max_bad_windows = 3
    gap_lookahead = 160

    def is_fragment(n: str) -> bool:
        if not n:
            return True
        if n in SPECIAL_SPECIES_NAMES:
            return False
        if len(n) <= 2:
            return True
        if n[0].islower():
            return True
        if " " in n and len(n) <= 5:
            return True
        return False

    last_good_idx = seed_start + seed_run - 1
    bad_windows = 0

    def window_is_strong(start: int) -> bool:
        if start + window > len(valid_mask):
            return False
        sub_valid = valid_mask[start : start + window]
        sub_names = names[start : start + window]
        good_ratio = sum(1 for x in sub_valid if x) / window
        frag_ratio = sum(1 for n in sub_names if is_fragment(n)) / window
        long_ratio = sum(1 for n in sub_names if len(n) >= min_len) / window
        return good_ratio >= min_good and frag_ratio <= max_frag and long_ratio >= min_good

    i = seed_start
    while i + window <= len(valid_mask):
        if window_is_strong(i):
            last_good_idx = i + window - 1
            bad_windows = 0
        else:
            bad_windows += 1
            if bad_windows >= max_bad_windows:
                recovered = False
                scan_end = min(len(valid_mask) - window, i + gap_lookahead)
                j = i + 1
                while j <= scan_end:
                    if window_is_strong(j):
                        i = j
                        last_good_idx = i + window - 1
                        bad_windows = 0
                        recovered = True
                        break
                    j += 1
                if not recovered:
                    break
        i += 1

    last_valid = last_good_idx + 1

    # Hard stop if we detect classic move-table bleed pattern in 11-byte chunks.
    # Seen on CFRU hacks where species text is followed by move names.
    for k in range(seed_start, min(len(names) - 2, last_valid)):
        if names[k] == "Pound":
            prev_name = names[k - 1] if k - 1 >= 0 else ""
            next_name = names[k + 1]
            if prev_name in {"-", "?", ""} and next_name.startswith("Karate"):
                last_valid = k
                break

    def is_suspicious_tail(n: str) -> bool:
        if n == "MISSINGNO?":
            return False
        if not n or n in {"-", "?"}:
            return True
        if "?" in n or ":" in n:
            return True
        return False

    while last_valid > 0 and is_suspicious_tail(names[last_valid - 1]):
        last_valid -= 1

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
