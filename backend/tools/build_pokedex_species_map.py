#!/usr/bin/env python3
"""Build the internal-species to National Dex mapping from PokeAPI's National Dex."""

from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BACKEND_DATA = ROOT / "backend" / "data" / "pokedex_species_map.json"
FRONTEND_DATA = ROOT / "frontend" / "src" / "core" / "pokedexSpeciesMap.json"
NATIVE_DATA = ROOT / "backend" / "data" / "pokedex_species_map.txt"
POKEMON_TEXT = ROOT / "backend" / "data" / "pokemon.txt"
NATIONAL_DEX_URL = "https://pokeapi.co/api/v2/pokedex/1/"
MAX_NATIONAL_DEX_ID = 809

NAME_ALIASES = {
    "nidoranf": "nidoran-f",
    "nidoranm": "nidoran-m",
    "fletchindr": "fletchinder",
    "flabb": "flabebe",
    "crabminble": "crabominable",
    "blacphalon": "blacephalon",
}

SPECIES_ID_ALIASES = {
    29: "nidoranf",
    32: "nidoranm",
}


def normalize(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def main() -> None:
    request = urllib.request.Request(NATIONAL_DEX_URL, headers={"User-Agent": "PUSE data builder"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)

    dex_by_name = {
        normalize(entry["pokemon_species"]["name"]): int(entry["entry_number"])
        for entry in payload["pokemon_entries"]
        if int(entry["entry_number"]) <= MAX_NATIONAL_DEX_ID
    }

    mapping = {}
    unmatched = []
    for line in POKEMON_TEXT.read_text(encoding="utf-8").splitlines():
        if ":" not in line:
            continue
        raw_id, raw_name = line.split(":", 1)
        species_id = int(raw_id)
        key = SPECIES_ID_ALIASES.get(species_id, NAME_ALIASES.get(normalize(raw_name), normalize(raw_name)))
        if raw_name.startswith("Unown "):
            key = "unown"
        dex_id = dex_by_name.get(key)
        if dex_id is None:
            unmatched.append({"species_id": species_id, "name": raw_name})
            continue
        mapping[str(species_id)] = dex_id

    output = {
        "source": "PokeAPI National Dex",
        "max_dex_id": MAX_NATIONAL_DEX_ID,
        "species_to_dex": mapping,
        "unmapped_internal_species": unmatched,
    }
    encoded = json.dumps(output, indent=2, sort_keys=True) + "\n"
    BACKEND_DATA.write_text(encoded, encoding="utf-8")
    FRONTEND_DATA.write_text(encoded, encoding="utf-8")
    NATIVE_DATA.write_text(
        "\n".join(f"{species_id}:{dex_id}" for species_id, dex_id in sorted(mapping.items(), key=lambda item: int(item[0]))) + "\n",
        encoding="utf-8",
    )
    print(f"Mapped {len(mapping)} internal species IDs to National Dex entries.")
    print(f"Unmapped internal entries: {len(unmatched)}")


if __name__ == "__main__":
    main()
