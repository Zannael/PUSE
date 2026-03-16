import glob
from typing import List
from pathlib import Path
import base64

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, Response
from modules import party as party_mod
from modules import bag as bag_mod
from modules import money as money_mod
from pydantic import BaseModel
from modules import pc as box_mod
import os
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from core.item_icon_resolver import ItemIconResolver


SAVE_FILE_NAME = "edited_save.sav"


def _load_env_file():
    env_path = Path(__file__).with_name(".env")
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


def _cors_origins_from_env():
    raw = os.getenv("CORS_ORIGINS", "http://localhost:5173")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


_load_env_file()

app = FastAPI()
# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins_from_env(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. Keep all shared state definitions at the top ---
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

# Keep BASE_DIR and icon paths defined before endpoint handlers
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SEARCH_DIRS = [
    os.path.join(BASE_DIR, "icons", "pokemon"),
    os.path.join(BASE_DIR, "data", "icons", "pokemon")
]
ITEM_ICONS_DIR = os.path.join(BASE_DIR, "icons", "items")

ICON_FALLBACK_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAAZ/q4cAAAAASUVORK5CYII="
)

icon_cache = {}
item_icon_cache: dict[int, str | None] = {}
item_icon_resolver = ItemIconResolver(ITEM_ICONS_DIR)


@app.get("/pokemon-icon/{species_id}")
async def get_pokemon_icon(species_id: int):
    # 1. Check cache
    if species_id in icon_cache:
        return FileResponse(icon_cache[species_id])

    # 2. Configure search parameters
    id_str = f"{species_id:03}"  # Ensure at least 3 digits (e.g., 1 -> 001)
    prefix = f"gFrontSprite{id_str}"
    search_dirs = [
        os.path.join(BASE_DIR, "icons", "pokemon"),
        os.path.join(BASE_DIR, "data", "icons", "pokemon")
    ]

    found_path = None

    # 3. Scan folders with remainder-based filtering
    for folder in search_dirs:
        if not os.path.exists(folder):
            continue

        pattern = os.path.join(folder, f"{prefix}*.png")
        candidates = glob.glob(pattern)

        for path in candidates:
            filename = os.path.basename(path)
            # Compute what remains after the prefix
            remainder = filename[len(prefix):]

            # Critical filter: if the first character after the ID is a digit,
            # it is a different ID (e.g., searching 113 but found 1137)
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

    return Response(content=ICON_FALLBACK_PNG, media_type="image/png")


@app.get("/item-icon/{item_id}")
async def get_item_icon(item_id: int):
    if item_id <= 0:
        raise HTTPException(status_code=404, detail="Item icon not found")

    if item_id in item_icon_cache:
        cached = item_icon_cache[item_id]
        if cached:
            return FileResponse(cached)
        raise HTTPException(status_code=404, detail="Item icon not found")

    item_name = bag_mod.DB_ITEMS.get(item_id)
    icon_path = item_icon_resolver.resolve(item_name or "")
    item_icon_cache[item_id] = icon_path

    if icon_path:
        return FileResponse(icon_path)
    raise HTTPException(status_code=404, detail="Item icon not found")


# --- 2. Unified database initialization ---
@app.on_event("startup")
def load_databases():
    print("Loading databases...")
    party_mod.load_static_data()
    bag_mod.load_item_names_from_file()
    bag_mod.load_tm_names_from_file()
    box_mod.load_static_data()

    if not any(os.path.isdir(p) for p in SEARCH_DIRS):
        print(
            "[WARN] Pokemon icon directory not found. "
            "UI will still work without sprites. "
            "To enable them, clone: "
            "https://github.com/Skeli789/Dynamic-Pokemon-Expansion/tree/master/graphics/pokeicon "
            f"in '{SEARCH_DIRS[0]}'."
        )

    if not item_icon_resolver.available:
        print(
            "[WARN] Item icon directory not found or empty. "
            "UI will still work without item icons. "
            "To enable them, use Leon's ROM Base item pack in "
            f"'{ITEM_ICONS_DIR}'."
        )


@app.post("/upload")
async def upload_save(file: UploadFile = File(...)):
    """Load the .sav file into memory."""
    content = await file.read()
    current_save["data"] = bytearray(content)
    current_save["filename"] = file.filename
    return {"message": f"File {file.filename} loaded successfully!"}


@app.get("/money")
async def get_money():
    """Read money from the loaded save file."""
    if current_save["data"] is None:
        raise HTTPException(status_code=400, detail="Upload a .sav file first")

    # Reuse list_sections from the money module
    secs = money_mod.list_sections(current_save["data"])
    trainer_secs = [s for s in secs if s["id"] == money_mod.TRAINER_SECTION_ID]

    if not trainer_secs:
        raise HTTPException(status_code=404, detail="Trainer section not found")

    # Sort by most recent active save slot (highest saveidx)
    trainer_secs.sort(key=lambda x: x['saveidx'], reverse=True)
    payload = trainer_secs[0]["data"]

    # Read u32 money value at the expected offset
    money = money_mod.ru32(payload, money_mod.FALLBACK_OFF_MONEY)
    return {"money": money}


@app.post("/money/update")
async def update_money(amount: int):
    """Update money value and recalculate checksums."""
    if current_save["data"] is None:
        raise HTTPException(status_code=400, detail="Upload a .sav file first")

    try:
        # Reuse patch_money_everywhere; it already handles checksums and BCD
        new_data = money_mod.patch_money_everywhere(current_save["data"], amount)
        current_save["data"] = bytearray(new_data)
        return {"message": f"Money updated to {amount}", "new_money": amount}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/download")
async def download_save():
    """Download the modified .sav file."""
    if current_save["data"] is None:
        raise HTTPException(status_code=400, detail="No data available")

    # Create a temporary file to send to the browser
    temp_file = "edited_save.sav"
    with open(temp_file, "wb") as f:
        f.write(current_save["data"])

    return FileResponse(temp_file, filename=current_save["filename"])


# --- Validation data models ---
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


class SpeciesUpdate(BaseModel):
    species_id: int


class PartyLevelUpdate(BaseModel):
    target_level: int
    growth_rate: int | None = None

# --- Helper logic ---
def get_active_trainer_offset():
    """Find offset of active Trainer section (highest saveidx)."""
    if not current_save["data"]:
        return None
    sections = money_mod.list_sections(current_save["data"])
    trainer_secs = [s for s in sections if s["id"] == party_mod.TRAINER_SECTION_ID]
    if not trainer_secs:
        return None
    trainer_secs.sort(key=lambda x: x['saveidx'], reverse=True)
    return trainer_secs[0]['off']


# --- Endpoints ---

@app.get("/party")
async def get_party():
    off = get_active_trainer_offset()
    if off is None:
        raise HTTPException(status_code=404, detail="Invalid save file")

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
            "exp": pk.get_exp(),
            "nature": pk.get_nature_name(),
            "nature_id": pk.get_nature_id(),
            "is_hidden_ability": bool(pk.get_hidden_ability_flag()),
            "ivs": pk.get_ivs(),
            "evs": pk.get_evs(),
            "species_id": pk.get_species_id(),
            "moves": pk.get_moves_ids(),
            "ability_slot": pk.get_standard_ability_slot(),  # 0 or 1
            "current_ability_index": 2 if pk.get_hidden_ability_flag() else pk.get_standard_ability_slot(),
            "item_id": pk.get_item_id(),
        })
    return party


@app.post("/party/{idx}/item")
async def update_party_item(idx: int, data: ItemUpdate):
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])

    pk.set_item(data.item_id)

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "Item updated"}


@app.post("/party/{idx}/species")
async def update_party_species(idx: int, data: SpeciesUpdate):
    if data.species_id <= 0 or data.species_id not in party_mod.DB_SPECIES:
        raise HTTPException(status_code=400, detail="Invalid species_id")

    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])

    pk.set_species_id(data.species_id)
    pk.recalculate_party_stats(clamp_hp=True)

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "Species updated", "species_id": data.species_id}


@app.post("/party/{idx}/ability-switch")
async def switch_ability(idx: int, data: AbilitySwitch):
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])

    pk.set_ability_slot(data.ability_index)

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "Ability/PID updated", "new_index": data.ability_index}


@app.post("/party/{idx}/ivs")
async def update_ivs(idx: int, stats: StatUpdate):
    """Update IVs (0-31) while preserving HA and Egg bits."""
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)

    # Load pokemon from buffer
    pk_data = current_save["data"][mon_off: mon_off + 100]
    pk = party_mod.Pokemon(pk_data)

    # Apply new IVs (mapping frontend keys to backend keys)
    new_ivs = {
        'HP': stats.hp, 'Atk': stats.atk, 'Def': stats.dfe,
        'Spd': stats.spe, 'SpA': stats.spa, 'SpD': stats.spd
    }
    pk.set_ivs(new_ivs)
    pk.recalculate_party_stats(clamp_hp=True)

    # Pack and write back to local buffer
    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "IVs updated in memory"}


@app.post("/party/{idx}/nature")
async def update_nature(idx: int, data: NatureUpdate):
    """Update nature and recalculate PID."""
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)

    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])
    pk.set_nature(data.nature_id)
    pk.recalculate_party_stats(clamp_hp=True)

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": f"Nature changed to {party_mod.DB_NATURES.get(data.nature_id)}"}


@app.post("/party/{idx}/level")
async def update_party_level(idx: int, data: PartyLevelUpdate):
    off = get_active_trainer_offset()
    if off is None:
        raise HTTPException(status_code=404, detail="Invalid save file")

    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])

    target_level = max(1, min(100, int(data.target_level)))
    visual_level = current_save["data"][mon_off + 0x54]
    current_exp = pk.get_exp()

    if data.growth_rate is not None:
        if data.growth_rate < 0 or data.growth_rate > 5:
            raise HTTPException(status_code=400, detail="growth_rate must be between 0 and 5")
        growth_rate, confidence = data.growth_rate, "manual"
    else:
        growth_rate, confidence = party_mod.guess_growth_rate(current_exp, visual_level)

    new_exp = party_mod.get_exp_at_level(growth_rate, target_level)
    pk.set_exp(new_exp)
    pk.set_visual_level(target_level)
    pk.recalculate_party_stats(clamp_hp=True)

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {
        "status": "Level updated",
        "target_level": target_level,
        "exp": new_exp,
        "growth_rate": growth_rate,
        "growth_name": party_mod.GROWTH_NAMES.get(growth_rate, "Unknown"),
        "confidence": confidence,
    }

# Load item database at startup
bag_mod.load_item_names_from_file()
bag_mod.load_tm_names_from_file()

class BagItemUpdate(BaseModel):
    offset: int  # Physical memory address
    item_id: int
    quantity: int
    encoding: str | None = None


@app.get("/items")
async def get_all_items():
    """Return full item list (ID and name) for the frontend."""
    # Convert dictionary into frontend object list
    return [{"id": k, "name": v} for k, v in bag_mod.DB_ITEMS.items() if k != 0]


@app.get("/species")
async def get_all_species():
    """Return full species list (ID and name) for the frontend."""
    return [{"id": k, "name": v} for k, v in party_mod.DB_SPECIES.items() if k != 0]


@app.get("/bag/scan/{search_item_id}")
async def scan_bag(search_item_id: int):
    """Scan bag pockets starting from a known item ID."""
    if not current_save["data"]:
        raise HTTPException(status_code=400, detail="Upload a .sav file")

    candidates = bag_mod.scan_for_item_candidates(current_save["data"], search_item_id)

    if not candidates:
        return {"message": "No pockets found", "results": []}

    max_idx = max((c['save_idx'] for c in candidates), default=-1)
    pocket_type = bag_mod.pocket_type_for_item_id(search_item_id)

    results = []
    for c in candidates:
        results.append({
            "anchor_offset": c['offset'],
            "sector": c['sector'],
            "sect_id": c['sect_id'],
            "save_idx": c['save_idx'],
            "is_active": c['save_idx'] == max_idx,
            "is_main_pocket": c['sect_id'] == bag_mod.UNBOUND_ITEM_SECTOR_ID,
            "quality": c.get('quality'),
            "score": c.get('score'),
            "slot_count": c.get('pocket_slots'),
            "dup_count": c.get('pocket_dups'),
            "pocket_type": pocket_type,
        })

    # Return object with 'results' key
    return {"results": results}


@app.get("/bag/pockets/bootstrap")
async def bag_pockets_bootstrap():
    """Quick main-pocket resolution (validation + fallback scan)."""
    if not current_save["data"]:
        raise HTTPException(status_code=400, detail="Upload a .sav file")

    pockets = bag_mod.resolve_quick_pockets(current_save["data"])
    return {"pockets": pockets}

@app.get("/bag/pocket")
async def get_pocket_items(anchor_offset: int):
    """Map all items in a pocket given an anchor offset."""
    # Walk list forward and backward to find all slots
    items = bag_mod.map_pocket_from_anchor(current_save["data"], anchor_offset)
    return items


@app.post("/bag/item/update")
async def update_bag_item(update: BagItemUpdate):
    """Update item ID or quantity for a specific slot in memory."""
    bag_mod.write_slot(
        current_save["data"],
        update.offset,
        update.item_id,
        update.quantity,
        encoding=update.encoding,
    )
    return {"status": "Bag slot updated"}


@app.get("/pc/load")
async def load_pc():
    """Analyze PC data and load Pokemon into memory."""
    if not current_save["data"]:
        raise HTTPException(status_code=400, detail="Upload a .sav file")

    # Extract active sectors
    sectors = box_mod.get_active_pc_sectors(current_save["data"])
    if not sectors:
        raise HTTPException(status_code=404, detail="PC sectors not found")

    # Rebuild standard and preset buffers
    pc_buf, headers, originals, preset_buf = box_mod.rebuild_buffer(current_save["data"], sectors)

    current_save["pc_context"].update({
        "sectors": sectors, "headers": headers,
        "originals": originals, "pc_buffer": pc_buf, "preset_buffer": preset_buf,
        "mons": []
    })

    # Load Pokemon entries (Boxes 1-25)
    curr = 0
    for box in range(1, 26):
        for slot in range(1, 31):
            if curr + box_mod.MON_SIZE_PC > len(pc_buf): break
            m = box_mod.UnboundPCMon(pc_buf[curr: curr + box_mod.MON_SIZE_PC], box, slot)
            if m.is_valid:
                m.buffer_offset = curr
                current_save["pc_context"]["mons"].append(m)
            curr += box_mod.MON_SIZE_PC

    # Load preset entries (Box 26)
    if len(preset_buf) > 0:
        p_curr = box_mod.OFFSET_PRESET_START
        for slot in range(1, box_mod.PRESET_CAPACITY + 1):
            if p_curr + box_mod.MON_SIZE_PC > len(preset_buf): break
            m = box_mod.UnboundPCMon(preset_buf[p_curr: p_curr + box_mod.MON_SIZE_PC], 26, slot)
            if m.is_valid:
                m.buffer_offset = p_curr
                current_save["pc_context"]["mons"].append(m)
            p_curr += box_mod.MON_SIZE_PC

    return {"count": len(current_save["pc_context"]["mons"]), "message": "PC loaded"}


@app.get("/pc/box/{box_id}")
async def get_box(box_id: int):
    """Return all Pokemon in a box with edit-ready data."""
    # Filter loaded Pokemon in context by selected box
    mons = [m for m in current_save["pc_context"]["mons"] if m.box == box_id]

    return [{
        "box": m.box,
        "slot": m.slot,
        "nickname": m.nickname,
        "species_name": box_mod.DB_SPECIES.get(m.species_id, "Unknown"),
        "species_id": m.species_id,
        "item_id": m.get_item_id(),
        "exp": m.exp,
        "nature_id": m.nature_id if hasattr(m, 'nature_id') else int(box_mod.ru32(m.raw, 0) % 25), # PID fallback
        "ivs": m.get_ivs(),
        "evs": m.get_evs(),
        "moves": m.get_moves(), # Returns numeric IDs
        "current_ability_index": 2 if m.get_hidden_ability_flag() else 0 # Simplified for PC
    } for m in mons]


class PCUpdate(BaseModel):
    box: int
    slot: int
    moves: List[int] = None
    item_id: int = None


@app.post("/pc/edit")
async def edit_pc_mon(upd: PCUpdate):
    # Find target Pokemon in global state
    target = next((m for m in current_save["pc_context"]["mons"]
                   if m.box == upd.box and m.slot == upd.slot), None)

    if not target:
        raise HTTPException(status_code=404, detail="Pokemon not found")

    # Apply object updates
    if upd.moves: target.set_moves(upd.moves)
    if upd.item_id is not None: target.set_item_id(upd.item_id)

    # Reflect updates in the corresponding buffer
    if target.box == 26:
        buf = current_save["pc_context"]["preset_buffer"]
        off = target.buffer_offset
    else:
        buf = current_save["pc_context"]["pc_buffer"]
        off = ((target.box - 1) * 30 + (target.slot - 1)) * box_mod.MON_SIZE_PC

    buf[off: off + box_mod.MON_SIZE_PC] = target.raw
    return {"status": "Update saved to temporary buffer"}


# --- Additional models for party updates ---
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


# --- Additional party endpoints ---

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
    pk.recalculate_party_stats(clamp_hp=True)
    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "EVs updated"}


@app.post("/party/{idx}/ability")
async def update_ability(idx: int, data: AbilityUpdate):
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])

    # In Unbound, the HA flag is handled inside the IVs/Ability byte
    pk.set_hidden_ability_flag(1 if data.is_hidden else 0)

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "Ability updated"}


@app.post("/party/{idx}/moves")
async def update_party_moves(idx: int, data: MovesUpdate):
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])

    pk.set_moves(data.moves)

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "Moves updated"}


@app.get("/moves")
async def get_all_moves():
    """Return move list for dropdown."""
    return [{"id": k, "name": v} for k, v in box_mod.DB_MOVES.items()]


# Model for full PC update payload
class PCFullUpdate(BaseModel):
    box: int
    slot: int
    nickname: str = None
    moves: List[int] = None
    item_id: int = None
    species_id: int = None
    ivs: dict = None
    evs: dict = None
    nature_id: int = None
    exp: int = None


@app.post("/pc/edit-full")
async def edit_pc_mon_full(upd: PCFullUpdate):
    # Find pokemon in loaded context
    target = next((m for m in current_save["pc_context"]["mons"]
                   if m.box == upd.box and m.slot == upd.slot), None)

    if not target:
        raise HTTPException(status_code=404, detail="Pokemon not found in PC")

    # Apply updates using UnboundPCMon methods (v16)
    if upd.moves: target.set_moves(upd.moves)
    if upd.item_id is not None: target.set_item_id(upd.item_id)
    if upd.species_id is not None:
        if upd.species_id <= 0 or upd.species_id not in box_mod.DB_SPECIES:
            raise HTTPException(status_code=400, detail="Invalid species_id")
        target.set_species_id(upd.species_id)
    if upd.ivs: target.set_ivs(upd.ivs)
    if upd.evs: target.set_evs(upd.evs)
    if upd.nature_id is not None: target.set_nature(upd.nature_id)
    if upd.exp is not None: target.set_exp(upd.exp)

    # Sync buffer (stream 1-25 or preset 26)
    if target.box == 26:
        buf = current_save["pc_context"]["preset_buffer"]
        off = target.buffer_offset
    else:
        buf = current_save["pc_context"]["pc_buffer"]
        # Compute linear stream offset
        off = ((target.box - 1) * 30 + (target.slot - 1)) * box_mod.MON_SIZE_PC

    buf[off: off + box_mod.MON_SIZE_PC] = target.raw
    return {"status": "PC updates applied to buffer"}


@app.post("/save-all")
async def commit_to_file():
    if not current_save["data"]:
        raise HTTPException(status_code=400, detail="No data")

    sections = money_mod.list_sections(current_save["data"])

    # 1. Recalculate trainer section checksums (ID 1)
    for sec in sections:
        if sec['id'] == party_mod.TRAINER_SECTION_ID:
            off = sec['off']
            valid_len = party_mod.ru32(current_save["data"], off + 0xFF0)
            if valid_len == 0 or valid_len > 0xFF4: valid_len = 0xFF4

            payload = current_save["data"][off: off + valid_len]
            new_chk = bag_mod.gba_checksum(payload)
            party_mod.wu16(current_save["data"], off + 0xFF6, new_chk)

    # 2. Recalculate bag checksums (all bag-related sectors)
    # Pokemon Unbound uses sectors 13, 14, 15, etc. for pockets.
    # Apply checksum recalculation to each bag/PC-items sector.
    for sec in sections:
        # Sector 13 is the main items sector (fixed 0x454).
        # Other sectors (Berries, TMs) use standard footer length.
        if sec['id'] >= 13 and sec['id'] <= 16:
            bag_mod.recalculate_checksum(current_save["data"], sec['off'])

    # 3. Persist PC buffers and write output save file
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

    return {"message": "Save completed and checksums recalculated!"}

@app.get("/download")
async def download_save():
    if not os.path.exists(SAVE_FILE_NAME):
        raise HTTPException(status_code=400, detail="File not generated yet")

    return FileResponse(SAVE_FILE_NAME, filename=current_save["filename"])
