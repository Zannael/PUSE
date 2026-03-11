#!/usr/bin/env python3
# unbound_key_finder.py — Trova la chiave di crittografia tramite Known Plaintext Attack
# Autore: Gemini

import struct
import sys

# --- CONFIGURAZIONE ---
SECTION_SIZE = 0x1000
FOOTER_ID_OFF = 0xFF4
FOOTER_SAVEIDX_OFF = 0xFFC
TRAINER_SECTION_ID = 1
PARTY_OFFSET = 0x38  # Trovato precedentemente

# --- DATI NOTI (TARGET) ---
# ROTOM (Slot 1)
# Structure B (Growth): [Species (2b)] [Item (2b)] ...
# Species: 479 (0x01DF). Item: None (0x0000).
# Target u32 (Little Endian): 00 00 01 DF -> 0x000001DF
TARGET_GROWTH = 0x000001DF

# Structure D (EVs): [HP(1)] [Atk(1)] [Def(1)] [Spd(1)] ...
# HP: 252 (FC), Atk: 0 (00), Def: 252 (FC), Spd: 2 (02)
# Target u32 (Little Endian): 02 FC 00 FC -> 0x02FC00FC
TARGET_EVS = 0x02FC00FC


def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


def solve_key(full_data):
    # 1. Trova la sezione
    num_sections = len(full_data) // SECTION_SIZE
    max_save_idx = -1
    latest_sec = None

    for i in range(num_sections):
        off = i * SECTION_SIZE
        sec_id = struct.unpack_from("<H", full_data, off + FOOTER_ID_OFF)[0]
        if sec_id == TRAINER_SECTION_ID:
            save_idx = struct.unpack_from("<I", full_data, off + FOOTER_SAVEIDX_OFF)[0]
            if save_idx > max_save_idx:
                max_save_idx = save_idx
                latest_sec = full_data[off: off + SECTION_SIZE]

    if not latest_sec:
        print("Errore: Sezione non trovata.")
        return

    print(f"Analisi Sezione SaveIdx: {max_save_idx}")

    # 2. Estrai i 48 byte criptati di Rotom (Slot 1)
    # Offset dati criptati: PARTY_OFFSET (0x38) + 0x20 = 0x58
    enc_start = PARTY_OFFSET + 0x20
    encrypted_data = latest_sec[enc_start: enc_start + 48]

    # Leggi PID e OTID per confronto
    pid = ru32(latest_sec, PARTY_OFFSET)
    otid = ru32(latest_sec, PARTY_OFFSET + 4)
    standard_key = pid ^ otid

    print(f"PID: 0x{pid:08X} | OTID: 0x{otid:08X}")
    print(f"Chiave Standard (PID^OTID): 0x{standard_key:08X}")

    # 3. Brute Force Intelligente sui 4 blocchi
    # La struttura è divisa in 4 blocchi da 12 byte (3 words u32)
    # Non sappiamo in che ordine siano (A, B, C, D), quindi proviamo a decriptare
    # ogni blocco come se fosse "Growth" (B) o "EVs" (D).

    found_key = None

    print("\n--- Tentativo di Cracking ---")

    # Ci sono 4 blocchi (offset 0, 12, 24, 36)
    for i in range(4):
        block_offset = i * 12
        raw_val = ru32(encrypted_data, block_offset)

        # Ipotesi 1: Questo blocco è GROWTH?
        # Key = Raw ^ Target_Growth
        candidate_key_g = raw_val ^ TARGET_GROWTH

        # Ipotesi 2: Questo blocco è EVs?
        # Key = Raw ^ Target_EVs
        candidate_key_e = raw_val ^ TARGET_EVS

        print(f"Blocco {i} (Raw: 0x{raw_val:08X}):")
        print(f"  -> Se fosse GROWTH, Key sarebbe: 0x{candidate_key_g:08X}")
        print(f"  -> Se fosse EVs,    Key sarebbe: 0x{candidate_key_e:08X}")

        # Verifica incrociata:
        # Se candidate_key_g è la chiave vera, applicandola a un altro blocco dovremmo trovare gli EVs.
        # Se candidate_key_e è la chiave vera, applicandola a un altro blocco dovremmo trovare la Specie.

        # Verifichiamo Candidate Key G (ipotesi: abbiamo trovato la chiave tramite la specie)
        # Cerchiamo se questa chiave decripta gli EVs in uno degli altri blocchi
        for j in range(4):
            if i == j: continue  # Salta se stesso
            test_val = ru32(encrypted_data, j * 12)
            decrypted_test = test_val ^ candidate_key_g

            if decrypted_test == TARGET_EVS:
                print(f"\n[!!!] SUCCESSO! TROVATA CHIAVE VALIDA: 0x{candidate_key_g:08X}")
                print(f"      Conferma: Blocco {i} è Growth, Blocco {j} è EVs.")
                found_key = candidate_key_g
                break

    if found_key:
        print("\n--- Analisi della Chiave ---")
        print(f"Chiave Trovata: 0x{found_key:08X}")
        print(f"PID:            0x{pid:08X}")
        print(f"OTID:           0x{otid:08X}")

        # Cerchiamo di capire la logica
        if found_key == pid:
            print("LOGICA SCOPERTA: La chiave è solo il PID!")
        elif found_key == otid:
            print("LOGICA SCOPERTA: La chiave è solo l'OTID!")
        elif found_key == (pid + otid) & 0xFFFFFFFF:
            print("LOGICA SCOPERTA: La chiave è PID + OTID!")
        else:
            # Differenza
            diff = found_key - pid
            print(f"Differenza Key - PID: 0x{diff:08X}")
            print("La logica potrebbe essere complessa, ma useremo questa chiave per l'editor.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Trascina il file .sav sullo script.")
    else:
        with open(sys.argv[1], "rb") as f:
            solve_key(f.read())