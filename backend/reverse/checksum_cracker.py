#!/usr/bin/env python3
# checksum_cracker.py — Trova l'algoritmo di checksum corretto per Unbound
# Analizza un salvataggio VALIDO per capire come il gioco calcola i controlli.

import struct
import sys

# Configurazioni Standard
SECTION_SIZE = 0x1000
FOOTER_ID_OFF = 0xFF4
FOOTER_CHK_OFF = 0xFF6
TRAINER_SECTION_ID = 1


def ru16(b, o): return struct.unpack_from("<H", b, o)[0]


def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


def calculate_checksum(data, length, include_footer_id=False):
    chk = 0
    # Somma le parole a 32 bit
    for i in range(0, length, 4):
        chk = (chk + ru32(data, i)) & 0xFFFFFFFF

    if include_footer_id:
        # Alcuni giochi aggiungono l'ID sezione al calcolo
        # L'ID è a 0xFF4. 0xFF4 / 4 non è allineato se length < 0xFF4
        # Ma in standard FR, si somma la word a 0xFF4 (che contiene SectionID + Padding)
        chk = (chk + ru32(data, 0xFF4)) & 0xFFFFFFFF

    upper = (chk >> 16) & 0xFFFF
    lower = chk & 0xFFFF
    return (upper + lower) & 0xFFFF


def crack_section(data, section_name):
    stored_chk = ru16(data, FOOTER_CHK_OFF)
    sec_id = ru16(data, FOOTER_ID_OFF)

    print(f"\n--- Analisi {section_name} (ID: {sec_id}) ---")
    print(f"Checksum Memorizzato nel file: 0x{stored_chk:04X}")

    # TENTATIVO 1: Brute Force sulla lunghezza
    # I salvataggi GBA sommano blocchi di 4 byte.
    # Proviamo tutte le lunghezze possibili da 3000 a 4096 byte.

    found = False

    # Test A: Solo Dati (Standard)
    print("Tentativo A: Somma Dati (Escluso Footer ID)")
    for length in range(3800, 0xFF8, 4):  # Step 4 bytes
        calc = calculate_checksum(data, length, include_footer_id=False)
        if calc == stored_chk:
            print(f"[SUCCESS] MATCH TROVATO! Algoritmo: Standard, Lunghezza: {length} (0x{length:X})")
            found = True

    # Test B: Dati + Footer ID (FireRed Vanilla Standard spesso fa questo)
    print("Tentativo B: Somma Dati + Footer ID (Standard FireRed)")
    for length in range(3800, 0xFF4, 4):
        calc = calculate_checksum(data, length, include_footer_id=True)
        if calc == stored_chk:
            print(f"[SUCCESS] MATCH TROVATO! Algoritmo: Dati+ID, Lunghezza Dati: {length} (0x{length:X})")
            found = True

    if not found:
        print("[FAIL] Nessun algoritmo standard ha funzionato. Il checksum potrebbe essere personalizzato o CRC32.")
    else:
        print("Annota i valori 'Lunghezza' e 'Algoritmo' trovati!")


def main():
    if len(sys.argv) < 2:
        print("Uso: python3 checksum_cracker.py <savefile_FUNZIONANTE>")
        return

    with open(sys.argv[1], "rb") as f:
        full_data = f.read()

    num_sections = len(full_data) // SECTION_SIZE

    # Cerca la sezione Trainer (ID 1) più recente
    latest_sec = None
    max_save = -1

    for i in range(num_sections):
        off = i * SECTION_SIZE
        sec_id = ru16(full_data, off + FOOTER_ID_OFF)
        save_idx = ru32(full_data, off + 0xFFC)

        if sec_id == TRAINER_SECTION_ID:
            if save_idx > max_save:
                max_save = save_idx
                latest_sec = full_data[off: off + SECTION_SIZE]

    if latest_sec:
        crack_section(latest_sec, "Sezione Trainer (Ultimo Salvataggio)")
    else:
        print("Sezione Trainer non trovata.")


if __name__ == "__main__":
    main()