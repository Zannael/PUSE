#!/usr/bin/env python3
import struct
import sys


def check_sector_identity(save_path):
    # L'indirizzo dove il Seeker ha trovato Toxapex è 0x40B0.
    # Il settore inizia quindi a 0x4000.
    SECTOR_START = 0x4000

    # In un save GBA, l'ID del settore è agli ultimi byte
    # Offset relativi all'inizio del settore:
    OFF_ID = 0xFF4  # 2 bytes
    OFF_CHECKSUM = 0xFF6  # 2 bytes
    OFF_INDEX = 0xFFC  # 4 bytes

    # Offset di Toxapex per conferma visiva
    OFF_TOXAPEX = 0xB0

    with open(save_path, "rb") as f:
        f.seek(SECTOR_START)
        data = f.read(4096)  # Leggiamo tutto il settore (4KB)

    # Leggiamo i dati del footer
    sec_id = struct.unpack_from("<H", data, OFF_ID)[0]
    checksum = struct.unpack_from("<H", data, OFF_CHECKSUM)[0]
    save_index = struct.unpack_from("<I", data, OFF_INDEX)[0]

    # Leggiamo i primi byte di Toxapex per essere sicuri che siamo nel posto giusto
    # Toxapex ID è 965 (0x03C5). Offset interno 0x1C (Specie)
    # 0xB0 (inizio mon) + 0x1C (offset specie) = 0xCC
    species_val = struct.unpack_from("<H", data, OFF_TOXAPEX + 0x1C)[0]

    print(f"--- ANALISI SETTORE A 0x{SECTOR_START:X} ---")
    print(f"Save Index: {save_index}")
    print(f"Checksum:   0x{checksum:X}")
    print(f"Sector ID:  {sec_id} (Decimale) / 0x{sec_id:X} (Hex)")
    print("-" * 40)
    print(f"Verifica Dati Pokémon:")
    print(f"Valore alla posizione della Specie (0xCC): {species_val}")

    if species_val == 965:
        print(">> CONFERMATO: Toxapex è qui.")
        print(f">> SOLUZIONE: Cambia 'PRESET_SECTOR_ID = 4' in 'PRESET_SECTOR_ID = {sec_id}' nello script v16.")
    else:
        print(">> ATTENZIONE: Non trovo Toxapex qui. Il save potrebbe essere ruotato.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python3 check_sector_id.py <savefile>")
    else:
        check_sector_identity(sys.argv[1])