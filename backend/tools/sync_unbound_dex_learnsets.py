#!/usr/bin/env python3
"""Build Unbound species learnset lookup data.

The source is the Unbound branch of Dynamic-Pokemon-Expansion, which is the
same family of data used by external Unbound Dex tooling. Source commits are
pinned below so regeneration is auditable instead of tracking moving branches.
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

from core.data_loader import backend_root, data_path


DPE_REPO = "Skeli789/Dynamic-Pokemon-Expansion"
DPE_COMMIT = "fe058e0e3ac23cf968cf950de43332135bc1549d"
CFRU_REPO = "Skeli789/Complete-Fire-Red-Upgrade"
CFRU_COMMIT = "b637a27898b14e25dd24d0f69a3e302f0069deb8"

DPE_RAW_BASE = f"https://raw.githubusercontent.com/{DPE_REPO}/{DPE_COMMIT}"
CFRU_MOVES_URL = f"https://raw.githubusercontent.com/{CFRU_REPO}/{CFRU_COMMIT}/include/constants/moves.h"
DPE_TREE_URL = f"https://api.github.com/repos/{DPE_REPO}/git/trees/{DPE_COMMIT}?recursive=1"
FRONTEND_CORE = backend_root().parent / "frontend" / "src" / "core"


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "puse-learnset-sync"})
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.read().decode("utf-8", errors="replace")


def fetch_json(url: str) -> dict:
    return json.loads(fetch_text(url))


def normalize_name(value: str) -> str:
    return re.sub(
        r"[^a-z0-9]+",
        " ",
        value.lower().replace("'", "").replace("’", ""),
    ).strip()


def load_species_token_to_id() -> dict[str, int]:
    mapping: dict[str, int] = {}
    for raw in data_path("species_id.txt").read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 2 or not parts[0].startswith("SPECIES_"):
            continue
        try:
            species_id = int(parts[1], 0)
        except ValueError:
            continue
        if species_id > 0:
            mapping[parts[0]] = species_id
    return mapping


def load_move_token_to_id() -> dict[str, int]:
    text = fetch_text(CFRU_MOVES_URL)
    mapping: dict[str, int] = {}
    for line in text.splitlines():
        match = re.match(r"#define\s+(MOVE_\w+)\s+(0x[0-9A-Fa-f]+|\d+)", line.strip())
        if match:
            token, value = match.groups()
            mapping[token] = int(value, 0)
    return mapping


def load_move_name_to_id() -> dict[str, int]:
    mapping: dict[str, int] = {}
    for raw in data_path("moves.txt").read_text(encoding="utf-8", errors="ignore").splitlines():
        if ":" not in raw:
            continue
        left, right = raw.split(":", 1)
        if left.strip().isdigit():
            mapping[normalize_name(right.strip())] = int(left.strip())
    return mapping


def empty_entry() -> dict[str, set[int]]:
    return {
        "level_up": set(),
        "tmhm": set(),
        "tutor": set(),
        "egg": set(),
    }


def ensure_entry(store: dict[str, dict[str, set[int]]], species_id: int) -> dict[str, set[int]]:
    key = str(species_id)
    if key not in store:
        store[key] = empty_entry()
    return store[key]


def merge_store(target: dict[str, dict[str, set[int]]], source: dict[str, dict[str, set[int]]]) -> None:
    for species_id, buckets in source.items():
        entry = ensure_entry(target, int(species_id))
        for bucket, values in buckets.items():
            entry[bucket].update(values)


def parse_level_up_learnsets(
    text: str,
    species_token_to_id: dict[str, int],
    move_token_to_id: dict[str, int],
) -> dict[str, dict[str, set[int]]]:
    learnsets_by_name: dict[str, set[int]] = {}
    current_name: str | None = None
    array_re = re.compile(r"static\s+const\s+struct\s+LevelUpMove\s+(s\w+LevelUpLearnset)\[\]")
    move_re = re.compile(r"LEVEL_UP_MOVE\(\s*\d+\s*,\s*(MOVE_\w+)\s*\)")

    for line in text.splitlines():
        array_match = array_re.search(line)
        if array_match:
            current_name = array_match.group(1)
            learnsets_by_name.setdefault(current_name, set())
            continue
        if current_name and "LEVEL_UP_END" in line:
            current_name = None
            continue
        if not current_name:
            continue
        move_match = move_re.search(line)
        if move_match:
            move_id = move_token_to_id.get(move_match.group(1))
            if move_id:
                learnsets_by_name[current_name].add(move_id)

    store: dict[str, dict[str, set[int]]] = {}
    map_re = re.compile(r"\[(SPECIES_\w+)\]\s*=\s*(s\w+LevelUpLearnset)")
    for species_token, learnset_name in map_re.findall(text):
        species_id = species_token_to_id.get(species_token)
        if not species_id:
            continue
        ensure_entry(store, species_id)["level_up"].update(learnsets_by_name.get(learnset_name, set()))
    return store


def parse_egg_moves(
    text: str,
    species_token_to_id: dict[str, int],
    move_token_to_id: dict[str, int],
) -> dict[str, dict[str, set[int]]]:
    store: dict[str, dict[str, set[int]]] = {}
    current_token: str | None = None
    header_re = re.compile(r"egg_moves\(\s*(\w+)")
    move_re = re.compile(r"\b(MOVE_\w+)\b")

    for line in text.splitlines():
        if "egg_moves" in line:
            current_token = None
        header_match = header_re.search(line)
        if header_match:
            candidate = f"SPECIES_{header_match.group(1)}"
            if candidate in species_token_to_id:
                current_token = candidate
        if not current_token:
            continue
        species_id = species_token_to_id[current_token]
        for move_token in move_re.findall(line):
            move_id = move_token_to_id.get(move_token)
            if move_id:
                ensure_entry(store, species_id)["egg"].add(move_id)
    return store


def list_dpe_paths() -> list[str]:
    payload = fetch_json(DPE_TREE_URL)
    return [
        item["path"]
        for item in payload.get("tree", [])
        if item.get("type") == "blob" and isinstance(item.get("path"), str)
    ]


def parse_compatibility_dir(
    paths: list[str],
    species_token_to_id: dict[str, int],
    move_name_to_id: dict[str, int],
    bucket: str,
) -> dict[str, dict[str, set[int]]]:
    store: dict[str, dict[str, set[int]]] = {}
    header_re = re.compile(r"^(?:TM|HM|Tutor)\d+:\s*(.+)$", re.IGNORECASE)

    for path in paths:
        if not path.endswith(".txt"):
            continue
        display_name = Path(path).name.split(" - ", 1)[-1].rsplit(".", 1)[0]
        move_id = move_name_to_id.get(normalize_name(display_name))
        if not move_id:
            continue

        url = f"{DPE_RAW_BASE}/{path.replace(' ', '%20')}"
        try:
            text = fetch_text(url)
        except urllib.error.URLError:
            continue

        for raw in text.splitlines():
            line = raw.strip()
            if not line or header_re.match(line):
                continue
            species_id = species_token_to_id.get(f"SPECIES_{line}")
            if species_id:
                ensure_entry(store, species_id)[bucket].add(move_id)
    return store


def finalize(store: dict[str, dict[str, set[int]]]) -> dict[str, dict[str, list[int]]]:
    out: dict[str, dict[str, list[int]]] = {}
    for species_id, buckets in sorted(store.items(), key=lambda item: int(item[0])):
        merged: set[int] = set()
        serialized: dict[str, list[int]] = {}
        for bucket in ("level_up", "tmhm", "tutor", "egg"):
            values = sorted(buckets.get(bucket, set()))
            serialized[bucket] = values
            merged.update(values)
        serialized["all"] = sorted(merged)
        out[species_id] = serialized
    return out


def build_learnsets() -> dict[str, dict[str, list[int]]]:
    species_token_to_id = load_species_token_to_id()
    move_token_to_id = load_move_token_to_id()
    move_name_to_id = load_move_name_to_id()
    dpe_paths = list_dpe_paths()

    store: dict[str, dict[str, set[int]]] = {}
    learnsets_text = fetch_text(f"{DPE_RAW_BASE}/src/Learnsets.c")
    egg_text = fetch_text(f"{DPE_RAW_BASE}/src/Egg_Moves.c")

    merge_store(store, parse_level_up_learnsets(learnsets_text, species_token_to_id, move_token_to_id))
    merge_store(store, parse_egg_moves(egg_text, species_token_to_id, move_token_to_id))
    merge_store(
        store,
        parse_compatibility_dir(
            [path for path in dpe_paths if path.startswith("src/tm_compatibility/")],
            species_token_to_id,
            move_name_to_id,
            "tmhm",
        ),
    )
    merge_store(
        store,
        parse_compatibility_dir(
            [path for path in dpe_paths if path.startswith("src/tutor_compatibility/")],
            species_token_to_id,
            move_name_to_id,
            "tutor",
        ),
    )
    return finalize(store)


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Unbound species learnset lookup data")
    parser.add_argument(
        "--backend-out",
        type=Path,
        default=data_path("species_learnsets.json"),
        help="Canonical backend output path",
    )
    parser.add_argument(
        "--frontend-out",
        type=Path,
        default=FRONTEND_CORE / "speciesLearnsets.json",
        help="Frontend mirror output path",
    )
    parser.add_argument(
        "--no-frontend",
        action="store_true",
        help="Only write the canonical backend data file",
    )
    args = parser.parse_args()

    learnsets = build_learnsets()
    payload = {
        "sources": {
            "dynamic_pokemon_expansion": {
                "repo": DPE_REPO,
                "commit": DPE_COMMIT,
            },
            "complete_fire_red_upgrade": {
                "repo": CFRU_REPO,
                "commit": CFRU_COMMIT,
                "file": "include/constants/moves.h",
            },
        },
        "species_count": len(learnsets),
        "learnsets": learnsets,
    }
    write_json(args.backend_out, payload)
    print(f"[OK] Wrote {payload['species_count']} species learnsets -> {args.backend_out}")

    if not args.no_frontend:
        write_json(args.frontend_out, payload)
        print(f"[OK] Mirrored species learnsets -> {args.frontend_out}")


if __name__ == "__main__":
    main()
