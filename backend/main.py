import glob
from typing import List

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
import unbound_editor_v8 as party_mod
import unbound_bag_editor_v14 as bag_mod
import edit_money_v2 as money_mod
from pydantic import BaseModel
import unbound_box_editor_v16 as box_mod
import os
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware # <--- AGGIUNGI QUESTA RIGA


SAVE_FILE_NAME = "edited_save.sav"

app = FastAPI()
# Configurazione CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://192.168.1.6:5173", "http://192.168.1.6:5174"], # L'URL del tuo frontend Vite
    allow_credentials=True,
    allow_methods=["*"], # Permette tutti i metodi (GET, POST, ecc.)
    allow_headers=["*"], # Permette tutti gli header
)

# --- 1. SPOSTA TUTTE LE DEFINIZIONI DELLO STATO ALL'INIZIO ---
current_save = {
    "data": None,
    "filename": None,
    "pc_context": {
        "sectors": [],
        "headers": {},
        "originals": {},
        "pc_buffer": None,
        "preset_buffer": None,
        "mons": []
    }
}

# Assicurati che BASE_DIR e icons_path siano definiti come prima
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SEARCH_DIRS = [
    os.path.join(BASE_DIR, "icons", "pokemon"),
    os.path.join(BASE_DIR, "data", "icons", "pokemon")
]

icon_cache = {}
@app.get("/pokemon-icon/{species_id}")
async def get_pokemon_icon(species_id: int):
    # 1. Controlla la cache
    if species_id in icon_cache:
        return FileResponse(icon_cache[species_id])

    # 2. Configura i parametri di ricerca
    id_str = f"{species_id:03}"  # Assicura almeno 3 cifre (es: 1 -> 001)
    prefix = f"gFrontSprite{id_str}"
    search_dirs = [
        os.path.join(BASE_DIR, "icons", "pokemon"),
        os.path.join(BASE_DIR, "data", "icons", "pokemon")
    ]

    found_path = None

    # 3. Scansione cartelle con la logica del remainder
    for folder in search_dirs:
        if not os.path.exists(folder):
            continue

        pattern = os.path.join(folder, f"{prefix}*.png")
        candidates = glob.glob(pattern)

        for path in candidates:
            filename = os.path.basename(path)
            # Calcola cosa resta dopo il prefisso
            remainder = filename[len(prefix):]

            # FILTRO CRITICO: se il primo carattere dopo l'ID è un numero,
            # allora è un ID diverso (es: cercavo 113, ho trovato 1137)
            if remainder and remainder[0].isdigit():
                continue

            found_path = path
            break

        if found_path:
            break

    if found_path:
        print(found_path)
        icon_cache[species_id] = found_path  # Salva in cache
        return FileResponse(found_path)

    raise HTTPException(status_code=404, detail="Icona non trovata")


# --- 2. INIZIALIZZAZIONE UNIFICATA DEI DATABASE ---
@app.on_event("startup")
def load_databases():
    print("Caricamento database in corso...")
    party_mod.find_and_load_ct()
    bag_mod.load_names_from_ct()
    box_mod.find_and_load_ct()


@app.post("/upload")
async def upload_save(file: UploadFile = File(...)):
    """Carica il file .sav in memoria"""
    content = await file.read()
    current_save["data"] = bytearray(content)
    current_save["filename"] = file.filename
    return {"message": f"File {file.filename} caricato con successo!"}


@app.get("/money")
async def get_money():
    """Legge i soldi dal salvataggio caricato"""
    if current_save["data"] is None:
        raise HTTPException(status_code=400, detail="Carica prima un file .sav")

    # Riutilizziamo la funzione list_sections del tuo script
    secs = money_mod.list_sections(current_save["data"])
    trainer_secs = [s for s in secs if s["id"] == money_mod.TRAINER_SECTION_ID]

    if not trainer_secs:
        raise HTTPException(status_code=404, detail="Sezione Trainer non trovata")

    # Ordiniamo per l'ultimo salvataggio attivo (saveidx più alto)
    trainer_secs.sort(key=lambda x: x['saveidx'], reverse=True)
    payload = trainer_secs[0]["data"]

    # Leggiamo il valore u32 all'offset prestabilito
    money = money_mod.ru32(payload, money_mod.FALLBACK_OFF_MONEY)
    return {"money": money}


@app.post("/money/update")
async def update_money(amount: int):
    """Aggiorna i soldi e ricalcola i checksum"""
    if current_save["data"] is None:
        raise HTTPException(status_code=400, detail="Carica prima un file .sav")

    try:
        # Riutilizziamo la tua funzione patch_money_everywhere
        # Questa funzione gestisce già i checksum e il BCD
        new_data = money_mod.patch_money_everywhere(current_save["data"], amount)
        current_save["data"] = bytearray(new_data)
        return {"message": f"Soldi aggiornati a {amount}", "new_money": amount}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/download")
async def download_save():
    """Scarica il file .sav modificato"""
    if current_save["data"] is None:
        raise HTTPException(status_code=400, detail="Nessun dato disponibile")

    # Creiamo un file temporaneo da inviare al browser
    temp_file = "edited_save.sav"
    with open(temp_file, "wb") as f:
        f.write(current_save["data"])

    return FileResponse(temp_file, filename=current_save["filename"])


# --- MODELLI DATI PER VALIDAZIONE ---
class StatUpdate(BaseModel):
    hp: int
    atk: int
    dfe: int
    spa: int
    spd: int
    spe: int


class NatureUpdate(BaseModel):
    nature_id: int


class AbilityUpdate(BaseModel):
    hidden: bool

class AbilitySwitch(BaseModel):
    ability_index: int  # 0: Slot1, 1: Slot2, 2: HA


class ItemUpdate(BaseModel):
    item_id: int

# --- LOGICA HELPER ---
def get_active_trainer_offset():
    """Trova l'offset della sezione Trainer attiva (saveidx più alto)"""
    if not current_save["data"]:
        return None
    sections = money_mod.list_sections(current_save["data"])
    trainer_secs = [s for s in sections if s["id"] == party_mod.TRAINER_SECTION_ID]
    if not trainer_secs:
        return None
    trainer_secs.sort(key=lambda x: x['saveidx'], reverse=True)
    return trainer_secs[0]['off']


# --- ENDPOINTS ---

@app.get("/party")
async def get_party():
    off = get_active_trainer_offset()
    if off is None:
        raise HTTPException(status_code=404, detail="Salvataggio non valido")

    sec_data = current_save["data"][off: off + party_mod.SECTION_SIZE]
    team_count = party_mod.ru32(sec_data, 0x34)
    if team_count > 6: team_count = 6

    party = []
    for i in range(team_count):
        mon_off = 0x38 + (i * 100)
        pk = party_mod.Pokemon(sec_data[mon_off: mon_off + 100])

        party.append({
            "index": i,
            "nickname": pk.nickname,
            "species_name": party_mod.DB_SPECIES.get(pk.get_species_id(), "Unknown"),
            "level": sec_data[mon_off + 0x54],
            "nature": pk.get_nature_name(),
            "nature_id": pk.get_nature_id(),  # <--- AGGIUNGI QUESTO
            "is_hidden_ability": bool(pk.get_hidden_ability_flag()),
            "ivs": pk.get_ivs(),
            "evs": pk.get_evs(),
            "species_id": pk.get_species_id(),
            "moves": pk.get_moves_ids(), # <-- AGGIUNGI QUESTA RIGA,
            "ability_slot": pk.get_standard_ability_slot(),  # 0 o 1
            "current_ability_index": 2 if pk.get_hidden_ability_flag() else pk.get_standard_ability_slot(),
            "item_id": pk.get_item_id(),  # <-- AGGIUNGI QUESTO
        })
    return party


@app.post("/party/{idx}/item")
async def update_party_item(idx: int, data: ItemUpdate):
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])

    pk.set_item(data.item_id)

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "Strumento aggiornato"}


@app.post("/party/{idx}/ability-switch")
async def switch_ability(idx: int, data: AbilitySwitch):
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])

    pk.set_ability_slot(data.ability_index)

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "Abilità/PID aggiornati", "new_index": data.ability_index}


@app.post("/party/{idx}/ivs")
async def update_ivs(idx: int, stats: StatUpdate):
    """Aggiorna gli IV (0-31) mantenendo i bit HA e Egg"""
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)

    # Carichiamo il pokemon dal buffer
    pk_data = current_save["data"][mon_off: mon_off + 100]
    pk = party_mod.Pokemon(pk_data)

    # Applichiamo i nuovi IV (mappando i nomi delle chiavi del frontend a quelli del backend)
    new_ivs = {
        'HP': stats.hp, 'Atk': stats.atk, 'Def': stats.dfe,
        'Spd': stats.spe, 'SpA': stats.spa, 'SpD': stats.spd
    }
    pk.set_ivs(new_ivs)

    # Pack e aggiornamento buffer locale
    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "IVs aggiornati in memoria"}


@app.post("/party/{idx}/nature")
async def update_nature(idx: int, data: NatureUpdate):
    """Modifica la natura ricalcolando il PID"""
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)

    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])
    pk.set_nature(data.nature_id)

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": f"Natura cambiata in {party_mod.DB_NATURES.get(data.nature_id)}"}

# Carica il database oggetti all'avvio
bag_mod.load_names_from_ct()

class BagItemUpdate(BaseModel):
    offset: int  # L'indirizzo fisico nella memoria
    item_id: int
    quantity: int


@app.get("/items")
async def get_all_items():
    """Restituisce la lista completa degli strumenti (ID e Nome) per il frontend"""
    # Trasformiamo il dizionario in una lista di oggetti per il frontend
    return [{"id": k, "name": v} for k, v in bag_mod.DB_ITEMS.items() if k != 0]


@app.get("/bag/scan/{search_item_id}")
async def scan_bag(search_item_id: int):
    """Cerca le tasche della borsa partendo da un ID oggetto noto"""
    if not current_save["data"]:
        raise HTTPException(status_code=400, detail="Carica un file .sav")

    candidates = bag_mod.scan_for_item_candidates(current_save["data"], search_item_id)

    if not candidates:
        return {"message": "Nessuna tasca trovata", "results": []}  # Già corretto qui

    max_idx = max((c['save_idx'] for c in candidates), default=-1)

    results = []
    for c in candidates:
        results.append({
            "anchor_offset": c['offset'],
            "sector": c['sector'],
            "sect_id": c['sect_id'],
            "save_idx": c['save_idx'],
            "is_active": c['save_idx'] == max_idx,
            "is_main_pocket": c['sect_id'] == bag_mod.UNBOUND_ITEM_SECTOR_ID
        })

    # MODIFICA QUI: Ritorna l'oggetto con la chiave 'results'
    return {"results": results}

@app.get("/bag/pocket")
async def get_pocket_items(anchor_offset: int):
    """Mappa tutti gli strumenti in una tasca dato un offset di riferimento"""
    # Mappa la lista avanti e indietro per trovare tutti gli slot
    items = bag_mod.map_pocket_from_anchor(current_save["data"], anchor_offset)
    return items


@app.post("/bag/item/update")
async def update_bag_item(update: BagItemUpdate):
    """Modifica ID o quantità di uno slot specifico in memoria"""
    # Scrittura a 2 byte (Little Endian)
    bag_mod.wu16(current_save["data"], update.offset, update.item_id)
    bag_mod.wu16(current_save["data"], update.offset + 2, update.quantity)
    return {"status": "Slot borsa aggiornato"}


@app.get("/pc/load")
async def load_pc():
    """Analizza il PC e carica i Pokémon in memoria"""
    if not current_save["data"]:
        raise HTTPException(status_code=400, detail="Carica un file .sav")

    # Estrazione settori attivi
    sectors = box_mod.get_active_pc_sectors(current_save["data"])
    if not sectors:
        raise HTTPException(status_code=404, detail="Settori PC non trovati")

    # Ricostruzione buffer standard e preset
    pc_buf, headers, originals, preset_buf = box_mod.rebuild_buffer(current_save["data"], sectors)

    current_save["pc_context"].update({
        "sectors": sectors, "headers": headers,
        "originals": originals, "pc_buffer": pc_buf, "preset_buffer": preset_buf,
        "mons": []
    })

    # Caricamento oggetti Pokémon (Box 1-25)
    curr = 0
    for box in range(1, 26):
        for slot in range(1, 31):
            if curr + box_mod.MON_SIZE_PC > len(pc_buf): break
            m = box_mod.UnboundPCMon(pc_buf[curr: curr + box_mod.MON_SIZE_PC], box, slot)
            if m.is_valid:
                m.buffer_offset = curr
                current_save["pc_context"]["mons"].append(m)
            curr += box_mod.MON_SIZE_PC

    # Caricamento Preset (Box 26)
    if len(preset_buf) > 0:
        p_curr = box_mod.OFFSET_PRESET_START
        for slot in range(1, box_mod.PRESET_CAPACITY + 1):
            if p_curr + box_mod.MON_SIZE_PC > len(preset_buf): break
            m = box_mod.UnboundPCMon(preset_buf[p_curr: p_curr + box_mod.MON_SIZE_PC], 26, slot)
            if m.is_valid:
                m.buffer_offset = p_curr
                current_save["pc_context"]["mons"].append(m)
            p_curr += box_mod.MON_SIZE_PC

    return {"count": len(current_save["pc_context"]["mons"]), "message": "PC caricato"}


@app.get("/pc/box/{box_id}")
async def get_box(box_id: int):
    """Restituisce i Pokémon di un box con tutti i dati necessari all'editing"""
    # Filtriamo i pokemon caricati nel contesto per il box selezionato
    mons = [m for m in current_save["pc_context"]["mons"] if m.box == box_id]

    return [{
        "box": m.box,
        "slot": m.slot,
        "nickname": m.nickname,
        "species_name": box_mod.DB_SPECIES.get(m.species_id, "Unknown"),
        "species_id": m.species_id,
        "item_id": m.get_item_id(),
        "exp": m.exp,
        "nature_id": m.nature_id if hasattr(m, 'nature_id') else int(box_mod.ru32(m.raw, 0) % 25), # Fallback PID
        "ivs": m.get_ivs(),  # AGGIUNTO
        "evs": m.get_evs(),  # AGGIUNTO
        "moves": m.get_moves(), # Restituisce gli ID numerici
        "current_ability_index": 2 if m.get_hidden_ability_flag() else 0 # Semplificato per PC
    } for m in mons]


class PCUpdate(BaseModel):
    box: int
    slot: int
    moves: List[int] = None
    item_id: int = None


@app.post("/pc/edit")
async def edit_pc_mon(upd: PCUpdate):
    # Cerca il pokemon nello stato globale
    target = next((m for m in current_save["pc_context"]["mons"]
                   if m.box == upd.box and m.slot == upd.slot), None)

    if not target:
        raise HTTPException(status_code=404, detail="Pokémon non trovato")

    # Applica modifiche all'oggetto
    if upd.moves: target.set_moves(upd.moves)
    if upd.item_id is not None: target.set_item_id(upd.item_id)

    # Rifletti le modifiche nel buffer di competenza
    if target.box == 26:
        buf = current_save["pc_context"]["preset_buffer"]
        off = target.buffer_offset
    else:
        buf = current_save["pc_context"]["pc_buffer"]
        off = ((target.box - 1) * 30 + (target.slot - 1)) * box_mod.MON_SIZE_PC

    buf[off: off + box_mod.MON_SIZE_PC] = target.raw
    return {"status": "Modifica salvata nel buffer temporaneo"}


# --- NUOVI MODELLI PER IL PARTY ---
class EvUpdate(BaseModel):
    hp: int
    atk: int
    dfe: int
    spa: int
    spd: int
    spe: int


class AbilityUpdate(BaseModel):
    is_hidden: bool


class MovesUpdate(BaseModel):
    moves: List[int]


class ItemUpdate(BaseModel):
    item_id: int


# --- NUOVI ENDPOINTS PARTY ---

@app.post("/party/{idx}/evs")
async def update_evs(idx: int, stats: EvUpdate):
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])

    new_evs = {
        'HP': stats.hp, 'Atk': stats.atk, 'Def': stats.dfe,
        'Spd': stats.spe, 'SpA': stats.spa, 'SpD': stats.spd
    }
    pk.set_evs(new_evs)
    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "EVs aggiornati"}


@app.post("/party/{idx}/ability")
async def update_ability(idx: int, data: AbilityUpdate):
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])

    # In Unbound il flag HA è gestito internamente al byte IVs/Ability
    pk.set_hidden_ability_flag(1 if data.is_hidden else 0)

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "Abilità aggiornata"}


@app.post("/party/{idx}/moves")
async def update_party_moves(idx: int, data: MovesUpdate):
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])

    pk.set_moves(data.moves)

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "Mosse aggiornate"}


@app.get("/moves")
async def get_all_moves():
    """Restituisce la lista mosse per il dropdown"""
    return [{"id": k, "name": v} for k, v in box_mod.DB_MOVES.items()]


# Aggiungi questo modello per un update completo del PC
class PCFullUpdate(BaseModel):
    box: int
    slot: int
    nickname: str = None
    moves: List[int] = None
    item_id: int = None
    ivs: dict = None
    evs: dict = None
    nature_id: int = None
    exp: int = None


@app.post("/pc/edit-full")
async def edit_pc_mon_full(upd: PCFullUpdate):
    # Trova il pokemon nel contesto caricato
    target = next((m for m in current_save["pc_context"]["mons"]
                   if m.box == upd.box and m.slot == upd.slot), None)

    if not target:
        raise HTTPException(status_code=404, detail="Pokémon non trovato nel PC")

    # Applica modifiche usando i metodi della classe UnboundPCMon (v16)
    if upd.moves: target.set_moves(upd.moves)
    if upd.item_id is not None: target.set_item_id(upd.item_id)
    if upd.ivs: target.set_ivs(upd.ivs)
    if upd.evs: target.set_evs(upd.evs)
    if upd.nature_id is not None: target.set_nature(upd.nature_id)
    if upd.exp is not None: target.set_exp(upd.exp)

    # Sincronizza il buffer (Stream 1-25 o Preset 26)
    if target.box == 26:
        buf = current_save["pc_context"]["preset_buffer"]
        off = target.buffer_offset
    else:
        buf = current_save["pc_context"]["pc_buffer"]
        # Calcolo offset lineare nello stream
        off = ((target.box - 1) * 30 + (target.slot - 1)) * box_mod.MON_SIZE_PC

    buf[off: off + box_mod.MON_SIZE_PC] = target.raw
    return {"status": "Modifiche PC applicate al buffer"}


@app.post("/save-all")
async def commit_to_file():
    if not current_save["data"]:
        raise HTTPException(status_code=400, detail="Nessun dato")

    sections = money_mod.list_sections(current_save["data"])

    # 1. Ricalcolo Checksum Sezioni Trainer (ID 1)
    for sec in sections:
        if sec['id'] == party_mod.TRAINER_SECTION_ID:
            off = sec['off']
            valid_len = party_mod.ru32(current_save["data"], off + 0xFF0)
            if valid_len == 0 or valid_len > 0xFF4: valid_len = 0xFF4

            payload = current_save["data"][off: off + valid_len]
            new_chk = bag_mod.gba_checksum(payload)
            party_mod.wu16(current_save["data"], off + 0xFF6, new_chk)

    # 2. Ricalcolo Checksum BORSA (Tutti i settori della borsa)
    # Pokémon Unbound usa i settori 13, 14, 15 etc. per le tasche.
    # Applichiamo il ricalcolo a ogni settore che viene identificato come "Borsa" o "PC Items"
    for sec in sections:
        # Il settore 13 è quello degli oggetti principali (fisso 0x454)
        # Gli altri settori (Bacche, MT) usano la lunghezza standard nel footer.
        if sec['id'] >= 13 and sec['id'] <= 16:
            bag_mod.recalculate_checksum(current_save["data"], sec['off'])

    # 3. Salvataggio PC e Scrittura File su disco
    ctx = current_save["pc_context"]
    if ctx.get("pc_buffer") is not None:
        box_mod.write_save_HYBRID(
            current_save["data"], ctx["sectors"], ctx["pc_buffer"],
            ctx["headers"], ctx["originals"], SAVE_FILE_NAME,
            preset_buffer=ctx["preset_buffer"]
        )
    else:
        with open(SAVE_FILE_NAME, "wb") as f:
            f.write(current_save["data"])

    return {"message": "Salvataggio completato e checksum ricalcolati!"}

@app.get("/download")
async def download_save():
    if not os.path.exists(SAVE_FILE_NAME):
        raise HTTPException(status_code=400, detail="File non ancora generato")

    return FileResponse(SAVE_FILE_NAME, filename=current_save["filename"])