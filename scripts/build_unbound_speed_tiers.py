#!/usr/bin/env python3
"""Build unbound_speed_tiers.csv from trainers xlsx + repo static config.

Benchmark Speed Stat uses each threat's doc level (Boss Level). Cap Benchmark Speed
and Required Roster Speed use the badge Level Cap so bracket targets stay consistent.
"""

from __future__ import annotations

import csv
import json
import math
import re
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "backend" / "data"
CORE = ROOT / "frontend" / "src" / "core"
XLSX_PATH = ROOT / "backend" / "local_artifacts" / "expert_bosses.xlsx"
OUTPUT = ROOT / "unbound_speed_tiers.csv"
JSON_OUTPUT_BACKEND = DATA / "unbound_speed_tiers.json"
JSON_OUTPUT_FRONTEND = CORE / "unbound_speed_tiers.json"

LEVEL_CAPS_PATH = DATA / "unbound_level_caps.json"
RULES_PATH = DATA / "expert_mode_rules.json"
BASE_STATS_PATH = CORE / "speciesBaseStats.json"
SPECIES_TABLE_PATH = DATA / "species_table_from_rom.json"
SPECIES_TYPES_PATH = CORE / "species_types.json"

FIELDNAMES = [
    "Level Cap",
    "Boss Name",
    "Key Speed Threat",
    "Base Speed",
    "Boss Level",
    "Benchmark Speed Stat",
    "Cap Benchmark Speed",
    "Required Roster Speed",
    "Threat Mechanics",
]

NATURES = {
    "hardy": 0, "lonely": 1, "brave": 2, "adamant": 3, "naughty": 4,
    "bold": 5, "docile": 6, "relaxed": 7, "impish": 8, "lax": 9,
    "timid": 10, "hasty": 11, "serious": 12, "jolly": 13, "naive": 14,
    "modest": 15, "mild": 16, "quiet": 17, "bashful": 18, "rash": 19,
    "calm": 20, "gentle": 21, "sassy": 22, "careful": 23, "quirky": 24,
}

INC_DEC = {
    0: (None, None), 1: ("atk", "def"), 2: ("atk", "spe"), 3: ("atk", "spa"), 4: ("atk", "spd"),
    5: ("def", "atk"), 6: (None, None), 7: ("def", "spe"), 8: ("def", "spa"), 9: ("def", "spd"),
    10: ("spe", "atk"), 11: ("spe", "def"), 12: (None, None), 13: ("spe", "spa"), 14: ("spe", "spd"),
    15: ("spa", "atk"), 16: ("spa", "def"), 17: ("spa", "spe"), 18: (None, None), 19: ("spa", "spd"),
    20: ("spd", "atk"), 21: ("spd", "def"), 22: ("spd", "spe"), 23: ("spd", "spa"), 24: (None, None),
}

SPECIES_ID_ALIASES = {
    "alolan ninetales": "1026",
    "alolan golem": "1033",
    "landorus therian": "698",
    "mega pinsir": "127",
    "mega lopunny": "428",
    "mega altaria": "334",
    "mega ampharos": "181",
    "mega gyarados": "130",
    "mega scizor": "212",
    "mega banette": "378",
    "mega salamence": "397",
    "mega mawile": "303",
    "mega sceptile": "254",
    "minior": "774",
    "blacephalon": "1077",
    "blacphalon": "1077",
}

PRIORITY_MOVE_TAGS = {
    "accelerock": "Accelerock",
    "aqua jet": "AquaJet",
    "bullet punch": "BulletPunch",
    "extreme speed": "ExtremeSpeed",
    "fake out": "FakeOut",
    "feint": "Feint",
    "first impression": "FirstImpression",
    "grassy glide": "GrassyGlide",
    "ice shard": "IceShard",
    "mach punch": "MachPunch",
    "quick attack": "QuickAttack",
    "shadow sneak": "ShadowSneak",
    "sucker punch": "SuckerPunch",
    "surging strikes": "SurgingStrikes",
    "wicked blow": "WickedBlow",
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_name_to_id() -> dict[str, str]:
    payload = load_json(SPECIES_TABLE_PATH)
    mapping: dict[str, str] = {}
    for entry in payload["species"]:
        mapping[entry["name"].lower()] = str(entry["species_id"])
    mapping.update(SPECIES_ID_ALIASES)
    return mapping


def resolve_species_id(species: str, name_to_id: dict[str, str]) -> str:
    clean = species.split("[")[0].strip()
    lowered = clean.lower()
    if lowered in SPECIES_ID_ALIASES:
        return SPECIES_ID_ALIASES[lowered]
    if lowered.startswith("mega "):
        token = clean.split(" ", 1)[1].lower()
        return SPECIES_ID_ALIASES.get(f"mega {token}", name_to_id[token])
    if lowered in name_to_id:
        return name_to_id[lowered]
    raise KeyError(clean)


def resolve_species_name(name: str) -> str:
    clean = name.split("[")[0].strip()
    if clean.lower() == "blacphalon":
        return "Blacephalon"
    if clean.lower().startswith("mega "):
        return f"Mega {clean.split(' ', 1)[1]}"
    return clean


def nature_mult(nature_id: int, stat: str) -> float:
    inc, dec = INC_DEC[nature_id % 25]
    if stat == inc:
        return 1.1
    if stat == dec:
        return 0.9
    return 1.0


def get_base_speed(species: str, *, base_stats: dict, name_to_id: dict[str, str]) -> int:
    sid = resolve_species_id(species, name_to_id)
    return int(base_stats[sid]["spe"])


def calc_speed(
    species: str,
    level: int,
    nature: str,
    spe_ev: int,
    spe_iv: int,
    *,
    base_stats: dict,
    name_to_id: dict[str, str],
) -> int:
    base_spe = get_base_speed(species, base_stats=base_stats, name_to_id=name_to_id)
    nature_id = NATURES[str(nature).lower()]
    neutral = math.floor(((2 * base_spe + spe_iv + int(float(spe_ev)) // 4) * int(float(level))) / 100) + 5
    return math.floor(neutral * nature_mult(nature_id, "spe"))


def normalize_item_token(item: str) -> str:
    return re.sub(r"\s+", " ", item.strip().lower())


def detect_priority_tag(moves: list[str]) -> str | None:
    for move in moves:
        token = re.sub(r"[^a-z0-9]+", " ", move.lower()).strip()
        if token in PRIORITY_MOVE_TAGS:
            return PRIORITY_MOVE_TAGS[token]
    return None


def species_types_for(
    species: str,
    *,
    species_types: dict,
    name_to_id: dict[str, str],
    override_types: list[str] | None = None,
) -> list[str]:
    if override_types:
        return override_types
    sid = resolve_species_id(species, name_to_id)
    entry = species_types.get(sid, {})
    return list(entry.get("types") or [entry.get("type1", "Normal")])


def has_type(types: list[str], wanted: str) -> bool:
    return wanted.lower() in {t.lower() for t in types}


def classify_mechanics(mon: dict, gimmick: str, types: list[str]) -> list[str]:
    tags: list[str] = []
    held = normalize_item_token(mon.get("held_item", ""))
    gimmick_lower = gimmick.lower()
    ability_lower = mon.get("ability", "").lower()

    if "trick room" in gimmick_lower:
        tags.append("TrickRoom")
    if "choice scarf" in held:
        tags.append("ChoiceScarf")
    if "tailwind" in gimmick_lower and has_type(types, "Flying"):
        tags.append("Tailwind-Core")
    if "sandstorm" in gimmick_lower and "sand rush" in ability_lower:
        tags.append("Weather-SandRush")
    if "heavy rain" in gimmick_lower and "swift swim" in ability_lower:
        tags.append("Weather-Rain")
    if ("harsh sunlight" in gimmick_lower or "sun" in gimmick_lower) and "chlorophyll" in ability_lower:
        tags.append("Weather-Sun")

    priority = detect_priority_tag(mon.get("moves", []))
    if priority:
        tags.append(f"Priority-{priority}")

    return tags if tags else ["None"]


def format_mechanics(tags: list[str]) -> str:
    return "|".join(tags)


def apply_field_modifiers(raw_speed: int, mon: dict, gimmick: str, types: list[str]) -> int:
    speed = raw_speed
    gimmick_lower = gimmick.lower()
    ability_lower = mon.get("ability", "").lower()
    held = normalize_item_token(mon.get("held_item", ""))

    if "choice scarf" in held:
        speed = math.floor(speed * 1.5)
    if "tailwind" in gimmick_lower and has_type(types, "Flying"):
        speed *= 2
    if "heavy rain" in gimmick_lower and "swift swim" in ability_lower:
        speed *= 2
    if "sandstorm" in gimmick_lower and "sand rush" in ability_lower:
        speed *= 2
    if ("harsh sunlight" in gimmick_lower or "sun" in gimmick_lower) and "chlorophyll" in ability_lower:
        speed *= 2
    return speed


def load_sheet_rows(sheet_name: str) -> list[list]:
    workbook = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
    worksheet = workbook[sheet_name]
    rows = [[("" if value is None else value) for value in row] for row in worksheet.iter_rows(values_only=True)]
    workbook.close()
    return rows


def parse_optional_level_cap_overrides() -> dict[str, int]:
    if not XLSX_PATH.exists():
        return {}
    try:
        rows = load_sheet_rows("Level Cap Mapping")
    except Exception:
        return {}
    overrides: dict[str, int] = {}
    for row in rows[1:]:
        if len(row) < 2 or not row[0] or not row[1]:
            continue
        trainer = str(row[0]).strip()
        try:
            overrides[trainer] = int(float(row[1]))
        except ValueError:
            continue
    return overrides


def parse_trainer_blocks(rows: list[list]) -> dict[str, dict]:
    blocks: dict[str, dict] = {}
    index = 0
    while index < len(rows):
        row = rows[index]
        if row and row[0] == "Name" and row[1]:
            title = str(row[1]).strip()
            field_rows: dict[str, list] = {}
            move_rows: list[list[str]] = []
            collecting_moves = False
            cursor = index + 1
            while cursor < len(rows) and not (rows[cursor] and rows[cursor][0] == "Name" and rows[cursor][1]):
                current = rows[cursor]
                if current and current[0]:
                    key = str(current[0])
                    values = current[1:]
                    if key == "Moves":
                        collecting_moves = True
                        move_rows.append([str(v) if v != "" else "" for v in values])
                    elif key == "Nature":
                        collecting_moves = False
                        field_rows[key] = values
                    else:
                        collecting_moves = False
                        field_rows[key] = values
                elif collecting_moves and current:
                    move_rows.append([str(v) if v != "" else "" for v in current[1:]])
                cursor += 1

            names = [str(value).split("[")[0].strip() for value in field_rows.get("Pokemon Names", []) if value != ""]
            levels = field_rows.get("Level at Cap", field_rows.get("Level at cap", []))
            natures = field_rows.get("Nature", [])
            spe_evs = field_rows.get("Speed EVs", [])
            spe_ivs = field_rows.get("Speed IVs", [])
            abilities = field_rows.get("Ability", [])
            held_items = field_rows.get("Held Item", [])
            type1_row = field_rows.get("Type 1", [])
            type2_row = field_rows.get("Type 2", [])

            mons = []
            for idx, name in enumerate(names):
                if idx >= len(levels):
                    break
                level_raw = levels[idx]
                if level_raw == "" or level_raw is None:
                    continue

                moves: list[str] = []
                for move_row in move_rows:
                    if idx < len(move_row) and move_row[idx]:
                        moves.append(move_row[idx])

                override_types: list[str] | None = None
                if idx < len(type1_row) and type1_row[idx]:
                    t1 = str(type1_row[idx]).strip()
                    t2 = str(type2_row[idx]).strip() if idx < len(type2_row) and type2_row[idx] else t1
                    override_types = [t1] if t1 == t2 else [t1, t2]

                mons.append(
                    {
                        "name": name,
                        "level": int(float(level_raw)),
                        "nature": str(natures[idx] if idx < len(natures) else "Hardy"),
                        "spe_ev": int(float(spe_evs[idx] if idx < len(spe_evs) else 0)),
                        "spe_iv": int(float(spe_ivs[idx])) if idx < len(spe_ivs) and str(spe_ivs[idx]) != "" else None,
                        "ability": str(abilities[idx] if idx < len(abilities) else "").replace("\u2192", "->"),
                        "held_item": str(held_items[idx] if idx < len(held_items) else ""),
                        "moves": moves,
                        "override_types": override_types,
                    }
                )

            blocks[title] = {"gimmick": str(field_rows.get("Fight Gimmicks", [""])[0] or "").strip(), "mons": mons}
            index = cursor
        else:
            index += 1
    return blocks


def load_all_blocks() -> dict[str, dict]:
    blocks: dict[str, dict] = {}
    for sheet in ("Gym Leaders", "Pokemon League"):
        parsed = parse_trainer_blocks(load_sheet_rows(sheet))
        blocks.update(parsed)
    return blocks


def find_mon(block: dict, pokemon: str) -> dict:
    target = pokemon.lower()
    for mon in block["mons"]:
        name = mon["name"].lower()
        if name == target or target in name or resolve_species_name(mon["name"]).lower() == target:
            return mon
        if target.startswith("mega ") and name.startswith("mega "):
            if target.split(" ", 1)[1] in name:
                return mon
    raise KeyError(pokemon)


def load_csv_plan(level_cap_overrides: dict[str, int], blocks: dict[str, dict]) -> list[dict]:
    payload = load_json(LEVEL_CAPS_PATH)
    plan: list[dict] = []
    for entry in payload["entries"]:
        trainer = entry["trainer"]
        level_cap = level_cap_overrides.get(trainer, entry["level_cap"])
        block = blocks.get(trainer)
        if block is None:
            # Milestone present in the boss list but not yet in the workbook. Skip its
            # speed-tier rows instead of failing the whole build; the export degrades
            # gracefully to threat names until the workbook is updated for this boss.
            print(f"WARNING: no trainer block in workbook for '{trainer}'; skipping speed-tier rows")
            continue
        for mon in block["mons"]:
            plan.append(
                {
                    "level_cap": level_cap,
                    "boss_name": entry["boss_name"],
                    "trainer": trainer,
                    "pokemon": mon["name"],
                }
            )
    return plan


def enrich_mon(
    mon: dict,
    block: dict,
    *,
    base_stats: dict,
    name_to_id: dict[str, str],
    species_types: dict,
    default_spe_iv: int,
) -> None:
    spe_iv = mon["spe_iv"] if mon.get("spe_iv") is not None else default_spe_iv
    mon["spe_iv"] = spe_iv
    mon["base_speed"] = get_base_speed(mon["name"], base_stats=base_stats, name_to_id=name_to_id)
    types = species_types_for(
        mon["name"],
        species_types=species_types,
        name_to_id=name_to_id,
        override_types=mon.get("override_types"),
    )
    mon["types"] = types
    mon["raw_speed"] = calc_speed(
        mon["name"],
        mon["level"],
        mon["nature"],
        mon["spe_ev"],
        spe_iv,
        base_stats=base_stats,
        name_to_id=name_to_id,
    )
    mon["benchmark_speed"] = apply_field_modifiers(mon["raw_speed"], mon, block["gimmick"], types)
    mon["threat_mechanics"] = format_mechanics(classify_mechanics(mon, block["gimmick"], types))


def cap_benchmark_speed(
    mon: dict,
    level_cap: int,
    block: dict,
    *,
    base_stats: dict,
    name_to_id: dict[str, str],
) -> int:
    raw = calc_speed(
        mon["name"],
        level_cap,
        mon["nature"],
        mon["spe_ev"],
        mon["spe_iv"],
        base_stats=base_stats,
        name_to_id=name_to_id,
    )
    return apply_field_modifiers(raw, mon, block["gimmick"], mon["types"])


def main() -> None:
    if not XLSX_PATH.exists():
        raise FileNotFoundError(f"Missing trainers workbook: {XLSX_PATH}")

    rules = load_json(RULES_PATH)
    default_spe_iv = int(rules["default_ivs"]["Spe"])
    base_stats = load_json(BASE_STATS_PATH)
    species_types = load_json(SPECIES_TYPES_PATH)
    name_to_id = load_name_to_id()
    blocks = load_all_blocks()
    level_cap_overrides = parse_optional_level_cap_overrides()
    plan = load_csv_plan(level_cap_overrides, blocks)

    rows: list[dict[str, str | int]] = []
    for entry in plan:
        block = blocks[entry["trainer"]]
        mon = find_mon(block, entry["pokemon"])
        enrich_mon(
            mon,
            block,
            base_stats=base_stats,
            name_to_id=name_to_id,
            species_types=species_types,
            default_spe_iv=default_spe_iv,
        )
        display = resolve_species_name(mon["name"])
        if entry["pokemon"].lower().startswith("mega "):
            display = f"Mega {resolve_species_name(entry['pokemon'].split(' ', 1)[1])}"
        boss_benchmark = int(mon["benchmark_speed"])
        cap_benchmark = cap_benchmark_speed(
            mon,
            entry["level_cap"],
            block,
            base_stats=base_stats,
            name_to_id=name_to_id,
        )
        rows.append(
            {
                "Level Cap": entry["level_cap"],
                "Boss Name": entry["boss_name"],
                "Key Speed Threat": display,
                "Base Speed": int(mon["base_speed"]),
                "Boss Level": int(mon["level"]),
                "Benchmark Speed Stat": boss_benchmark,
                "Cap Benchmark Speed": cap_benchmark,
                "Required Roster Speed": cap_benchmark + 1,
                "Threat Mechanics": mon["threat_mechanics"],
            }
        )

    with OUTPUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)

    json_rows = []
    for row in rows:
        mechanics = str(row["Threat Mechanics"] or "None").split("|")
        json_rows.append(
            {
                "level_cap": int(row["Level Cap"]),
                "boss_name": str(row["Boss Name"]),
                "threat": str(row["Key Speed Threat"]),
                "base_speed": int(row["Base Speed"]),
                "boss_level": int(row["Boss Level"]),
                "benchmark_speed_stat": int(row["Benchmark Speed Stat"]),
                "cap_benchmark_speed": int(row["Cap Benchmark Speed"]),
                "required_roster_speed": int(row["Required Roster Speed"]),
                "threat_mechanics": [part for part in mechanics if part] or ["None"],
            }
        )

    json_payload = {
        "mode": "expert",
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "source": {
            "csv": "unbound_speed_tiers.csv",
            "trainers_workbook": "backend/local_artifacts/expert_bosses.xlsx",
            "level_caps": "backend/data/unbound_level_caps.json",
            "expert_rules": "backend/data/expert_mode_rules.json",
            "base_stats": "frontend/src/core/speciesBaseStats.json",
            "species_types": "frontend/src/core/species_types.json",
        },
        "entries": json_rows,
    }
    encoded = json.dumps(json_payload, indent=2, ensure_ascii=False) + "\n"
    JSON_OUTPUT_BACKEND.write_text(encoded, encoding="utf-8")
    JSON_OUTPUT_FRONTEND.write_text(encoded, encoding="utf-8")

    print(f"Wrote {len(rows)} rows -> {OUTPUT}")
    print(f"Wrote JSON -> {JSON_OUTPUT_BACKEND}")
    print(f"Mirrored JSON -> {JSON_OUTPUT_FRONTEND}")


if __name__ == "__main__":
    main()
