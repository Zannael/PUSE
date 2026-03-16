#!/usr/bin/env python3
# bag.py — Editor Definitivo per Pokemon Unbound
# Include: Smart Search, Save Index Check e Unbound Fixed Length Checksum

import struct
import sys
import shutil
import json

from core.data_loader import load_id_name_file, data_path

# --- CONFIGURAZIONE ---
SECTION_SIZE = 0x1000
OFF_VALID_LEN = 0xFF0
OFF_ID = 0xFF4
OFF_CHK = 0xFF6
OFF_SAVE_IDX = 0xFFC

# ID Interno del settore Items in Unbound (trovato con la diagnostica)
UNBOUND_ITEM_SECTOR_ID = 13
# Settori borsa noti (Unbound/CFRU): item, key, balls, berries/tm (varia per build)
BAG_SECTOR_IDS = {13, 14, 15, 16}
# Lunghezza fissa trovata col Cracker (0x450 o 0x454 vanno bene, usiamo il max)
UNBOUND_ITEM_FIXED_LEN = 0x454

# Limiti conservativi per filtro slot borsa
MAX_PLAUSIBLE_ITEM_ID = 4095
MAX_PLAUSIBLE_ITEM_QTY = 2000
MAX_POCKET_SLOTS = 200
MAX_STRICT_POCKET_SLOTS = 80
MAX_STRICT_DUP_RATIO = 0.35
MAX_MEDIUM_DUP_RATIO = 0.60

def _fallback_pocket_sets():
    ball = {
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
        52, 53, 54, 59, 60,
        622, 623, 624, 625, 626, 627, 628, 629, 630, 631,
    }
    berry = set(range(133, 176)) | set(range(539, 563))
    tm = set(range(289, 347)) | set(range(375, 437))
    hm = set(range(437, 445))
    key = set(range(259, 289)) | set(range(348, 375))
    return ball, berry, tm, hm, (tm | hm), key


def _set_from_json_list(value):
    if not isinstance(value, list):
        return set()
    out = set()
    for v in value:
        try:
            out.add(int(v))
        except Exception:
            continue
    return out


def _load_pocket_sets_from_map():
    map_path = data_path("item_pocket_map.json")
    if not map_path.exists():
        return _fallback_pocket_sets()

    try:
        payload = json.loads(map_path.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return _fallback_pocket_sets()

    pockets = payload.get("pockets", {})

    ball = _set_from_json_list(pockets.get("ball", {}).get("ids", []))
    berry = _set_from_json_list(pockets.get("berry", {}).get("ids", []))
    tm = _set_from_json_list(pockets.get("tm", {}).get("ids", []))
    hm = _set_from_json_list(pockets.get("hm", {}).get("ids", []))
    key = _set_from_json_list(pockets.get("key", {}).get("ids", []))

    if not ball or not berry or not (tm or hm) or not key:
        return _fallback_pocket_sets()

    tmhm = tm | hm
    return ball, berry, tm, hm, tmhm, key


BALL_ITEM_IDS, BERRY_ITEM_IDS, TM_ITEM_IDS, HM_ITEM_IDS, TMHM_ITEM_IDS, KEY_ITEM_IDS = _load_pocket_sets_from_map()

KNOWN_POCKET_ANCHORS = {
    "ball": 0x1E31C,
    "tm": 0x1E3E4,
    "berry": 0x1E5E4,
}

KNOWN_POCKET_REL_OFFSETS = {
    "ball": 0x31C,
    "tm": 0x3E4,
    "berry": 0x5E4,
}

TM_CASE_ITEM_ID = 364
BERRY_POUCH_ITEM_ID = 365

EMPTY_BOOTSTRAP_SLOT_COUNT = 8

MAIN_POCKET_PROBE_IDS = [13, 84, 197, 94, 24, 26, 16, 493, 603, 606, 72]


def pocket_type_for_item_id(item_id):
    if item_id in KEY_ITEM_IDS:
        return "key"
    if item_id in BALL_ITEM_IDS:
        return "ball"
    if item_id in BERRY_ITEM_IDS:
        return "berry"
    if item_id in TM_ITEM_IDS:
        return "tm"
    if item_id in HM_ITEM_IDS:
        return "hm"
    return "generic"


def _slot_family_stats(items, valid_ids):
    non_zero = [it for it in items if it.get('id', 0) != 0]
    if not non_zero:
        return 0, 0
    family_hits = sum(1 for it in non_zero if it['id'] in valid_ids)
    return len(non_zero), family_hits


def _candidate_from_anchor(data, anchor_offset):
    items = map_pocket_from_anchor(data, anchor_offset)
    if not items:
        return None, []

    non_zero = [it for it in items if it.get('id', 0) != 0]
    if not non_zero:
        return None, items

    slot_count = len(non_zero)
    dup_count = max(0, slot_count - len({it['id'] for it in non_zero}))
    score = _score_pocket(slot_count, dup_count, slot_count)
    quality = _classify_pocket_quality(slot_count, dup_count, slot_count)

    sec_idx = anchor_offset // SECTION_SIZE
    sec_off = sec_idx * SECTION_SIZE
    sect_id = ru16(data, sec_off + OFF_ID)
    save_idx = ru32(data, sec_off + OFF_SAVE_IDX)

    candidate = {
        'offset': anchor_offset,
        'qty': non_zero[0]['qty'],
        'sector': sec_idx,
        'sect_id': sect_id,
        'save_idx': save_idx,
        'pocket_end': non_zero[-1]['offset'] + 4,
        'pocket_nonzero': slot_count,
        'pocket_slots': slot_count,
        'pocket_dups': dup_count,
        'encoding_swapped': non_zero[0].get('encoding') == 'qty_id',
        'score': score,
        'quality': quality,
    }
    return candidate, items


def _resolve_family_pocket(data, pocket_type, known_anchor, probe_item_id, valid_ids, min_slots):
    if known_anchor is not None:
        candidate, items = _candidate_from_anchor(data, known_anchor)
        if candidate and candidate['quality'] != 'reject':
            slot_count, family_hits = _slot_family_stats(items, valid_ids)
            if slot_count >= min_slots and family_hits >= max(min_slots - 2, int(slot_count * 0.7)):
                purity = family_hits / slot_count if slot_count > 0 else 0
                return {
                    'pocket_type': pocket_type,
                    'anchor_offset': known_anchor,
                    'quality': candidate['quality'],
                    'score': candidate['score'],
                    'slot_count': candidate['pocket_slots'],
                    'dup_count': candidate['pocket_dups'],
                    'family_purity': round(purity, 3),
                    'source': 'validated_static',
                    'confidence': 'high',
                    'detection_note': f'static anchor validated with strong family purity ({round(purity * 100)}%)',
                }

            if slot_count > 0:
                purity = family_hits / slot_count
                sparse_floor = max(4, min_slots // 3)
                if slot_count >= sparse_floor and purity >= 0.90:
                    return {
                        'pocket_type': pocket_type,
                        'anchor_offset': known_anchor,
                        'quality': candidate['quality'],
                        'score': candidate['score'],
                        'slot_count': candidate['pocket_slots'],
                        'dup_count': candidate['pocket_dups'],
                        'family_purity': round(purity, 3),
                        'source': 'validated_sparse',
                        'confidence': 'medium' if slot_count >= min_slots // 2 else 'low',
                        'detection_note': f'sparse pocket accepted: {slot_count} slots, family purity {round(purity * 100)}%',
                    }

    scanned = scan_for_item_candidates(data, probe_item_id)
    if scanned:
        top = scanned[0]
        conf = 'high' if top.get('quality') == 'strict' else 'medium'
        return {
            'pocket_type': pocket_type,
            'anchor_offset': top['offset'],
            'quality': top.get('quality'),
            'score': top.get('score'),
            'slot_count': top.get('pocket_slots'),
            'dup_count': top.get('pocket_dups'),
            'source': 'scan_fallback',
            'confidence': conf,
            'detection_note': f'found by probing item id {probe_item_id}',
        }

    active_save_idx = _compute_active_save_idx(data, BAG_SECTOR_IDS)
    sparse_floor = max(4, min_slots // 3)
    score_bonus = 500
    if pocket_type == 'berry':
        score_bonus = 450
    elif pocket_type == 'tm':
        score_bonus = 480
    elif pocket_type == 'key':
        score_bonus = 520

    sparse_scan = _scan_global_idset_pockets(
        data,
        active_save_idx,
        valid_ids,
        score_bonus=score_bonus,
        min_slots=sparse_floor,
    )
    if sparse_scan:
        top = sparse_scan[0]
        return {
            'pocket_type': pocket_type,
            'anchor_offset': top['offset'],
            'quality': top.get('quality'),
            'score': top.get('score'),
            'slot_count': top.get('pocket_slots'),
            'dup_count': top.get('pocket_dups'),
            'family_purity': 1.0,
            'source': 'scan_sparse',
            'confidence': 'medium' if top.get('pocket_slots', 0) >= min_slots // 2 else 'low',
            'detection_note': f'sparse global scan matched {top.get("pocket_slots", 0)} family slots',
        }

    return None


def _compute_active_save_idx(data, sector_ids=None):
    total_sectors = len(data) // SECTION_SIZE
    max_idx = 0

    for sec_idx in range(total_sectors):
        sec_off = sec_idx * SECTION_SIZE
        sect_id = ru16(data, sec_off + OFF_ID)
        if sector_ids and sect_id not in sector_ids:
            continue

        save_idx = ru32(data, sec_off + OFF_SAVE_IDX)
        if save_idx <= 0 or save_idx == 0xFFFFFFFF:
            continue
        if save_idx > max_idx:
            max_idx = save_idx

    if max_idx > 0:
        return max_idx

    for sec_idx in range(total_sectors):
        sec_off = sec_idx * SECTION_SIZE
        save_idx = ru32(data, sec_off + OFF_SAVE_IDX)
        if save_idx <= 0 or save_idx == 0xFFFFFFFF:
            continue
        if save_idx > max_idx:
            max_idx = save_idx

    return max_idx


def _pick_best_candidate(candidates):
    if not candidates:
        return None

    def sort_key(c):
        return (
            c.get('save_idx', 0),
            1 if c.get('quality') == 'strict' else 0,
            c.get('score', -10**9),
            c.get('pocket_slots', 0),
            -c.get('offset', 0),
        )

    return max(candidates, key=sort_key)


def _resolve_main_pocket(data):
    best = None
    best_probe = None

    for probe_item_id in MAIN_POCKET_PROBE_IDS:
        candidates = scan_for_item_candidates(data, probe_item_id)
        top = _pick_best_candidate(candidates)
        if not top:
            continue

        if top.get('quality') == 'strict' and top.get('pocket_slots', 0) >= 6:
            best = top
            best_probe = probe_item_id
            break

        if not best:
            best = top
            best_probe = probe_item_id
            continue

        contender = _pick_best_candidate([best, top])
        if contender is top:
            best = top
            best_probe = probe_item_id

    if not best:
        return None

    conf = 'high' if best.get('quality') == 'strict' else 'medium'
    return {
        'pocket_type': 'main',
        'anchor_offset': best['offset'],
        'quality': best.get('quality'),
        'score': best.get('score'),
        'slot_count': best.get('pocket_slots'),
        'dup_count': best.get('pocket_dups'),
        'source': f'scan_probe:{best_probe}',
        'confidence': conf,
        'detection_note': f'main pocket resolved with probe item id {best_probe}',
    }


def _resolve_template_base_offset(data, key_pocket=None):
    if key_pocket and key_pocket.get('anchor_offset') is not None:
        anchor = int(key_pocket['anchor_offset'])
        return (anchor // SECTION_SIZE) * SECTION_SIZE

    fallback = KNOWN_POCKET_ANCHORS.get('ball')
    if fallback is None:
        return None
    return int(fallback) - KNOWN_POCKET_REL_OFFSETS['ball']


def _extract_key_item_ids(data, key_pocket):
    if not key_pocket or key_pocket.get('anchor_offset') is None:
        return set()

    items = map_pocket_from_anchor(data, int(key_pocket['anchor_offset']))
    return {it['id'] for it in items if it.get('id', 0) != 0}


def _anchor_region_is_empty(data, anchor_offset, slots=EMPTY_BOOTSTRAP_SLOT_COUNT):
    if anchor_offset is None:
        return False

    end_off = anchor_offset + (slots * 4)
    if anchor_offset < 0 or end_off > len(data):
        return False

    for i in range(slots):
        off = anchor_offset + (i * 4)
        iid = ru16(data, off)
        qty = ru16(data, off + 2)
        if iid != 0 or qty != 0:
            return False
    return True


def _build_empty_candidate(pocket_type, anchor_offset):
    return {
        'pocket_type': pocket_type,
        'anchor_offset': anchor_offset,
        'quality': 'empty',
        'score': 0,
        'slot_count': 0,
        'dup_count': 0,
        'source': 'empty_unlocked',
        'confidence': 'low',
        'is_empty_candidate': True,
        'empty_encoding': 'id_qty',
        'empty_slot_offsets': [anchor_offset + (i * 4) for i in range(EMPTY_BOOTSTRAP_SLOT_COUNT)],
        'detection_note': 'empty pocket enabled because unlock key item is present',
    }


def _with_gate_metadata(pocket, ready, locked, requires_key_item=None, unlock_via=None, locked_reason=None):
    target = dict(pocket or {})
    target['ready'] = bool(ready)
    target['locked'] = bool(locked)
    target['requires_key_item'] = requires_key_item
    target['unlock_via'] = unlock_via
    target['locked_reason'] = locked_reason
    return target


def _gate_unlockable_pocket(data, pocket, pocket_type, required_item_id, key_ids_present, template_base_offset):
    slot_count = int((pocket or {}).get('slot_count') or 0)

    if pocket and slot_count > 0:
        return _with_gate_metadata(
            pocket,
            ready=True,
            locked=False,
            requires_key_item=required_item_id,
            unlock_via='non_empty_pocket',
        )

    if required_item_id in key_ids_present:
        candidate = pocket
        if candidate is None and template_base_offset is not None:
            rel = KNOWN_POCKET_REL_OFFSETS[pocket_type]
            anchor = template_base_offset + rel
            if _anchor_region_is_empty(data, anchor):
                candidate = _build_empty_candidate(pocket_type, anchor)

        if candidate is not None:
            return _with_gate_metadata(
                candidate,
                ready=True,
                locked=False,
                requires_key_item=required_item_id,
                unlock_via='key_item',
            )

    return _with_gate_metadata(
        pocket,
        ready=False,
        locked=True,
        requires_key_item=required_item_id,
        unlock_via=None,
        locked_reason='missing_unlock_key_item',
    )


def resolve_quick_pockets(data):
    if not data:
        return {}

    quick = {}

    # Main pocket: dynamic by probe family scan (active copy may shift absolute offset).
    quick['main'] = _resolve_main_pocket(data)

    quick['ball'] = _resolve_family_pocket(
        data,
        'ball',
        KNOWN_POCKET_ANCHORS['ball'],
        4,
        BALL_ITEM_IDS,
        min_slots=8,
    )
    quick['key'] = _resolve_family_pocket(
        data,
        'key',
        None,
        368,
        KEY_ITEM_IDS,
        min_slots=4,
    )

    berry_raw = _resolve_family_pocket(
        data,
        'berry',
        KNOWN_POCKET_ANCHORS['berry'],
        149,
        BERRY_ITEM_IDS,
        min_slots=12,
    )
    tm_raw = _resolve_family_pocket(
        data,
        'tm',
        KNOWN_POCKET_ANCHORS['tm'],
        307,
        TMHM_ITEM_IDS,
        min_slots=20,
    )

    key_ids_present = _extract_key_item_ids(data, quick.get('key'))
    template_base_offset = _resolve_template_base_offset(data, quick.get('key'))

    quick['tm'] = _gate_unlockable_pocket(
        data,
        tm_raw,
        'tm',
        TM_CASE_ITEM_ID,
        key_ids_present,
        template_base_offset,
    )
    quick['berry'] = _gate_unlockable_pocket(
        data,
        berry_raw,
        'berry',
        BERRY_POUCH_ITEM_ID,
        key_ids_present,
        template_base_offset,
    )

    return quick


def _decode_slot(data, offset, swapped=False):
    a = ru16(data, offset)
    b = ru16(data, offset + 2)
    if swapped:
        return b, a
    return a, b

DB_ITEMS = {
    1: "Master Ball", 2: "Ultra Ball", 3: "Great Ball", 4: "Poke Ball",
    44: "Rare Candy", 50: "Yellow Shard", 200: "Leftovers",
    60: "Dusk Ball", 62: "Quick Ball", 13: "Potion", 21: "Hyper Potion",
    23: "Full Heal", 25: "Max Revive", 273: "Safari Ball",
    716: "Ability Capsule", 717: "Ability Patch",
    0: "--- VUOTO ---"
}


def ru16(b, o): return struct.unpack_from("<H", b, o)[0]


def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


def wu16(b, o, v): struct.pack_into("<H", b, o, v)


def load_item_names_from_file():
    items = load_id_name_file("items.txt")
    if not items:
        return
    DB_ITEMS.clear()
    DB_ITEMS.update(items)
    DB_ITEMS.setdefault(0, "--- VUOTO ---")
    print(f"[INFO] Database aggiornato: {len(DB_ITEMS)} oggetti caricati da items.txt.")


# Compat legacy name.
def load_names_from_ct():
    load_item_names_from_file()


def load_tm_names_from_file():
    tm_path = data_path("tms.txt")
    if not tm_path.exists():
        return

    loaded = 0
    try:
        with tm_path.open("r", encoding="utf-8", errors="ignore") as f:
            for raw in f:
                line = raw.strip()
                if not line or not line.startswith("TM") or ":" not in line:
                    continue

                left, right = line.split(":", 1)
                tm_tag = left.strip().upper().replace(" ", "")
                if len(tm_tag) < 4:
                    continue

                num_str = tm_tag[2:]
                if not num_str.isdigit():
                    continue

                tm_num = int(num_str)
                if tm_num < 1 or tm_num > 120:
                    continue

                move_name = right.strip()
                if tm_num <= 58:
                    item_id = 288 + tm_num
                else:
                    item_id = 316 + tm_num

                DB_ITEMS[item_id] = f"TM{tm_num:03d}: {move_name}"
                loaded += 1
    except:
        return

    if loaded:
        print(f"[INFO] TM lookup caricato: {loaded} nomi da {tm_path}.")


# --- CHECKSUM ALGO (GBA STANDARD) ---
def gba_checksum(data):
    total = 0
    for i in range(0, len(data), 4):
        total = (total + ru32(data, i)) & 0xFFFFFFFF
    return ((total >> 16) + (total & 0xFFFF)) & 0xFFFF


# --- RICALCOLO INTELLIGENTE ---
def recalculate_checksum(data, offset):
    """
    Ricalcola il checksum applicando la logica specifica per Unbound.
    """
    sector_start = (offset // SECTION_SIZE) * SECTION_SIZE

    # 1. Identifica che tipo di settore è
    sect_id = ru16(data, sector_start + OFF_ID)

    # 2. Determina la lunghezza dei dati su cui calcolare
    if sect_id == UNBOUND_ITEM_SECTOR_ID:
        # CASO SPECIALE UNBOUND: Ignora footer, usa lunghezza fissa scoperta
        valid_len = UNBOUND_ITEM_FIXED_LEN
        print(f"[FIX] Settore {sect_id} rilevato: Forzo calcolo su 0x{valid_len:X} bytes (Hardcoded)")
    else:
        # CASO STANDARD: Leggi lunghezza dal footer
        valid_len = ru32(data, sector_start + OFF_VALID_LEN)
        if valid_len > 0xFF4: valid_len = 0xFF4  # Safety cap
        # print(f"[STD] Settore {sect_id}: Calcolo su 0x{valid_len:X} bytes (da Footer)")

    # 3. Prepara il payload
    payload = data[sector_start: sector_start + valid_len]

    # Padding a 4 byte (Standard GBA)
    remainder = valid_len % 4
    if remainder != 0:
        payload += b'\x00' * (4 - remainder)

    # 4. Calcola e Scrivi
    new_chk = gba_checksum(payload)
    wu16(data, sector_start + OFF_CHK, new_chk)
    return new_chk


def get_save_index(data, sector_idx):
    offset = (sector_idx * SECTION_SIZE) + OFF_SAVE_IDX
    return ru32(data, offset)


def _is_plausible_slot(item_id, qty):
    return 0 <= item_id <= MAX_PLAUSIBLE_ITEM_ID and 1 <= qty <= MAX_PLAUSIBLE_ITEM_QTY


def _is_ball_slot(item_id, qty):
    return item_id in BALL_ITEM_IDS and 1 <= qty <= MAX_PLAUSIBLE_ITEM_QTY


def _is_berry_slot(item_id, qty):
    return item_id in BERRY_ITEM_IDS and 1 <= qty <= MAX_PLAUSIBLE_ITEM_QTY


def _extract_idset_pocket_bounds_global(data, anchor_offset, valid_ids, min_slots=4):
    """
    Variante globale per pocket reali fuori dai settori borsa classici.
    Richiede stream composto da item ID nel set valido e terminatore item_id == 0.
    """
    if anchor_offset < 0 or anchor_offset + 3 >= len(data):
        return None

    curr = anchor_offset
    seen_ids = set()

    while True:
        prev = curr - 4
        if prev < 0:
            break
        pid = ru16(data, prev)
        pqty = ru16(data, prev + 2)
        if pid == 0 or pid not in valid_ids or not (1 <= pqty <= MAX_PLAUSIBLE_ITEM_QTY):
            break
        curr = prev

    start_abs = curr
    non_zero_count = 0
    duplicate_count = 0
    slot_count = 0
    terminated = False

    while curr + 3 < len(data) and slot_count < MAX_POCKET_SLOTS:
        iid = ru16(data, curr)
        iqty = ru16(data, curr + 2)

        if iid == 0:
            terminated = True
            break
        if iid not in valid_ids or not (1 <= iqty <= MAX_PLAUSIBLE_ITEM_QTY):
            break

        slot_count += 1
        non_zero_count += 1
        if iid in seen_ids:
            duplicate_count += 1
        else:
            seen_ids.add(iid)

        curr += 4

    if slot_count < min_slots or not terminated:
        return None

    return start_abs, curr, non_zero_count, slot_count, duplicate_count


def _scan_global_idset_candidates(data, item_id, active_save_idx, valid_ids, score_bonus=500, min_slots=4):
    if item_id not in valid_ids:
        return []

    out = []
    seen = set()

    for abs_off in range(0, len(data) - 3, 2):
        iid = ru16(data, abs_off)
        qty = ru16(data, abs_off + 2)
        if iid != item_id or qty <= 0:
            continue

        bounds = _extract_idset_pocket_bounds_global(data, abs_off, valid_ids, min_slots=min_slots)
        if not bounds:
            continue

        p_start, p_end, non_zero_count, slot_count, dup_count = bounds
        score = _score_pocket(non_zero_count, dup_count, slot_count)
        quality = _classify_pocket_quality(non_zero_count, dup_count, slot_count)
        if quality == "reject":
            continue

        key = (p_start, p_end)
        if key in seen:
            continue
        seen.add(key)

        sec_idx = p_start // SECTION_SIZE
        sect_id = ru16(data, (sec_idx * SECTION_SIZE) + OFF_ID)

        out.append({
            'offset': p_start,
            'qty': qty,
            'sector': sec_idx,
            'sect_id': sect_id,
            'save_idx': active_save_idx,
            'pocket_end': p_end,
            'pocket_nonzero': non_zero_count,
            'pocket_slots': slot_count,
            'pocket_dups': dup_count,
            'encoding_swapped': False,
            'score': score + score_bonus,
            'quality': quality,
        })

    return out


def _scan_global_idset_pockets(data, active_save_idx, valid_ids, score_bonus=500, min_slots=4):
    """
    Cerca tasche globali per una famiglia di ID (anche se item_id cercato non e' presente).
    Utile per "Add item" su pocket nota (Ball/Berry/TM) con item assente.
    """
    out = []
    seen = set()

    for abs_off in range(0, len(data) - 3, 2):
        iid = ru16(data, abs_off)
        qty = ru16(data, abs_off + 2)
        if iid not in valid_ids or qty <= 0:
            continue

        bounds = _extract_idset_pocket_bounds_global(data, abs_off, valid_ids, min_slots=min_slots)
        if not bounds:
            continue

        p_start, p_end, non_zero_count, slot_count, dup_count = bounds
        key = (p_start, p_end)
        if key in seen:
            continue
        seen.add(key)

        score = _score_pocket(non_zero_count, dup_count, slot_count)
        quality = _classify_pocket_quality(non_zero_count, dup_count, slot_count)
        if quality == "reject":
            continue

        sec_idx = p_start // SECTION_SIZE
        sect_id = ru16(data, (sec_idx * SECTION_SIZE) + OFF_ID)

        out.append({
            'offset': p_start,
            'qty': 0,
            'sector': sec_idx,
            'sect_id': sect_id,
            'save_idx': active_save_idx,
            'pocket_end': p_end,
            'pocket_nonzero': non_zero_count,
            'pocket_slots': slot_count,
            'pocket_dups': dup_count,
            'encoding_swapped': False,
            'score': score + score_bonus,
            'quality': quality,
        })

    return out


def _extract_pocket_bounds(data, anchor_offset, swapped=False):
    """
    Estrae i limiti di una tasca partendo da uno slot interno valido.
    Regola forte: una tasca termina al primo slot con item_id == 0.
    Ritorna (start_abs, end_abs_exclusive, non_zero_count, slot_count, dup_count) oppure None.
    """
    if anchor_offset < 0 or anchor_offset + 3 >= len(data):
        return None

    sector_start = (anchor_offset // SECTION_SIZE) * SECTION_SIZE
    sector_end = sector_start + OFF_VALID_LEN

    if not (sector_start <= anchor_offset < sector_end):
        return None

    curr = anchor_offset

    # Rewind all'inizio tasca: ci fermiamo su vuoto o dati non plausibili
    while True:
        prev = curr - 4
        if prev < sector_start:
            break
        pid, pqty = _decode_slot(data, prev, swapped=swapped)
        if pid == 0 or not _is_plausible_slot(pid, pqty):
            break
        curr = prev

    start_abs = curr

    # Forward fino al primo slot vuoto (terminatore tasca)
    non_zero_count = 0
    duplicate_count = 0
    slot_count = 0
    seen_ids = set()
    terminated = False

    while curr + 3 < sector_end and slot_count < MAX_POCKET_SLOTS:
        iid, iqty = _decode_slot(data, curr, swapped=swapped)

        if iid == 0:
            terminated = True
            break

        # Soft terminator: slot con qty==0 (item non vuoto) non deve invertire il decode
        # dell'intera tasca. Lo trattiamo come fine stream.
        if iqty == 0:
            terminated = True
            break

        if not _is_plausible_slot(iid, iqty):
            break

        slot_count += 1
        non_zero_count += 1
        if iid in seen_ids:
            duplicate_count += 1
        else:
            seen_ids.add(iid)

        curr += 4

    end_abs = curr

    if slot_count == 0:
        return None

    # Tasche senza terminatore sono tipicamente rumore/stream non tasca
    if not terminated:
        return None

    return start_abs, end_abs, non_zero_count, slot_count, duplicate_count


def _score_pocket(non_zero_count, duplicate_count, slot_count):
    # Favor pocket streams with unique entries and penalize large/noisy regions.
    unique_count = max(0, non_zero_count - duplicate_count)
    dense_reward = min(unique_count, 64) * 6
    overflow_reward = max(0, unique_count - 64)
    oversize_penalty = max(0, slot_count - 64) * 10
    duplicate_penalty = duplicate_count * 20
    return dense_reward + overflow_reward - oversize_penalty - duplicate_penalty


def _classify_pocket_quality(non_zero_count, duplicate_count, slot_count):
    if slot_count <= 0:
        return "reject"

    dup_ratio = duplicate_count / slot_count

    if slot_count <= MAX_STRICT_POCKET_SLOTS and dup_ratio <= MAX_STRICT_DUP_RATIO:
        return "strict"

    if dup_ratio <= MAX_MEDIUM_DUP_RATIO:
        return "medium"

    return "reject"


def _best_pocket_for_anchor(data, anchor_offset):
    """
    Prova entrambe le codifiche slot:
    - standard: [item_id, qty]
    - swapped:  [qty, item_id]
    Ritorna (swapped, bounds) migliore per qualità.
    """
    cand = []
    for swapped in (False, True):
        bounds = _extract_pocket_bounds(data, anchor_offset, swapped=swapped)
        if not bounds:
            continue
        _, _, non_zero_count, slot_count, duplicate_count = bounds
        score = _score_pocket(non_zero_count, duplicate_count, slot_count)
        cand.append((score, swapped, bounds))

    if not cand:
        return None, None

    cand.sort(key=lambda x: x[0], reverse=True)
    _, swapped, bounds = cand[0]
    return swapped, bounds


# --- MOTORE DI RICERCA ---
def scan_for_item_candidates(data, item_id):
    """
    Ricerca robusta e deterministica degli slot item:
    - scansiona SOLO i settori borsa noti (13..16),
    - usa slot allineati a 4 byte,
    - deduplica per tasca e save copy (attivo/inattivo),
    - evita falsi positivi da scansione raw globale.
    """
    if item_id <= 0:
        return []

    strict_candidates = []
    medium_candidates = []
    total_sectors = len(data) // SECTION_SIZE
    active_save_idx = _compute_active_save_idx(data, BAG_SECTOR_IDS)

    for sec_idx in range(total_sectors):
        sec_off = sec_idx * SECTION_SIZE
        sect_id = ru16(data, sec_off + OFF_ID)
        save_idx = ru32(data, sec_off + OFF_SAVE_IDX)

        if sect_id not in BAG_SECTOR_IDS:
            continue

        # Skip settori vuoti/non inizializzati
        if save_idx <= 0:
            continue

        # Gli slot sono larghi 4 byte ma possono iniziare su allineamento 0 oppure 2.
        for rel in range(0, OFF_VALID_LEN - 3, 2):
            abs_off = sec_off + rel
            for swapped in (False, True):
                iid, qty = _decode_slot(data, abs_off, swapped=swapped)

                if iid != item_id or qty <= 0:
                    continue
                if not _is_plausible_slot(iid, qty):
                    continue

                bounds = _extract_pocket_bounds(data, abs_off, swapped=swapped)
                if not bounds:
                    continue

                p_start, p_end, non_zero_count, slot_count, dup_count = bounds

                # Tasche completamente vuote/non utili non sono candidati affidabili
                if non_zero_count <= 0:
                    continue
                # Evita micro-tasche a 1 slot: sono spesso allineamenti spurii.
                if slot_count < 2:
                    continue

                score = _score_pocket(non_zero_count, dup_count, slot_count)
                quality = _classify_pocket_quality(non_zero_count, dup_count, slot_count)
                if quality == "reject":
                    continue

                candidate = {
                    'offset': p_start,
                    'qty': qty,
                    'sector': sec_idx,
                    'sect_id': sect_id,
                    'save_idx': save_idx,
                    'pocket_end': p_end,
                    'pocket_nonzero': non_zero_count,
                    'pocket_slots': slot_count,
                    'pocket_dups': dup_count,
                    'encoding_swapped': swapped,
                    'score': score,
                    'quality': quality,
                }

                if quality == "strict":
                    strict_candidates.append(candidate)
                else:
                    medium_candidates.append(candidate)

    # Fallback globale per tasche reali fuori dai settori borsa classici.
    strict_candidates.extend(
        _scan_global_idset_candidates(
            data,
            item_id,
            active_save_idx,
            BALL_ITEM_IDS,
            score_bonus=500,
            min_slots=4,
        )
    )
    strict_candidates.extend(
        _scan_global_idset_candidates(
            data,
            item_id,
            active_save_idx,
            BERRY_ITEM_IDS,
            score_bonus=450,
            min_slots=8,
        )
    )
    strict_candidates.extend(
        _scan_global_idset_candidates(
            data,
            item_id,
            active_save_idx,
            TMHM_ITEM_IDS,
            score_bonus=480,
            min_slots=12,
        )
    )
    strict_candidates.extend(
        _scan_global_idset_candidates(
            data,
            item_id,
            active_save_idx,
            KEY_ITEM_IDS,
            score_bonus=520,
            min_slots=4,
        )
    )

    # Manteniamo sia strict che medium: lo stesso item puo' esistere in tasche diverse
    # nello stesso settore (es. tasca strumenti + tasca ball).
    sector_candidates = strict_candidates + medium_candidates

    if not sector_candidates:
        if item_id in BALL_ITEM_IDS:
            sector_candidates = _scan_global_idset_pockets(
                data, active_save_idx, BALL_ITEM_IDS, score_bonus=500, min_slots=4
            )
        elif item_id in BERRY_ITEM_IDS:
            sector_candidates = _scan_global_idset_pockets(
                data, active_save_idx, BERRY_ITEM_IDS, score_bonus=450, min_slots=8
            )
        elif item_id in TM_ITEM_IDS:
            sector_candidates = _scan_global_idset_pockets(
                data, active_save_idx, TMHM_ITEM_IDS, score_bonus=480, min_slots=12
            )
        elif item_id in KEY_ITEM_IDS:
            sector_candidates = _scan_global_idset_pockets(
                data, active_save_idx, KEY_ITEM_IDS, score_bonus=520, min_slots=4
            )

    if not sector_candidates:
        return []

    # Dedup per tasca reale (anchor) + copia save + settore + encoding.
    # Evita duplicati provenienti da match multipli dello stesso stream.
    best_by_pocket = {}
    for c in sector_candidates:
        key = (c['save_idx'], c['sect_id'], c['offset'], c['encoding_swapped'])
        prev = best_by_pocket.get(key)

        if prev is None:
            best_by_pocket[key] = c
            continue

        prev_rank = 2 if prev.get('quality') == 'strict' else 1
        new_rank = 2 if c.get('quality') == 'strict' else 1

        prev_score = (prev_rank, prev['score'], prev['pocket_nonzero'])
        new_score = (new_rank, c['score'], c['pocket_nonzero'])
        if new_score > prev_score:
            best_by_pocket[key] = c
            continue

        # In caso di tasche "medium" con score negativi (ambigue), preferiamo
        # anchor più bassa per stabilizzare il risultato tra decode shiftati di 2 byte.
        if (
            prev_rank == 1 and new_rank == 1 and
            prev['score'] < 0 and c['score'] < 0 and
            c['offset'] < prev['offset']
        ):
            best_by_pocket[key] = c

    out = list(best_by_pocket.values())

    # Collapse decode-shift twins (stessa tasca vista con offset +/-2).
    # Caso tipico: due candidati quasi identici per la stessa copia/settore.
    collapsed = []
    for cand in sorted(out, key=lambda x: (x['save_idx'], x['sect_id'], x['offset'])):
        twin_idx = None
        for i, prev in enumerate(collapsed):
            if prev['save_idx'] != cand['save_idx'] or prev['sect_id'] != cand['sect_id']:
                continue
            if abs(prev['offset'] - cand['offset']) <= 2 and abs(prev['pocket_end'] - cand['pocket_end']) <= 2:
                twin_idx = i
                break

        if twin_idx is None:
            collapsed.append(cand)
            continue

        prev = collapsed[twin_idx]
        prev_rank = 2 if prev.get('quality') == 'strict' else 1
        cand_rank = 2 if cand.get('quality') == 'strict' else 1

        if (
            prev_rank == 1 and cand_rank == 1 and
            prev['score'] < 0 and cand['score'] < 0
        ):
            # Tasche medium ambigue: favoriamo offset minore (allineamento stabile).
            if cand['offset'] < prev['offset']:
                collapsed[twin_idx] = cand
            continue

        # Prefer strict quality, poi score migliore; a parita', offset minore.
        prev_key = (prev_rank, prev['score'], -prev['offset'])
        cand_key = (cand_rank, cand['score'], -cand['offset'])
        if cand_key > prev_key:
            collapsed[twin_idx] = cand

    out = collapsed

    if item_id in BALL_ITEM_IDS:
        strict_ball = [c for c in out if c.get('quality') == 'strict']
        if strict_ball:
            max_ball_slots = max(c.get('pocket_slots', 0) for c in strict_ball)
            # Se troviamo una tasca Ball popolata (>=8 slot), filtriamo i mini-stream decoy.
            if max_ball_slots >= 8:
                strict_ball = [c for c in strict_ball if c.get('pocket_slots', 0) == max_ball_slots]
                max_idx = max(c['save_idx'] for c in strict_ball)
                out = [c for c in strict_ball if c['save_idx'] == max_idx]

    if item_id in BERRY_ITEM_IDS:
        strict_berry = [c for c in out if c.get('quality') == 'strict']
        if strict_berry:
            max_berry_slots = max(c.get('pocket_slots', 0) for c in strict_berry)
            # La Berry pouch reale e' tipicamente una lista lunga; favoriamo quella maggiore.
            if max_berry_slots >= 12:
                strict_berry = [c for c in strict_berry if c.get('pocket_slots', 0) == max_berry_slots]
                max_idx = max(c['save_idx'] for c in strict_berry)
                out = [c for c in strict_berry if c['save_idx'] == max_idx]

    if item_id in TM_ITEM_IDS:
        strict_tm = [c for c in out if c.get('quality') == 'strict']
        if strict_tm:
            max_tm_slots = max(c.get('pocket_slots', 0) for c in strict_tm)
            # TM pocket reale: lista lunga quasi tutta qty=1 (contiene anche HM in testa).
            if max_tm_slots >= 20:
                strict_tm = [c for c in strict_tm if c.get('pocket_slots', 0) == max_tm_slots]
                max_idx = max(c['save_idx'] for c in strict_tm)
                out = [c for c in strict_tm if c['save_idx'] == max_idx]

    out.sort(
        key=lambda x: (
            -x['save_idx'],
            0 if x.get('quality') == 'strict' else 1,
            -x['score'],
            x['sect_id'],
            x['sector'],
            x['offset']
        )
    )
    return out


# --- MAPPATURA TASCA ---
def map_pocket_from_anchor(data, anchor_offset):
    swapped, bounds = _best_pocket_for_anchor(data, anchor_offset)
    if not bounds:
        return []
    swapped_flag = True if swapped else False

    start_abs, end_abs, _, _, _ = bounds

    # Forward map: slot reali fino al primo terminatore
    items = []
    curr = start_abs
    while curr < end_abs:
        iid, iqty = _decode_slot(data, curr, swapped=swapped_flag)
        if iid == 0:
            break
        if not _is_plausible_slot(iid, iqty):
            break
        name = DB_ITEMS.get(iid, f"Item {iid}")
        items.append({'id': iid, 'qty': iqty, 'offset': curr, 'name': name, 'encoding': 'qty_id' if swapped_flag else 'id_qty'})
        curr += 4

    # Aggiungiamo alcuni slot vuoti contigui per facilitare Add Item nel frontend
    empties = 0
    sector_start = (start_abs // SECTION_SIZE) * SECTION_SIZE
    sector_end = sector_start + OFF_VALID_LEN
    while curr + 3 < sector_end and empties < 3:
        iid, iqty = _decode_slot(data, curr, swapped=swapped_flag)
        if iid != 0:
            break
        items.append({'id': 0, 'qty': 0, 'offset': curr, 'name': '--- VUOTO ---', 'encoding': 'qty_id' if swapped_flag else 'id_qty'})
        empties += 1
        curr += 4

    return items


def write_slot(data, offset, item_id, quantity, encoding=None):
    """
    Scrittura slot sicura con supporto ai due layout:
    - id_qty  : [item_id, qty]
    - qty_id  : [qty, item_id]
    Se encoding non è fornito, lo inferisce dalla tasca dell'offset.
    """
    if encoding not in ("id_qty", "qty_id"):
        swapped, _ = _best_pocket_for_anchor(data, offset)
        encoding = "qty_id" if swapped else "id_qty"

    # TM/HM e Key Items: qty effettiva deve restare >= 1.
    if (item_id in TMHM_ITEM_IDS or item_id in KEY_ITEM_IDS) and quantity <= 0:
        quantity = 1

    if encoding == "qty_id":
        wu16(data, offset, quantity)
        wu16(data, offset + 2, item_id)
    else:
        wu16(data, offset, item_id)
        wu16(data, offset + 2, quantity)


# --- MAIN ---
def main():
    print("--- UNBOUND BAG EDITOR v14 (FINAL FIX) ---")
    if len(sys.argv) < 2:
        print("Uso: python3 -m modules.bag <savefile>")
        return

    save_path = sys.argv[1]
    load_item_names_from_file()
    load_tm_names_from_file()

    with open(save_path, "rb") as f:
        full_data = bytearray(f.read())

    print("\nInserisci l'ID di un oggetto da cercare.")
    try:
        search_id = int(input("ID Oggetto: "))
    except:
        print("ID non valido.")
        return

    candidates = scan_for_item_candidates(full_data, search_id)
    if not candidates:
        print("Nessun risultato.")
        return

    # Determina il Save Index più recente
    max_save_idx = -1
    for c in candidates:
        if c['save_idx'] > max_save_idx:
            max_save_idx = c['save_idx']

    print(f"\n[RISULTATI] Oggetto '{DB_ITEMS.get(search_id, search_id)}':")
    print("IDX | SETTORE (ID) | OFFSET  | QTY | SAVE INDEX | STATO")
    print("-" * 70)

    valid_selection = None
    for i, cand in enumerate(candidates):
        status = "ATTIVO" if cand['save_idx'] == max_save_idx else "BACKUP"
        # Evidenzia se è il settore problematico ID 13
        note = " (ITEM PCKT)" if cand['sect_id'] == UNBOUND_ITEM_SECTOR_ID else ""

        print(
            f"{i + 1:3} | {cand['sector']:2} (ID {cand['sect_id']:2}){note} | {hex(cand['offset']):7} | {cand['qty']:3} | {cand['save_idx']:10} | {status}")

    print("-" * 70)
    print(f"CONSIGLIO: Scegli 'ATTIVO'. Se vedi ID {UNBOUND_ITEM_SECTOR_ID}, è la tasca oggetti standard.")
    sel = input("Selezione (Numero): ")

    try:
        sel_idx = int(sel) - 1
        valid_selection = candidates[sel_idx]
    except:
        print("Selezione non valida.")
        return

    anchor = valid_selection['offset']

    # Editor Loop
    while True:
        pocket_items = map_pocket_from_anchor(full_data, anchor)
        print(f"\n--- TASCA (Settore {valid_selection['sector']} - Index {valid_selection['save_idx']}) ---")
        print(" N. | OFFSET  | QTY  | OGGETTO")
        print("-" * 50)
        for i, item in enumerate(pocket_items):
            if item['id'] != 0:
                print(f"{i + 1:3} | {hex(item['offset']):7} | x{item['qty']:<3} | {item['name']} ({item['id']})")
            else:
                print(f"{i + 1:3} | {hex(item['offset']):7} | ---- | --- VUOTO ---")

        print("-" * 50)
        print("M = Modifica | S = Salva | 0 = Esci")
        cmd = input(">> ").upper()

        if cmd == '0':
            break
        elif cmd == 'S':
            shutil.copy(save_path, save_path + ".bak_v14")

            # Calcolo checksum con fix
            new_chk = recalculate_checksum(full_data, anchor)
            print(f"Checksum applicato: {hex(new_chk)}")

            with open(save_path, "wb") as f:
                f.write(full_data)
            print("File salvato correttamente.")
            break

        elif cmd == 'M':
            try:
                idx = int(input("Slot: ")) - 1
                if 0 <= idx < len(pocket_items):
                    itm = pocket_items[idx]
                    print(f"Modifica: {itm['name']}")
                    nid = input(f"Nuovo ID ({itm['id']}): ")
                    nqty = input(f"Nuova Qty ({itm['qty']}): ")

                    wid = int(nid) if nid else itm['id']
                    wqty = int(nqty) if nqty else itm['qty']

                    write_slot(full_data, itm['offset'], wid, wqty, encoding=itm.get('encoding'))
                    print("Memoria aggiornata (non ancora salvata su disco).")
            except:
                print("Errore input.")


if __name__ == "__main__":
    main()
