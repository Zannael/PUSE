#!/usr/bin/env python3
# party.py — Unbound Editor con HA (Hidden Ability), Natura & Exp Logic
# Features: Checksum Fix, static data loading, Name Search, Nature Editing, Smart Level, Hidden Ability Toggle.

import struct
import sys
import shutil
import os
import math
import json

from core.data_loader import load_id_name_file

# --- CONFIGURAZIONE SALVATAGGIO ---
SECTION_SIZE = 0x1000
CHECKSUM_LENGTH = 0xFF4
FOOTER_ID_OFF = 0xFF4
FOOTER_CHK_OFF = 0xFF6
FOOTER_SAVEIDX_OFF = 0xFFC
TRAINER_SECTION_ID = 1

# Offsets Pokémon (Unbound Party)
OFF_PID = 0x00
OFF_OTID = 0x04
OFF_NICK = 0x08
OFF_DATA_START = 0x20
OFF_CHECKSUM = 0x1C
OFF_LEVEL_VISUAL = 0x54
OFF_CURR_HP = 0x56
OFF_MAX_HP = 0x58
OFF_ATK = 0x5A
OFF_DEF = 0x5C
OFF_SPE = 0x5E
OFF_SPA = 0x60
OFF_SPD = 0x62

# --- DATABASE GLOBALE ---
DB_ITEMS = {}
DB_MOVES = {}
DB_SPECIES = {}
DB_SPECIES_BASE_STATS = {}
DB_SPECIES_IDENTITY_META = {}
DB_SPECIES_GROWTH_RATES = {}

GENDER_THRESHOLD_MALE_ONLY = 0
GENDER_THRESHOLD_FEMALE_ONLY = 254
GENDER_THRESHOLD_GENDERLESS = 255
_INV_11_MOD_25 = 16

DB_NATURES = {
    0: "Hardy (Ardita)", 1: "Lonely (Schiva)", 2: "Brave (Audace)", 3: "Adamant (Decisa)",
    4: "Naughty (Birbona)", 5: "Bold (Sicura)", 6: "Docile (Docile)", 7: "Relaxed (Placida)",
    8: "Impish (Scaltra)", 9: "Lax (Fiacca)", 10: "Timid (Timida)", 11: "Hasty (Lesta)",
    12: "Serious (Seria)", 13: "Jolly (Allegra)", 14: "Naive (Ingenua)", 15: "Modest (Modesta)",
    16: "Mild (Mite)", 17: "Quiet (Quieta)", 18: "Bashful (Ritrosa)", 19: "Rash (Ardente)",
    20: "Calm (Calma)", 21: "Gentle (Gentile)", 22: "Sassy (Vivace)", 23: "Careful (Cauta)",
    24: "Quirky (Furba)"
}

# LOGICA EXP / CRESCITA
GROWTH_NAMES = {
    0: "Medium Fast (Cubic)", 1: "Erratic", 2: "Fluctuating",
    3: "Medium Slow", 4: "Fast", 5: "Slow"
}


def get_exp_at_level(rate_idx, n):
    if n <= 1: return 0
    if n > 100: n = 100
    if rate_idx == 0:
        return n ** 3
    elif rate_idx == 1:
        if n <= 50:
            return int((n ** 3 * (100 - n)) / 50)
        elif n <= 68:
            return int((n ** 3 * (150 - n)) / 100)
        elif n <= 98:
            return int((n ** 3 * ((1911 - 10 * n) / 3)) / 500)
        else:
            return int((n ** 3 * (160 - n)) / 100)
    elif rate_idx == 2:
        if n <= 15:
            return int(n ** 3 * ((math.floor((n + 1) / 3) + 24) / 50))
        elif n <= 36:
            return int(n ** 3 * ((n + 14) / 50))
        else:
            return int(n ** 3 * ((math.floor(n / 2) + 32) / 50))
    elif rate_idx == 3:
        return int(1.2 * (n ** 3) - 15 * (n ** 2) + 100 * n - 140)
    elif rate_idx == 4:
        return int((4 * (n ** 3)) / 5)
    elif rate_idx == 5:
        return int((5 * (n ** 3)) / 4)
    return n ** 3


def calc_current_level(rate_idx, current_exp):
    for lvl in range(1, 101):
        if current_exp < get_exp_at_level(rate_idx, lvl + 1):
            return lvl
    return 100


def guess_growth_rate(current_exp, visual_level):
    visual = max(1, min(100, int(visual_level)))
    ranked = []

    for rate in range(6):
        inferred = calc_current_level(rate, current_exp)
        exp_at_visual = get_exp_at_level(rate, visual)
        exp_at_next = get_exp_at_level(rate, min(100, visual + 1))
        in_band = exp_at_visual <= current_exp < exp_at_next

        if in_band:
            exp_distance = 0
        else:
            if current_exp < exp_at_visual:
                exp_distance = exp_at_visual - current_exp
            else:
                exp_distance = max(0, current_exp - exp_at_next + 1)

        ranked.append({
            "rate": rate,
            "in_band": in_band,
            "level_delta": abs(inferred - visual),
            "exp_distance": exp_distance,
        })

    ranked.sort(key=lambda x: (0 if x["in_band"] else 1, x["level_delta"], x["exp_distance"], x["rate"]))
    best = ranked[0]
    runner = ranked[1] if len(ranked) > 1 else None

    confidence = "low"
    if best["in_band"] and best["level_delta"] == 0:
        if not runner:
            confidence = "high"
        elif (not runner["in_band"]) or runner["level_delta"] > 0:
            confidence = "high"
        else:
            confidence = "medium"
    elif best["level_delta"] <= 1:
        confidence = "medium"

    return best["rate"], confidence


# --- UTILS DI CODIFICA ---
CHARMAP = {
    0x00: " ", 0xAB: "!", 0xAC: "?", 0xAD: ".", 0xAE: "-", 0xFF: "",
    0xB0: "0", 0xB1: "1", 0xB2: "2", 0xB3: "3", 0xB4: "4",
    0xB5: "5", 0xB6: "6", 0xB7: "7", 0xB8: "8", 0xB9: "9",
    0xBB: "A", 0xBC: "B", 0xBD: "C", 0xBE: "D", 0xBF: "E", 0xC0: "F",
    0xC1: "G", 0xC2: "H", 0xC3: "I", 0xC4: "J", 0xC5: "K", 0xC6: "L",
    0xC7: "M", 0xC8: "N", 0xC9: "O", 0xCA: "P", 0xCB: "Q", 0xCC: "R",
    0xCD: "S", 0xCE: "T", 0xCF: "U", 0xD0: "V", 0xD1: "W", 0xD2: "X",
    0xD3: "Y", 0xD4: "Z",
    0xD5: "a", 0xD6: "b", 0xD7: "c", 0xD8: "d", 0xD9: "e", 0xDA: "f",
    0xDB: "g", 0xDC: "h", 0xDD: "i", 0xDE: "j", 0xDF: "k", 0xE0: "l",
    0xE1: "m", 0xE2: "n", 0xE3: "o", 0xE4: "p", 0xE5: "q", 0xE6: "r",
    0xE7: "s", 0xE8: "t", 0xE9: "u", 0xEA: "v", 0xEB: "w", 0xEC: "x",
    0xED: "y", 0xEE: "z",
}

ENCODE_CHARMAP = {
    " ": 0x00,
    "!": 0xAB,
    "?": 0xAC,
    ".": 0xAD,
    "-": 0xAE,
    "'": 0xB4,
}
for i, c in enumerate("0123456789"):
    ENCODE_CHARMAP[c] = 0xB0 + i
for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
    ENCODE_CHARMAP[c] = 0xBB + i
for i, c in enumerate("abcdefghijklmnopqrstuvwxyz"):
    ENCODE_CHARMAP[c] = 0xD5 + i


def decode_text(data):
    s = ""
    for b in data:
        if b == 0xFF: break
        char = CHARMAP.get(b, "?")
        s += char
    return s


def encode_text(text, max_len=10):
    safe = (text or "").strip()[:max_len]
    out = bytearray([0xFF] * max_len)
    for i, ch in enumerate(safe):
        out[i] = ENCODE_CHARMAP.get(ch, 0xAC)
    return bytes(out)


def ru16(b, o): return struct.unpack_from("<H", b, o)[0]


def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


def wu8(b, o, v): struct.pack_into("<B", b, o, v)


def wu16(b, o, v): struct.pack_into("<H", b, o, v)


def wu32(b, o, v): struct.pack_into("<I", b, o, v)


def load_static_data():
    DB_ITEMS.clear()
    DB_MOVES.clear()
    DB_SPECIES.clear()
    DB_SPECIES_BASE_STATS.clear()
    DB_SPECIES_IDENTITY_META.clear()
    DB_SPECIES_GROWTH_RATES.clear()

    DB_ITEMS.update(load_id_name_file("items.txt"))
    DB_MOVES.update(load_id_name_file("moves.txt"))
    DB_SPECIES.update(load_id_name_file("pokemon.txt"))

    base_stats_path = os.path.join(os.path.dirname(__file__), "..", "data", "species_base_stats.json")
    if os.path.exists(base_stats_path):
        with open(base_stats_path, "r", encoding="utf-8") as fh:
            raw_stats = json.loads(fh.read())
        for sid, stats in raw_stats.items():
            if not str(sid).isdigit():
                continue
            DB_SPECIES_BASE_STATS[int(sid)] = {
                "hp": int(stats.get("hp", 0)),
                "atk": int(stats.get("atk", 0)),
                "def": int(stats.get("def", 0)),
                "spe": int(stats.get("spe", 0)),
                "spa": int(stats.get("spa", 0)),
                "spd": int(stats.get("spd", 0)),
            }

    identity_meta_path = os.path.join(os.path.dirname(__file__), "..", "data", "species_identity_meta.json")
    if os.path.exists(identity_meta_path):
        with open(identity_meta_path, "r", encoding="utf-8") as fh:
            raw_identity = json.loads(fh.read())
        for sid, meta in raw_identity.items():
            if not str(sid).isdigit():
                continue
            threshold = meta.get("gender_threshold") if isinstance(meta, dict) else None
            if threshold is None:
                continue
            DB_SPECIES_IDENTITY_META[int(sid)] = {
                "gender_threshold": int(threshold) & 0xFF,
            }

    growth_rates_path = os.path.join(os.path.dirname(__file__), "..", "data", "species_growth_rates.json")
    if os.path.exists(growth_rates_path):
        with open(growth_rates_path, "r", encoding="utf-8") as fh:
            raw_growth = json.loads(fh.read())
        for sid, meta in raw_growth.items():
            if not str(sid).isdigit():
                continue
            rate = meta.get("growth_rate") if isinstance(meta, dict) else None
            if rate is None:
                continue
            rate_int = int(rate)
            if 0 <= rate_int <= 5:
                DB_SPECIES_GROWTH_RATES[int(sid)] = rate_int

    print(
        f"[INFO] Dati statici caricati: "
        f"{len(DB_ITEMS)} oggetti, {len(DB_MOVES)} mosse, {len(DB_SPECIES)} specie, "
        f"{len(DB_SPECIES_BASE_STATS)} base stats, {len(DB_SPECIES_IDENTITY_META)} identity meta, "
        f"{len(DB_SPECIES_GROWTH_RATES)} growth rates."
    )


def get_species_growth_rate(species_id):
    rate = DB_SPECIES_GROWTH_RATES.get(int(species_id))
    if rate is None:
        return None
    if 0 <= int(rate) <= 5:
        return int(rate)
    return None


def _shiny_value(otid: int, pid: int) -> int:
    tid = otid & 0xFFFF
    sid = (otid >> 16) & 0xFFFF
    return tid ^ sid ^ (pid & 0xFFFF) ^ ((pid >> 16) & 0xFFFF)


def _is_shiny_pid(otid: int, pid: int) -> bool:
    return _shiny_value(otid, pid) < 8


def _gender_from_pid(pid: int, gender_threshold: int | None) -> str:
    if gender_threshold is None:
        return "unknown"
    if gender_threshold == GENDER_THRESHOLD_GENDERLESS:
        return "genderless"
    if gender_threshold == GENDER_THRESHOLD_MALE_ONLY:
        return "male"
    if gender_threshold == GENDER_THRESHOLD_FEMALE_ONLY:
        return "female"
    return "female" if (pid & 0xFF) < gender_threshold else "male"


def _gender_mode_from_threshold(gender_threshold: int | None) -> str:
    if gender_threshold is None:
        return "unknown"
    if gender_threshold == GENDER_THRESHOLD_GENDERLESS:
        return "genderless"
    if gender_threshold == GENDER_THRESHOLD_MALE_ONLY:
        return "fixed_male"
    if gender_threshold == GENDER_THRESHOLD_FEMALE_ONLY:
        return "fixed_female"
    return "dynamic"


def _nearest_high_for_mod(req_mod: int, preferred_high: int) -> int:
    k = round((preferred_high - req_mod) / 25)
    min_k = 0
    max_k = (0xFFFF - req_mod) // 25
    k = max(min_k, min(max_k, k))
    return req_mod + (25 * k)


def _find_identity_pid(
    current_pid: int,
    otid: int,
    target_nature_id: int,
    desired_shiny: bool,
    desired_gender: str | None,
    gender_threshold: int | None,
    required_ability_slot: int | None,
):
    target_nature_id = int(target_nature_id) % 25

    if desired_gender is not None:
        desired_gender = desired_gender.lower().strip()
        if desired_gender not in {"male", "female", "genderless"}:
            return None, f"Invalid gender '{desired_gender}'."

    if desired_gender == "genderless":
        if gender_threshold != GENDER_THRESHOLD_GENDERLESS:
            return None, "Selected species is not genderless."
    elif desired_gender in {"male", "female"}:
        mode = _gender_mode_from_threshold(gender_threshold)
        if mode == "unknown":
            return None, "Gender metadata unavailable for this species."
        if mode == "genderless":
            return None, "Selected species is genderless."
        if mode == "fixed_male" and desired_gender != "male":
            return None, "Selected species is male-only."
        if mode == "fixed_female" and desired_gender != "female":
            return None, "Selected species is female-only."

    current_low = current_pid & 0xFFFF
    current_high = (current_pid >> 16) & 0xFFFF
    tid_sid = (otid & 0xFFFF) ^ ((otid >> 16) & 0xFFFF)

    for delta in range(0x10000):
        low = (current_low + delta) & 0xFFFF

        if required_ability_slot is not None and (low & 1) != required_ability_slot:
            continue

        if desired_gender in {"male", "female"} and _gender_mode_from_threshold(gender_threshold) == "dynamic":
            if _gender_from_pid(low, gender_threshold) != desired_gender:
                continue

        req_high_mod = ((target_nature_id - (low % 25)) * _INV_11_MOD_25) % 25

        if desired_shiny:
            for sv in range(8):
                high = (tid_sid ^ low ^ sv) & 0xFFFF
                if high % 25 != req_high_mod:
                    continue
                pid = ((high << 16) | low) & 0xFFFFFFFF
                if desired_gender in {"male", "female", "genderless"}:
                    if _gender_from_pid(pid, gender_threshold) != desired_gender:
                        continue
                return pid, None
            continue

        base_high = _nearest_high_for_mod(req_high_mod, current_high)
        if not _is_shiny_pid(otid, ((base_high << 16) | low) & 0xFFFFFFFF):
            pid = ((base_high << 16) | low) & 0xFFFFFFFF
            if desired_gender in {"male", "female", "genderless"}:
                if _gender_from_pid(pid, gender_threshold) != desired_gender:
                    continue
            return pid, None

        found_non_shiny = None
        for n in range(1, 6):
            for sign in (-1, 1):
                test_high = base_high + (sign * 25 * n)
                if test_high < 0 or test_high > 0xFFFF:
                    continue
                test_pid = ((test_high << 16) | low) & 0xFFFFFFFF
                if not _is_shiny_pid(otid, test_pid):
                    found_non_shiny = test_pid
                    break
            if found_non_shiny is not None:
                break

        if found_non_shiny is None:
            continue

        if desired_gender in {"male", "female", "genderless"}:
            if _gender_from_pid(found_non_shiny, gender_threshold) != desired_gender:
                continue
        return found_non_shiny, None

    return None, "Could not find a PID satisfying all identity constraints."


def nature_modifier(nature_id, stat_key):
    inc_dec = {
        0: (None, None),
        1: ("atk", "def"),
        2: ("atk", "spe"),
        3: ("atk", "spa"),
        4: ("atk", "spd"),
        5: ("def", "atk"),
        6: (None, None),
        7: ("def", "spe"),
        8: ("def", "spa"),
        9: ("def", "spd"),
        10: ("spe", "atk"),
        11: ("spe", "def"),
        12: (None, None),
        13: ("spe", "spa"),
        14: ("spe", "spd"),
        15: ("spa", "atk"),
        16: ("spa", "def"),
        17: ("spa", "spe"),
        18: (None, None),
        19: ("spa", "spd"),
        20: ("spd", "atk"),
        21: ("spd", "def"),
        22: ("spd", "spe"),
        23: ("spd", "spa"),
        24: (None, None),
    }
    inc, dec = inc_dec.get(int(nature_id) % 25, (None, None))
    if stat_key == inc:
        return 1.1
    if stat_key == dec:
        return 0.9
    return 1.0


def calc_hp_stat(base, iv, ev, level):
    return ((2 * base + iv + (ev // 4)) * level) // 100 + level + 10


def calc_other_stat(base, iv, ev, level, nature_mult):
    neutral = ((2 * base + iv + (ev // 4)) * level) // 100 + 5
    return int(math.floor(neutral * nature_mult))


# Compat legacy name.
def find_and_load_ct():
    load_static_data()


def search_id(query, db, db_name):
    if not query: return None, None
    if query.isdigit():
        val = int(query)
        return val, db.get(val, "Sconosciuto")
    query = query.lower()
    matches = []
    for idx, name in db.items():
        if query in name.lower(): matches.append((idx, name))
    if not matches:
        print(f"Nessun {db_name} trovato.")
        return None, None
    if len(matches) == 1: return matches[0]
    print(f"Trovati più {db_name}:")
    for i, (idx, name) in enumerate(matches[:10]):
        print(f" {i + 1}) {name} (ID: {idx})")
    sel = input("Scegli (numero): ")
    if sel.isdigit() and 1 <= int(sel) <= len(matches):
        return matches[int(sel) - 1]
    return None, None


# --- CLASSE POKEMON ---
class Pokemon:
    def __init__(self, data):
        self.raw = bytearray(data)
        self.pid = ru32(self.raw, OFF_PID)
        self.otid = ru32(self.raw, OFF_OTID)
        self.nickname = decode_text(self.raw[OFF_NICK:OFF_NICK + 10])
        self.data_block = self.raw[OFF_DATA_START: OFF_DATA_START + 48]
        self.substructs = {
            'B': self.data_block[0:12], 'A': self.data_block[12:24],
            'D': self.data_block[24:36], 'C': self.data_block[36:48]
        }

    # Getters
    def get_species_id(self):
        return ru16(self.substructs['B'], 0)

    def get_item_id(self):
        return ru16(self.substructs['B'], 2)

    def get_moves_ids(self):
        return [ru16(self.substructs['A'], i * 2) for i in range(4)]

    def get_exp(self):
        return ru32(self.substructs['B'], 4)

    # --- NUOVA GESTIONE ABILITÀ CFRU ---
    # In CFRU, il bit 31 degli IVs (Offset 0x04 nel substruct C) indica se è attiva l'Abilità Segreta.
    # 0 = Standard (1 o 2 decise dal PID)
    # 1 = Hidden Ability (Segreta)

    def get_hidden_ability_flag(self):
        packed = ru32(self.substructs['C'], 4)
        return (packed >> 31) & 1

    def set_hidden_ability_flag(self, active):
        c = bytearray(self.substructs['C'])
        val = ru32(c, 4)
        if active:
            val |= (1 << 31)  # Setta bit 31 a 1
        else:
            val &= ~(1 << 31)  # Setta bit 31 a 0
        wu32(c, 4, val)
        self.substructs['C'] = c

    def get_standard_ability_slot(self):
        # Se HA è spenta, l'abilità standard è determinata dall'ultimo bit del PID
        return self.pid & 1

    def get_ivs(self):
        packed = ru32(self.substructs['C'], 4)
        return {
            'HP': (packed >> 0) & 0x1F, 'Atk': (packed >> 5) & 0x1F,
            'Def': (packed >> 10) & 0x1F, 'Spd': (packed >> 15) & 0x1F,
            'SpA': (packed >> 20) & 0x1F, 'SpD': (packed >> 25) & 0x1F
        }

    def get_evs(self):
        d = self.substructs['D']
        return {'HP': d[0], 'Atk': d[1], 'Def': d[2], 'Spd': d[3], 'SpA': d[4], 'SpD': d[5]}

    # --- GESTIONE NATURA (PID) ---
    def get_nature_id(self):
        return self.pid % 25

    def get_nature_name(self):
        return DB_NATURES.get(self.get_nature_id(), "Sconosciuta")

    def get_gender_threshold(self):
        meta = DB_SPECIES_IDENTITY_META.get(self.get_species_id(), {})
        threshold = meta.get("gender_threshold")
        return int(threshold) if threshold is not None else None

    def get_gender_mode(self):
        return _gender_mode_from_threshold(self.get_gender_threshold())

    def get_gender(self):
        return _gender_from_pid(self.pid, self.get_gender_threshold())

    def is_shiny(self):
        return _is_shiny_pid(self.otid, self.pid)

    def set_nature(self, target_nature_id):
        current_ability_slot = self.pid & 1  # Salva lo slot attuale (0 o 1)
        while (self.pid % 25 != target_nature_id) or (self.pid & 1 != current_ability_slot):
            self.pid = (self.pid + 1) & 0xFFFFFFFF
        wu32(self.raw, OFF_PID, self.pid)

    def set_identity(self, shiny: bool | None = None, gender: str | None = None):
        desired_shiny = self.is_shiny() if shiny is None else bool(shiny)

        desired_gender = gender
        if desired_gender is None:
            mode = self.get_gender_mode()
            if mode == "dynamic":
                desired_gender = self.get_gender()

        required_ability_slot = None if self.get_hidden_ability_flag() else self.get_standard_ability_slot()
        next_pid, reason = _find_identity_pid(
            current_pid=self.pid,
            otid=self.otid,
            target_nature_id=self.get_nature_id(),
            desired_shiny=desired_shiny,
            desired_gender=desired_gender,
            gender_threshold=self.get_gender_threshold(),
            required_ability_slot=required_ability_slot,
        )
        if next_pid is None:
            raise ValueError(reason or "Identity PID solve failed")

        self.pid = next_pid
        wu32(self.raw, OFF_PID, self.pid)

    # Setters Standard
    def set_ivs(self, iv_dict):
        c = bytearray(self.substructs['C'])
        orig = ru32(c, 4)
        new_val = (orig & 0xC0000000)  # Mantiene Egg bit (30) e HA bit (31)
        shift = 0
        for stat in ['HP', 'Atk', 'Def', 'Spd', 'SpA', 'SpD']:
            new_val |= (iv_dict[stat] & 0x1F) << shift
            shift += 5
        wu32(c, 4, new_val)
        self.substructs['C'] = c

    def set_evs(self, ev_dict):
        d = bytearray(self.substructs['D'])
        keys = ['HP', 'Atk', 'Def', 'Spd', 'SpA', 'SpD']
        for i, k in enumerate(keys): d[i] = ev_dict[k]
        self.substructs['D'] = d

    def set_item(self, item_id):
        b = bytearray(self.substructs['B'])
        wu16(b, 2, item_id)
        self.substructs['B'] = b

    def set_nickname(self, nickname):
        self.nickname = (nickname or "").strip()[:10]
        self.raw[OFF_NICK:OFF_NICK + 10] = encode_text(self.nickname, 10)

    def set_species_id(self, species_id):
        b = bytearray(self.substructs['B'])
        wu16(b, 0, species_id)
        self.substructs['B'] = b

    def set_moves(self, moves):
        a = bytearray(self.substructs['A'])
        for i in range(4):
            if i < len(moves): wu16(a, i * 2, moves[i])
        self.substructs['A'] = a

    def set_exp(self, exp):
        b = bytearray(self.substructs['B'])
        wu32(b, 4, exp)
        self.substructs['B'] = b

    def set_visual_level(self, lvl):
        wu8(self.raw, OFF_LEVEL_VISUAL, lvl)

    def recalculate_party_stats(self, clamp_hp=True):
        species_id = self.get_species_id()
        base = DB_SPECIES_BASE_STATS.get(species_id)
        if not base:
            return

        level = max(1, int(self.raw[OFF_LEVEL_VISUAL]))
        ivs = self.get_ivs()
        evs = self.get_evs()
        nature_id = self.get_nature_id()

        new_max_hp = calc_hp_stat(base["hp"], ivs["HP"], evs["HP"], level)
        new_atk = calc_other_stat(base["atk"], ivs["Atk"], evs["Atk"], level, nature_modifier(nature_id, "atk"))
        new_def = calc_other_stat(base["def"], ivs["Def"], evs["Def"], level, nature_modifier(nature_id, "def"))
        new_spe = calc_other_stat(base["spe"], ivs["Spd"], evs["Spd"], level, nature_modifier(nature_id, "spe"))
        new_spa = calc_other_stat(base["spa"], ivs["SpA"], evs["SpA"], level, nature_modifier(nature_id, "spa"))
        new_spd = calc_other_stat(base["spd"], ivs["SpD"], evs["SpD"], level, nature_modifier(nature_id, "spd"))

        old_hp = ru16(self.raw, OFF_CURR_HP)
        if clamp_hp:
            new_hp = min(old_hp, new_max_hp)
        else:
            new_hp = new_max_hp

        wu16(self.raw, OFF_CURR_HP, max(0, int(new_hp)))
        wu16(self.raw, OFF_MAX_HP, max(1, int(new_max_hp)))
        wu16(self.raw, OFF_ATK, max(1, int(new_atk)))
        wu16(self.raw, OFF_DEF, max(1, int(new_def)))
        wu16(self.raw, OFF_SPE, max(1, int(new_spe)))
        wu16(self.raw, OFF_SPA, max(1, int(new_spa)))
        wu16(self.raw, OFF_SPD, max(1, int(new_spd)))

    def pack_data(self):
        new_payload = self.substructs['B'] + self.substructs['A'] + self.substructs['D'] + self.substructs['C']
        checksum = 0
        for i in range(0, 48, 2):
            checksum = (checksum + ru16(new_payload, i)) & 0xFFFF
        wu16(self.raw, OFF_CHECKSUM, checksum)
        self.raw[OFF_DATA_START: OFF_DATA_START + 48] = new_payload
        wu32(self.raw, OFF_PID, self.pid)
        return self.raw

    def set_ability_slot(self, slot_type):
        """
        slot_type: 0 = Slot 1 (Std), 1 = Slot 2 (Std), 2 = Hidden Ability
        """
        if slot_type == 2:
            # Attiva HA e mantieni il PID attuale
            self.set_hidden_ability_flag(True)
        else:
            # Disattiva HA e aggiusta il PID per lo slot 0 o 1
            self.set_hidden_ability_flag(False)
            target_nature = self.get_nature_id()
            # Cerchiamo un PID che mantenga la stessa natura ma cambi il bit dell'abilità
            while (self.pid % 25 != target_nature) or (self.pid & 1 != slot_type):
                self.pid = (self.pid + 1) & 0xFFFFFFFF
            wu32(self.raw, OFF_PID, self.pid)


# --- LOGICA SALVATAGGIO ---
def calculate_section_checksum(data):
    total = 0
    for i in range(0, CHECKSUM_LENGTH, 4):
        total = (total + ru32(data, i)) & 0xFFFFFFFF
    return ((total >> 16) + (total & 0xFFFF)) & 0xFFFF


def main():
    if len(sys.argv) < 2:
        print("Uso: python3 -m modules.party <savefile>")
        return

    save_path = sys.argv[1]
    load_static_data()
    shutil.copy(save_path, save_path + ".bak_v10")
    print(f"Backup creato: {save_path}.bak_v10")

    with open(save_path, "rb") as f:
        full_data = bytearray(f.read())

    num_sections = len(full_data) // SECTION_SIZE
    trainer_sections = []
    for i in range(num_sections):
        off = i * SECTION_SIZE
        if ru16(full_data, off + FOOTER_ID_OFF) == TRAINER_SECTION_ID:
            trainer_sections.append({'off': off, 'idx': ru32(full_data, off + FOOTER_SAVEIDX_OFF)})

    if not trainer_sections: return
    trainer_sections.sort(key=lambda x: x['idx'], reverse=True)
    active_sec_off = trainer_sections[0]['off']

    # Caricamento Squadra
    sec_data = full_data[active_sec_off: active_sec_off + SECTION_SIZE]
    PARTY_OFFSET = 0x38
    team_count = ru32(sec_data, 0x34)
    if team_count > 6: team_count = 6

    pokemon_list = []
    print("\n--- SQUADRA ATTUALE ---")
    for i in range(team_count):
        mon_off = PARTY_OFFSET + (i * 100)
        p = Pokemon(sec_data[mon_off: mon_off + 100])
        pokemon_list.append(p)
        s_name = DB_SPECIES.get(p.get_species_id(), "???")
        ha_status = "HA" if p.get_hidden_ability_flag() else "Std"
        print(f"[{i + 1}] {p.nickname} ({s_name}) - {p.get_nature_name()} [{ha_status}]")

    while True:
        print("\n--- MENU ---")
        print("1. Modifica IVs")
        print("2. Modifica EVs")
        print("3. Modifica Mosse")
        print("4. Modifica Strumento")
        print("5. Modifica Exp/Livello (Con Calcolo Crescita)")
        print("6. Gestione Abilità (Standard / Nascosta)")
        print("7. MODIFICA NATURA")
        print("9. SALVA ed Esci")
        print("0. Esci")

        ch = input(">> ")
        if ch == '0': return
        if ch == '9':
            packed = [p.pack_data() for p in pokemon_list]
            for sec in trainer_sections:
                off = sec['off']
                c_data = bytearray(full_data[off: off + SECTION_SIZE])
                for i, p_data in enumerate(packed):
                    mo = PARTY_OFFSET + (i * 100)
                    c_data[mo: mo + 100] = p_data
                chk = calculate_section_checksum(c_data)
                wu16(c_data, FOOTER_CHK_OFF, chk)
                full_data[off: off + SECTION_SIZE] = c_data
            with open(save_path, "wb") as f:
                f.write(full_data)
            print("Salvato.")
            return

        try:
            idx_input = input("Pokemon (1-6): ")
            if not idx_input: continue
            idx = int(idx_input) - 1
            pk = pokemon_list[idx]

            if ch == '1':  # IV
                curr = pk.get_ivs()
                print(f"IVs: {curr}")
                for k in curr:
                    v = input(f"{k}: ")
                    if v: curr[k] = int(v)
                pk.set_ivs(curr)
            elif ch == '2':  # EV
                curr = pk.get_evs()
                print(f"EVs: {curr}")
                for k in curr:
                    v = input(f"{k}: ")
                    if v: curr[k] = int(v)
                pk.set_evs(curr)
            elif ch == '3':  # Mosse
                curr = pk.get_moves_ids()
                print("Mosse:", [DB_MOVES.get(m, m) for m in curr])
                for i in range(4):
                    q = input(f"Mossa {i + 1}: ")
                    res = search_id(q, DB_MOVES, "Mossa")
                    if res[0]: curr[i] = res[0]
                pk.set_moves(curr)
            elif ch == '4':  # Item
                print(f"Item: {DB_ITEMS.get(pk.get_item_id(), pk.get_item_id())}")
                res = search_id(input("Nuovo Item: "), DB_ITEMS, "Oggetto")
                if res[0]: pk.set_item(res[0])

            elif ch == '5':  # Exp
                print("\n--- SELEZIONE CURVA DI CRESCITA ---")
                for k, v in GROWTH_NAMES.items():
                    print(f" {k}: {v}")

                rate_s = input("ID Curva (0-5) [Default 0]: ")
                rate = int(rate_s) if rate_s.isdigit() else 0

                curr_exp = pk.get_exp()
                est_lvl = calc_current_level(rate, curr_exp)
                print(f"Exp Attuale: {curr_exp} | Livello Stimato: {est_lvl}")

                target_s = input("Nuovo Livello desiderato (1-100): ")
                if target_s.isdigit():
                    target = int(target_s)
                    new_exp = get_exp_at_level(rate, target)

                    pk.set_exp(new_exp)
                    pk.set_visual_level(target)
                    print(f"Impostato Lv {target} con {new_exp} Exp.")
                else:
                    print("Input non valido.")

            elif ch == '6':  # Nuova gestione Abilità
                ha_active = pk.get_hidden_ability_flag()
                std_slot = pk.get_standard_ability_slot() + 1

                status_str = "ATTIVA (Hidden Ability)" if ha_active else f"DISATTIVA (Usa Standard Slot {std_slot})"
                print(f"\nStato Attuale: {status_str}")
                print("1. Attiva Abilità Segreta (HA)")
                print("2. Disattiva HA (Usa Abilità Standard da PID)")

                sel = input("Scelta: ")
                if sel == '1':
                    pk.set_hidden_ability_flag(True)
                    print("Hidden Ability attivata!")
                elif sel == '2':
                    pk.set_hidden_ability_flag(False)
                    print(f"Hidden Ability rimossa. Il Pokémon userà l'abilità dello Slot {std_slot}.")

            elif ch == '7':  # Natura
                print(f"Natura Attuale: {pk.get_nature_name()}")
                print("Lista Nature:")
                for k, v in DB_NATURES.items():
                    print(f" {k}: {v}")
                nid_s = input("ID Nuova Natura (0-24): ")
                if nid_s.isdigit():
                    nid = int(nid_s)
                    if 0 <= nid <= 24:
                        pk.set_nature(nid)
                        print(f"Natura cambiata in {DB_NATURES[nid]}.")

        except ValueError:
            print("Input invalido")
        except Exception as e:
            print(f"Errore: {e}")


if __name__ == "__main__":
    main()
