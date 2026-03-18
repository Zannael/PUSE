#!/usr/bin/env python3
"""Build ROM-derived species form aliases from species identifiers.

This tool joins `pokemon.txt` (ROM display names by decimal ID) with
`species_id.txt` (identifier tokens by hex ID) using numeric IDs only.

Output schema (keyed by species id as string):
{
  "<species_id>": {
    "token": "SPECIES_TOKEN",
    "alias": "Alias label",
    "confidence": "high",
    "rule": "special|suffix"
  }
}
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from core.data_loader import data_path


SPECIAL_BY_TOKEN = {
    "AEGISLASH": "Shield Forme",
    "DARMANITAN": "Standard Mode",
    "DARMANITAN_G": "Galarian Standard Mode",
    "DARMANITANZEN": "Zen Mode",
    "DARMANITAN_G_ZEN": "Galarian Zen Mode",
    "ASHGRENINJA": "Ash",
    "WISHIWASHI": "Solo Form",
    "WISHIWASHI_S": "School Form",
    "TOXTRICITY": "Amped Form",
    "TOXTRICITY_LOW_KEY": "Low Key Form",
    "TOXTRICITY_LOW_KEY_GIGA": "Low Key Gigantamax",
    "SINISTEA": "Phony Form",
    "SINISTEA_CHIPPED": "Chipped Form",
    "POLTEAGEIST": "Phony Form",
    "POLTEAGEIST_CHIPPED": "Chipped Form",
    "EISCUE": "Ice Face",
    "EISCUE_NOICE": "Noice Face",
    "MORPEKO": "Full Belly Mode",
    "MORPEKO_HANGRY": "Hangry Mode",
    "ZACIAN": "Hero of Many Battles",
    "ZACIAN_CROWNED": "Crowned Sword",
    "ZAMAZENTA": "Hero of Many Battles",
    "ZAMAZENTA_CROWNED": "Crowned Shield",
    "URSHIFU_SINGLE": "Single Strike Style",
    "URSHIFU_SINGLE_GIGA": "Single Strike Gigantamax",
    "URSHIFU_RAPID": "Rapid Strike Style",
    "URSHIFU_RAPID_GIGA": "Rapid Strike Gigantamax",
    "CALYREX_ICE_RIDER": "Ice Rider",
    "CALYREX_SHADOW_RIDER": "Shadow Rider",
    "FLOETTE_ETERNAL": "Eternal Flower",
    "FURFROU_HEART": "Heart Trim",
    "FURFROU_DIAMOND": "Diamond Trim",
    "FURFROU_STAR": "Star Trim",
    "FURFROU_PHAROAH": "Pharaoh Trim",
    "FURFROU_KABUKI": "Kabuki Trim",
    "FURFROU_LA_REINE": "La Reine Trim",
    "FURFROU_MATRON": "Matron Trim",
    "FURFROU_DANDY": "Dandy Trim",
    "FURFROU_DEBUTANTE": "Debutante Trim",
    "BURMY_SANDY": "Sandy Cloak",
    "BURMY_TRASH": "Trash Cloak",
    "WORMADAM_SANDY": "Sandy Cloak",
    "WORMADAM_TRASH": "Trash Cloak",
}


SUFFIX_ALIAS = {
    "A": "Alolan",
    "G": "Galarian",
    "H": "Hisuian",
    "MEGA": "Mega",
    "MEGA_X": "Mega X",
    "MEGA_Y": "Mega Y",
    "GIGA": "Gigantamax",
    "PRIMAL": "Primal",
    "ORIGIN": "Origin Forme",
    "THERIAN": "Therian Forme",
    "INCARNATE": "Incarnate Forme",
    "ATTACK": "Attack Forme",
    "DEFENSE": "Defense Forme",
    "SPEED": "Speed Forme",
    "SKY": "Sky Forme",
    "BLADE": "Blade Forme",
    "HEAT": "Heat Form",
    "WASH": "Wash Form",
    "FROST": "Frost Form",
    "FAN": "Fan Form",
    "MOW": "Mow Form",
    "SUMMER": "Summer Form",
    "AUTUMN": "Autumn Form",
    "WINTER": "Winter Form",
    "SPRING": "Spring Form",
    "BLUE": "Blue Form",
    "RED": "Red Form",
    "WHITE": "White Form",
    "YELLOW": "Yellow Form",
    "ORANGE": "Orange Form",
    "GREEN": "Green Form",
    "VIOLET": "Violet Form",
    "INDIGO": "Indigo Form",
    "PINK": "Pink Form",
    "F": "Female Form",
    "M": "Male Form",
    "FEMALE": "Female Form",
    "MALE": "Male Form",
    "EXCLAMATION": "Exclamation Form",
    "QUESTION": "Question Form",
    "SINGLE": "Single Form",
    "RAPID": "Rapid Form",
    "CROWNED": "Crowned Form",
    "NOICE": "Noice Form",
    "HANGRY": "Hangry Mode",
}


TYPE_SUFFIXES = {
    "BUG", "DARK", "DRAGON", "ELECTRIC", "FAIRY", "FIGHT", "FIRE",
    "FLYING", "GHOST", "GRASS", "GROUND", "ICE", "POISON", "PSYCHIC",
    "ROCK", "STEEL", "WATER",
}


def parse_pokemon_txt(path: Path) -> dict[int, str]:
    out: dict[int, str] = {}
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or ":" not in line:
            continue
        left, right = line.split(":", 1)
        left = left.strip()
        if not left.isdigit():
            continue
        out[int(left)] = right.strip()
    return out


def parse_species_id_txt(path: Path) -> dict[int, str]:
    out: dict[int, str] = {}
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line.startswith("SPECIES_"):
            continue
        parts = line.split()
        token = parts[0][len("SPECIES_"):]
        sid = None
        for p in parts[1:]:
            if p.startswith("0x"):
                try:
                    sid = int(p, 16)
                except ValueError:
                    sid = None
                break
        if sid is not None:
            out[sid] = token
    return out


def normalize_display_name(name: str) -> str:
    n = (name or "").upper()
    n = n.replace(".", "").replace("'", "")
    n = n.replace("♀", "F").replace("♂", "M")
    n = n.replace("?", "")
    n = n.replace("-", " ").replace(":", " ")
    n = re.sub(r"\s+", " ", n).strip().replace(" ", "_")

    remap = {
        "FLABB": "FLABEBE",
        "MR_MIME": "MR_MIME",
        "MIME_JR": "MIME_JR",
        "TYPE_NULL": "TYPE_NULL",
        "NIDORAN": "NIDORAN",
        "CRABMINBLE": "CRABOMINABLE",
        "BASCULEGON": "BASCULEGION",
    }
    return remap.get(n, n)


def alias_from_suffix(suffix: str) -> str | None:
    if suffix in SUFFIX_ALIAS:
        return SUFFIX_ALIAS[suffix]
    if suffix in TYPE_SUFFIXES:
        return f"{suffix.title()} Type"
    if len(suffix) == 1 and suffix.isalpha():
        return f"Form {suffix}"
    return None


def infer_alias(display_name: str, token: str) -> tuple[str | None, str | None, str | None]:
    if token in SPECIAL_BY_TOKEN:
        return SPECIAL_BY_TOKEN[token], "high", "special"

    base = normalize_display_name(display_name)
    if not base:
        return None, None, None

    # Direct base form, no alias.
    if token == base:
        return None, None, None

    # Standard <base>_<suffix>
    if token.startswith(base + "_"):
        suffix = token[len(base) + 1:]
        alias = alias_from_suffix(suffix)
        if alias:
            return alias, "high", "suffix"
        return None, None, None

    # Compact tokens like DARMANITANZEN
    if token.startswith(base):
        suffix = token[len(base):].lstrip("_")
        alias = alias_from_suffix(suffix)
        if alias:
            return alias, "high", "compact_suffix"

    # Prefix forms like ASHGRENINJA
    if token.endswith(base):
        prefix = token[: -len(base)].rstrip("_")
        if prefix == "ASH":
            return "Ash", "high", "prefix"

    return None, None, None


def build_aliases(pokemon: dict[int, str], species_ids: dict[int, str]) -> tuple[dict[str, dict], dict[str, list[int]]]:
    aliases: dict[str, dict] = {}

    only_pokemon = sorted([sid for sid in pokemon if sid not in species_ids and sid != 0])
    only_species = sorted([sid for sid in species_ids if sid not in pokemon])

    for sid, display_name in pokemon.items():
        if sid == 0:
            continue
        token = species_ids.get(sid)
        if not token:
            continue
        alias, confidence, rule = infer_alias(display_name, token)
        if not alias:
            continue
        aliases[str(sid)] = {
            "token": token,
            "alias": alias,
            "confidence": confidence,
            "rule": rule,
        }

    diagnostics = {
        "pokemon_only_ids": only_pokemon,
        "species_only_ids": only_species,
    }
    return aliases, diagnostics


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract species form aliases from species_id + pokemon catalogs")
    parser.add_argument(
        "--pokemon",
        type=Path,
        default=data_path("pokemon.txt"),
        help="Path to pokemon.txt",
    )
    parser.add_argument(
        "--species-id",
        type=Path,
        default=data_path("species_id.txt"),
        help="Path to species_id.txt",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=data_path("species_form_aliases.json"),
        help="Output aliases JSON path",
    )
    parser.add_argument(
        "--diag-out",
        type=Path,
        default=data_path("species_form_aliases_diagnostics.json"),
        help="Output diagnostics JSON path",
    )
    args = parser.parse_args()

    pokemon = parse_pokemon_txt(args.pokemon)
    species_ids = parse_species_id_txt(args.species_id)
    aliases, diagnostics = build_aliases(pokemon, species_ids)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(aliases, indent=2, sort_keys=True), encoding="utf-8")

    args.diag_out.parent.mkdir(parents=True, exist_ok=True)
    args.diag_out.write_text(json.dumps(diagnostics, indent=2, sort_keys=True), encoding="utf-8")

    print(f"[OK] Parsed pokemon IDs: {len(pokemon)}")
    print(f"[OK] Parsed species_id entries: {len(species_ids)}")
    print(f"[OK] Aliases inferred: {len(aliases)}")
    print(f"[OK] Wrote aliases -> {args.out}")
    print(f"[OK] Wrote diagnostics -> {args.diag_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
