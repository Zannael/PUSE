#!/usr/bin/env python3
"""Extract Pokemon Unbound item metadata from ROM with full ID coverage.

Output always contains all IDs from backend/data/items.txt. Names are canonical
from items.txt; ROM names are included as diagnostic fields. All records come
from the continuous table addressed by the CFRU header pointer at 0x1C8.
"""

from __future__ import annotations

import argparse
import json
import hashlib
from pathlib import Path
from statistics import mode


ITEM_STRUCT_SIZE = 44
OFF_NAME = 0
OFF_ITEM_ID = 14
OFF_POCKET = 26
ITEM_TABLE_POINTER_OFFSET = 0x1C8
ROM_ADDRESS_BASE = 0x08000000


def build_charmap() -> tuple[dict[int, str], dict[str, int]]:
    decode: dict[int, str] = {
        0x00: " ",
        0x01: "A",
        0x02: "B",
        0x03: "C",
        0x04: "D",
        0x05: "E",
        0x06: "É",
        0x07: "G",
        0x08: "H",
        0x09: "I",
        0x0A: "J",
        0x0B: "K",
        0x0C: "L",
        0x0D: "M",
        0x0E: "N",
        0x0F: "O",
        0x10: "P",
        0x11: "Q",
        0x12: "R",
        0x13: "S",
        0x14: "T",
        0x15: "U",
        0x16: "V",
        0x17: "W",
        0x18: "X",
        0x19: "é",
        0x1A: "Z",
        0xAB: "!",
        0xAC: "?",
        0xAD: ".",
        0xAE: "-",
        0xAF: "·",
        0xB0: "...",
        0xB4: "'",
        0xB5: "♂",
        0xB6: "♀",
        0xB7: "$",
        0xB8: ",",
        0xB9: "x",
        0xBA: "/",
        0xF0: ":",
        0xFF: "",
    }
    for i, c in enumerate("0123456789"):
        decode[0xA1 + i] = c
    for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
        decode[0xBB + i] = c
    for i, c in enumerate("abcdefghijklmnopqrstuvwxyz"):
        decode[0xD5 + i] = c

    encode = {v: k for k, v in decode.items() if v and len(v) == 1}
    return decode, encode


DECODE, ENCODE = build_charmap()


def load_items_txt(path: Path) -> dict[int, str]:
    out: dict[int, str] = {}
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or ":" not in line:
            continue
        left, right = line.split(":", 1)
        left = left.strip()
        right = right.strip()
        if left.isdigit() and right:
            out[int(left)] = right
    return out


def encode_name(name: str) -> bytes | None:
    out = []
    for ch in name:
        b = ENCODE.get(ch)
        if b is None:
            return None
        out.append(b)
    out.append(0xFF)
    return bytes(out)


def decode_name(raw: bytes) -> tuple[str, int]:
    out = []
    unknown = 0
    for b in raw:
        if b == 0xFF:
            break
        ch = DECODE.get(b)
        if ch is None:
            out.append("?")
            unknown += 1
        else:
            out.append(ch)
    return "".join(out).strip(), unknown


def normalize_name(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


def find_live_item_base(rom: bytes, max_item_id: int) -> int:
    """Use the CFRU header pointer, never the first matching legacy table."""
    if len(rom) < ITEM_TABLE_POINTER_OFFSET + 4:
        raise ValueError("ROM is too short for the CFRU item-table pointer")
    pointer = int.from_bytes(rom[ITEM_TABLE_POINTER_OFFSET:ITEM_TABLE_POINTER_OFFSET + 4], "little")
    base = pointer - ROM_ADDRESS_BASE
    if base < 0 or base % 4 or base + (max_item_id + 1) * ITEM_STRUCT_SIZE > len(rom):
        raise ValueError("CFRU item-table pointer is outside the ROM or table is truncated")
    # Validate both ends of the old split: a vanilla-table match is insufficient.
    for item_id, name in [(1, "Master Ball"), (2, "Ultra Ball"), (348, "Costume Box"), (349, "Parcel")]:
        row = read_row(rom, base + item_id * ITEM_STRUCT_SIZE)
        if row is None or row["item_id_field"] != item_id or row["rom_name"] != name:
            raise ValueError(f"CFRU item-table pointer failed anchor validation for item {item_id}")
    return base


def read_row(rom: bytes, offset: int) -> dict | None:
    if offset < 0 or offset + ITEM_STRUCT_SIZE > len(rom):
        return None

    raw_name = rom[offset + OFF_NAME: offset + OFF_NAME + 14]
    name_pointer = int.from_bytes(raw_name[:4], "little")
    if raw_name[3] in (0x08, 0x09):
        if not ROM_ADDRESS_BASE <= name_pointer < ROM_ADDRESS_BASE + len(rom):
            raise ValueError(f"Item name pointer outside ROM at 0x{offset:X}")
        name_offset = name_pointer - ROM_ADDRESS_BASE
        pointed_name = rom[name_offset:name_offset + 128]
        if b"\xff" not in pointed_name:
            raise ValueError(f"Unterminated item name pointer at 0x{offset:X}")
        rom_name, unknown = decode_name(pointed_name)
    else:
        rom_name, unknown = decode_name(raw_name)
    item_id_field = int.from_bytes(rom[offset + OFF_ITEM_ID: offset + OFF_ITEM_ID + 2], "little")
    pocket_code = rom[offset + OFF_POCKET]
    return {
        "offset": offset,
        "raw_name_hex": raw_name.hex(),
        "rom_name": rom_name,
        "rom_name_unknown_chars": unknown,
        "item_id_field": item_id_field,
        "pocket_code": pocket_code,
    }


def pick_mode_code(by_id: dict[int, dict], ids: list[int]) -> int | None:
    vals = [by_id[i]["pocket_code"] for i in ids if by_id.get(i) and by_id[i].get("found_in_rom") and by_id[i].get("pocket_code") is not None]
    if not vals:
        return None
    try:
        return mode(vals)
    except Exception:
        return vals[0]


def build_pocket_map(entries_by_id: dict[int, dict]) -> tuple[dict[int, str], dict[str, int | None]]:
    code_main = pick_mode_code(entries_by_id, [13, 14, 19, 20, 68, 84])
    code_ball = pick_mode_code(entries_by_id, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    code_berry = pick_mode_code(entries_by_id, [133, 134, 135, 140, 168, 175])
    code_key = pick_mode_code(entries_by_id, [259, 263, 271, 278, 364, 365, 368])
    code_tm = pick_mode_code(entries_by_id, [289, 290, 300, 320, 346, 375, 400, 436, 437, 444])

    code_to_label: dict[int, str] = {}
    if code_main is not None:
        code_to_label[code_main] = "main"
    if code_ball is not None:
        code_to_label[code_ball] = "ball"
    if code_berry is not None:
        code_to_label[code_berry] = "berry"
    if code_key is not None:
        code_to_label[code_key] = "key"
    if code_tm is not None:
        code_to_label[code_tm] = "tmhm"

    return code_to_label, {
        "main": code_main,
        "ball": code_ball,
        "berry": code_berry,
        "key": code_key,
        "tmhm": code_tm,
    }


def summarize_ids(entries: list[dict]) -> dict[str, list[int]]:
    groups: dict[str, list[int]] = {}
    for e in entries:
        key = e.get("pocket_type", "unresolved")
        groups.setdefault(key, []).append(e["item_id"])
    for k in groups:
        groups[k].sort()
    return groups


def extract_all_ids(rom: bytes, items_by_id: dict[int, str], base: int) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for item_id, canonical_name in sorted(items_by_id.items()):
        offset = base + item_id * ITEM_STRUCT_SIZE
        row = read_row(rom, offset)
        if row is None or row["pocket_code"] not in range(6):
            raise ValueError(f"Invalid live item record {item_id} at 0x{offset:X}")
        out[item_id] = {
            "item_id": item_id,
            "name": canonical_name,
            "canonical_name": canonical_name,
            "table": "live",
            "found_in_rom": True,
            "offset": row["offset"],
            "rom_name": row["rom_name"],
            "rom_name_unknown_chars": row["rom_name_unknown_chars"],
            "name_match": normalize_name(row["rom_name"]) == normalize_name(canonical_name),
            "item_id_field": row["item_id_field"],
            "id_field_matches_item_id": row["item_id_field"] == item_id,
            "pocket_code": row["pocket_code"],
            "raw_name_hex": row["raw_name_hex"],
        }
    return out


def runtime_pocket_map(entries: list[dict]) -> dict:
    """Derive runtime families without per-item pocket corrections."""
    pockets = {key: {"ids": []} for key in ("ball", "berry", "tm", "hm", "key")}
    for entry in entries:
        family = entry["pocket_type"]
        if family == "tmhm":
            name = entry["rom_name"]
            if not (name.startswith("TM") or name.startswith("HM")):
                raise ValueError(f"Cannot distinguish TM/HM for item {entry['item_id']}")
            family = "hm" if name.startswith("HM") else "tm"
        if family in pockets:
            pockets[family]["ids"].append(entry["item_id"])
        elif family not in ("main", "unused"):
            raise ValueError(f"Unresolved pocket for item {entry['item_id']}")
    pockets["key"].update({
        "dangerous": True, "quantity_forced": 1,
        "notes": "Editing key items can bypass progression and may require story/event flags.",
    })
    pockets["main"] = {"fallback": True}
    return {"version": 3, "source": "Live CFRU item table (item_table_from_rom.json)", "pockets": pockets}


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract Unbound item pocket metadata from ROM")
    parser.add_argument("rom", type=Path, help="Path to Unbound.gba")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "item_table_from_rom.json",
        help="Output JSON file",
    )
    args = parser.parse_args()

    rom = args.rom.read_bytes()
    items_path = Path(__file__).resolve().parents[1] / "data" / "items.txt"
    items_by_id = load_items_txt(items_path)

    base = find_live_item_base(rom, max(items_by_id))
    print(f"[INFO] Live item table from header 0x{ITEM_TABLE_POINTER_OFFSET:X}: 0x{base:X}")
    entries_by_id = extract_all_ids(rom, items_by_id, base)
    code_to_label, inferred_codes = build_pocket_map(entries_by_id)
    if any(code is None for code in inferred_codes.values()) or len(set(inferred_codes.values())) != 5:
        raise ValueError("Cannot infer distinct pocket codes from the live table")
    code_to_label[0] = "unused"

    entries = []
    for item_id in sorted(entries_by_id.keys()):
        e = entries_by_id[item_id]
        pocket_code = e.get("pocket_code")
        if pocket_code is None:
            pocket_type = "unresolved"
        else:
            pocket_type = code_to_label.get(pocket_code, f"raw_{pocket_code}")
        entries.append({**e, "pocket_type": pocket_type})

    grouped = summarize_ids(entries)
    total = len(entries)
    found_count = sum(1 for e in entries if e.get("found_in_rom"))
    unresolved_count = total - found_count
    name_match_count = sum(1 for e in entries if e.get("found_in_rom") and e.get("name_match"))
    id_field_match_count = sum(1 for e in entries if e.get("found_in_rom") and e.get("id_field_matches_item_id"))

    payload = {
        "rom": str(args.rom),
        "rom_sha256": hashlib.sha256(rom).hexdigest(),
        "bases": {"live": f"0x{base:X}"},
        "table_pointer_offset": ITEM_TABLE_POINTER_OFFSET,
        "struct_size": ITEM_STRUCT_SIZE,
        "coverage": {
            "items_txt_total": total,
            "found_in_rom": found_count,
            "unresolved": unresolved_count,
            "rom_name_matches_canonical": name_match_count,
            "id_field_matches_item_id": id_field_match_count,
        },
        "inferred_pocket_codes": inferred_codes,
        "counts": {k: len(v) for k, v in grouped.items()},
        "groups": grouped,
        "items": entries,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"[OK] Wrote {args.out} with {total} items ({found_count} found, {unresolved_count} unresolved)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
