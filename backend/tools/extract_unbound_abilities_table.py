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


def _is_valid_ability_name_entry(entry: bytes, entry_size: int) -> bool:
    if len(entry) != entry_size:
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


def infer_ability_count_from_rom(
    rom: bytes,
    base: int,
    entry_size: int = ABILITY_NAME_ENTRY_SIZE,
    max_scan: int = 512,
    invalid_streak_stop: int = 6,
) -> int:
    last_valid = 0
    invalid_streak = 0
    for idx in range(1, max_scan + 1):
        off = base + (idx - 1) * entry_size
        if off + entry_size > len(rom):
            break
        entry = rom[off : off + entry_size]
        if _is_valid_ability_name_entry(entry, entry_size):
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


def find_abilities_table_base_generic(rom: bytes, min_run: int = 64) -> int:
    best_base = None
    best_run = 0

    for align in range(ABILITY_NAME_ENTRY_SIZE):
        pos = align
        run_start = None
        run_len = 0

        while pos + ABILITY_NAME_ENTRY_SIZE <= len(rom):
            entry = rom[pos : pos + ABILITY_NAME_ENTRY_SIZE]
            if _is_valid_ability_name_entry(entry, ABILITY_NAME_ENTRY_SIZE):
                if run_start is None:
                    run_start = pos
                    run_len = 1
                else:
                    run_len += 1
            else:
                if run_start is not None and run_len > best_run:
                    best_base = run_start
                    best_run = run_len
                run_start = None
                run_len = 0
            pos += ABILITY_NAME_ENTRY_SIZE

        if run_start is not None and run_len > best_run:
            best_base = run_start
            best_run = run_len

    if best_base is None or best_run < min_run:
        raise RuntimeError(f"Could not locate ability-name table via generic scan (best_run={best_run})")

    return best_base


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


def infer_species_count_from_base_stats_table(rom: bytes, base: int, max_scan: int = 4096, invalid_streak_stop: int = 128) -> int:
    last_valid = 0
    invalid_streak = 0

    for idx in range(1, max_scan + 1):
        off = base + (idx - 1) * SPECIES_STRUCT_SIZE
        if off + SPECIES_STRUCT_SIZE > len(rom):
            break
        hp = rom[off + 0]
        atk = rom[off + 1]
        deff = rom[off + 2]
        spe = rom[off + 3]
        spa = rom[off + 4]
        spd = rom[off + 5]
        growth = rom[off + 0x13]
        if (hp or atk or deff or spe or spa or spd) and growth <= 5:
            last_valid = idx
            invalid_streak = 0
        else:
            invalid_streak += 1
            if invalid_streak >= invalid_streak_stop and last_valid > 0:
                break

    if last_valid <= 0:
        raise RuntimeError("Could not infer species count from species base stats table")
    return last_valid


def collect_used_ability_ids_from_species(rom: bytes, species_base: int, species_count: int) -> set[int]:
    used: set[int] = set()
    for sid in range(1, species_count + 1):
        off = species_base + (sid - 1) * SPECIES_STRUCT_SIZE
        if off + SPECIES_STRUCT_SIZE > len(rom):
            break
        a1 = int(rom[off + OFF_ABILITY_1]) & 0xFF
        a2 = int(rom[off + OFF_ABILITY_2]) & 0xFF
        if a1 > 0:
            used.add(a1)
        if a2 > 0:
            used.add(a2)
    return used


def find_abilities_table_structural(
    rom: bytes,
    min_entry_size: int = 12,
    max_entry_size: int = 24,
    max_overshoot: int = 96,
) -> tuple[int, int, int]:
    species_base = find_species_table_base(rom)
    species_count = infer_species_count_from_base_stats_table(rom, species_base)
    used_ids = collect_used_ability_ids_from_species(rom, species_base, species_count)
    needed = max(used_ids) if used_ids else 64
    target_run = max(needed + 8, 96)

    best = None

    for entry_size in range(min_entry_size, max_entry_size + 1):
        for align in range(entry_size):
            pos = align
            run_start = None
            run_len = 0

            while pos + entry_size <= len(rom):
                entry = rom[pos : pos + entry_size]
                if _is_valid_ability_name_entry(entry, entry_size):
                    if run_start is None:
                        run_start = pos
                        run_len = 1
                    else:
                        run_len += 1
                else:
                    if run_start is not None:
                        if run_len >= target_run:
                            coverage = 0
                            for aid in used_ids:
                                off = run_start + (aid - 1) * entry_size
                                if off + entry_size <= len(rom) and _is_valid_ability_name_entry(rom[off: off + entry_size], entry_size):
                                    coverage += 1
                            inferred = infer_ability_count_from_rom(rom, run_start, entry_size=entry_size)
                            overshoot = inferred - needed
                            if overshoot < 0 or overshoot > max_overshoot:
                                overshoot = 10_000
                            score = (coverage, -overshoot, run_len, entry_size)
                            if best is None or score > best[0]:
                                best = (score, run_start, entry_size, run_len, inferred)
                    run_start = None
                    run_len = 0
                pos += entry_size

            if run_start is not None and run_len >= target_run:
                coverage = 0
                for aid in used_ids:
                    off = run_start + (aid - 1) * entry_size
                    if off + entry_size <= len(rom) and _is_valid_ability_name_entry(rom[off: off + entry_size], entry_size):
                        coverage += 1
                inferred = infer_ability_count_from_rom(rom, run_start, entry_size=entry_size)
                overshoot = inferred - needed
                if overshoot < 0 or overshoot > max_overshoot:
                    overshoot = 10_000
                score = (coverage, -overshoot, run_len, entry_size)
                if best is None or score > best[0]:
                    best = (score, run_start, entry_size, run_len, inferred)

    if best is None:
        raise RuntimeError("Could not locate ability-name table via structural scan")

    if best[0][1] <= -10_000:
        raise RuntimeError("Structural scan found only implausible candidates (overshoot too large)")

    _, base, entry_size, run_len, _ = best
    return base, entry_size, run_len


def extract_abilities(rom: bytes, base: int, ability_count: int, entry_size: int = ABILITY_NAME_ENTRY_SIZE) -> list[dict]:
    out: list[dict] = []
    for ability_id in range(1, ability_count + 1):
        off = base + (ability_id - 1) * entry_size
        if off + entry_size > len(rom):
            break
        entry = rom[off: off + entry_size]
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
        "--generic-scan",
        action="store_true",
        help="Use generic fixed-width string-run scan instead of hardcoded name anchors",
    )
    parser.add_argument(
        "--structural-scan",
        action="store_true",
        help="Use structural scan guided by species ability-byte usage",
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
    entry_size = ABILITY_NAME_ENTRY_SIZE
    if args.structural_scan:
        base, entry_size, _ = find_abilities_table_structural(rom)
    elif args.generic_scan:
        base = find_abilities_table_base_generic(rom)
    else:
        base = find_abilities_table_base(rom)

    if args.count is None:
        ability_count = infer_ability_count_from_rom(rom, base, entry_size=entry_size)
    else:
        ability_count = int(args.count)

    rows = extract_abilities(rom, base, ability_count, entry_size=entry_size)

    payload = {
        "source_rom": str(args.rom),
        "table_base": base,
        "entry_size": entry_size,
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
