#!/usr/bin/env python3
import struct
import sys
import shutil
import math
import glob
import re
import os

# --- CONFIGURAZIONE TECNICA (PC Unbound) ---
PC_SECTOR_IDS = [5, 6, 7, 8, 9, 10, 11, 12, 13]
SECTION_SIZE = 0x1000
SECTOR_HEADER_SIZE = 4
MON_SIZE_PC = 58  # Stride confermato dall'autopsia

# --- OFFSET (CFRU COMPACT) ---
OFF_PID = 0x00
OFF_NICK = 0x08
OFF_SPECIES = 0x1C
OFF_ITEM = 0x1E
OFF_EXP = 0x20  # Fonte verità livello
OFF_MOVES = 0x24  # 4 mosse x 2 bytes = 8 bytes
OFF_EVS = 0x2C
OFF_IVS = 0x36

# --- REGOLE SETTORI ---
SECTOR_RULES = {
    5: 'FULL', 6: 'FULL',
    7: 'STD', 8: 'STD', 9: 'STD', 10: 'STD', 11: 'STD', 12: 'STD',
    13: 'COPY'
}

# --- DATABASE GLOBALE (Popolato dal .CT) ---
DB_ITEMS = {}
DB_MOVES = {}
DB_SPECIES = {}

GROWTH_NAMES = {
    0: "Medium Fast (Cubic)", 1: "Erratic", 2: "Fluctuating",
    3: "Medium Slow", 4: "Fast", 5: "Slow"
}


# --- FUNZIONI DI PARSING .CT (Dal tuo v8) ---
def find_and_load_ct():
    """Cerca e parsa il file .CT per popolare i database."""
    ct_files = glob.glob("*.CT") + glob.glob("data/*.CT") + glob.glob("data/*.ct")
    if not ct_files:
        print("[WARN] Nessun file .CT trovato. I nomi non saranno disponibili.")
        return

    ct_path = ct_files[0]
    print(f"[INFO] Caricamento dati da: {ct_path}...")
    try:
        with open(ct_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()

        # Regex adattate dal v8 per estrarre le liste Lua
        _parse_category(content, r'local AttacksDropDownList = "(.*?)"', DB_MOVES, "Mosse")
        _parse_category(content, r'local PokemonDropDownList = "(.*?)"', DB_SPECIES, "Specie")
        # Item non strettamente necessari per PC ma utili se espandiamo
        # _parse_category(content, r'local linkDropDownList = "(.*?)"', DB_ITEMS, "Oggetti")

    except Exception as e:
        print(f"[ERR] Errore nel parsing del CT: {e}")


def _parse_category(content, regex_pattern, target_dict, label):
    """Logica di parsing presa pari pari dal v8"""
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
                    idx = int(parts[0].strip())
                    name = parts[1].strip()
                    target_dict[idx] = name
                    count += 1
                except ValueError:
                    continue
        print(f"   -> Caricati {count} {label}.")


def search_id(query, db, db_name):
    """Cerca un ID nel database (logica v8)."""
    if not query: return None, None
    if query.isdigit():
        val = int(query)
        return val, db.get(val, f"Unknown {db_name}")

    query = query.lower()
    matches = []
    for idx, name in db.items():
        if query in name.lower():
            matches.append((idx, name))

    if not matches:
        print(f"Nessun risultato per '{query}'.")
        return None, None

    if len(matches) == 1:
        return matches[0]

    print(f"Trovati più risultati per '{query}':")
    for i, (idx, name) in enumerate(matches[:10]):
        print(f" {i + 1}) {name} (ID: {idx})")

    try:
        sel = int(input("Scegli un numero: "))
        if 1 <= sel <= len(matches):
            return matches[sel - 1]
    except:
        pass
    return None, None


# --- UTILS MATEMATICHE E BINARIE ---
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


CHARMAP = {
    0x00: " ", 0x01: "À", 0x02: "Á", 0x03: "Â", 0x04: "Ç", 0x05: "È",
    0x06: "É", 0x07: "Ê", 0x08: "Ë", 0x09: "Ì", 0x0B: "Î", 0x0C: "Ï",
    0x0D: "Ò", 0x0E: "Ó", 0x0F: "Ô", 0x10: "Œ", 0x11: "Ù", 0x12: "Ú",
    0x13: "Û", 0x14: "Ñ", 0x15: "ß", 0x16: "à", 0x17: "á", 0x19: "ç",
    0x1A: "è", 0x1B: "é", 0x1C: "ê", 0x1D: "ë", 0x1E: "ì", 0x20: "î",
    0x21: "ï", 0x22: "ò", 0x23: "ó", 0x24: "ô", 0x25: "œ", 0x26: "ù",
    0x27: "ú", 0x28: "û", 0x29: "ñ", 0x2A: "º", 0x2B: "ª", 0x2D: "&",
    0x2E: "+", 0x34: "Lv", 0x35: "=", 0x36: ";", 0x51: "¿", 0x52: "¡",
    0x53: "PK", 0x54: "MN", 0x55: "PO", 0x56: "Ké", 0x57: "Bl", 0x58: "oc",
    0x59: "k", 0x5A: "Í", 0x5B: "%", 0x5C: "(", 0x5D: ")", 0x68: "â",
    0x6F: "í", 0x79: "⬆", 0x7A: "⬇", 0x7B: "⬅", 0x7C: "➡", 0x85: "<",
    0x86: ">", 0xA1: "0", 0xA2: "1", 0xA3: "2", 0xA4: "3", 0xA5: "4",
    0xA6: "5", 0xA7: "6", 0xA8: "7", 0xA9: "8", 0xAA: "9", 0xAB: "!",
    0xAC: "?", 0xAD: ".", 0xAE: "-", 0xAF: "·", 0xB0: "...", 0xB1: "“",
    0xB2: "”", 0xB3: "‘", 0xB4: "’", 0xB5: "♂", 0xB6: "♀", 0xB7: "$",
    0xB8: ",", 0xB9: "×", 0xBA: "/", 0xBB: "A", 0xBC: "B", 0xBD: "C",
    0xBE: "D", 0xBF: "E", 0xC0: "F", 0xC1: "G", 0xC2: "H", 0xC3: "I",
    0xC4: "J", 0xC5: "K", 0xC6: "L", 0xC7: "M", 0xC8: "N", 0xC9: "O",
    0xCA: "P", 0xCB: "Q", 0xCC: "R", 0xCD: "S", 0xCE: "T", 0xCF: "U",
    0xD0: "V", 0xD1: "W", 0xD2: "X", 0xD3: "Y", 0xD4: "Z", 0xD5: "a",
    0xD6: "b", 0xD7: "c", 0xD8: "d", 0xD9: "e", 0xDA: "f", 0xDB: "g",
    0xDC: "h", 0xDD: "i", 0xDE: "j", 0xDF: "k", 0xE0: "l", 0xE1: "m",
    0xE2: "n", 0xE3: "o", 0xE4: "p", 0xE5: "q", 0xE6: "r", 0xE7: "s",
    0xE8: "t", 0xE9: "u", 0xEA: "v", 0xEB: "w", 0xEC: "x", 0xED: "y",
    0xEE: "z", 0xEF: "▶", 0xF0: ":", 0xF1: "Ä", 0xF2: "Ö", 0xF3: "Ü",
    0xF4: "ä", 0xF5: "ö", 0xF6: "ü", 0xFF: ""
}


def decode_text(data):
    s = ""
    for b in data:
        if b == 0xFF: break
        s += CHARMAP.get(b, "?")
    return s


def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


def ru16(b, o): return struct.unpack_from("<H", b, o)[0]


def ru8(b, o): return struct.unpack_from("<B", b, o)[0]


def wu32(b, o, v): struct.pack_into("<I", b, o, v)


def wu16(b, o, v): struct.pack_into("<H", b, o, v)


def wu8(b, o, v): struct.pack_into("<B", b, o, v)


# --- CLASSE POKEMON ---
class UnboundPCMon:
    def __init__(self, data, box, slot):
        self.raw = bytearray(data)
        self.box = box
        self.slot = slot
        self.is_valid = False

        if len(self.raw) < MON_SIZE_PC: return
        self.species_id = ru16(self.raw, OFF_SPECIES)
        self.exp = ru32(self.raw, OFF_EXP)

        # Filtro Minimo
        if self.species_id == 0 or self.species_id > 2500: return
        if self.exp == 0: return

        self.nickname = decode_text(self.raw[OFF_NICK: OFF_NICK + 10])
        self.is_valid = True

    def set_exp(self, new_exp):
        wu32(self.raw, OFF_EXP, new_exp)
        self.exp = new_exp

    def get_moves(self):
        moves = []
        for i in range(4):
            m_id = ru16(self.raw, OFF_MOVES + (i * 2))
            moves.append(m_id)
        return moves

    def set_moves(self, move_list):
        for i in range(4):
            if i < len(move_list):
                wu16(self.raw, OFF_MOVES + (i * 2), move_list[i])

    def get_ivs(self):
        val = ru32(self.raw, OFF_IVS)
        return {
            'HP': (val >> 0) & 0x1F, 'Atk': (val >> 5) & 0x1F, 'Def': (val >> 10) & 0x1F,
            'Spe': (val >> 15) & 0x1F, 'SpA': (val >> 20) & 0x1F, 'SpD': (val >> 25) & 0x1F
        }

    def set_ivs(self, ivs):
        old_val = ru32(self.raw, OFF_IVS)
        flags = old_val & 0xC0000000
        val = 0
        val |= (ivs['HP'] & 0x1F) << 0
        val |= (ivs['Atk'] & 0x1F) << 5
        val |= (ivs['Def'] & 0x1F) << 10
        val |= (ivs['Spe'] & 0x1F) << 15
        val |= (ivs['SpA'] & 0x1F) << 20
        val |= (ivs['SpD'] & 0x1F) << 25
        val |= flags
        wu32(self.raw, OFF_IVS, val)

    def get_evs(self):
        return {
            'HP': ru8(self.raw, OFF_EVS), 'Atk': ru8(self.raw, OFF_EVS + 1), 'Def': ru8(self.raw, OFF_EVS + 2),
            'Spe': ru8(self.raw, OFF_EVS + 3), 'SpA': ru8(self.raw, OFF_EVS + 4), 'SpD': ru8(self.raw, OFF_EVS + 5)
        }

    def set_evs(self, evs):
        wu8(self.raw, OFF_EVS, evs['HP'])
        wu8(self.raw, OFF_EVS + 1, evs['Atk'])
        wu8(self.raw, OFF_EVS + 2, evs['Def'])
        wu8(self.raw, OFF_EVS + 3, evs['Spe'])
        wu8(self.raw, OFF_EVS + 4, evs['SpA'])
        wu8(self.raw, OFF_EVS + 5, evs['SpD'])


# --- GESTIONE FILE E CHECKSUM ---
def get_active_pc_sectors(data):
    sections = []
    for i in range(0, len(data), SECTION_SIZE):
        if i + SECTION_SIZE > len(data): break
        footer_offset = i + 0xFF0
        sec_id = ru16(data, footer_offset + 4)
        save_idx = ru32(data, footer_offset + 12)
        if sec_id in PC_SECTOR_IDS:
            sections.append({'id': sec_id, 'idx': save_idx, 'offset': i})
    if not sections: return []
    max_idx = max(s['idx'] for s in sections)
    return sorted([s for s in sections if s['idx'] == max_idx], key=lambda x: x['id'])


def rebuild_buffer(save_data, sectors):
    buffer = bytearray()
    headers = {}
    originals = {}
    for sec in sectors:
        off = sec['offset']
        sec_id = sec['id']
        originals[sec_id] = save_data[off: off + SECTION_SIZE]
        headers[sec_id] = save_data[off: off + SECTOR_HEADER_SIZE]
        payload = save_data[off + SECTOR_HEADER_SIZE: off + 0xF80]
        buffer += payload
    return buffer, headers, originals


def calculate_checksum(data):
    chk = 0
    for i in range(0, len(data), 4):
        chk = (chk + ru32(data, i)) & 0xFFFFFFFF
    return ((chk >> 16) + (chk & 0xFFFF)) & 0xFFFF


def write_save_HYBRID(save_data, sectors, buffer, headers, originals, filename):
    cursor = 0
    p_size = 0xF80 - SECTOR_HEADER_SIZE
    for sec in sectors:
        off = sec['offset']
        sec_id = sec['id']
        rule = SECTOR_RULES.get(sec_id, 'STD')
        if rule == 'COPY':
            save_data[off: off + SECTION_SIZE] = originals[sec_id]
            cursor += p_size
            continue
        save_data[off: off + SECTOR_HEADER_SIZE] = headers[sec_id]
        chunk = buffer[cursor: cursor + p_size]
        save_data[off + SECTOR_HEADER_SIZE: off + SECTOR_HEADER_SIZE + len(chunk)] = chunk
        chk_len = 0xFF0 if rule == 'FULL' else 0xF80
        new_chk = calculate_checksum(save_data[off: off + chk_len])
        wu16(save_data, off + 0xFF6, new_chk)
        cursor += p_size
    with open(filename, "wb") as f:
        f.write(save_data)
    print(f"Salvato in: {filename}")


def main():
    print("--- UNBOUND EDITOR v19 (CT + PC STRUCTURE) ---")

    # 1. Parsing CT (Metodo da v8)
    find_and_load_ct()

    if len(sys.argv) < 2:
        print("Uso: python3 unbound_box_editor_v19.py <savefile>")
        return

    path = sys.argv[1]
    shutil.copy(path, path + ".bak_v19")
    with open(path, "rb") as f:
        save_data = bytearray(f.read())

    sectors = get_active_pc_sectors(save_data)
    if not sectors:
        print("Errore: Settori PC non trovati.")
        return

    pc_buffer, headers, originals = rebuild_buffer(save_data, sectors)

    mons = []
    curr = 0
    for box in range(1, 26):
        for slot in range(1, 31):
            if curr + MON_SIZE_PC > len(pc_buffer): break
            m = UnboundPCMon(pc_buffer[curr:curr + MON_SIZE_PC], box, slot)
            if m.is_valid: mons.append(m)
            curr += MON_SIZE_PC

    while True:
        print(f"\nPokémon trovati: {len(mons)}")
        print("1. Lista (Visualizzazione con Nomi CT)")
        print("2. Modifica Pokémon")
        print("9. SALVA ed Esci")
        print("0. Esci")

        ch = input(">> ")
        if ch == '0': break

        if ch == '1':
            for i, m in enumerate(mons):
                s_name = DB_SPECIES.get(m.species_id, f"ID:{m.species_id}")
                print(f"{i + 1:3}. {m.nickname:<12} ({s_name:<15}) [Exp:{m.exp}] Box {m.box}-{m.slot}")

        elif ch == '2':
            try:
                idx = int(input("Numero lista: ")) - 1
                pk = mons[idx]
                s_name = DB_SPECIES.get(pk.species_id, f"ID {pk.species_id}")
                print(f"\n--- Editing: {pk.nickname} ({s_name}) ---")

                print("1. Modifica IVs")
                print("2. Modifica EVs")
                print("3. Cambia Livello (Manuale + Calcolo Exp)")
                print("4. Modifica MOSSE (Ricerca per Nome)")

                op = input("Scelta: ")
                if op == '1':
                    ivs = pk.get_ivs()
                    print(f"Attuali: {ivs}")
                    for k in ivs:
                        v = input(f"{k}: ")
                        if v: ivs[k] = int(v)
                    pk.set_ivs(ivs)
                elif op == '2':
                    evs = pk.get_evs()
                    print(f"Attuali: {evs}")
                    for k in evs:
                        v = input(f"{k}: ")
                        if v: evs[k] = int(v)
                    pk.set_evs(evs)
                elif op == '3':
                    print("\n--- SELEZIONE CURVA DI CRESCITA ---")
                    for k, v in GROWTH_NAMES.items():
                        print(f" {k}: {v}")
                    rate_s = input("Inserisci ID Gruppo (0-5): ")
                    if rate_s.isdigit():
                        rate = int(rate_s)
                        calc_lvl = calc_current_level(rate, pk.exp)
                        print(f"Livello attuale stimato: {calc_lvl}")
                        target = input("Nuovo livello (1-100): ")
                        if target:
                            req = get_exp_at_level(rate, int(target))
                            pk.set_exp(req)
                            print(f"Nuova Exp: {req}")

                elif op == '4':
                    print("\n--- MODIFICA MOSSE ---")
                    moves = pk.get_moves()
                    for i in range(4):
                        m_id = moves[i]
                        m_name = DB_MOVES.get(m_id, f"ID {m_id}")
                        print(f"Slot {i + 1}: {m_name}")

                    slot = int(input("Quale slot modificare (1-4)? ")) - 1
                    if 0 <= slot <= 3:
                        query = input("Cerca mossa (Nome o ID): ")
                        res_id, res_name = search_id(query, DB_MOVES, "Mossa")
                        if res_id is not None:
                            moves[slot] = res_id
                            pk.set_moves(moves)
                            print(f"Impostato: {res_name} (ID {res_id})")

                # Commit immediato
                abs_off = ((pk.box - 1) * 30 + (pk.slot - 1)) * MON_SIZE_PC
                pc_buffer[abs_off: abs_off + MON_SIZE_PC] = pk.raw
                print("Buffer aggiornato.")

            except Exception as e:
                print(f"Errore: {e}")

        elif ch == '9':
            write_save_HYBRID(save_data, sectors, pc_buffer, headers, originals, path)
            break


if __name__ == "__main__":
    main()