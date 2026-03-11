#!/usr/bin/env python3
import struct
import sys
import glob
import re

# --- CONFIGURAZIONE CFRU COMPACT ---
# Settori che contengono lo Stream dei Pokémon
POKEMON_STREAM_SECTORS = [5, 6, 7, 8, 9, 10, 11, 12]
SECTION_SIZE = 0x1000
SECTOR_HEADER_SIZE = 4
SECTOR_PAYLOAD_SIZE = 0xFF4 - SECTOR_HEADER_SIZE
MON_SIZE_PC = 58

# OFFSET IPOTIZZATI
OFF_NICK = 0x08
OFF_SPECIES = 0x1C
OFF_ITEM = 0x1E  # <--- TARGET DEL REVERSE ENGINEERING
OFF_EXP = 0x20

# Dizionario parziale per verifica visiva immediata
COMMON_ITEMS = {
    0: "--- NESSUNO ---",
    1: "Master Ball",
    4: "Poke Ball",
    13: "Potion",
    44: "Rare Candy",
    200: "Leftovers"
}


def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


def ru16(b, o): return struct.unpack_from("<H", b, o)[0]


# --- PARSING DEI NOMI (Opzionale, per leggibilità) ---
def load_pokemon_names():
    names = {}
    ct_files = glob.glob("*.CT") + glob.glob("data/*.CT")
    if not ct_files: return names
    try:
        with open(ct_files[0], 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            match = re.search(r'local PokemonDropDownList = "(.*?)"', content, re.DOTALL)
            if match:
                for line in match.group(1).replace('\\n', '\n').split('\n'):
                    parts = line.strip().strip('"').split(':', 1)
                    if len(parts) == 2 and parts[0].strip().isdigit():
                        names[int(parts[0])] = parts[1].strip()
    except:
        pass
    return names


# --- LOGICA DI LETTURA TESTUALE (Semplificata) ---
CHARMAP = {0x00: " ", 0xFF: ""}  # Espandibile, ma basta per capire se leggiamo spazzatura o no


def decode_text_simple(data):
    # Decodifica molto grezza solo per identificare il pokemon
    s = ""
    for b in data:
        if b == 0xFF: break
        if 0xBB <= b <= 0xD4:
            s += chr(b - 0xBB + 65)  # A-Z approssimativo
        elif 0xD5 <= b <= 0xEE:
            s += chr(b - 0xD5 + 97)  # a-z approssimativo
        else:
            s += "."
    return s


def get_active_pc_sectors(data):
    sections = []
    for i in range(0, len(data), SECTION_SIZE):
        if i + SECTION_SIZE > len(data): break
        footer_offset = i + 0xFF0
        sec_id = ru16(data, footer_offset + 4)
        save_idx = ru32(data, footer_offset + 12)
        if sec_id in POKEMON_STREAM_SECTORS:
            sections.append({'id': sec_id, 'idx': save_idx, 'offset': i})

    if not sections: return []
    # Trova l'indice di salvataggio più recente
    max_idx = max(s['idx'] for s in sections)
    # Filtra solo i settori attivi e ordinali per ID settore
    return sorted([s for s in sections if s['idx'] == max_idx], key=lambda x: x['id'])


def rebuild_buffer(save_data, sectors):
    buffer = bytearray()
    print(f"[INFO] Ricostruzione Buffer da {len(sectors)} settori...")
    for sec in sectors:
        off = sec['offset']
        # Salta l'header del settore e leggi il payload
        payload = save_data[off + SECTOR_HEADER_SIZE: off + SECTOR_HEADER_SIZE + SECTOR_PAYLOAD_SIZE]
        buffer += payload
    return buffer


def main():
    print("--- DIAGNOSTICA STRUMENTI PC (UNBOUND) ---")
    if len(sys.argv) < 2:
        print("Trascina il file .sav su questo script.")
        return

    path = sys.argv[1]
    with open(path, "rb") as f:
        data = f.read()

    sectors = get_active_pc_sectors(data)
    if not sectors:
        print("[ERRORE] Impossibile trovare i settori del PC.")
        return

    pc_buffer = rebuild_buffer(data, sectors)
    poke_names = load_pokemon_names()

    print(f"\n[OFFSET 0x1E TEST] Lettura dei primi Pokémon nel PC...\n")
    print(
        f"{'BOX-SLOT':<10} | {'NOME (RAW)':<12} | {'SPECIE':<15} | {'ITEM ID (HEX)':<10} | {'ITEM ID (DEC)':<10} | {'PREVISIONE'}")
    print("-" * 90)

    curr = 0
    # Analizziamo solo i primi 2 Box per il test (60 pokemon)
    for box in range(1, 3):
        for slot in range(1, 31):
            if curr + MON_SIZE_PC > len(pc_buffer): break

            mon_data = pc_buffer[curr: curr + MON_SIZE_PC]
            species = ru16(mon_data, OFF_SPECIES)

            # Filtro slot vuoti o spazzatura
            if species != 0 and species < 2000:
                nick = decode_text_simple(mon_data[OFF_NICK: OFF_NICK + 10])
                s_name = poke_names.get(species, f"ID {species}")

                # --- IL PUNTO CRUCIALE ---
                item_val = ru16(mon_data, OFF_ITEM)
                # -------------------------

                item_guess = COMMON_ITEMS.get(item_val, "???")

                print(
                    f"{box}-{slot:<8} | {nick:<12} | {s_name:<15} | 0x{item_val:04X}     | {item_val:<10} | {item_guess}")

            curr += MON_SIZE_PC

    print("-" * 90)
    print("VERIFICA:")
    print("1. Se vedi i tuoi strumenti corretti, l'offset 0x1E è confermato.")
    print("2. Se vedi numeri assurdi o sempre 0 anche con strumenti, l'offset è sbagliato.")


if __name__ == "__main__":
    main()