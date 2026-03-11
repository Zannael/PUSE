#!/usr/bin/env python3
# unbound_ghost_finder.py
# Scansiona l'intero file (e i buffer PC) alla ricerca delle specie "scomparse"
# per capire se c'è un problema di allineamento (byte shift) o di settore.

import struct
import sys

# --- CONFIGURAZIONE ---
PC_SECTOR_IDS = [5, 6, 7, 8, 9, 10, 11, 12, 13]
SECTION_SIZE = 0x1000
SECTOR_HEADER_SIZE = 4
MON_SIZE_PC = 58  # Dimensione standard CFRU

# Specie segnalate come mancanti (Decimal -> Hex Little Endian)
TARGETS = {
    "Magneton": 82,
    "Rhyhorn": 111,
    "Treecko": 252,
    "Klink": 599,
    "Helioptile": 694,
    "Steenee": 762
}


def ru16(b, o): return struct.unpack_from("<H", b, o)[0]


def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


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
    # Ordiniamo per ID per ricostruire il buffer lineare
    return sorted([s for s in sections if s['idx'] == max_idx], key=lambda x: x['id'])


def analyze_alignment(name, species_id, buffer):
    print(f"\n--- RICERCA: {name} (ID: {species_id}) ---")

    # Crea il pattern di ricerca (Little Endian)
    target_bytes = struct.pack("<H", species_id)

    found_count = 0
    offset = 0

    while True:
        offset = buffer.find(target_bytes, offset)
        if offset == -1: break

        # Abbiamo trovato i byte della specie. Ora verifichiamo il contesto.
        # In CFRU PC struct, la specie è a offset 0x1C (28).
        # Quindi l'inizio teorico del Pokémon dovrebbe essere offset - 28.

        potential_start = offset - 0x1C

        if potential_start >= 0 and (potential_start + MON_SIZE_PC) <= len(buffer):
            # Leggiamo i dati come se fosse un Pokémon valido
            raw = buffer[potential_start: potential_start + MON_SIZE_PC]

            pid = ru32(raw, 0x00)
            exp = ru32(raw, 0x20)
            lvl = raw[0x34]  # Byte livello visuale

            # Calcolo allineamento
            alignment_mod = potential_start % MON_SIZE_PC
            is_aligned = (alignment_mod == 0)

            # Calcolo posizione teorica (Box e Slot)
            slot_idx = potential_start // MON_SIZE_PC
            box_num = (slot_idx // 30) + 1
            slot_num = (slot_idx % 30) + 1

            print(f"[TROVATO] Offset Buffer: 0x{potential_start:X}")
            print(f"   -> Contesto: PID: 0x{pid:08X} | Exp: {exp} | Lv: {lvl}")
            print(f"   -> Posizione Teorica: Box {box_num} - Slot {slot_num}")

            if is_aligned:
                print(f"   -> ALLINEAMENTO: PERFETTO (Multiplo di {MON_SIZE_PC})")

                # Se è allineato ma non si vede nell'editor, controlliamo i filtri della v21
                fail_reasons = []
                if species_id == 0 or species_id > 2500: fail_reasons.append("ID Specie fuori range")
                if exp == 0 and lvl == 0: fail_reasons.append("Exp/Livello a 0")

                if fail_reasons:
                    print(f"   -> [DIAGNOSI] L'Editor lo scarta perché: {', '.join(fail_reasons)}")
                else:
                    print(f"   -> [MISTERO] I dati sembrano validi. Potrebbe essere un problema di Settore mancante?")
            else:
                print(f"   -> ALLINEAMENTO: ERRORE! (Spostato di {alignment_mod} bytes)")
                print(
                    f"      Questo significa che la struttura dati precedente ha una dimensione diversa da {MON_SIZE_PC}!")

            found_count += 1

        offset += 2  # Continua ricerca

    if found_count == 0:
        print("   [!] Specie non trovata nel buffer PC ricostruito. È in un settore non caricato?")


def main():
    if len(sys.argv) < 2:
        print("Uso: python3 unbound_ghost_finder.py <savefile>")
        return

    with open(sys.argv[1], "rb") as f:
        data = f.read()

    # 1. Ricostruzione Buffer PC (Logica v21)
    sectors = get_active_pc_sectors(data)
    print(f"Settori PC Rilevati: {[s['id'] for s in sectors]}")

    pc_buffer = bytearray()
    SECTOR_RULES = {5: 'FULL', 6: 'FULL', 7: 'STD', 8: 'STD', 9: 'STD', 10: 'STD', 11: 'STD', 12: 'STD', 13: 'COPY'}

    print("\n--- RICOSTRUZIONE BUFFER ---")
    current_len = 0
    for sec in sectors:
        off = sec['offset']
        sec_id = sec['id']
        rule = SECTOR_RULES.get(sec_id, 'STD')

        # Logica Payload
        # Nella v21 usiamo 0xF80 fisso tranne header. Vediamo se questo taglia dati.
        payload_size = 0xF80 - 4
        # Nota: Unbound usa 0xFF0 per i settori 5 e 6?

        if rule == 'FULL':
            # Ipotizziamo che FULL significhi che usa più spazio
            # Se l'editor v21 usa sempre 0xF80, potrebbe tagliare dei Pokémon alla fine del settore 5/6!
            # Verifichiamo.
            pass

        payload = data[off + 4: off + 0xF80]
        pc_buffer += payload
        print(f"Settore {sec_id}: Aggiunti {len(payload)} bytes. Buffer totale: {len(pc_buffer)}")

    print(f"\nBuffer Totale: {len(pc_buffer)} bytes.")

    # 2. Caccia ai Fantasmi
    for name, s_id in TARGETS.items():
        analyze_alignment(name, s_id, pc_buffer)


if __name__ == "__main__":
    main()