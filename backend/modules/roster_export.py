"""Versioned, read-only roster projection shared with the browser implementation."""

from modules.party import DB_NATURES

FORMAT = "puse.roster"
VERSION = 1
STATS = ("HP", "Atk", "Def", "SpA", "SpD", "Spe")


def _stats(values):
    values = values or {}
    return {key: int(values.get(key, values.get("Spd", 0) if key == "Spe" else 0)) for key in STATS}


def build_roster(rows, selected_pc_keys, item_names=None, move_names=None):
    """Include every occupied party slot and only explicitly selected PC slots."""
    item_names = item_names or {}
    move_names = move_names or {}
    selected = set(selected_pc_keys)
    pokemon = []
    for row in rows:
        if int(row.get("species_id") or 0) <= 0:
            continue
        source = row.get("source")
        if source == "party":
            index = int(row["partyIndex"])
            location = {"source": "party", "index": index}
        elif source == "pc":
            box, slot = int(row["box"]), int(row["slot"])
            if not (1 <= slot <= 30) or row.get("rosterKey") not in selected:
                continue
            location = {"source": "pc", "box": box, "slot": slot}
        else:
            continue
        species_id = int(row["species_id"])
        item_id = int(row.get("item_id") or 0)
        nature_id = int(row.get("nature_id") or 0)
        moves = row.get("moves") or []
        pp = row.get("move_pp") or []
        pp_ups = row.get("move_pp_ups") or []
        pp_max = row.get("move_pp_max") or []
        pokemon.append({
            "location": location,
            "species": {"id": species_id, "name": row.get("species_label") or row.get("species_name") or f"Species #{species_id}"},
            "nickname": row.get("nickname") or "",
            "level": int(row.get("level") or 0),
            "nature": {"id": nature_id, "name": row.get("nature") or DB_NATURES.get(nature_id, "Unknown")},
            "shiny": bool(row.get("is_shiny")),
            "gender": row.get("gender") or "Unknown",
            "ability": {"id": int(row.get("effective_ability_id") or 0), "name": row.get("ability_name_current") or row.get("effective_ability_name") or "", "slot": int(row.get("current_ability_index") or 0)},
            "held_item": {"id": item_id, "name": (item_names.get(item_id) or f"Item #{item_id}") if item_id else "None"},
            "ivs": _stats(row.get("ivs")),
            "evs": _stats(row.get("evs")),
            "moves": [{"id": int(move_id), "name": move_names.get(int(move_id)) or f"Move #{move_id}",
                       "pp": int(pp[i]) if i < len(pp) else 0,
                       "pp_ups": int(pp_ups[i]) if i < len(pp_ups) else 0,
                       "pp_max": int(pp_max[i]) if i < len(pp_max) else 0}
                      for i, move_id in enumerate(moves) if int(move_id) > 0],
        })
    return {"format": FORMAT, "version": VERSION, "game": "Pokemon Unbound 2.1.1.1", "pokemon": pokemon}


def _cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ").replace("\r", " ")


def roster_markdown(roster):
    lines = ["# PUSE roster", "", f"Pokemon Unbound 2.1.1.1 · {len(roster['pokemon'])} Pokémon", "",
             "| Location | Pokémon | Level | Nature | Ability | Held item | Shiny |",
             "| --- | --- | ---: | --- | --- | --- | --- |"]
    for mon in roster["pokemon"]:
        loc = mon["location"]
        place = f"Party {loc['index'] + 1}" if loc["source"] == "party" else f"{'Preset' if loc['box'] == 26 else 'Box ' + str(loc['box'])} · {loc['slot']}"
        name = mon["nickname"] or mon["species"]["name"]
        if name != mon["species"]["name"]:
            name += f" ({mon['species']['name']})"
        lines.append("| " + " | ".join(map(_cell, (place, name, mon["level"], mon["nature"]["name"], mon["ability"]["name"], mon["held_item"]["name"], "Yes" if mon["shiny"] else "No"))) + " |")
    lines.append("")
    for mon in roster["pokemon"]:
        loc = mon["location"]
        place = f"Party {loc['index'] + 1}" if loc["source"] == "party" else f"{'Preset' if loc['box'] == 26 else 'Box ' + str(loc['box'])} · {loc['slot']}"
        lines.extend([f"## {mon['nickname'] or mon['species']['name']} — {place}", "",
                      f"Species: {mon['species']['name']} (#{mon['species']['id']}) · Gender: {mon['gender']}", "",
                      "IVs: " + ", ".join(f"{key} {mon['ivs'][key]}" for key in STATS), "",
                      "EVs: " + ", ".join(f"{key} {mon['evs'][key]}" for key in STATS), "",
                      "Moves: " + (", ".join(move["name"] for move in mon["moves"]) or "None"), ""])
    return "\n".join(lines).rstrip() + "\n"
