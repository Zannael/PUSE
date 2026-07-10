#!/usr/bin/env python3
"""Build species id -> SPECIES_ constant lookup data.

The canonical input is backend/data/species_id.txt, extracted from the ROM
headers. The backend JSON is canonical; the frontend JSON is a mirror for
local-mode/runtime consumers.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from core.data_loader import backend_root, data_path


LINE_RE = re.compile(r"^(SPECIES_[A-Z0-9_]+)\s+0x([0-9A-Fa-f]+)$")
FRONTEND_CORE = backend_root().parent / "frontend" / "src" / "core"


def build_species_constants(src: Path) -> dict[str, str]:
    mapping: dict[int, str] = {}
    for raw in src.read_text(encoding="utf-8", errors="ignore").splitlines():
        match = LINE_RE.match(raw.strip())
        if not match:
            continue
        token, hex_id = match.groups()
        species_id = int(hex_id, 16)
        if species_id > 0:
            mapping[species_id] = token
    return {str(species_id): token for species_id, token in sorted(mapping.items())}


def write_json(path: Path, payload: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build species constant lookup JSON")
    parser.add_argument(
        "--src",
        type=Path,
        default=data_path("species_id.txt"),
        help="Input species_id.txt path",
    )
    parser.add_argument(
        "--backend-out",
        type=Path,
        default=data_path("species_constants.json"),
        help="Canonical backend output path",
    )
    parser.add_argument(
        "--frontend-out",
        type=Path,
        default=FRONTEND_CORE / "speciesConstants.json",
        help="Frontend mirror output path",
    )
    parser.add_argument(
        "--no-frontend",
        action="store_true",
        help="Only write the canonical backend data file",
    )
    args = parser.parse_args()

    payload = build_species_constants(args.src)
    write_json(args.backend_out, payload)
    print(f"[OK] Wrote {len(payload)} species constants -> {args.backend_out}")

    if not args.no_frontend:
        write_json(args.frontend_out, payload)
        print(f"[OK] Mirrored species constants -> {args.frontend_out}")


if __name__ == "__main__":
    main()
