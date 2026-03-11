import struct
import sys

# CONFIGURAZIONE
SECTION_SIZE = 0x1000
SECTOR_HEADER_SIZE = 4
TARGET_SECTOR_ID = 6  # Cerchiamo nel settore che segue quello pieno

# VALORI TARGET (Dai tuoi dati)
# Chinchou: Exp 129778 -> 0x0001FB12 -> Little Endian: 12 FB 01 00
EXP_TARGET_1 = 129778
NAME_TARGET_1 = "Chinchou"

# Electabuzz: Exp 39304 -> 0x00009988 -> Little Endian: 88 99 00 00
EXP_TARGET_2 = 39304
NAME_TARGET_2 = "Electabuzz"

# OFFSET CFRU (Per calcolare l'inizio della struct)
OFF_EXP = 0x20


def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


def ru16(b, o): return struct.unpack_from("<H", b, o)[0]


def hex_dump(data, limit=64):
    print(f"--- DUMP PRIMI {limit} BYTE SETTORE 6 ---")
    for i in range(0, limit, 16):
        chunk = data[i:i + 16]
        hex_vals = ' '.join(f'{b:02X}' for b in chunk)
        print(f"Offset {i:03X} | {hex_vals}")


def find_pokemon_by_exp(data, exp_val, name_ref):
    print(f"\n[CACCIA] Cerco Exp {exp_val} ({name_ref})...")
    # Cerchiamo la sequenza di byte dell'esperienza
    target_bytes = struct.pack("<I", exp_val)

    found_offset = data.find(target_bytes)

    if found_offset != -1:
        # Se troviamo l'exp, l'inizio del Pokémon è exp_offset - OFF_EXP
        mon_start = found_offset - OFF_EXP
        print(f" -> TROVATO! Exp a offset {found_offset} (0x{found_offset:X})")
        print(f" -> Il Pokémon {name_ref} inizia presumibilmente a: {mon_start} (0x{mon_start:X})")

        # Verifica ID Specie (Offset start + 0x1C)
        if mon_start >= 0:
            specie_id = ru16(data, mon_start + 0x1C)
            print(f" -> Verifica Specie ID a quel punto: {specie_id}")
        return mon_start
    else:
        print(" -> Non trovato nel settore.")
        return -1


def analyze_sector_6(filename):
    try:
        with open(filename, "rb") as f:
            data = f.read()
    except Exception as e:
        print(f"Errore: {e}")
        return

    # 1. Estrazione Settore 6
    sec6 = None
    max_idx = -1

    for i in range(0, len(data), SECTION_SIZE):
        if i + SECTION_SIZE > len(data): break
        footer_offset = i + 0xFF0
        sec_id = ru16(data, footer_offset + 4)
        save_idx = ru32(data, footer_offset + 12)

        if sec_id == TARGET_SECTOR_ID:
            if save_idx > max_idx:
                max_idx = save_idx
                # Prendiamo il payload saltando i 4 byte di header generico dei salvataggi GBA
                sec6 = data[i + SECTOR_HEADER_SIZE: i + SECTION_SIZE]

    if not sec6:
        print("Settore 6 non trovato.")
        return

    print(f"Analisi Settore 6 (Save Index: {max_idx})")

    # Dump iniziale per vedere se ci sono header strani
    hex_dump(sec6, 96)

    # 2. Cerca Chinchou
    off1 = find_pokemon_by_exp(sec6, EXP_TARGET_1, NAME_TARGET_1)

    # 3. Cerca Electabuzz
    off2 = find_pokemon_by_exp(sec6, EXP_TARGET_2, NAME_TARGET_2)

    # 4. Analisi Logica
    if off1 != -1:
        print("\n--- ANALISI STRUTTURA ---")
        if off1 == 0:
            print("Il Pokémon inizia a 0. L'ispezione precedente ha fallito per motivi ignoti (forse specie 0?).")
        else:
            print(f"C'è un GAP/HEADER iniziale di {off1} byte nel Settore 6.")

        if off2 != -1:
            diff = off2 - off1
            print(f"Distanza tra Chinchou e Electabuzz: {diff} byte.")
            if diff == 58:
                print(" -> La struttura è contigua (58 byte per mon).")
            else:
                print(f" -> ATTENZIONE: La distanza non è 58! C'è padding tra i Pokémon?")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        analyze_sector_6(sys.argv[1])
    else:
        print("Trascina il file .sav")