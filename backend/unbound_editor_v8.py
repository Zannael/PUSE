#!/usr/bin/env python3
# unbound_editor_v10.py — Unbound Editor con HA (Hidden Ability), Natura & Exp Logic
# Features: Checksum Fix, Auto-load .CT file, Name Search, Nature Editing, Smart Level, Hidden Ability Toggle.

import struct
import sys
import shutil
import os
import re
import glob
import math

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

# --- DATABASE GLOBALE ---
DB_ITEMS = {}
DB_MOVES = {}
DB_SPECIES = {}

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


def decode_text(data):
    s = ""
    for b in data:
        if b == 0xFF: break
        char = CHARMAP.get(b, "?")
        s += char
    return s


def ru16(b, o): return struct.unpack_from("<H", b, o)[0]


def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


def wu8(b, o, v): struct.pack_into("<B", b, o, v)


def wu16(b, o, v): struct.pack_into("<H", b, o, v)


def wu32(b, o, v): struct.pack_into("<I", b, o, v)


# --- PARSER CHEAT TABLE ---
def find_and_load_ct():
    ct_files = glob.glob("data/*.CT") + glob.glob("data/*.ct") + glob.glob("*.CT")
    if not ct_files:
        print("[WARN] Nessun file .CT trovato. Database vuoto.")
        return
    ct_path = ct_files[0]
    print(f"Caricamento dati da: {ct_path}...")
    try:
        with open(ct_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        _parse_category(content, r'local linkDropDownList = "(.*?)"', DB_ITEMS, "Oggetti")
        _parse_category(content, r'local AttacksDropDownList = "(.*?)"', DB_MOVES, "Mosse")
        _parse_category(content, r'local PokemonDropDownList = "(.*?)"', DB_SPECIES, "Pokémon")
    except Exception as e:
        print(f"[ERRORE] Lettura CT: {e}")


def _parse_category(content, regex_pattern, target_dict, label):
    match = re.search(regex_pattern, content, re.DOTALL)
    if match:
        raw_data = match.group(1)
        lines = raw_data.replace('\\n', '\n').split('\n')
        count = 0
        for line in lines:
            clean = line.strip().strip('"')
            if ':' in clean:
                parts = clean.split(':', 1)
                try:
                    target_dict[int(parts[0])] = parts[1].strip()
                    count += 1
                except ValueError:
                    continue
        print(f" -> Caricati {count} {label}.")


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

    def set_nature(self, target_nature_id):
        current_ability_slot = self.pid & 1  # Salva lo slot attuale (0 o 1)
        while (self.pid % 25 != target_nature_id) or (self.pid & 1 != current_ability_slot):
            self.pid = (self.pid + 1) & 0xFFFFFFFF
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
        print("Uso: python3 unbound_editor_v10.py <savefile>")
        return

    save_path = sys.argv[1]
    find_and_load_ct()
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