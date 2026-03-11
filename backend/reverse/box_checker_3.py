import struct
import sys

# CONFIGURAZIONE UNBOUND
PC_SECTOR_IDS = [5, 6, 7, 8, 9, 10, 11, 12, 13]
SECTION_SIZE = 0x1000
SECTOR_HEADER_SIZE = 4
MON_SIZE_PC = 58

# OFFSET CFRU
OFF_SPECIES = 0x1C
OFF_NICK = 0x08
OFF_EXP = 0x20

# MAPPA CARATTERI (Ridotta per debug)
CHARMAP = {
    0x00: " ", 0xFF: "", 0x01: "À", 0x1B: "é", 0x2D: "&", 0x34: "Lv",
    0x53: "PK", 0x54: "MN", 0xA1: "0", 0xAB: "!", 0xAC: "?", 0xAD: ".",
    0xB5: "M", 0xB6: "F", 0xBB: "A", 0xBC: "B", 0xBD: "C", 0xBE: "D",
    0xBF: "E", 0xC0: "F", 0xC1: "G", 0xC2: "H", 0xC3: "I", 0xC4: "J",
    0xC5: "K", 0xC6: "L", 0xC7: "M", 0xC8: "N", 0xC9: "O", 0xCA: "P",
    0xCB: "Q", 0xCC: "R", 0xCD: "S", 0xCE: "T", 0xCF: "U", 0xD0: "V",
    0xD1: "W", 0xD2: "X", 0xD3: "Y", 0xD4: "Z", 0xD5: "a", 0xD6: "b",
    0xD7: "c", 0xD8: "d", 0xD9: "e", 0xDA: "f", 0xDB: "g", 0xDC: "h",
    0xDD: "i", 0xDE: "j", 0xDF: "k", 0xE0: "l", 0xE1: "m", 0xE2: "n",
    0xE3: "o", 0xE4: "p", 0xE5: "q", 0xE6: "r", 0xE7: "s", 0xE8: "t",
    0xE9: "u", 0xEA: "v", 0xEB: "w", 0xEC: "x", 0xED: "y", 0xEE: "z",
}


def decode_text(data):
    s = ""
    for b in data:
        if b == 0xFF: break
        s += CHARMAP.get(b, "?")
    return s


def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


def ru16(b, o): return struct.unpack_from("<H", b, o)[0]


def hex_dump(data, label):
    hex_vals = ' '.join(f'{b:02X}' for b in data)
    print(f"[{label}] {hex_vals}")


def get_sector_data(data, target_id):
    best_sec = None
    max_idx = -1

    for i in range(0, len(data), SECTION_SIZE):
        if i + SECTION_SIZE > len(data): break
        footer_offset = i + 0xFF0
        sec_id = ru16(data, footer_offset + 4)
        save_idx = ru32(data, footer_offset + 12)

        if sec_id == target_id:
            if save_idx > max_idx:
                max_idx = save_idx
                # Saltiamo l'header di 4 byte e prendiamo il corpo
                best_sec = data[i + SECTOR_HEADER_SIZE: i + SECTION_SIZE]
    return best_sec, max_idx


def inspect_sectors(filename):
    print(f"--- ISPEZIONE TRANSIZIONE SETTORI: {filename} ---")
    try:
        with open(filename, "rb") as f:
            data = f.read()
    except Exception as e:
        print(f"Errore: {e}")
        return

    # 1. Analisi Fine Settore 5 (Pokemon 1-70)
    sec5, idx5 = get_sector_data(data, 5)
    if not sec5:
        print("Settore 5 non trovato.")
        return
    print(f"\n[SETTORE 5] SaveIndex: {idx5}")

    # Pokemon #70 (Indice 69) - Ultimo del settore
    offset_70 = 69 * MON_SIZE_PC
    raw_70 = sec5[offset_70: offset_70 + MON_SIZE_PC]
    specie_70 = ru16(raw_70, OFF_SPECIES)
    nick_70 = decode_text(raw_70[OFF_NICK:OFF_NICK + 10])
    print(f"Pokemon #70 (Ultimo del blocco):")
    print(f"  Offset Relativo: {offset_70} (0x{offset_70:X})")
    print(f"  Specie ID: {specie_70}")
    print(f"  Nick: {nick_70}")

    # Analisi Padding (Spazio tra fine Pokemon 70 e fine Payload utile)
    # Payload utile stimato V11 era 0xFF0 - 4 = 4076.
    # Fine Pokemon 70 = 4060.
    padding_data = sec5[offset_70 + MON_SIZE_PC: 4076]
    print(f"\n[PADDING] Dati tra fine #70 e footer (Offset 4060-4076):")
    hex_dump(padding_data, "JUNK")
    print("  -> Se la teoria è corretta, questi byte causavano lo sfasamento.")

    # 2. Analisi Inizio Settore 6 (Pokemon 71-140)
    sec6, idx6 = get_sector_data(data, 6)
    if not sec6:
        print("Settore 6 non trovato.")
        return
    print(f"\n[SETTORE 6] SaveIndex: {idx6}")

    # Pokemon #71 (Indice 0 del nuovo settore)
    # Se il sistema è allineato, deve essere a offset 0 assoluto del payload settore 6
    offset_71 = 0
    raw_71 = sec6[offset_71: offset_71 + MON_SIZE_PC]
    specie_71 = ru16(raw_71, OFF_SPECIES)
    nick_71 = decode_text(raw_71[OFF_NICK:OFF_NICK + 10])

    print(f"Pokemon #71 (Primo del blocco 6):")
    print(f"  Offset Relativo: {offset_71}")
    print(f"  Specie ID: {specie_71}")
    print(f"  Nick: {nick_71}")

    print("\n--- VERIFICA ---")
    print("1. Il #70 è Clamperl?")
    print("2. Il #71 è Chinchou (o quello che ti aspetti nel Box 3-11)?")
    print("Se sì, la logica corretta è: Leggi 70 Pkmn -> Stop -> Salta al prossimo settore -> Leggi 70 Pkmn.")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        inspect_sectors(sys.argv[1])
    else:
        print("Trascina il file .sav")