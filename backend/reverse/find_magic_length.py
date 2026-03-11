#!/usr/bin/env python3
import struct
import sys


def gba_checksum(data):
    chk = 0
    # Processa a blocchi di 4 byte
    for i in range(0, len(data), 4):
        val = struct.unpack("<I", data[i:i + 4])[0]
        chk = (chk + val) & 0xFFFFFFFF
    return ((chk >> 16) + (chk & 0xFFFF)) & 0xFFFF


def brute_force_length(save_path):
    # Offset del settore 0 attivo (come confermato prima)
    SECTOR_START = 0x4000

    with open(save_path, "rb") as f:
        f.seek(SECTOR_START)
        # Leggiamo tutto il settore, incluso il footer
        full_sector = f.read(4096)

    # Il checksum target è nel footer a 0xFF6
    target_chk = struct.unpack_from("<H", full_sector, 0xFF6)[0]

    print(f"--- BRUTE FORCE LUNGHEZZA SETTORE 0 ---")
    print(f"Checksum Target (da File): 0x{target_chk:04X}")
    print("Tentativo calcolo su tutte le lunghezze possibili...")

    found = False
    # Proviamo tutte le lunghezze allineate a 4 byte, fino al footer (0xFF4)
    for length in range(4, 0xFF5, 4):
        # Prendiamo la fetta di dati
        chunk = full_sector[:length]

        # Calcoliamo
        calc_chk = gba_checksum(chunk)

        if calc_chk == target_chk:
            print(f"\n>>> TROVATO MATCH! <<<")
            print(f"Lunghezza Magica: 0x{length:X} ({length} bytes)")
            print(f"Checksum Calcolato: 0x{calc_chk:04X}")
            found = True
            break

    if not found:
        print(
            "\nNessun match trovato. Il checksum potrebbe usare un algoritmo non standard o un offset di partenza diverso.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python3 find_magic_length.py <savefile>")
    else:
        brute_force_length(sys.argv[1])