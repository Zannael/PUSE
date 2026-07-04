import struct

from modules import bag as bag_mod
from modules import money as money_mod

TRAINER_SECTION_ID = 1
DEX_SEEN_OFFSET = 0x0310
DEX_CAUGHT_OFFSET = 0x038D
DEX_FLAG_BYTE_COUNT = 125
MAX_TRACKED_DEX_ID = 999

POKEDEX_FLAG_SEEN = "seen"
POKEDEX_FLAG_CAUGHT = "caught"


def _dex_bit_index(dex_id: int) -> int | None:
    dex = int(dex_id)
    if dex < 1 or dex > MAX_TRACKED_DEX_ID:
        return None
    return dex - 1


def _trainer_section_offset(buf) -> int | None:
    sections = money_mod.list_sections(buf)
    matches = [s for s in sections if int(s.get("id", -1)) == TRAINER_SECTION_ID]
    if not matches:
        return None
    matches.sort(key=lambda row: row["saveidx"], reverse=True)
    return int(matches[0]["off"])


def _read_flag_at_offset(buf, base_offset: int, dex_id: int) -> bool | None:
    bit_index = _dex_bit_index(dex_id)
    if bit_index is None:
        return None
    byte_index = bit_index // 8
    if byte_index < 0 or byte_index >= DEX_FLAG_BYTE_COUNT:
        return False
    sec_off = _trainer_section_offset(buf)
    if sec_off is None:
        return False
    abs_off = sec_off + base_offset + byte_index
    if abs_off < 0 or abs_off >= len(buf):
        return False
    byte = buf[abs_off]
    return ((byte >> (bit_index % 8)) & 1) == 1


def _write_flag_at_offset(buf, base_offset: int, dex_id: int, value: bool) -> bool:
    bit_index = _dex_bit_index(dex_id)
    if bit_index is None:
        return False
    byte_index = bit_index // 8
    if byte_index < 0 or byte_index >= DEX_FLAG_BYTE_COUNT:
        return False
    sec_off = _trainer_section_offset(buf)
    if sec_off is None:
        return False
    abs_off = sec_off + base_offset + byte_index
    if abs_off < 0 or abs_off >= len(buf):
        return False
    bit = bit_index % 8
    current = buf[abs_off]
    next_byte = (current | (1 << bit)) if value else (current & ~(1 << bit))
    buf[abs_off] = next_byte
    bag_mod.recalculate_checksum(buf, sec_off)
    return True


def is_dex_species_trackable(species_id: int) -> bool:
    try:
        dex = int(species_id)
    except (TypeError, ValueError):
        return False
    return 1 <= dex <= MAX_TRACKED_DEX_ID


def get_pokedex_flags(buf, species_id: int) -> dict:
    if not is_dex_species_trackable(species_id):
        return {"trackable": False, "seen": False, "caught": False}
    return {
        "trackable": True,
        "seen": bool(_read_flag_at_offset(buf, DEX_SEEN_OFFSET, species_id)),
        "caught": bool(_read_flag_at_offset(buf, DEX_CAUGHT_OFFSET, species_id)),
    }


def set_pokedex_flag(buf, species_id: int, flag: str, value: bool) -> dict:
    normalized = POKEDEX_FLAG_CAUGHT if flag == POKEDEX_FLAG_CAUGHT else POKEDEX_FLAG_SEEN
    offset = DEX_CAUGHT_OFFSET if normalized == POKEDEX_FLAG_CAUGHT else DEX_SEEN_OFFSET
    enabled = bool(value)
    if not _write_flag_at_offset(buf, offset, species_id, enabled):
        return {"ok": False, "reason": "untrackable_or_missing_section"}
    if enabled and normalized == POKEDEX_FLAG_CAUGHT:
        _write_flag_at_offset(buf, DEX_SEEN_OFFSET, species_id, True)
    return {"ok": True, **get_pokedex_flags(buf, species_id)}


def build_pokedex_summary(buf, species_rows: list[dict]) -> dict:
    trackable = []
    for row in species_rows or []:
        try:
            species_id = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        if not is_dex_species_trackable(species_id):
            continue
        trackable.append(
            {
                "id": species_id,
                "name": row.get("label") or row.get("display_name") or row.get("name") or f"Species {species_id}",
            }
        )
    trackable.sort(key=lambda row: row["id"])

    seen_count = 0
    caught_count = 0
    entries = []
    for row in trackable:
        flags = get_pokedex_flags(buf, row["id"])
        if flags["seen"]:
            seen_count += 1
        if flags["caught"]:
            caught_count += 1
        entries.append(
            {
                "species_id": row["id"],
                "species_name": row["name"],
                "seen": flags["seen"],
                "caught": flags["caught"],
            }
        )

    total = len(trackable)
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
