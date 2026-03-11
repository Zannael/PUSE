#!/usr/bin/env python3
# unbound_checksum_cracker.py — Ricerca esaustiva della "Lunghezza Magica"
# Prova ogni possibile lunghezza del payload per trovare quella usata da CFRU.

import struct
import sys

# Target: Settore 5
SECTOR_OFFSET = 0x5000
SECTOR_SIZE = 0x1000
OFF_CHK = 0xFF6


def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


def ru16(b, o): return struct.unpack_from("<H", b, o)[0]


def algo_gba_standard(data):
    total = 0
    for i in range(0, len(data), 4):
        total = (total + ru32(data, i)) & 0xFFFFFFFF
    return ((total >> 16) + (total & 0xFFFF)) & 0xFFFF


def main():
    print("--- UNBOUND DEEP CRACKER ---")
    if len(sys.argv) < 2:
        print("Uso: python3 unbound_checksum_cracker.py <savefile>")
        return

    with open(sys.argv[1], "rb") as f:
        full_data = f.read()

    sector = bytearray(full_data[SECTOR_OFFSET: SECTOR_OFFSET + SECTOR_SIZE])
    target_chk = ru16(sector, OFF_CHK)

    print(f"Target Checksum: 0x{target_chk:04X}")
    print("Inizio scansione profonda (Step: 4 bytes)...")

    # Pulisci il campo checksum nel buffer per non influenzare i calcoli
    # se il range dovesse includerlo (non dovrebbe, ma per sicurezza)
    struct.pack_into("<H", sector, OFF_CHK, 0)

    found = False

    # 1. SCANSIONE LUNGHEZZA (Da 0 a 0xFF0)
    # Ipotizziamo che inizi a 0 e finisca a X
    for length in range(4, 0x1000, 4):
        chunk = sector[:length]
        chk = algo_gba_standard(chunk)

        if chk == target_chk:
            print(f"\n[!!!] TROVATO MATCH ESATTO!")
            print(f"Algoritmo: GBA Standard")
            print(f"Start:     0")
            print(f"End:       0x{length:X} ({length} bytes)")
            print(f"Nota:      Questo è probabilmente un 'Fixed Size' hardcodato nel gioco.")
            found = True
            # Non ci fermiamo, potremmo trovarne altri (es. collisioni o pattern)

    # 2. SCANSIONE OFFSET INIZIALE (Caso raro)
    # A volte saltano i primi 4 byte (Save Index vecchio sovrascritto)
    if not found:
        print("\nNessun match partendo da 0. Provo a saltare l'header...")
        for start in range(4, 64, 4):  # Prova a saltare i primi byte
            for length in range(start + 4, 0x1000, 4):
                chunk = sector[start:length]
                chk = algo_gba_standard(chunk)
                if chk == target_chk:
                    print(f"\n[!!!] TROVATO MATCH CON OFFSET!")
                    print(f"Start:     0x{start:X}")
                    print(f"End:       0x{length:X}")
                    found = True

    if not found:
        print("\nFallito. Il checksum potrebbe usare un seed iniziale (IV) diverso da 0.")
        print("O un algoritmo completamente custom (es. CRC32, ma improbabile su GBA).")
    else:
        print("\nAnnota i valori 'End' trovati. Serviranno per l'editor v14.")


if __name__ == "__main__":
    main()