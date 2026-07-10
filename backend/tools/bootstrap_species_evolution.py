#!/usr/bin/env python3
"""Build species evolution metadata for roster/legality helpers.

This maps Unbound species ids to a best-effort final-form summary using pinned
Showdown evolution-chain data plus the ROM-derived PUSE lookup tables.
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.request
from pathlib import Path

from core.data_loader import backend_root, data_path


SHOWDOWN_REPO = "smogon/pokemon-showdown"
SHOWDOWN_COMMIT = "d21da3c860f62d2ecd2feec7d910ef56d5054988"
SHOWDOWN_PDEX_URL = (
    f"https://raw.githubusercontent.com/{SHOWDOWN_REPO}/{SHOWDOWN_COMMIT}/data/pokedex.ts"
)
FRONTEND_CORE = backend_root().parent / "frontend" / "src" / "core"

ROLE_DEFINING_HIDDEN_ABILITIES = {
    "snowwarning",
    "drizzle",
    "drought",
    "sandstream",
    "electricsurge",
    "grassysurge",
    "mistysurge",
    "psychicsurge",
}


def normalize_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def load_json(name: str) -> dict:
    return json.loads(data_path(name).read_text(encoding="utf-8"))


def load_species_rows() -> list[dict]:
    payload = load_json("species_table_from_rom.json")
    rows = payload.get("species")
    if not isinstance(rows, list):
        raise RuntimeError("species_table_from_rom.json is missing species rows")
    return rows


def load_id_name_file(name: str) -> dict[int, str]:
    out: dict[int, str] = {}
    for raw in data_path(name).read_text(encoding="utf-8", errors="ignore").splitlines():
        if ":" not in raw:
            continue
        left, right = raw.split(":", 1)
        if left.strip().isdigit():
            out[int(left.strip())] = right.strip()
    return out


def fetch_showdown_raw() -> str:
    req = urllib.request.Request(SHOWDOWN_PDEX_URL, headers={"User-Agent": "puse-evolution-sync"})
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.read().decode("utf-8", errors="replace")


def extract_brace_block(text: str, open_index: int) -> str:
    depth = 0
    for idx in range(open_index, len(text)):
        char = text[idx]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[open_index:idx + 1]
    raise ValueError("Unbalanced brace block")


def parse_scalar_field(block: str, field: str) -> str | int | None:
    quoted = re.search(rf'{field}:\s*"([^"]+)"', block)
    if quoted:
        return quoted.group(1)
    numeric = re.search(rf"{field}:\s*(\d+)", block)
    if numeric:
        return int(numeric.group(1))
    return None


def parse_showdown_entries(raw: str) -> dict[str, dict]:
    entries: dict[str, dict] = {}
    for match in re.finditer(r"\n\s*([a-z0-9]+):\s*\{", raw):
        key = match.group(1)
        block = extract_brace_block(raw, match.end() - 1)
        name_match = re.search(r'name:\s*"([^"]+)"', block)
        evos_match = re.search(r"evos:\s*\[([^\]]*)\]", block)
        evos_string_match = re.search(r'evos:\s*"([^"]+)"', block)
        prevo_match = re.search(r'prevo:\s*"([^"]+)"', block)
        ability_match = re.search(r'abilities:\s*\{\s*0:\s*"([^"]+)"', block)
        hidden_match = re.search(r'H:\s*"([^"]+)"', block)
        gender_match = re.search(r'gender:\s*"([FM])"', block)

        if evos_match:
            evos = [normalize_token(part) for part in re.findall(r'["\']([^"\']+)["\']', evos_match.group(1))]
        elif evos_string_match:
            evos = [normalize_token(evos_string_match.group(1))]
        else:
            evos = []

        entries[key] = {
            "name": name_match.group(1) if name_match else key,
            "evos": [evo for evo in evos if evo],
            "prevo": normalize_token(prevo_match.group(1)) if prevo_match else None,
            "evo_level": parse_scalar_field(block, "evoLevel"),
            "evo_type": parse_scalar_field(block, "evoType"),
            "evo_item": parse_scalar_field(block, "evoItem"),
            "evo_condition": parse_scalar_field(block, "evoCondition"),
            "ability_primary": ability_match.group(1) if ability_match else None,
            "ability_hidden": hidden_match.group(1) if hidden_match else None,
            "gender": gender_match.group(1) if gender_match else None,
        }
    return entries


def showdown_lookup_keys(name: str, species_id: int, form_aliases: dict[str, dict]) -> list[str]:
    clean = name.strip()
    lowered = clean.lower()
    keys: list[str] = []
    alias_info = form_aliases.get(str(species_id))
    if alias_info:
        token = str(alias_info.get("token", ""))
        if token.endswith("_A"):
            keys.append(token[:-2].lower() + "alola")
        elif token.endswith("_G"):
            keys.append(token[:-2].lower() + "galar")
        elif token.endswith("_H"):
            keys.append(token[:-2].lower() + "hisui")
        elif token.endswith("_F"):
            keys.append(token[:-2].lower() + "f")
        elif token.endswith("_M"):
            keys.append(token[:-2].lower() + "m")
        elif "_" in token:
            keys.append(token.split("_", 1)[0].lower())

    compact = re.sub(r"[^a-z]", "", lowered)
    if compact.startswith("flab"):
        keys.append("flabebe")
    if species_id == 29:
        keys.append("nidoranf")
    elif species_id == 32:
        keys.append("nidoranm")
    elif name == "Basculegon":
        keys.append("basculegion")

    keys.append(normalize_token(clean))
    for prefix, suffix in (
        ("alolan ", "alola"),
        ("galarian ", "galar"),
        ("hisuian ", "hisui"),
        ("paldean ", "paldea"),
        ("mega ", "mega"),
        ("primal ", "primal"),
    ):
        if lowered.startswith(prefix):
            base = clean.split(" ", 1)[1]
            keys.append(normalize_token(suffix + base))
            keys.append(normalize_token(base + suffix))
    if lowered.startswith("mega "):
        keys.append(normalize_token(clean.split(" ", 1)[1]))
    if lowered == "blacphalon":
        keys.append("blacephalon")

    out: list[str] = []
    for key in keys:
        if key and key not in out:
            out.append(key)
    return out


def resolve_showdown_key(name: str, entries: dict[str, dict], species_id: int, form_aliases: dict[str, dict]) -> str | None:
    for key in showdown_lookup_keys(name, species_id, form_aliases):
        if key in entries:
            return key
    return None


def calc_bst(stats: dict | None) -> int | None:
    if not stats:
        return None
    total = 0
    for key in ("hp", "atk", "def", "spa", "spd", "spe"):
        if key not in stats:
            return None
        total += int(stats[key])
    return total


def showdown_entry_tokens(entry: dict, key: str) -> set[str]:
    name = str(entry.get("name", ""))
    tokens = {normalize_token(name), normalize_token(key)}
    if "-" in name:
        tokens.add(normalize_token(name.split("-", 1)[0]))
    if normalize_token(name).startswith("basculegion"):
        tokens.add("basculegon")
    return {token for token in tokens if token}


def resolve_species_id_for_showdown_key(
    key: str,
    entries: dict[str, dict],
    species_rows: list[dict],
    form_aliases: dict[str, dict],
    hint_species_id: int,
) -> int | None:
    entry = entries.get(key)
    if not entry:
        return None
    tokens = showdown_entry_tokens(entry, key)
    matches = [
        int(row["species_id"])
        for row in species_rows
        if normalize_token(str(row["name"])) in tokens
    ]
    if not matches:
        return None
    if hint_species_id in matches:
        return hint_species_id

    hint_alias = form_aliases.get(str(hint_species_id))
    if hint_alias:
        alias = hint_alias.get("alias")
        for species_id in matches:
            row_alias = form_aliases.get(str(species_id))
            if row_alias and row_alias.get("alias") == alias:
                return species_id
    return min(matches)


def collect_mapped_final_candidates(
    start_key: str,
    entries: dict[str, dict],
    species_rows: list[dict],
    form_aliases: dict[str, dict],
    hint_species_id: int,
    base_stats: dict[str, dict],
) -> list[tuple[str, int, int | None]]:
    queue = [start_key]
    visited: set[str] = set()
    mapped: list[tuple[str, int, int | None]] = []
    while queue:
        key = queue.pop(0)
        if key in visited:
            continue
        visited.add(key)
        species_id = resolve_species_id_for_showdown_key(key, entries, species_rows, form_aliases, hint_species_id)
        if species_id:
            mapped.append((key, species_id, calc_bst(base_stats.get(str(species_id)))))
        queue.extend(entries.get(key, {}).get("evos") or [])
    mapped.sort(key=lambda row: (row[2] or -1, row[1]), reverse=True)
    return mapped


def find_chain_root(key: str, entries: dict[str, dict]) -> str:
    current = key
    seen = {current}
    while True:
        prevo = entries.get(current, {}).get("prevo")
        if not prevo or prevo not in entries or prevo in seen:
            return current
        seen.add(prevo)
        current = prevo


def find_path_to_final(start_key: str, final_key: str, entries: dict[str, dict]) -> list[str] | None:
    if start_key == final_key:
        return [start_key]
    queue: list[tuple[str, list[str]]] = [(start_key, [start_key])]
    visited = {start_key}
    while queue:
        key, path = queue.pop(0)
        for evo in entries.get(key, {}).get("evos") or []:
            if evo in visited:
                continue
            next_path = path + [evo]
            if evo == final_key:
                return next_path
            visited.add(evo)
            queue.append((evo, next_path))
    return None


def format_step_requirement(parent_key: str, child_key: str, entries: dict[str, dict]) -> str | None:
    child = entries.get(child_key) or {}
    parent = entries.get(parent_key) or {}
    if child.get("prevo") != normalize_token(str(parent.get("name", ""))):
        return None
    evo_type = child.get("evo_type")
    level = child.get("evo_level")
    item = child.get("evo_item")
    condition = child.get("evo_condition")
    if evo_type == "useItem" and item:
        return str(item)
    if evo_type == "levelFriendship":
        return f"Lv {level}+Friendship" if level else "Friendship"
    if evo_type == "trade":
        return f"Trade+{item}" if item else "Trade"
    if evo_type == "levelHold" and item:
        return f"Lv {level}+{item}" if level else str(item)
    if level is not None:
        return f"Lv {level}"
    if condition:
        return str(condition)
    if item:
        return str(item)
    return None


def build_evo_requirements(path: list[str], entries: dict[str, dict]) -> str | None:
    steps = [
        step
        for idx in range(1, len(path))
        if (step := format_step_requirement(path[idx - 1], path[idx], entries))
    ]
    return " -> ".join(steps) if steps else None


def primary_ability_name(species_id: int, abilities_meta: dict[str, dict], ability_names: dict[int, str], showdown_entry: dict | None) -> str | None:
    meta = abilities_meta.get(str(species_id))
    if meta:
        ability_id = int(meta.get("ability_1_id") or 0)
        if ability_id > 0:
            return ability_names.get(ability_id)
    return showdown_entry.get("ability_primary") if showdown_entry else None


def hidden_ability_name(species_id: int, abilities_meta: dict[str, dict], ability_names: dict[int, str], showdown_entry: dict | None) -> str | None:
    if showdown_entry and showdown_entry.get("ability_hidden"):
        return showdown_entry.get("ability_hidden")
    hidden_id = int((abilities_meta.get(str(species_id)) or {}).get("hidden_ability_id") or 0)
    return ability_names.get(hidden_id) if hidden_id > 0 else None


def resolve_export_abilities(
    species_id: int,
    final_species_id: int,
    abilities_meta: dict[str, dict],
    ability_names: dict[int, str],
    current_showdown: dict | None,
    final_showdown: dict | None,
) -> tuple[str | None, str | None, bool]:
    current = primary_ability_name(species_id, abilities_meta, ability_names, current_showdown)
    final_primary = primary_ability_name(final_species_id, abilities_meta, ability_names, final_showdown)
    final_hidden = hidden_ability_name(final_species_id, abilities_meta, ability_names, final_showdown)
    if current and final_primary and normalize_token(current) != normalize_token(final_primary):
        return current, final_primary, True
    if (
        current
        and final_hidden
        and final_primary
        and normalize_token(current) == normalize_token(final_primary)
        and normalize_token(current) != normalize_token(final_hidden)
        and normalize_token(final_hidden) in ROLE_DEFINING_HIDDEN_ABILITIES
    ):
        return current, final_hidden, True
    return current, final_primary, False


def build_evolution_meta() -> dict[str, dict]:
    entries = parse_showdown_entries(fetch_showdown_raw())
    species_rows = load_species_rows()
    base_stats = load_json("species_base_stats.json")
    abilities_meta = load_json("species_abilities_meta.json")
    ability_names = load_id_name_file("abilities.txt")
    form_aliases = load_json("species_form_aliases.json")

    out: dict[str, dict] = {}
    for row in species_rows:
        species_id = int(row["species_id"])
        name = str(row["name"])
        showdown_key = resolve_showdown_key(name, entries, species_id, form_aliases)
        if not showdown_key:
            out[str(species_id)] = {
                "species_name": name,
                "is_final_form": True,
                "source": "unmapped",
            }
            continue

        current_entry = entries[showdown_key]
        mapped_finals = collect_mapped_final_candidates(
            showdown_key,
            entries,
            species_rows,
            form_aliases,
            species_id,
            base_stats,
        )
        if not mapped_finals:
            out[str(species_id)] = {
                "species_name": name,
                "is_final_form": not bool(current_entry.get("evos")),
                "source": "unmapped_final",
            }
            continue

        final_key, final_species_id, _final_bst_sort = mapped_finals[0]
        path = find_path_to_final(showdown_key, final_key, entries) or [showdown_key]
        root_key = find_chain_root(showdown_key, entries)
        full_path = find_path_to_final(root_key, final_key, entries) or path
        stage_total = len(full_path)
        stage_index = full_path.index(showdown_key) + 1 if showdown_key in full_path else len(path)
        current_ability, final_ability, ability_changes = resolve_export_abilities(
            species_id,
            final_species_id,
            abilities_meta,
            ability_names,
            current_entry,
            entries.get(final_key),
        )
        final_showdown = entries.get(final_key) or {}
        payload = {
            "species_name": name,
            "final_species_id": final_species_id,
            "final_species_name": final_showdown.get("name", final_key),
            "final_bst": calc_bst(base_stats.get(str(final_species_id))),
            "stage_index": stage_index,
            "stage_total": stage_total,
            "evos_remaining": max(0, stage_total - stage_index),
            "evo_requirements": build_evo_requirements(path, entries),
            "current_ability": current_ability,
            "final_ability": final_ability,
            "ability_changes_on_evo": ability_changes,
            "is_final_form": final_species_id == species_id,
            "source": "showdown_pokedex",
        }
        if final_showdown.get("gender") in ("F", "M"):
            payload["evo_gender"] = final_showdown["gender"]
        out[str(species_id)] = payload
    return out


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Unbound species evolution metadata")
    parser.add_argument(
        "--backend-out",
        type=Path,
        default=data_path("species_evolution_meta.json"),
        help="Canonical backend output path",
    )
    parser.add_argument(
        "--frontend-out",
        type=Path,
        default=FRONTEND_CORE / "speciesEvolutionMeta.json",
        help="Frontend mirror output path",
    )
    parser.add_argument(
        "--no-frontend",
        action="store_true",
        help="Only write the canonical backend data file",
    )
    args = parser.parse_args()

    entries = build_evolution_meta()
    payload = {
        "sources": {
            "pokemon_showdown": {
                "repo": SHOWDOWN_REPO,
                "commit": SHOWDOWN_COMMIT,
                "file": "data/pokedex.ts",
            },
            "puse_backend_data": [
                "species_table_from_rom.json",
                "species_base_stats.json",
                "species_abilities_meta.json",
                "species_form_aliases.json",
                "abilities.txt",
            ],
        },
        "notes": "Final form is chosen as the highest-BST mapped Showdown descendant when multiple branches exist.",
        "species_count": len(entries),
        "entries": entries,
    }
    write_json(args.backend_out, payload)
    print(f"[OK] Wrote {len(entries)} species evolution entries -> {args.backend_out}")
    if not args.no_frontend:
        write_json(args.frontend_out, payload)
        print(f"[OK] Mirrored species evolution entries -> {args.frontend_out}")


if __name__ == "__main__":
    main()
