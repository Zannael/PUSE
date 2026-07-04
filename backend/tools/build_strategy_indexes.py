"""Build reverse-lookup indexes for the Pokemon Unbound strategy assistant.

Emits three Markdown files into backend/data/ so an LLM can answer
"which species can have ability / type / role-defining move X" with a direct
read instead of reasoning from (romhack-incorrect) memory:

  - ability_species_index.md : every ability -> species
  - type_species_index.md    : every type -> species
  - move_species_index.md    : curated role-defining moves -> species

Coverage moves (Earthquake, Ice Beam, etc.) are intentionally excluded from the
move index: they are learned by hundreds of species, so they bloat the file and
are useless as a discovery filter. The move index lists scarce, build-defining
moves where "who can do this" is a meaningful question.
"""

import json
import os

DATA = os.path.join(os.path.dirname(__file__), "..", "data")

# Role-defining moves worth indexing. Names must match moves.txt exactly
# (case-insensitive match applied). Missing names are reported, not fatal.
CURATED_MOVES = [
    # Weather setters
    "Rain Dance", "Sunny Day", "Sandstorm", "Hail",
    # Entry hazards + removal
    "Stealth Rock", "Spikes", "Toxic Spikes", "Sticky Web",
    "Rapid Spin", "Defog",
    # Screens / team support
    "Reflect", "Light Screen", "Aurora Veil", "Tailwind", "Trick Room",
    # Physical setup
    "Swords Dance", "Dragon Dance", "Bulk Up", "Coil", "Shift Gear",
    "Belly Drum", "Howl",
    # Special setup
    "Nasty Plot", "Calm Mind", "Quiver Dance", "Tail Glow", "Growth",
    # Mixed / speed setup
    "Shell Smash", "Work Up", "Agility", "Rock Polish", "Autotomize",
    # Recovery
    "Recover", "Roost", "Synthesis", "Moonlight", "Morning Sun",
    "Slack Off", "Soft-Boiled", "Wish", "Rest", "Milk Drink", "Shore Up",
    "Strength Sap",
    # Priority
    "Aqua Jet", "Bullet Punch", "Mach Punch", "Ice Shard", "Shadow Sneak",
    "Sucker Punch", "ExtremeSpeed", "Quick Attack", "Vacuum Wave",
    "Accelerock",
    # Pivoting
    "U-turn", "Volt Switch", "Flip Turn", "Parting Shot", "Teleport",
    "Baton Pass",
    # Status / disruption / utility
    "Will-O-Wisp", "Thunder Wave", "Toxic", "Spore", "Sleep Powder",
    "Stun Spore", "Taunt", "Encore", "Trick", "Switcheroo", "Knock Off",
    "Destiny Bond", "Leech Seed", "Whirlwind", "Roar", "Dragon Tail",
    "Memento", "Healing Wish", "Court Change", "Haze", "Glare",
]


def load_id_name(name):
    out = {}
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if ":" in line:
                i, n = line.split(":", 1)
                out[int(i)] = n
    return out


def write_md(filename, header, note, rows):
    lines = [f"# {header}", "", note, ""] + rows
    path = os.path.join(DATA, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    size_kb = os.path.getsize(path) / 1024
    print(f"  {filename}: {len(rows)} entries, {size_kb:.1f} KB")


def build_ability_index(species, abilities):
    with open(os.path.join(DATA, "species_abilities_meta.json"), encoding="utf-8") as f:
        meta = json.load(f)
    idx = {}
    for sid, slots in meta.items():
        name = species.get(int(sid))
        if not name or name == "NONE":
            continue
        for key in ("ability_1_id", "ability_2_id"):
            aid = slots.get(key, 0)
            if aid:
                idx.setdefault(aid, {"reg": set(), "hid": set()})["reg"].add(name)
        haid = slots.get("hidden_ability_id", 0)
        if haid:
            idx.setdefault(haid, {"reg": set(), "hid": set()})["hid"].add(name)
    rows = []
    for aid in sorted(idx, key=lambda a: abilities.get(a, "zzz")):
        aname = abilities.get(aid)
        if not aname or aname == "NONE":
            continue
        reg = sorted(idx[aid]["reg"])
        hid = sorted(idx[aid]["hid"] - idx[aid]["reg"])
        parts = reg + [f"{n} (H)" for n in hid]
        if parts:
            rows.append(f"- **{aname}**: {', '.join(parts)}")
    write_md("ability_species_index.md",
             "Ability -> Species Index (Pokemon Unbound v2.1.1.1)",
             "Regular = ability slot 1/2. (H) = hidden ability only.", rows)


def build_type_index(species):
    with open(os.path.join(DATA, "species_types.json"), encoding="utf-8") as f:
        types = json.load(f)
    idx = {}
    for sid, rec in types.items():
        name = species.get(int(sid))
        if not name or name == "NONE":
            continue
        for t in rec.get("types", []):
            idx.setdefault(t, set()).add(name)
    rows = [f"- **{t}**: {', '.join(sorted(idx[t]))}" for t in sorted(idx)]
    write_md("type_species_index.md",
             "Type -> Species Index (Pokemon Unbound v2.1.1.1)",
             "Dual-typed species appear under both of their types.", rows)


def build_move_index(species, moves):
    with open(os.path.join(DATA, "species_learnsets.json"), encoding="utf-8") as f:
        ls = json.load(f)["learnsets"]
    name_to_id = {n.lower(): i for i, n in moves.items()}
    wanted = {}
    missing = []
    for mv in CURATED_MOVES:
        mid = name_to_id.get(mv.lower())
        if mid is None:
            missing.append(mv)
        else:
            wanted[mid] = moves[mid]
    idx = {mid: set() for mid in wanted}
    for sid, rec in ls.items():
        name = species.get(int(sid))
        if not name or name == "NONE":
            continue
        for mid in rec.get("all", []):
            if mid in idx:
                idx[mid].add(name)
    rows = []
    for mid in sorted(idx, key=lambda m: moves.get(m, "zzz")):
        sp = sorted(idx[mid])
        if sp:
            rows.append(f"- **{moves[mid]}**: {', '.join(sp)}")
    write_md("move_species_index.md",
             "Role-Defining Move -> Species Index (Pokemon Unbound v2.1.1.1)",
             "Curated competitive moves only (weather, hazards, setup, "
             "recovery, priority, pivots, utility). Generic coverage moves "
             "are excluded by design.", rows)
    if missing:
        print(f"  NOTE: not found in moves.txt -> {', '.join(missing)}")


def main():
    species = load_id_name("pokemon.txt")
    abilities = load_id_name("abilities.txt")
    moves = load_id_name("moves.txt")
    print("Building strategy indexes:")
    build_ability_index(species, abilities)
    build_type_index(species)
    build_move_index(species, moves)


if __name__ == "__main__":
    main()
