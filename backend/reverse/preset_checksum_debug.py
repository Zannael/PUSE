#!/usr/bin/env python3
import struct
import sys


def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


def ru16(b, o): return struct.unpack_from("<H", b, o)[0]


def gba_checksum(data):
    total = 0
    for i in range(0, len(data), 4):
        total = (total + ru32(data, i)) & 0xFFFFFFFF
    return ((total >> 16) + (total & 0xFFFF)) & 0xFFFF


def debug_checksum(save_path):
    # Andiamo al settore 0 attivo (offset 0x4000 secondo i tuoi test precedenti)
    # NB: Se il save ha ruotato, questo potrebbe cambiare, ma per ora assumiamo 0x4000
    # dato che il tuo editor ha trovato lì i dati.
    SECTOR_ADDR = 0x4000

    with open(save_path, "rb") as f:
        f.seek(SECTOR_ADDR)
        data = f.read(4096)

    # Leggiamo il Footer
    valid_len = ru16(data, 0xFF0)  # A volte è 32bit, ma i primi 16 bastano
    sec_id = ru16(data, 0xFF4)
    stored_chk = ru16(data, 0xFF6)

    print(f"--- DIAGNOSTICA SETTORE 0x{SECTOR_ADDR:X} ---")
    print(f"ID Settore: {sec_id}")
    print(f"Checksum su File: 0x{stored_chk:04X}")
    print(f"Lunghezza Dichiarata (Footer 0xFF0): 0x{valid_len:X} bytes")

    # Test 1: Calcolo su tutto il blocco (Come fa v16 ora)
    full_payload = data[:0xFF4]
    chk_full = gba_checksum(full_payload)
    print(f"\n1. Calcolo Checksum su 0xFF4 bytes (Logica v16): 0x{chk_full:04X}")
    if chk_full == stored_chk:
        print("   -> MATCH! (Il problema non è questo)")
    else:
        print("   -> MISMATCH! (Ecco l'errore del v16)")

    # Test 2: Calcolo sulla lunghezza valida (Logica GBA Standard)
    partial_payload = data[:valid_len]
    # Padding a 4 byte se necessario
    if len(partial_payload) % 4 != 0:
        partial_payload += b'\x00' * (4 - (len(partial_payload) % 4))

    chk_partial = gba_checksum(partial_payload)
    print(f"2. Calcolo Checksum su 0x{valid_len:X} bytes (Logica Corretta): 0x{chk_partial:04X}")
    if chk_partial == stored_chk:
        print("   -> MATCH! (Conferma: dobbiamo usare la lunghezza del footer)")
    else:
        print("   -> MISMATCH! (C'è qualcosa di ancora più strano)")


if __name__ == "__main__":
    debug_checksum(sys.argv[1])