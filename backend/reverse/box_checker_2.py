import struct
import sys

# CONFIGURAZIONE
SECTION_SIZE = 0x1000
# ID del primo settore PC in Unbound solitamente è 5
TARGET_SECTOR_ID = 5


# UTILS
def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


def ru16(b, o): return struct.unpack_from("<H", b, o)[0]


def hex_dump(data, start_offset_label):
    print(f"\n--- HEX DUMP (Offset Settore: {start_offset_label}) ---")
    print("Offset | 00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F | ASCII")
    print("-" * 75)
    for i in range(0, len(data), 16):
        chunk = data[i:i + 16]
        hex_vals = ' '.join(f'{b:02X}' for b in chunk)
        text = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
        lbl = start_offset_label + i
        print(f"0x{lbl:03X}  | {hex_vals:<47} | {text}")


def deep_analyze_sector(filename):
    try:
        with open(filename, "rb") as f:
            data = f.read()
    except Exception as e:
        print(f"Errore file: {e}")
        return

    # Trova il settore 5 attivo
    found_sec = None
    max_save_idx = -1

    for i in range(0, len(data), SECTION_SIZE):
        if i + SECTION_SIZE > len(data): break
        footer_off = i + 0xFF0
        sec_id = ru16(data, footer_off + 4)
        save_idx = ru32(data, footer_off + 12)

        if sec_id == TARGET_SECTOR_ID:
            if save_idx > max_save_idx:
                max_save_idx = save_idx
                found_sec = data[i: i + SECTION_SIZE]

    if not found_sec:
        print(f"Settore {TARGET_SECTOR_ID} non trovato.")
        return

    print(f"Analisi Settore {TARGET_SECTOR_ID} (Save Index: {max_save_idx})")

    # Parametri previsti
    # Se ci sono 70 pokemon: 70 * 58 = 4060 (0xFDC)
    # Il footer inizia solitamente a 0xFF0 o 0xFF4

    # Dump della zona finale del settore (da 3900 alla fine)
    # 3944 (0xF68) era la fine del 68° pokemon secondo i calcoli vecchi

    start_view = 0xF00
    end_view = 0x1000  # Fine del settore

    slice_data = found_sec[start_view:end_view]
    hex_dump(slice_data, start_view)

    print("\n--- ANALISI FIRME ---")
    # Cerchiamo Misdreavus (ID 200 -> C8 00) e Clamperl (ID 366 -> 6E 01)
    # L'offset della specie è +0x1C dall'inizio della struttura del pokemon

    # 69° Pokemon (Indice 68): Inizio teorico 0xF68. Specie a 0xF68 + 0x1C = 0xF84
    val_69 = ru16(found_sec, 0xF84)
    print(f"Posizione 69 (Offset 0xF84): {val_69} (Hex: {val_69:04X})")
    if val_69 == 200:
        print(" -> MATCH! Trovato Misdreavus dove lo script attuale smette di leggere.")

    # 70° Pokemon (Indice 69): Inizio teorico 0xF68 + 58 = 0xFA2. Specie a 0xFA2 + 0x1C = 0xFBE
    val_70 = ru16(found_sec, 0xFBE)
    print(f"Posizione 70 (Offset 0xFBE): {val_70} (Hex: {val_70:04X})")
    if val_70 == 366:  # 366 è Clamperl
        print(" -> MATCH! Trovato Clamperl schiacciato contro il footer.")

    # Controllo Footer
    print("\n--- CONTROLLO FOOTER ---")
    footer_id = ru16(found_sec, 0xFF4)
    print(f"Footer ID a 0xFF4: {footer_id} (Dovrebbe essere {TARGET_SECTOR_ID})")

    if val_70 == 366:
        print("\n=== CONCLUSIONE ===")
        print("Unbound salva 70 Pokémon per settore invece di 68.")
        print("Lo script deve estendere la lettura fino a 4060 bytes.")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        deep_analyze_sector(sys.argv[1])
    else:
        print("Trascina il file .sav")