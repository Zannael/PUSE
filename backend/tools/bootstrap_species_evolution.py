#!/usr/bin/env python3
"""Build species_evolution_meta.json (final-form BST tags for roster export).

Uses Showdown pokedex evolution chains matched to ROM species names.
"""

from __future__ import annotations

import json
import re
import urllib.request

from core.data_loader import backend_root, data_path

SHOWDOWN_PDEX_URL = (
    "https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/pokedex.ts"
)
FRONTEND_CORE = backend_root().parent / "frontend" / "src" / "core"


def normalize_token(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def load_form_aliases() -> dict[str, dict]:
    path = data_path("species_form_aliases.json")
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def load_species_table() -> list[dict]:
    payload = json.loads(data_path("species_table_from_rom.json").read_text(encoding="utf-8"))
    return payload["species"]


def load_base_stats() -> dict[str, dict[str, int]]:
    path = FRONTEND_CORE / "speciesBaseStats.json"
    return json.loads(path.read_text(encoding="utf-8"))


def load_abilities_meta() -> dict[str, dict]:
    path = FRONTEND_CORE / "speciesAbilitiesMeta.json"
    return json.loads(path.read_text(encoding="utf-8"))


def load_ability_names() -> dict[int, str]:
    names: dict[int, str] = {}
    for raw in data_path("abilities.txt").read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or ":" not in line:
            continue
        left, right = line.split(":", 1)
        if left.strip().isdigit():
            names[int(left.strip())] = right.strip()
    return names


def extract_brace_block(text: str, open_index: int) -> str:
    depth = 0
    for idx in range(open_index, len(text)):
        char = text[idx]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[open_index: idx + 1]
    raise ValueError("Unbalanced brace block")


def fetch_showdown_raw() -> str:
    with urllib.request.urlopen(SHOWDOWN_PDEX_URL, timeout=30) as response:
        return response.read().decode("utf-8", errors="ignore")


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
        if evos_match:
            evos = [normalize_token(part) for part in re.findall(r'["\']([^"\']+)["\']', evos_match.group(1))]
        elif evos_string_match:
            evos = [normalize_token(evos_string_match.group(1))]
        else:
            evos = []
        ability_match = re.search(r'abilities:\s*\{\s*0:\s*"([^"]+)"', block)
        hidden_match = re.search(r'H:\s*"([^"]+)"', block)
        gender_match = re.search(r'gender:\s*"([^"]+)"', block)
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


def showdown_lookup_keys(name: str, species_id: int | None = None, form_aliases: dict[str, dict] | None = None) -> list[str]:
    clean = name.strip()
    lowered = clean.lower()
    keys: list[str] = []
    alias_info = (form_aliases or {}).get(str(species_id)) if species_id is not None else None
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
    keys.append(normalize_token(clean))
    replacements = [
        ("alolan ", "alola"),
        ("galarian ", "galar"),
        ("hisuian ", "hisui"),
        ("paldean ", "paldea"),
        ("mega ", "mega"),
        ("primal ", "primal"),
    ]
    for src, dst in replacements:
        if lowered.startswith(src):
            base = clean.split(" ", 1)[1]
            keys.append(normalize_token(dst + base))
            keys.append(normalize_token(base + dst))
            keys.append(normalize_token(base + "alola"))
    if lowered.startswith("mega "):
        keys.append(normalize_token(clean.split(" ", 1)[1]))
    if "therian" in lowered:
        keys.append(normalize_token(clean.replace("Therian", "therian")))
    if lowered == "blacphalon":
        keys.append("blacephalon")
    deduped: list[str] = []
    for key in keys:
        if key and key not in deduped:
            deduped.append(key)
    return deduped


def resolve_showdown_key(
    name: str,
    entries: dict[str, dict],
    species_id: int | None = None,
    form_aliases: dict[str, dict] | None = None,
) -> str | None:
    for key in showdown_lookup_keys(name, species_id, form_aliases):
        if key in entries:
            return key
    return None


def calc_bst(stats: dict[str, int] | None) -> int | None:
    if not stats:
        return None
    total = 0
    for key in ("hp", "atk", "def", "spa", "spd", "spe"):
        value = stats.get(key)
        if value is None:
            return None
        total += int(value)
    return total


def collect_final_candidates(start_key: str, entries: dict[str, dict]) -> list[str]:
    queue = [start_key]
    seen: set[str] = set()
    leaves: list[str] = []
    while queue:
        key = queue.pop(0)
        if key in seen:
            continue
        seen.add(key)
        entry = entries.get(key)
        if not entry:
            leaves.append(key)
            continue
        evos = entry.get("evos") or []
        if not evos:
            leaves.append(key)
            continue
        queue.extend(evos)
    return leaves


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
        species_id = resolve_species_id_for_showdown_key(
            key,
            entries,
            species_rows,
            form_aliases,
            hint_species_id=hint_species_id,
        )
        if species_id:
            mapped.append((key, species_id, calc_bst(base_stats.get(str(species_id)))))
        for evo in entries.get(key, {}).get("evos") or []:
            queue.append(evo)
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
    return current


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


def showdown_entry_name_tokens(entry: dict, key: str) -> set[str]:
    tokens = {normalize_token(entry.get("name", "")), normalize_token(key)}
    display_name = str(entry.get("name", ""))
    if "-" in display_name:
        tokens.add(normalize_token(display_name.split("-", 1)[0]))
    return {token for token in tokens if token}


def resolve_species_id_for_showdown_key(
    key: str,
    entries: dict[str, dict],
    species_rows: list[dict],
    form_aliases: dict[str, dict],
    hint_species_id: int | None = None,
) -> int | None:
    entry = entries.get(key)
    if not entry:
        return None
    tokens = showdown_entry_name_tokens(entry, key)
    matches = [
        int(row["species_id"])
        for row in species_rows
        if normalize_token(str(row["name"])) in tokens
    ]
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    hint_alias = form_aliases.get(str(hint_species_id)) if hint_species_id is not None else None
    if hint_alias:
        alias = hint_alias.get("alias")
        for sid in matches:
            row_alias = form_aliases.get(str(sid))
            if row_alias and row_alias.get("alias") == alias:
                return sid
    if hint_species_id is not None and hint_species_id in matches:
        return hint_species_id
    return min(matches)


def primary_ability_name(
    species_id: int,
    abilities_meta: dict[str, dict],
    ability_names: dict[int, str],
    showdown_entry: dict | None,
) -> str | None:
    meta = abilities_meta.get(str(species_id))
    if meta:
        ability_id = int(meta.get("ability_1_id") or 0)
        if ability_id > 0:
            return ability_names.get(ability_id)
    if showdown_entry:
        return showdown_entry.get("ability_primary")
    return None


    return None


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


def hidden_ability_name(
    species_id: int,
    abilities_meta: dict[str, dict],
    ability_names: dict[int, str],
    showdown_entry: dict | None,
) -> str | None:
    if showdown_entry:
        hidden = showdown_entry.get("ability_hidden")
        if hidden:
            return hidden
    hidden_id = int((abilities_meta.get(str(species_id)) or {}).get("hidden_ability_id") or 0)
    if hidden_id > 0:
        return ability_names.get(hidden_id)
    return None


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


def format_step_requirement(parent_key: str, child_key: str, entries: dict[str, dict]) -> str | None:
    parent = entries.get(parent_key) or {}
    child = entries.get(child_key) or {}
    parent_token = normalize_token(parent.get("name", ""))
    child_prevo = child.get("prevo")

    if child_prevo and child_prevo == parent_token:
        evo_type = child.get("evo_type")
        level = child.get("evo_level")
        item = child.get("evo_item")
        condition = child.get("evo_condition")
        if evo_type == "useItem" and item:
            return str(item)
        if evo_type == "levelFriendship":
            if level:
                return f"Lv {level}+Friendship"
            return "Friendship"
        if evo_type == "trade":
            if item:
                return f"Trade+{item}"
            return "Trade"
        if evo_type == "levelHold" and item:
            if level:
                return f"Lv {level}+{item}"
            return str(item)
        if level is not None:
            return f"Lv {level}"
        if condition:
            return str(condition)
        if item:
            return str(item)
        return "Friendship"

    return None


def build_evo_requirements(path: list[str], entries: dict[str, dict]) -> str | None:
    if len(path) < 2:
        return None
    steps: list[str] = []
    for idx in range(1, len(path)):
        step = format_step_requirement(path[idx - 1], path[idx], entries)
        if step:
            steps.append(step)
    return " → ".join(steps) if steps else None


def bootstrap() -> dict[str, dict]:
    raw = fetch_showdown_raw()
    entries = parse_showdown_entries(raw)
    species_rows = load_species_table()
    base_stats = load_base_stats()
    abilities_meta = load_abilities_meta()
    ability_names = load_ability_names()
    form_aliases = load_form_aliases()

    out: dict[str, dict] = {}
    missing: list[str] = []

    for row in species_rows:
        sid = int(row["species_id"])
        name = str(row["name"])
        showdown_key = resolve_showdown_key(name, entries, sid, form_aliases)
        if not showdown_key:
            missing.append(name)
            out[str(sid)] = {
                "species_name": name,
                "is_final_form": True,
                "source": "unmapped",
            }
            continue

        entry = entries[showdown_key]
        mapped_finals = collect_mapped_final_candidates(
            showdown_key,
            entries,
            species_rows,
            form_aliases,
            sid,
            base_stats,
        )
        if not mapped_finals:
            missing.append(name)
            out[str(sid)] = {
                "species_name": name,
                "is_final_form": not bool(entry.get("evos")),
                "source": "unmapped_final",
            }
            continue

        final_key, final_species_id, _final_bst_sort = mapped_finals[0]
        final_species_name = entries.get(final_key, {}).get("name", final_key)
        path = find_path_to_final(showdown_key, final_key, entries) or [showdown_key]
        root_key = find_chain_root(showdown_key, entries)
        full_path = find_path_to_final(root_key, final_key, entries) or path
        stage_total = len(full_path)
        stage_index = full_path.index(showdown_key) + 1 if showdown_key in full_path else len(path)
        evos_remaining = stage_total - stage_index
        evo_requirements = build_evo_requirements(path, entries)

        current_ability, final_ability, ability_changes = resolve_export_abilities(
            sid,
            final_species_id,
            abilities_meta,
            ability_names,
            entry,
            entries.get(final_key),
        )

        is_final_form = final_species_id == sid
        final_showdown = entries.get(final_key) or {}
        evo_gender = final_showdown.get("gender")
        payload = {
            "species_name": name,
            "final_species_id": final_species_id,
            "final_species_name": final_species_name,
            "final_bst": calc_bst(base_stats.get(str(final_species_id))),
            "stage_index": stage_index,
            "stage_total": stage_total,
            "evos_remaining": evos_remaining,
            "evo_requirements": evo_requirements,
            "current_ability": current_ability,
            "final_ability": final_ability,
            "ability_changes_on_evo": ability_changes,
            "is_final_form": is_final_form,
            "source": "showdown_fallback",
        }
        if evo_gender in ("F", "M"):
            payload["evo_gender"] = evo_gender
        out[str(sid)] = payload

    print(f"[OK] Built evolution meta for {len(out)} species")
    if missing:
        print(f"[WARN] Missing/unmapped evolution data for {len(missing)} species")
    return out


def main() -> None:
    payload = {
        "source": "showdown_pokedex",
        "notes": "Final form chosen as highest-BST mapped descendant in Showdown evo graph. Custom Unbound species may be unmapped.",
        "entries": bootstrap(),
    }
    encoded = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    backend_out = data_path("species_evolution_meta.json")
    frontend_out = FRONTEND_CORE / "species_evolution_meta.json"
    backend_out.write_text(encoded, encoding="utf-8")
    frontend_out.parent.mkdir(parents=True, exist_ok=True)
    frontend_out.write_text(encoded, encoding="utf-8")
    print(f"[OK] Wrote {backend_out}")
    print(f"[OK] Mirrored {frontend_out}")


if __name__ == "__main__":
    main()
