import json
from pathlib import Path

from modules import bag as bag_mod
from modules import money as money_mod


TRAINER_SECTION_ID = 1
DEX_SEEN_OFFSET = 0x0310
DEX_CAUGHT_OFFSET = 0x038D
DEX_FLAG_BYTE_COUNT = 125
MAX_TRACKED_DEX_ID = 809

POKEDEX_FLAG_SEEN = "seen"
POKEDEX_FLAG_CAUGHT = "caught"

SPECIES_TO_DEX = json.loads(
    (Path(__file__).resolve().parents[1] / "data" / "pokedex_species_map.json").read_text(encoding="utf-8")
)["species_to_dex"]


def dex_id_for_species_id(species_id: int):
    try:
        sid = int(species_id)
    except (TypeError, ValueError):
        return None
    return SPECIES_TO_DEX.get(str(sid))


def build_pokedex_species_groups(species_rows: list[dict]) -> dict[int, list[dict]]:
    groups = {}
    for row in species_rows or []:
        try:
            internal_id = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        dex_id = dex_id_for_species_id(internal_id)
        if dex_id is None:
            continue
        groups.setdefault(int(dex_id), []).append({**row, "internal_species_id": internal_id})
    for rows in groups.values():
        rows.sort(key=lambda row: row["internal_species_id"])
    return groups


def is_dex_species_trackable(species_id: int) -> bool:
    try:
        dex_id = int(species_id)
    except (TypeError, ValueError):
        return False
    return 1 <= dex_id <= MAX_TRACKED_DEX_ID


def _dex_bit_index(dex_id: int):
    if not is_dex_species_trackable(dex_id):
        return None
    return int(dex_id) - 1


def _active_trainer_section_offset(buf):
    sections = money_mod.list_sections(buf)
    matches = [s for s in sections if int(s.get("id", -1)) == TRAINER_SECTION_ID]
    if not matches:
        return None
    matches.sort(key=lambda row: row["saveidx"], reverse=True)
    return int(matches[0]["off"])


def _read_flag_at_offset(buf, base_offset: int, dex_id: int):
    bit_index = _dex_bit_index(dex_id)
    if bit_index is None:
        return None
    byte_index = bit_index // 8
    if byte_index < 0 or byte_index >= DEX_FLAG_BYTE_COUNT:
        return False
    sec_off = _active_trainer_section_offset(buf)
    if sec_off is None:
        return False
    abs_off = sec_off + base_offset + byte_index
    if abs_off < 0 or abs_off >= len(buf):
        return False
    return ((buf[abs_off] >> (bit_index % 8)) & 1) == 1


def _write_flag_at_offset(buf, base_offset: int, dex_id: int, value: bool) -> bool:
    bit_index = _dex_bit_index(dex_id)
    if bit_index is None:
        return False
    byte_index = bit_index // 8
    if byte_index < 0 or byte_index >= DEX_FLAG_BYTE_COUNT:
        return False
    sec_off = _active_trainer_section_offset(buf)
    if sec_off is None:
        return False
    abs_off = sec_off + base_offset + byte_index
    if abs_off < 0 or abs_off >= len(buf):
        return False
    bit = bit_index % 8
    current = buf[abs_off]
    buf[abs_off] = (current | (1 << bit)) if value else (current & ~(1 << bit))
    bag_mod.recalculate_checksum(buf, sec_off)
    return True


def _get_pokedex_flags_for_dex(buf, dex_id: int) -> dict:
    if not is_dex_species_trackable(dex_id):
        return {"trackable": False, "seen": False, "caught": False}
    return {
        "trackable": True,
        "seen": bool(_read_flag_at_offset(buf, DEX_SEEN_OFFSET, dex_id)),
        "caught": bool(_read_flag_at_offset(buf, DEX_CAUGHT_OFFSET, dex_id)),
    }


def get_pokedex_flags(buf, species_id: int) -> dict:
    dex_id = dex_id_for_species_id(species_id)
    if dex_id is None:
        return {"trackable": False, "seen": False, "caught": False}
    return {"dex_id": dex_id, **_get_pokedex_flags_for_dex(buf, dex_id)}


def set_pokedex_flag(buf, species_id: int, flag: str, value: bool) -> dict:
    dex_id = dex_id_for_species_id(species_id)
    if dex_id is None:
        return {"ok": False, "reason": "untrackable_or_missing_section"}
    normalized = POKEDEX_FLAG_CAUGHT if flag == POKEDEX_FLAG_CAUGHT else POKEDEX_FLAG_SEEN
    offset = DEX_CAUGHT_OFFSET if normalized == POKEDEX_FLAG_CAUGHT else DEX_SEEN_OFFSET
    enabled = bool(value)
    if not _write_flag_at_offset(buf, offset, dex_id, enabled):
        return {"ok": False, "reason": "untrackable_or_missing_section"}
    if enabled and normalized == POKEDEX_FLAG_CAUGHT:
        _write_flag_at_offset(buf, DEX_SEEN_OFFSET, dex_id, True)
    return {"ok": True, **get_pokedex_flags(buf, species_id)}


def build_pokedex_summary(buf, species_rows: list[dict]) -> dict:
    groups = build_pokedex_species_groups(species_rows)

    seen_count = 0
    caught_count = 0
    entries = []
    for dex_id in sorted(groups):
        if not is_dex_species_trackable(dex_id):
            continue
        rows = groups[dex_id]
        base = rows[0]
        base_name = base.get("display_name") or base.get("name") or f"Species {dex_id}"
        forms = []
        for row in rows[1:]:
            label = str(row.get("label") or row.get("display_name") or row.get("name") or "Form")
            prefix = f"{base_name} ("
            forms.append({
                "name": label[len(prefix):-1] if label.startswith(prefix) and label.endswith(")") else label,
                "internal_species_id": row["internal_species_id"],
                "status": "n/a",
            })
        flags = _get_pokedex_flags_for_dex(buf, dex_id)
        if flags["seen"]:
            seen_count += 1
        if flags["caught"]:
            caught_count += 1
        entries.append({
            "species_id": dex_id,
            "species_name": base_name,
            "forms": forms,
            "seen": flags["seen"],
            "caught": flags["caught"],
        })

    total = len(entries)
    return {
        "layout": "cfru_saveblock1_v1",
        "max_tracked_dex_id": MAX_TRACKED_DEX_ID,
        "total": total,
        "seen_count": seen_count,
        "caught_count": caught_count,
        "seen_percent": round((seen_count / total) * 100, 1) if total else 0,
        "caught_percent": round((caught_count / total) * 100, 1) if total else 0,
        "entries": entries,
    }
