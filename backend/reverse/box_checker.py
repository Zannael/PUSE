import struct
import sys

# CONFIGURAZIONE UNBOUND
PC_SECTOR_IDS = [5, 6, 7, 8, 9, 10, 11, 12, 13]
SECTION_SIZE = 0x1000
SECTOR_HEADER_SIZE = 4
SECTOR_DATA_SIZE = 0xF80 - SECTOR_HEADER_SIZE  # 3964 bytes
MON_SIZE_PC = 58

# OFFSET CFRU
OFF_SPECIES = 0x1C
OFF_NICK = 0x08
OFF_EXP = 0x20


def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


def ru16(b, o): return struct.unpack_from("<H", b, o)[0]


def get_active_pc_sectors(data):
    sections = []
    for i in range(0, len(data), SECTION_SIZE):
        if i + SECTION_SIZE > len(data): break
        footer_offset = i + 0xFF0
        sec_id = ru16(data, footer_offset + 4)
        save_idx = ru32(data, footer_offset + 12)
        if sec_id in PC_SECTOR_IDS:
            sections.append({'id': sec_id, 'idx': save_idx, 'offset': i})
    if not sections: return []
    max_idx = max(s['idx'] for s in sections)
    return sorted([s for s in sections if s['idx'] == max_idx], key=lambda x: x['id'])


def hex_dump(data, start_addr=0):
    for i in range(0, len(data), 16):
        chunk = data[i:i + 16]
        hex_vals = ' '.join(f'{b:02X}' for b in chunk)
        text = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
        print(f"{start_addr + i:04X} | {hex_vals:<47} | {text}")


def diagnose_gap(filename):
    print(f"--- DIAGNOSTICA SAVE: {filename} ---")
    try:
        with open(filename, "rb") as f:
            data = f.read()
    except Exception as e:
        print(f"Errore lettura file: {e}")
        return

    sectors = get_active_pc_sectors(data)
    if not sectors:
        print("Nessun settore PC trovato.")
        return

    print(f"Settori attivi trovati (Save Index {sectors[0]['idx']}): {[s['id'] for s in sectors]}")

    # Prendiamo solo i primi due settori PC (ID 5 e 6 solitamente)
    sec1 = sectors[0]  # Settore 5
    sec2 = sectors[1]  # Settore 6

    print(f"\nAnalisi Transizione Settore {sec1['id']} -> Settore {sec2['id']}")

    # Estraiamo i payload grezzi
    payload1 = data[sec1['offset'] + SECTOR_HEADER_SIZE: sec1['offset'] + 0xF80]
    payload2 = data[sec2['offset'] + SECTOR_HEADER_SIZE: sec2['offset'] + 0xF80]

    # Calcoli matematici
    mons_in_sec1 = len(payload1) // MON_SIZE_PC
    remainder = len(payload1) % MON_SIZE_PC

    print(f"Dimensione Payload Settore: {len(payload1)} bytes")
    print(f"Dimensione Pokémon: {MON_SIZE_PC} bytes")
    print(f"Pokémon interi per settore: {mons_in_sec1}")
    print(f"Bytes di avanzo (GAP): {remainder}")

    # Costruiamo il buffer "sbagliato" (lineare) per replicare l'errore
    buffer_linear = payload1 + payload2

    # Definiamo la zona critica
    # Fine dell'ultimo Pokemon del settore 1
    end_valid_data = mons_in_sec1 * MON_SIZE_PC
    # Inizio del buffer (Settore 2 attaccato subito dopo il padding)
    start_sec2_in_buffer = len(payload1)

    print("\n--- HEX DUMP ZONA CRITICA ---")
    print(f"Offset 0x{end_valid_data:X} = Fine ultimo Pokémon del Settore 1")
    print(f"Offset 0x{start_sec2_in_buffer:X} = Inizio Settore 2 (Pokémon 69 Reale)")

    # Mostriamo i dati da un po' prima della fine a un po' dopo l'inizio del secondo settore
    start_view = end_valid_data - MON_SIZE_PC  # Vediamo l'ultimo pokemon intero
    end_view = start_sec2_in_buffer + MON_SIZE_PC  # E il primo del nuovo settore

    slice_data = buffer_linear[start_view:end_view]
    hex_dump(slice_data, start_view)

    print("\n--- TEST LETTURA POKEMON #69 (Index 68) ---")

    # 1. Lettura LINEARE (Quella che fa lo script v10 attuale)
    # L'offset sarebbe 68 * 58 = 3944
    offset_bad = mons_in_sec1 * MON_SIZE_PC
    raw_bad = buffer_linear[offset_bad: offset_bad + MON_SIZE_PC]
    species_bad = ru16(raw_bad, OFF_SPECIES)
    exp_bad = ru32(raw_bad, OFF_EXP)
    print(f"1. Lettura ATTUALE (Offset {offset_bad} - Include GAP):")
    print(f"   Specie ID: {species_bad} (Hex: {species_bad:04X})")
    print(f"   Exp: {exp_bad}")

    # 2. Lettura CORRETTA (Saltando il gap)
    # L'offset dovrebbe essere all'inizio del secondo payload, cioè a len(payload1)
    offset_good = len(payload1)
    raw_good = buffer_linear[offset_good: offset_good + MON_SIZE_PC]
    species_good = ru16(raw_good, OFF_SPECIES)
    exp_good = ru32(raw_good, OFF_EXP)
    print(f"2. Lettura CORRETTA (Offset {offset_good} - Salta GAP):")
    print(f"   Specie ID: {species_good} (Hex: {species_good:04X})")
    print(f"   Exp: {exp_good}")

    # Controllo ID Specie noti
    print("\n--- RIFERIMENTI ---")
    print(f"Misdreavus ID: 200")
    print(f"Chinchou ID: 170")
    print(f"Se la lettura 2 da ID 200, l'ipotesi del GAP è confermata.")


# ESECUZIONE
# Sostituisci 'Pokemon Unbound.sav' con il nome del file caricato
if __name__ == "__main__":
    if len(sys.argv) > 1:
        diagnose_gap(sys.argv[1])
    else:
        print("Trascina il file .sav sullo script o passalo come argomento.")