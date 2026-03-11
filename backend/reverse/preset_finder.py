#!/usr/bin/env python3
import sys
import struct

# Offset rilevato dallo script precedente (Usa quello del Settore 9, che sembra essere l'attivo per i preset)
START_OFFSET = 0x9926  # Inizio di Crawdaunt
# Leggiamo abbastanza bytes per coprire Crawdaunt, Manectric e Toxapex
READ_LENGTH = 512


def hex_dump(data, start_addr):
    # Genera una vista esadecimale classica
    for i in range(0, len(data), 16):
        chunk = data[i:i + 16]
        hex_vals = ' '.join(f'{b:02X}' for b in chunk)
        ascii_vals = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
        print(f"0x{start_addr + i:06X} | {hex_vals:<47} | {ascii_vals}")


def analyze_gap(data, offset_start, name):
    # Analizza i 58 byte successivi a un pokemon
    gap_data = data[offset_start + 58: offset_start + 116]
    is_empty = all(b == 0 for b in gap_data)
    print(f"\n--- ANALISI GAP DOPO {name} ---")
    print(f"Offset Gap: 0x{START_OFFSET + offset_start + 58:06X}")
    if is_empty:
        print(">> IL GAP È VUOTO (Tutti 0x00). Probabile Padding o Slot riservato.")
    else:
        print(">> IL GAP CONTIENE DATI! Ecco i primi 16 byte:")
        hex_vals = ' '.join(f'{b:02X}' for b in gap_data[:16])
        print(f"   {hex_vals}")


def main():
    if len(sys.argv) < 2:
        print("Uso: python3 unbound_hex_inspector.py <savefile>")
        return

    file_path = sys.argv[1]

    try:
        with open(file_path, "rb") as f:
            # Andiamo all'offset target
            f.seek(START_OFFSET)
            chunk = f.read(READ_LENGTH)

        print(f"--- HEX DUMP DEL BOX PRESET (Start: 0x{START_OFFSET:X}) ---")
        print("Offset   | Hex Data                                        | ASCII")
        print("-" * 75)
        hex_dump(chunk, START_OFFSET)

        # Analisi specifica basata sulle distanze trovate prima
        # Crawdaunt è a +0 relativo
        analyze_gap(chunk, 0, "CRAWDAUNT")

        # Manectric è a +232 (0xE8) relativo
        # Se c'è spazio, analizziamo anche dopo di lui
        if len(chunk) >= 0xE8 + 116:
            analyze_gap(chunk, 0xE8, "MANECTRIC")

    except Exception as e:
        print(f"Errore: {e}")


if __name__ == "__main__":
    main()