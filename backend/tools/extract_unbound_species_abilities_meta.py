#!/usr/bin/env python3
"""Extract ROM-truth species ability metadata from Unbound ROM.

Output schema:
{
  "<species_id>": {
    "ability_1_id": <int>,
    "ability_2_id": <int>,
    "hidden_ability_id": <int>
  }
}
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from core.data_loader import data_path


SPECIES_STRUCT_SIZE = 0x1C
OFF_ABILITY_1 = 0x16
OFF_ABILITY_2 = 0x17
OFF_HIDDEN_ABILITY = 0x1A

ANCHOR_GLISCOR = 525
ANCHOR_RATICATE_BASE = 20


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


def load_ability_names() -> dict[int, str]:
    names: dict[int, str] = {}
    text = data_path("abilities.txt").read_text(encoding="utf-8", errors="ignore")
    for raw in text.splitlines():
        line = raw.strip()
        if not line or ":" not in line:
            continue
        left, right = line.split(":", 1)
        left = left.strip()
        if not left.isdigit():
            continue
        names[int(left)] = right.strip()
    return names


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


def extract_species_abilities_meta(rom: bytes, table_base: int, species_ids: list[int]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for sid in species_ids:
        off = table_base + ((sid - 1) * SPECIES_STRUCT_SIZE)
        if off + SPECIES_STRUCT_SIZE > len(rom):
            continue
        hidden = int.from_bytes(rom[off + OFF_HIDDEN_ABILITY: off + OFF_HIDDEN_ABILITY + 2], "little")
        out[str(sid)] = {
            "ability_1_id": int(rom[off + OFF_ABILITY_1]) & 0xFF,
            "ability_2_id": int(rom[off + OFF_ABILITY_2]) & 0xFF,
            "hidden_ability_id": hidden,
        }
    return out


def validate_anchors(meta: dict[str, dict[str, int]], ability_names: dict[int, str]) -> None:
    gliscor = meta.get(str(ANCHOR_GLISCOR), {})
    raticate = meta.get(str(ANCHOR_RATICATE_BASE), {})

    gliscor_hidden = gliscor.get("hidden_ability_id")
    raticate_hidden = raticate.get("hidden_ability_id")

    gliscor_hidden_name = ability_names.get(int(gliscor_hidden)) if gliscor_hidden is not None else None
    raticate_hidden_name = ability_names.get(int(raticate_hidden)) if raticate_hidden is not None else None

    if gliscor_hidden_name != "Poison Heal":
        raise RuntimeError(
            f"Anchor validation failed for Gliscor ({ANCHOR_GLISCOR}): "
            f"expected hidden ability 'Poison Heal', got id={gliscor_hidden} name={gliscor_hidden_name!r}"
        )

    if raticate_hidden_name != "Hustle":
        raise RuntimeError(
            f"Anchor validation failed for Raticate base ({ANCHOR_RATICATE_BASE}): "
            f"expected hidden ability 'Hustle', got id={raticate_hidden} name={raticate_hidden_name!r}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract Unbound species abilities metadata")
    parser.add_argument("rom", type=Path, help="Path to Unbound.gba")
    parser.add_argument(
        "--out",
        type=Path,
        default=data_path("species_abilities_meta.json"),
        help="Output JSON path",
    )
    args = parser.parse_args()

    rom = args.rom.read_bytes()
    species_ids = load_species_ids()
    base = find_species_table_base(rom)
    table = extract_species_abilities_meta(rom, base, species_ids)
    validate_anchors(table, load_ability_names())

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(table, indent=2, sort_keys=True), encoding="utf-8")

    print(f"[OK] Found species table base at 0x{base:X}")
    print(f"[OK] Anchor validation passed for Gliscor and Raticate base")
    print(f"[OK] Wrote {len(table)} species abilities entries -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
