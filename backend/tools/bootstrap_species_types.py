#!/usr/bin/env python3
"""Build species_types.json from ROM or Showdown name fallback."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

from core.data_loader import backend_root, data_path
from core.rom_paths import find_unbound_rom

ROM_CANDIDATES = [
    backend_root() / "local_artifacts" / "Unbound.gba",
    backend_root().parent / "romre" / "roms" / "Unbound.gba",
]

SHOWDOWN_PDEX_URL = (
    "https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/pokedex.ts"
)


def normalize_token(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def load_species_table() -> list[dict]:
    payload = json.loads(data_path("species_table_from_rom.json").read_text(encoding="utf-8"))
    return payload["species"]


def try_rom_extract(out_path: Path) -> bool:
    extract_script = backend_root() / "tools" / "extract_unbound_species_types.py"
    rom = find_unbound_rom()
    if rom is not None:
        subprocess.run(
            [sys.executable, str(extract_script), str(rom), "--out", str(out_path)],
            check=True,
        )
        return True
    for rom in ROM_CANDIDATES:
        if not rom.exists():
            continue
        subprocess.run(
            [sys.executable, str(extract_script), str(rom), "--out", str(out_path)],
            check=True,
        )
        return True
    return False


def parse_showdown_pokedex(raw: str) -> dict[str, list[str]]:
    entries: dict[str, list[str]] = {}
    for match in re.finditer(
        r"\n\s*([a-z0-9]+):\s*\{[^{}]*?types:\s*\[([^\]]+)\]",
        raw,
        flags=re.S,
    ):
        key = match.group(1)
        type_blob = match.group(2)
        types = [part.strip().strip("'\"") for part in type_blob.split(",") if part.strip()]
        if types:
            entries[key] = types
    return entries


def fetch_showdown_types() -> dict[str, list[str]]:
    with urllib.request.urlopen(SHOWDOWN_PDEX_URL, timeout=30) as response:
        raw = response.read().decode("utf-8", errors="ignore")
    return parse_showdown_pokedex(raw)


def lookup_showdown_types(name: str, pokedex: dict[str, list[str]]) -> list[str] | None:
    candidates = [
        normalize_token(name),
        normalize_token(name.replace("Alolan ", "alola")),
        normalize_token(name.replace("Mega ", "mega")),
        normalize_token(name.replace("Therian", "therian")),
        normalize_token(name.replace("Blacphalon", "Blacephalon")),
    ]
    if name.lower().startswith("mega "):
        base = name.split(" ", 1)[1]
        candidates.append(normalize_token(base))
    for token in candidates:
        if token in pokedex:
            return pokedex[token]
    return None


def bootstrap_from_showdown(out_path: Path) -> None:
    pokedex = fetch_showdown_types()
    species_rows = load_species_table()
    out: dict[str, dict] = {}
    missing: list[str] = []

    for row in species_rows:
        sid = str(row["species_id"])
        name = str(row["name"])
        types = lookup_showdown_types(name, pokedex)
        if not types:
            missing.append(name)
            continue
        out[sid] = {
            "type1": types[0],
            "type2": types[1] if len(types) > 1 else types[0],
            "types": types,
            "source": "showdown_fallback",
        }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(f"[OK] Wrote {len(out)} species type entries via Showdown fallback -> {out_path}")
    if missing:
        print(f"[WARN] Missing Showdown type mapping for {len(missing)} species")


def main() -> None:
    out_path = data_path("species_types.json")
    if try_rom_extract(out_path):
        print("[OK] Used ROM extraction")
        return
    print("[WARN] ROM not found; using Showdown fallback")
    bootstrap_from_showdown(out_path)


if __name__ == "__main__":
    main()
