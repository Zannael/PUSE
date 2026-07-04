"""Parse backend/data/species_id.txt into a species_id -> SPECIES_ constant map.

Used to build deep links to the Unbound Pokedex (ydarissep.github.io/Unbound-Pokedex),
which keys its `?species=` query param on the pokeemerald SPECIES_ constant name
rather than the display name.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "species_id.txt"
BACKEND_OUT = ROOT / "data" / "species_constants.json"
FRONTEND_OUT = ROOT.parent / "frontend" / "src" / "core" / "species_constants.json"

LINE_RE = re.compile(r"^(SPECIES_[A-Z0-9_]+)\s+0x([0-9A-Fa-f]+)$")


def main():
    mapping = {}
    for line in SRC.read_text(encoding="utf-8").splitlines():
        match = LINE_RE.match(line.strip())
        if not match:
            continue
        name, hex_id = match.groups()
        species_id = int(hex_id, 16)
        if species_id == 0:
            continue
        mapping[str(species_id)] = name

    payload = dict(sorted(mapping.items(), key=lambda kv: int(kv[0])))
    text = json.dumps(payload, indent=2) + "\n"
    BACKEND_OUT.write_text(text, encoding="utf-8")
    FRONTEND_OUT.write_text(text, encoding="utf-8")
    print(f"Wrote {len(payload)} species constants to {BACKEND_OUT} and {FRONTEND_OUT}")


if __name__ == "__main__":
    main()
