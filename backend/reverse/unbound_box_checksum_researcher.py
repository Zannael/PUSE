#!/usr/bin/env python3
import struct
import sys

# --- CONFIGURAZIONE ---
SECTION_SIZE = 0x1000
SECTOR_HEADER_SIZE = 4


def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


def ru16(b, o): return struct.unpack_from("<H", b, o)[0]


def calc_algo_standard(data, size):
    # Somma semplice dei dati (es. primi 0xF80 bytes)
    chk = 0
    for i in range(0, size, 4):
        chk = (chk + ru32(data, i)) & 0xFFFFFFFF
    return ((chk >> 16) + (chk & 0xFFFF)) & 0xFFFF


def calc_algo_firered(data, size):
    # Somma dati + Footer ID (word a 0xFF4)
    chk = 0
    for i in range(0, size, 4):
        chk = (chk + ru32(data, i)) & 0xFFFFFFFF

    # Aggiungi ID Settore dal footer
    chk = (chk + ru32(data, 0xFF4)) & 0xFFFFFFFF

    return ((chk >> 16) + (chk & 0xFFFF)) & 0xFFFF


def main():
    print("--- UNBOUND SECTOR MAPPER ---")
    if len(sys.argv) < 2:
        print("Uso: python3 unbound_checksum_map.py <file.sav>")
        return

    with open(sys.argv[1], "rb") as f:
        save_data = bytearray(f.read())

    # Trova il Save Index più recente
    max_save_idx = -1
    for i in range(0, len(save_data), SECTION_SIZE):
        if i + SECTION_SIZE > len(save_data): break
        save_idx = ru32(save_data, i + 0xFFC)
        if save_idx > max_save_idx: max_save_idx = save_idx

    print(f"Save Index Attivo: {max_save_idx}\n")
    print(f"{'SEC ID':<8} | {'OFFSET':<10} | {'STORED CHK':<12} | {'ALGO DETECTED'}")
    print("-" * 60)

    # Analizza ogni settore del salvataggio attivo
    for i in range(0, len(save_data), SECTION_SIZE):
        if i + SECTION_SIZE > len(save_data): break

        sector = save_data[i: i + SECTION_SIZE]
        sec_id = ru16(sector, 0xFF4)
        save_idx = ru32(sector, 0xFFC)
        stored_chk = ru16(sector, 0xFF6)

        # Analizza solo i settori del salvataggio corrente (o ID 0 che a volte è speciale)
        if save_idx == max_save_idx or (save_idx < max_save_idx and sec_id == 0):  # Gestione settori rotativi

            match_found = "UNKNOWN"

            # Test 1: Standard GBA (0xF80 bytes) - Classico Pokémon Ruby/Sapphire
            if calc_algo_standard(sector, 0xF80) == stored_chk:
                match_found = "STD (0xF80)"

            # Test 2: Unbound/CFRU Full (0xFF0 bytes)
            elif calc_algo_standard(sector, 0xFF0) == stored_chk:
                match_found = "FULL (0xFF0)"

            # Test 3: FireRed (0xF80 + ID)
            elif calc_algo_firered(sector, 0xF80) == stored_chk:
                match_found = "FR (0xF80+ID)"

            # Test 4: FireRed Full (0xFF0 + ID) - Quello che abbiamo trovato prima
            elif calc_algo_firered(sector, 0xFF0) == stored_chk:
                match_found = "FR_FULL (0xFF0+ID)"

            # Filtra solo i settori PC (5-13) o Trainer (0-4) per chiarezza
            print(f"{sec_id:<8} | {hex(i):<10} | {hex(stored_chk):<12} | {match_found}")


if __name__ == "__main__":
    main()