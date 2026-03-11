#!/usr/bin/env python3
# unbound_bag_editor_v14.py — Editor Definitivo per Pokemon Unbound
# Include: Smart Search, Save Index Check e Unbound Fixed Length Checksum

import struct
import sys
import shutil
import glob
import os

# --- CONFIGURAZIONE ---
SECTION_SIZE = 0x1000
OFF_VALID_LEN = 0xFF0
OFF_ID = 0xFF4
OFF_CHK = 0xFF6
OFF_SAVE_IDX = 0xFFC

# ID Interno del settore Items in Unbound (trovato con la diagnostica)
UNBOUND_ITEM_SECTOR_ID = 13
# Settori borsa noti (Unbound/CFRU): item, key, balls, berries/tm (varia per build)
BAG_SECTOR_IDS = {13, 14, 15, 16}
# Lunghezza fissa trovata col Cracker (0x450 o 0x454 vanno bene, usiamo il max)
UNBOUND_ITEM_FIXED_LEN = 0x454

# Limiti conservativi per filtro slot borsa
MAX_PLAUSIBLE_ITEM_ID = 4095
MAX_PLAUSIBLE_ITEM_QTY = 2000

DB_ITEMS = {
    1: "Master Ball", 2: "Ultra Ball", 3: "Great Ball", 4: "Poke Ball",
    44: "Rare Candy", 50: "Yellow Shard", 200: "Leftovers",
    60: "Dusk Ball", 62: "Quick Ball", 13: "Potion", 21: "Hyper Potion",
    23: "Full Heal", 25: "Max Revive", 273: "Safari Ball",
    716: "Ability Capsule", 717: "Ability Patch",
    0: "--- VUOTO ---"
}


def ru16(b, o): return struct.unpack_from("<H", b, o)[0]


def ru32(b, o): return struct.unpack_from("<I", b, o)[0]


def wu16(b, o, v): struct.pack_into("<H", b, o, v)


# --- CARICAMENTO NOMI DA .CT ---
def load_names_from_ct():
    ct_files = glob.glob("*.CT") + glob.glob("data/*.CT")
    if not ct_files: return
    try:
        with open(ct_files[0], 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            import re
            match = re.search(r'local linkDropDownList = "(.*?)"', content, re.DOTALL)
            if match:
                lines = match.group(1).replace('\\n', '\n').split('\n')
                for line in lines:
                    if ':' in line:
                        parts = line.split(':', 1)
                        try:
                            DB_ITEMS[int(parts[0])] = parts[1].strip()
                        except:
                            pass
                print(f"[INFO] Database aggiornato: {len(DB_ITEMS)} oggetti caricati.")
    except:
        pass


# --- CHECKSUM ALGO (GBA STANDARD) ---
def gba_checksum(data):
    total = 0
    for i in range(0, len(data), 4):
        total = (total + ru32(data, i)) & 0xFFFFFFFF
    return ((total >> 16) + (total & 0xFFFF)) & 0xFFFF


# --- RICALCOLO INTELLIGENTE ---
def recalculate_checksum(data, offset):
    """
    Ricalcola il checksum applicando la logica specifica per Unbound.
    """
    sector_start = (offset // SECTION_SIZE) * SECTION_SIZE

    # 1. Identifica che tipo di settore è
    sect_id = ru16(data, sector_start + OFF_ID)

    # 2. Determina la lunghezza dei dati su cui calcolare
    if sect_id == UNBOUND_ITEM_SECTOR_ID:
        # CASO SPECIALE UNBOUND: Ignora footer, usa lunghezza fissa scoperta
        valid_len = UNBOUND_ITEM_FIXED_LEN
        print(f"[FIX] Settore {sect_id} rilevato: Forzo calcolo su 0x{valid_len:X} bytes (Hardcoded)")
    else:
        # CASO STANDARD: Leggi lunghezza dal footer
        valid_len = ru32(data, sector_start + OFF_VALID_LEN)
        if valid_len > 0xFF4: valid_len = 0xFF4  # Safety cap
        # print(f"[STD] Settore {sect_id}: Calcolo su 0x{valid_len:X} bytes (da Footer)")

    # 3. Prepara il payload
    payload = data[sector_start: sector_start + valid_len]

    # Padding a 4 byte (Standard GBA)
    remainder = valid_len % 4
    if remainder != 0:
        payload += b'\x00' * (4 - remainder)

    # 4. Calcola e Scrivi
    new_chk = gba_checksum(payload)
    wu16(data, sector_start + OFF_CHK, new_chk)
    return new_chk


def get_save_index(data, sector_idx):
    offset = (sector_idx * SECTION_SIZE) + OFF_SAVE_IDX
    return ru32(data, offset)


def _is_plausible_slot(item_id, qty):
    return 0 <= item_id <= MAX_PLAUSIBLE_ITEM_ID and 0 <= qty <= MAX_PLAUSIBLE_ITEM_QTY


def _extract_pocket_bounds(data, anchor_offset):
    """
    Estrae i limiti di una tasca partendo da uno slot interno valido.
    Ritorna (start_abs, end_abs_exclusive, non_zero_count, slot_count) oppure None.
    """
    if anchor_offset < 0 or anchor_offset + 3 >= len(data):
        return None

    sector_start = (anchor_offset // SECTION_SIZE) * SECTION_SIZE
    sector_end = sector_start + OFF_VALID_LEN

    if not (sector_start <= anchor_offset < sector_end):
        return None

    curr = anchor_offset

    # Rewind all'inizio tasca: ci fermiamo su vuoto o dati non plausibili
    while True:
        prev = curr - 4
        if prev < sector_start:
            break
        pid = ru16(data, prev)
        pqty = ru16(data, prev + 2)
        if pid == 0 or not _is_plausible_slot(pid, pqty):
            break
        curr = prev

    start_abs = curr

    # Forward fino a 3 slot vuoti consecutivi o dati non plausibili
    empties = 0
    non_zero_count = 0
    slot_count = 0

    while curr + 3 < sector_end:
        iid = ru16(data, curr)
        iqty = ru16(data, curr + 2)

        if not _is_plausible_slot(iid, iqty):
            break

        slot_count += 1
        if iid == 0:
            empties += 1
            if empties >= 3:
                curr += 4
                break
        else:
            non_zero_count += 1
            empties = 0

        curr += 4

    end_abs = curr

    if slot_count == 0:
        return None

    return start_abs, end_abs, non_zero_count, slot_count


# --- MOTORE DI RICERCA ---
def scan_for_item_candidates(data, item_id):
    """
    Ricerca robusta e deterministica degli slot item:
    - scansiona SOLO i settori borsa noti (13..16),
    - usa slot allineati a 4 byte,
    - deduplica per tasca e save copy (attivo/inattivo),
    - evita falsi positivi da scansione raw globale.
    """
    if item_id <= 0:
        return []

    sector_candidates = []
    total_sectors = len(data) // SECTION_SIZE

    for sec_idx in range(total_sectors):
        sec_off = sec_idx * SECTION_SIZE
        sect_id = ru16(data, sec_off + OFF_ID)
        save_idx = ru32(data, sec_off + OFF_SAVE_IDX)

        if sect_id not in BAG_SECTOR_IDS:
            continue

        # Skip settori vuoti/non inizializzati
        if save_idx <= 0:
            continue

        # Gli slot sono larghi 4 byte ma possono iniziare su allineamento 0 oppure 2.
        for rel in range(0, OFF_VALID_LEN - 3, 2):
            abs_off = sec_off + rel
            iid = ru16(data, abs_off)
            qty = ru16(data, abs_off + 2)

            if iid != item_id or qty <= 0:
                continue
            if not _is_plausible_slot(iid, qty):
                continue

            bounds = _extract_pocket_bounds(data, abs_off)
            if not bounds:
                continue

            p_start, p_end, non_zero_count, slot_count = bounds

            # Tasche completamente vuote/non utili non sono candidati affidabili
            if non_zero_count <= 0:
                continue

            sector_candidates.append({
                'offset': p_start,
                'qty': qty,
                'sector': sec_idx,
                'sect_id': sect_id,
                'save_idx': save_idx,
                'pocket_end': p_end,
                'pocket_nonzero': non_zero_count,
                'pocket_slots': slot_count,
            })

    if not sector_candidates:
        return []

    # Dedup: una tasca "migliore" per copia save + tipo settore
    # (evita risultati multipli dello stesso item in aree rumorose)
    best_by_copy = {}
    for c in sector_candidates:
        key = (c['save_idx'], c['sect_id'])
        prev = best_by_copy.get(key)

        if prev is None:
            best_by_copy[key] = c
            continue

        prev_score = (prev['pocket_nonzero'], prev['pocket_slots'])
        new_score = (c['pocket_nonzero'], c['pocket_slots'])
        if new_score > prev_score:
            best_by_copy[key] = c

    out = list(best_by_copy.values())
    out.sort(key=lambda x: (-x['save_idx'], x['sect_id'], x['sector'], x['offset']))
    return out


# --- MAPPATURA TASCA ---
def map_pocket_from_anchor(data, anchor_offset):
    curr = anchor_offset
    # Rewind per trovare l'inizio della lista
    while True:
        prev = curr - 4
        # Se usciamo dal settore, stop
        if prev // SECTION_SIZE != anchor_offset // SECTION_SIZE: break

        pid = ru16(data, prev)
        pqty = ru16(data, prev + 2)

        # Se troviamo dati non validi o ID 0, siamo all'inizio o fuori
        if pid == 0 or not _is_plausible_slot(pid, pqty):
            break
        curr = prev

    # Forward map
    items = []
    while True:
        # Stop prima del footer
        if (curr % SECTION_SIZE) >= OFF_VALID_LEN: break

        iid = ru16(data, curr)
        iqty = ru16(data, curr + 2)

        if iid == 0:
            items.append({'id': 0, 'qty': 0, 'offset': curr, 'name': '--- VUOTO ---'})
            # Se vediamo 3 slot vuoti di fila, probabilmente la lista è finita
            if len(items) >= 3 and items[-2]['id'] == 0 and items[-3]['id'] == 0:
                break
        elif not _is_plausible_slot(iid, iqty):
            break  # Dati spazzatura
        else:
            name = DB_ITEMS.get(iid, f"Item {iid}")
            items.append({'id': iid, 'qty': iqty, 'offset': curr, 'name': name})
        curr += 4
    return items


# --- MAIN ---
def main():
    print("--- UNBOUND BAG EDITOR v14 (FINAL FIX) ---")
    if len(sys.argv) < 2:
        print("Uso: python3 unbound_bag_editor_v14.py <savefile>")
        return

    save_path = sys.argv[1]
    load_names_from_ct()

    with open(save_path, "rb") as f:
        full_data = bytearray(f.read())

    print("\nInserisci l'ID di un oggetto da cercare.")
    try:
        search_id = int(input("ID Oggetto: "))
    except:
        print("ID non valido.")
        return

    candidates = scan_for_item_candidates(full_data, search_id)
    if not candidates:
        print("Nessun risultato.")
        return

    # Determina il Save Index più recente
    max_save_idx = -1
    for c in candidates:
        if c['save_idx'] > max_save_idx:
            max_save_idx = c['save_idx']

    print(f"\n[RISULTATI] Oggetto '{DB_ITEMS.get(search_id, search_id)}':")
    print("IDX | SETTORE (ID) | OFFSET  | QTY | SAVE INDEX | STATO")
    print("-" * 70)

    valid_selection = None
    for i, cand in enumerate(candidates):
        status = "ATTIVO" if cand['save_idx'] == max_save_idx else "BACKUP"
        # Evidenzia se è il settore problematico ID 13
        note = " (ITEM PCKT)" if cand['sect_id'] == UNBOUND_ITEM_SECTOR_ID else ""

        print(
            f"{i + 1:3} | {cand['sector']:2} (ID {cand['sect_id']:2}){note} | {hex(cand['offset']):7} | {cand['qty']:3} | {cand['save_idx']:10} | {status}")

    print("-" * 70)
    print(f"CONSIGLIO: Scegli 'ATTIVO'. Se vedi ID {UNBOUND_ITEM_SECTOR_ID}, è la tasca oggetti standard.")
    sel = input("Selezione (Numero): ")

    try:
        sel_idx = int(sel) - 1
        valid_selection = candidates[sel_idx]
    except:
        print("Selezione non valida.")
        return

    anchor = valid_selection['offset']

    # Editor Loop
    while True:
        pocket_items = map_pocket_from_anchor(full_data, anchor)
        print(f"\n--- TASCA (Settore {valid_selection['sector']} - Index {valid_selection['save_idx']}) ---")
        print(" N. | OFFSET  | QTY  | OGGETTO")
        print("-" * 50)
        for i, item in enumerate(pocket_items):
            if item['id'] != 0:
                print(f"{i + 1:3} | {hex(item['offset']):7} | x{item['qty']:<3} | {item['name']} ({item['id']})")
            else:
                print(f"{i + 1:3} | {hex(item['offset']):7} | ---- | --- VUOTO ---")

        print("-" * 50)
        print("M = Modifica | S = Salva | 0 = Esci")
        cmd = input(">> ").upper()

        if cmd == '0':
            break
        elif cmd == 'S':
            shutil.copy(save_path, save_path + ".bak_v14")

            # Calcolo checksum con fix
            new_chk = recalculate_checksum(full_data, anchor)
            print(f"Checksum applicato: {hex(new_chk)}")

            with open(save_path, "wb") as f:
                f.write(full_data)
            print("File salvato correttamente.")
            break

        elif cmd == 'M':
            try:
                idx = int(input("Slot: ")) - 1
                if 0 <= idx < len(pocket_items):
                    itm = pocket_items[idx]
                    print(f"Modifica: {itm['name']}")
                    nid = input(f"Nuovo ID ({itm['id']}): ")
                    nqty = input(f"Nuova Qty ({itm['qty']}): ")

                    wid = int(nid) if nid else itm['id']
                    wqty = int(nqty) if nqty else itm['qty']

                    wu16(full_data, itm['offset'], wid)
                    wu16(full_data, itm['offset'] + 2, wqty)
                    print("Memoria aggiornata (non ancora salvata su disco).")
            except:
                print("Errore input.")


if __name__ == "__main__":
    main()
