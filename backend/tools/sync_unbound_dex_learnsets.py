#!/usr/bin/env python3
"""Build species_learnsets.json from Unbound DPE sources (same data as Yda Dex).

Output is keyed by species id (string). Each entry contains move id sets for
level-up, TM/HM, tutor, egg, and a merged ``all`` list used by legit validation.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_DPE = "Skeli789/Dynamic-Pokemon-Expansion/Unbound"
RAW_BASE = f"https://raw.githubusercontent.com/{REPO_DPE}"
CFRU_MOVES_H = "https://raw.githubusercontent.com/Skeli789/Complete-Fire-Red-Upgrade/master/include/constants/moves.h"

BACKEND = Path(__file__).resolve().parents[1]
FRONTEND_CORE = BACKEND.parent / "frontend" / "src" / "core"


def data_path(name: str) -> Path:
    return BACKEND / "data" / name


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "puse-learnset-sync"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", errors="replace")


def load_species_token_to_id() -> dict[str, int]:
    mapping: dict[str, int] = {}
    for raw in data_path("species_id.txt").read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        token = parts[0]
        try:
            sid = int(parts[1], 0)
        except ValueError:
            continue
        if sid > 0:
            mapping[token] = sid
    return mapping


def load_move_token_to_id() -> dict[str, int]:
    text = fetch_text(CFRU_MOVES_H)
    mapping: dict[str, int] = {}
    for line in text.splitlines():
        match = re.match(r"#define\s+(MOVE_\w+)\s+(0x[0-9A-Fa-f]+|\d+)", line.strip())
        if not match:
            continue
        token, value = match.groups()
        mapping[token] = int(value, 0)
    return mapping


def empty_entry() -> dict[str, set[int]]:
    return {
        "level_up": set(),
        "tmhm": set(),
        "tutor": set(),
        "egg": set(),
    }


def ensure_species_entry(store: dict[str, dict[str, set[int]]], sid: int) -> dict[str, set[int]]:
    key = str(sid)
    if key not in store:
        store[key] = empty_entry()
    return store[key]


def parse_learnsets_c(text: str, token_to_id: dict[str, int], move_token_to_id: dict[str, int]) -> dict[str, dict[str, set[int]]]:
    store: dict[str, dict[str, set[int]]] = {}
    conversion: dict[str, list[str]] = {}
    active_species: list[str] = []

    learnset_name_re = re.compile(r"s(\w+)LevelUpLearnset", re.IGNORECASE)
    species_map_re = re.compile(r"\[(SPECIES_\w+)\]\s*=\s*s(\w+)LevelUpLearnset")
    level_move_re = re.compile(r"LEVEL_UP_MOVE\(\s*(\d+)\s*,\s*(MOVE_\w+)\s*\)")

    for line in text.splitlines():
        map_match = species_map_re.search(line)
        if map_match:
            species_token, learnset_key = map_match.groups()
            conversion.setdefault(f"s{learnset_key}LevelUpLearnset", []).append(species_token)
            continue

        learnset_match = learnset_name_re.search(line)
        if learnset_match:
            key = f"s{learnset_match.group(1)}LevelUpLearnset"
            active_species = conversion.get(key, [])
            continue

        move_match = level_move_re.search(line)
        if move_match and active_species:
            _level, move_token = move_match.groups()
            move_id = move_token_to_id.get(move_token)
            if not move_id:
                continue
            for species_token in active_species:
                sid = token_to_id.get(species_token)
                if not sid:
                    continue
                ensure_species_entry(store, sid)["level_up"].add(move_id)

    return store


def parse_egg_moves_c(text: str, token_to_id: dict[str, int], move_token_to_id: dict[str, int]) -> dict[str, dict[str, set[int]]]:
    store: dict[str, dict[str, set[int]]] = {}
    current_token: str | None = None
    egg_header_re = re.compile(r"egg_moves\(\s*(\w+)")
    move_re = re.compile(r"(MOVE_\w+)")

    for line in text.splitlines():
        if "egg_moves" in line:
            current_token = None
        header = egg_header_re.search(line)
        if header:
            species_token = f"SPECIES_{header.group(1)}"
            if species_token in token_to_id:
                current_token = species_token
        for move_token in move_re.findall(line):
            if not current_token:
                continue
            move_id = move_token_to_id.get(move_token)
            sid = token_to_id.get(current_token)
            if move_id and sid:
                ensure_species_entry(store, sid)["egg"].add(move_id)

    return store


def merge_store(target: dict[str, dict[str, set[int]]], source: dict[str, dict[str, set[int]]]) -> None:
    for sid, buckets in source.items():
        entry = ensure_species_entry(target, int(sid))
        for bucket, values in buckets.items():
            entry[bucket].update(values)


def parse_compatibility_dir(
    tree_paths: list[str],
    token_to_id: dict[str, int],
    move_token_to_id: dict[str, int],
    bucket: str,
) -> dict[str, dict[str, set[int]]]:
    store: dict[str, dict[str, set[int]]] = {}
    header_move_re = re.compile(r"^(?:TM|HM|Tutor)\d+:\s*(.+)$", re.IGNORECASE)
    name_to_move_id: dict[str, int] = {}

    moves_txt = data_path("moves.txt").read_text(encoding="utf-8", errors="ignore")
    for raw in moves_txt.splitlines():
        if ":" not in raw:
            continue
        left, right = raw.split(":", 1)
        if not left.strip().isdigit():
            continue
        name_to_move_id[normalize_name(right.strip())] = int(left.strip())

    for path in tree_paths:
        if not path.endswith(".txt"):
            continue
        filename = Path(path).name
        # "26 - Earthquake.txt"
        display_name = filename.split(" - ", 1)[-1].rsplit(".", 1)[0]
        move_id = name_to_move_id.get(normalize_name(display_name))
        if not move_id:
            continue

        url = f"{RAW_BASE}/{path.replace(' ', '%20')}"
        try:
            text = fetch_text(url)
        except urllib.error.URLError:
            continue

        for line in text.splitlines():
            line = line.strip()
            if not line or header_move_re.match(line):
                continue
            species_token = f"SPECIES_{line}"
            sid = token_to_id.get(species_token)
            if not sid:
                continue
            ensure_species_entry(store, sid)[bucket].add(move_id)

    return store


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower().replace("'", "").replace("’", "")).strip()


def list_repo_paths() -> list[str]:
    api_url = f"https://api.github.com/repos/Skeli789/Dynamic-Pokemon-Expansion/git/trees/Unbound?recursive=1"
    req = urllib.request.Request(api_url, headers={"User-Agent": "puse-learnset-sync"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return [item["path"] for item in payload.get("tree", []) if item.get("type") == "blob"]


def finalize(store: dict[str, dict[str, set[int]]]) -> dict[str, dict[str, list[int]]]:
    out: dict[str, dict[str, list[int]]] = {}
    for sid, buckets in sorted(store.items(), key=lambda item: int(item[0])):
        merged = set()
        serialized: dict[str, list[int]] = {}
        for bucket in ("level_up", "tmhm", "tutor", "egg"):
            values = sorted(buckets.get(bucket, set()))
            serialized[bucket] = values
            merged.update(values)
        serialized["all"] = sorted(merged)
        out[sid] = serialized
    return out


def sync_learnsets() -> dict[str, dict[str, list[int]]]:
    token_to_id = load_species_token_to_id()
    move_token_to_id = load_move_token_to_id()

    learnsets_text = fetch_text(f"{RAW_BASE}/src/Learnsets.c")
    egg_text = fetch_text(f"{RAW_BASE}/src/Egg_Moves.c")
    repo_paths = list_repo_paths()

    store: dict[str, dict[str, set[int]]] = {}
    merge_store(store, parse_learnsets_c(learnsets_text, token_to_id, move_token_to_id))
    merge_store(store, parse_egg_moves_c(egg_text, token_to_id, move_token_to_id))
    merge_store(
        store,
        parse_compatibility_dir(
            [p for p in repo_paths if p.startswith("src/tm_compatibility/")],
            token_to_id,
            move_token_to_id,
            "tmhm",
        ),
    )
    merge_store(
        store,
        parse_compatibility_dir(
            [p for p in repo_paths if p.startswith("src/tutor_compatibility/")],
            token_to_id,
            move_token_to_id,
            "tutor",
        ),
    )

    return finalize(store)


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Unbound Dex learnsets into PUSE static data")
    parser.add_argument(
        "--out",
        type=Path,
        default=data_path("species_learnsets.json"),
        help="Backend output path",
    )
    parser.add_argument(
        "--frontend-out",
        type=Path,
        default=FRONTEND_CORE / "species_learnsets.json",
        help="Frontend mirror path",
    )
    args = parser.parse_args()

    payload = {
        "source": REPO_DPE,
        "species_count": 0,
        "learnsets": sync_learnsets(),
    }
    payload["species_count"] = len(payload["learnsets"])

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.frontend_out.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(payload, indent=2, sort_keys=True)
    args.out.write_text(encoded + "\n", encoding="utf-8")
    args.frontend_out.write_text(encoded + "\n", encoding="utf-8")
    print(f"Wrote {payload['species_count']} species learnsets to {args.out}")
    print(f"Mirrored to {args.frontend_out}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise
