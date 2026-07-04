import json
from pathlib import Path

from modules import bag as bag_mod
from modules import money as money_mod

SAVE_BLOCK1_CHUNK_SIZES = [0xFF0, 0xFF0, 0xFF0, 0xD98]
SAVE_BLOCK1_SECTION_IDS = [1, 2, 3, 4]
SAVEBLOCK1_FLAGS_OFFSET = 0x0EE0
EXPANDED_FLAGS_BASE = 0x900
EXPANDED_FLAGS_SECTION_ID = 4
EXPANDED_FLAGS_SECTION_OFFSET = 0xD98
EXPANDED_FLAGS_SIZE = 0x258

FLAG_BADGE01_GET = 0x820
FLAG_BADGE08_GET = 0x827
FLAG_SYS_GAME_CLEAR = 0x82C
FLAG_SYS_DEXNAV = 0x91E

ITEM_HEART_SCALE = 111
ITEM_DREAM_MIST = 89
ITEM_BOTTLE_CAP = 616
ITEM_GOLD_BOTTLE_CAP = 617
ITEM_STAT_SCANNER = 278
ITEM_MEGA_RING = 353
ITEM_MEGA_CUFF = 119
ITEM_MEGA_CHARM = 528
ITEM_MEGA_BRACELET = 529

# Successor Maxima awards the Mega Keystone, embedded in one of four accessories
# the player chooses. Owning any of them proves Maxima has been defeated.
MEGA_ACCESSORY_ITEM_IDS = [ITEM_MEGA_RING, ITEM_MEGA_CUFF, ITEM_MEGA_CHARM, ITEM_MEGA_BRACELET]

CAP_PROFILES = {
    "NORMAL": "normal",
    "EXPERT": "expert",
}

NORMAL_LEVEL_CAP_BY_BADGES = [20, 26, 32, 36, 40, 52, 57, 61, 75]

_LEVEL_CAPS_PATH = Path(__file__).resolve().parents[1] / "data" / "unbound_level_caps.json"
_LEVEL_CAPS_PAYLOAD = json.loads(_LEVEL_CAPS_PATH.read_text(encoding="utf-8"))


def normalize_cap_profile(value):
    return CAP_PROFILES["EXPERT"] if value == CAP_PROFILES["EXPERT"] else CAP_PROFILES["NORMAL"]


def _ru8(buf, offset):
    return buf[offset]


def _find_active_section_by_id(buf, section_id):
    sections = money_mod.list_sections(buf)
    matches = [s for s in sections if int(s.get("id", -1)) == int(section_id)]
    if not matches:
        return None
    matches.sort(key=lambda row: row["saveidx"], reverse=True)
    return matches[0]


def _save_block1_offset_to_section(abs_offset):
    remaining = abs_offset
    for index, chunk_size in enumerate(SAVE_BLOCK1_CHUNK_SIZES):
        if remaining < chunk_size:
            return {
                "section_id": SAVE_BLOCK1_SECTION_IDS[index],
                "rel_offset": remaining,
            }
        remaining -= chunk_size
    return None


def _read_flag_bit(buf, section_id, rel_offset, bit_index):
    section = _find_active_section_by_id(buf, section_id)
    if not section:
        return False
    abs_offset = int(section["off"]) + rel_offset
    if abs_offset < 0 or abs_offset >= len(buf):
        return False
    byte = _ru8(buf, abs_offset)
    return ((byte >> bit_index) & 1) == 1


def _read_standard_event_flag(buf, flag_id):
    byte_offset = SAVEBLOCK1_FLAGS_OFFSET + (flag_id // 8)
    bit_index = flag_id % 8
    mapped = _save_block1_offset_to_section(byte_offset)
    if not mapped:
        return False
    return _read_flag_bit(buf, mapped["section_id"], mapped["rel_offset"], bit_index)


def _read_expanded_event_flag(buf, flag_id):
    if flag_id < EXPANDED_FLAGS_BASE or flag_id >= 0x1900:
        return False
    flag_index = flag_id - EXPANDED_FLAGS_BASE
    byte_offset = EXPANDED_FLAGS_SECTION_OFFSET + (flag_index // 8)
    bit_index = flag_index % 8
    if byte_offset >= EXPANDED_FLAGS_SECTION_OFFSET + EXPANDED_FLAGS_SIZE:
        return False
    return _read_flag_bit(buf, EXPANDED_FLAGS_SECTION_ID, byte_offset, bit_index)


def read_event_flag(buf, flag_id):
    flag = int(flag_id)
    if flag >= EXPANDED_FLAGS_BASE and flag < 0x1900:
        return _read_expanded_event_flag(buf, flag)
    if flag >= 0x4000:
        return False
    return _read_standard_event_flag(buf, flag)


def count_badges(buf):
    count = 0
    for flag_id in range(FLAG_BADGE01_GET, FLAG_BADGE08_GET + 1):
        if read_event_flag(buf, flag_id):
            count += 1
    return count


def is_champion(buf):
    return read_event_flag(buf, FLAG_SYS_GAME_CLEAR)


def compute_normal_level_cap(buf):
    if is_champion(buf):
        return 100
    badge_count = count_badges(buf)
    if badge_count <= 0:
        return NORMAL_LEVEL_CAP_BY_BADGES[0]
    if badge_count >= len(NORMAL_LEVEL_CAP_BY_BADGES):
        return NORMAL_LEVEL_CAP_BY_BADGES[-1]
    return NORMAL_LEVEL_CAP_BY_BADGES[badge_count]


def compute_expert_level_cap(buf):
    if is_champion(buf):
        return 100
    entries = _LEVEL_CAPS_PAYLOAD.get("entries") or []
    if not entries:
        return 100
    badge_count = count_badges(buf)
    index = min(max(0, badge_count), len(entries) - 1)
    return int(entries[index].get("level_cap") or 100)


def resolve_effective_level_cap(buf, cap_profile=CAP_PROFILES["NORMAL"]):
    if normalize_cap_profile(cap_profile) == CAP_PROFILES["EXPERT"]:
        return compute_expert_level_cap(buf)
    return compute_normal_level_cap(buf)


# resolve_quick_pockets returns pocket descriptors (anchor_offset, slot_count, ...),
# not item slots. Read the real slots for each pocket from its anchor so item
# ownership checks actually see the save's contents.
def _collect_owned_slots(buf, pockets):
    slots = []
    for pocket in (pockets or {}).values():
        if not isinstance(pocket, dict):
            continue
        anchor = pocket.get("anchor_offset")
        if not isinstance(anchor, int):
            continue
        for slot in bag_mod.map_pocket_from_anchor(buf, anchor):
            if int(slot.get("id") or 0) > 0:
                slots.append(slot)
    return slots


def _sum_item_quantity(slots, item_id):
    total = 0
    for slot in slots or []:
        if int(slot.get("id", -1)) == int(item_id):
            total += max(0, int(slot.get("qty") or 0))
    return total


def _has_key_item(slots, item_id):
    return _sum_item_quantity(slots, item_id) > 0


def _lookup_item_name(item_name_by_id, item_id, fallback):
    if not item_name_by_id:
        return fallback
    return item_name_by_id.get(int(item_id)) or fallback


def _read_money(buf):
    secs = money_mod.list_sections(buf)
    trainer_secs = [s for s in secs if s["id"] == money_mod.TRAINER_SECTION_ID]
    if not trainer_secs:
        return 0
    trainer_secs.sort(key=lambda row: row["saveidx"], reverse=True)
    payload = trainer_secs[0]["data"]
    return int(money_mod.ru32(payload, money_mod.FALLBACK_OFF_MONEY))


BP_OFFSET_IN_SECTION = 0xF34


def _read_bp(buf):
    sections = money_mod.list_sections(buf)
    matches = [s for s in sections if int(s.get("id", -1)) == 4]
    if not matches:
        return 0
    matches.sort(key=lambda row: row["saveidx"], reverse=True)
    sec_off = int(matches[0]["off"])
    return int(money_mod.ru16(buf, sec_off + BP_OFFSET_IN_SECTION))


def build_game_progress_snapshot(buf, item_name_by_id=None, cap_profile=CAP_PROFILES["NORMAL"]):
    pockets = bag_mod.resolve_quick_pockets(buf)
    owned_slots = _collect_owned_slots(buf, pockets)
    money = _read_money(buf)
    battle_points = _read_bp(buf)
    badge_count = count_badges(buf)
    champion = is_champion(buf)
    mega_unlocked = any(_has_key_item(owned_slots, item_id) for item_id in MEGA_ACCESSORY_ITEM_IDS)
    resolved_profile = normalize_cap_profile(cap_profile)
    normal_level_cap = compute_normal_level_cap(buf)
    expert_level_cap = compute_expert_level_cap(buf)
    effective_level_cap = resolve_effective_level_cap(buf, resolved_profile)
    tm_ownership = bag_mod.collect_owned_tmhm_item_ids(buf)

    return {
        "badge_count": badge_count,
        "active_level_cap": normal_level_cap,
        "normal_level_cap": normal_level_cap,
        "expert_level_cap": expert_level_cap,
        "cap_profile": resolved_profile,
        "effective_level_cap": effective_level_cap,
        "difficulty_flag_known": False,
        "is_champion": champion,
        "mega_unlocked": mega_unlocked,
        "money": money,
        "battle_points": battle_points,
        "tm_case_owned": tm_ownership["tm_case_owned"],
        "owned_tmhm_item_ids": tm_ownership["owned_tmhm_item_ids"],
        "key_items": {
            "dexnav": read_event_flag(buf, FLAG_SYS_DEXNAV),
            "stat_scanner": _has_key_item(owned_slots, ITEM_STAT_SCANNER),
            "mega_ring": _has_key_item(owned_slots, ITEM_MEGA_RING),
        },
        "consumables": {
            "heart_scale": _sum_item_quantity(owned_slots, ITEM_HEART_SCALE),
            "dream_mist": _sum_item_quantity(owned_slots, ITEM_DREAM_MIST),
            "bottle_cap": _sum_item_quantity(owned_slots, ITEM_BOTTLE_CAP),
            "gold_bottle_cap": _sum_item_quantity(owned_slots, ITEM_GOLD_BOTTLE_CAP),
        },
        "key_items_detail": {
            "dexnav": {
                "owned": read_event_flag(buf, FLAG_SYS_DEXNAV),
                "source": "event_flag",
                "flag_id": FLAG_SYS_DEXNAV,
            },
            "stat_scanner": {
                "owned": _has_key_item(owned_slots, ITEM_STAT_SCANNER),
                "item_id": ITEM_STAT_SCANNER,
                "item_name": _lookup_item_name(item_name_by_id, ITEM_STAT_SCANNER, "Stat Scanner"),
            },
            "mega_ring": {
                "owned": _has_key_item(owned_slots, ITEM_MEGA_RING),
                "item_id": ITEM_MEGA_RING,
                "item_name": _lookup_item_name(item_name_by_id, ITEM_MEGA_RING, "Mega Ring"),
            },
        },
        "consumables_detail": {
            "heart_scale": {
                "count": _sum_item_quantity(owned_slots, ITEM_HEART_SCALE),
                "item_id": ITEM_HEART_SCALE,
                "item_name": _lookup_item_name(item_name_by_id, ITEM_HEART_SCALE, "Heart Scale"),
            },
            "dream_mist": {
                "count": _sum_item_quantity(owned_slots, ITEM_DREAM_MIST),
                "item_id": ITEM_DREAM_MIST,
                "item_name": _lookup_item_name(item_name_by_id, ITEM_DREAM_MIST, "Dream Mist"),
            },
            "bottle_cap": {
                "count": _sum_item_quantity(owned_slots, ITEM_BOTTLE_CAP),
                "item_id": ITEM_BOTTLE_CAP,
                "item_name": _lookup_item_name(item_name_by_id, ITEM_BOTTLE_CAP, "Bottle Cap"),
            },
            "gold_bottle_cap": {
                "count": _sum_item_quantity(owned_slots, ITEM_GOLD_BOTTLE_CAP),
                "item_id": ITEM_GOLD_BOTTLE_CAP,
                "item_name": _lookup_item_name(item_name_by_id, ITEM_GOLD_BOTTLE_CAP, "Gold Bottle Cap"),
            },
        },
    }
