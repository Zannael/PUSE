import glob
import json
from typing import List
from pathlib import Path
import base64
import io
import zipfile

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
from tools import rtc_repair_from_pair as rtc_repair
from tools import rtc_patch


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
        "mons": [],
        "fallback_box_starts": {},
        "fallback_slot_offsets": {},
        "absolute_touched_sectors": []
    }
}


@app.post("/rtc/repair-candidates")
async def rtc_repair_candidates(broken: UploadFile = File(...), fixed: UploadFile = File(...)):
    broken_bytes = await broken.read()
    fixed_bytes = await fixed.read()

    if not broken_bytes or not fixed_bytes:
        raise HTTPException(status_code=400, detail="Both broken and fixed save files are required")
    if len(broken_bytes) != len(fixed_bytes):
        raise HTTPException(status_code=400, detail="Save files must have the same size")

    full_manifest = rtc_patch.build_manifest(broken_bytes, fixed_bytes)
    candidates = rtc_repair.build_candidates_from_pair(
        broken_bytes,
        fixed_bytes,
        full_manifest,
        rtc_repair.DEFAULT_PROFILES,
    )

    zip_buffer = io.BytesIO()
    base_name = Path(broken.filename or "save").stem

    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        manifest_json = json.dumps(full_manifest, indent=2).encode("utf-8")
        zf.writestr(f"{base_name}_rtc_manifest.json", manifest_json)

        summary = {
            "recommended_profile": "id0_id4_full",
            "fallback_order": rtc_repair.DEFAULT_PROFILES,
            "notes": "Test candidates in order and stop at first valid non-tampered save",
        }
        zf.writestr(f"{base_name}_rtc_summary.json", json.dumps(summary, indent=2).encode("utf-8"))

        for profile in rtc_repair.DEFAULT_PROFILES:
            entry = candidates[profile]
            out_name = f"{base_name}_rtc_{profile}.sav"
            zf.writestr(out_name, entry["bytes"])

    zip_buffer.seek(0)
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={base_name}_rtc_repair_pack.zip"},
    )


@app.post("/rtc/quick-fix")
async def rtc_quick_fix(file: UploadFile = File(...)):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Save file is required")
    if len(raw) < 0x20000:
        raise HTTPException(status_code=400, detail="Save file is too small")

    manifest_path = Path(__file__).with_name("data").joinpath("rtc_manifest_unbound_v1.json")
    if not manifest_path.exists():
        raise HTTPException(status_code=500, detail="RTC quick-fix manifest missing")

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        result = rtc_repair.build_quick_candidates_from_single(raw, manifest)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Quick fix failed: {e}")

    zip_buffer = io.BytesIO()
    base_name = Path(file.filename or "save").stem

    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        summary = {
            "recommended": "quick_id0_id4",
            "fallback_order": ["quick_id0_id4", "quick_id0_id4_id13", "quick_id0_id4_id13_aux12"],
            "source_idx": result["source_idx"],
            "target_idx": result["target_idx"],
            "warning": "Use only when you are sure the issue is RTC tampering",
        }
        zf.writestr(f"{base_name}_rtc_quick_summary.json", json.dumps(summary, indent=2).encode("utf-8"))
        for profile_name, payload in result["candidates"].items():
            zf.writestr(f"{base_name}_{profile_name}.sav", payload)

    zip_buffer.seek(0)
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={base_name}_rtc_quick_fix_pack.zip"},
    )

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
species_form_meta: dict[int, dict] = {}
species_form_aliases: dict[int, dict] = {}
species_id_tokens: dict[int, str] = {}

SPECIAL_SPRITE_BY_TOKEN = {
    "FLAPPLE_GIGA": "gFrontSpriteGigaFlappletun.png",
    "APPLETUN_GIGA": "gFrontSpriteGigaFlappletun.png",
    "TOXTRICITY_LOW_KEY_GIGA": "gFrontSpriteGigaToxtricity.png",
}


def _load_species_form_aliases() -> dict[int, dict]:
    path = os.path.join(BASE_DIR, "data", "species_form_aliases.json")
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.loads(fh.read())
    except Exception:
        return {}

    out: dict[int, dict] = {}
    if isinstance(raw, dict):
        for sid, meta in raw.items():
            if not str(sid).isdigit() or not isinstance(meta, dict):
                continue
            out[int(sid)] = meta
    return out


def _load_species_id_tokens() -> dict[int, str]:
    path = os.path.join(BASE_DIR, "data", "species_id.txt")
    if not os.path.exists(path):
        return {}

    out: dict[int, str] = {}
    with open(path, "r", encoding="utf-8", errors="ignore") as fh:
        for raw in fh:
            line = raw.strip()
            if not line.startswith("SPECIES_"):
                continue
            parts = line.split()
            token = parts[0][len("SPECIES_"):]
            sid = None
            for part in parts[1:]:
                if part.lower().startswith("0x"):
                    try:
                        sid = int(part, 16)
                    except ValueError:
                        sid = None
                    break
            if sid is not None:
                out[int(sid)] = token
    return out


def _to_pascal_from_token(token: str) -> str:
    pieces = [p for p in str(token).split("_") if p]
    return "".join(p[:1].upper() + p[1:].lower() for p in pieces)


def _sprite_candidates_from_token(token: str | None) -> list[str]:
    if not token:
        return []
    if token in SPECIAL_SPRITE_BY_TOKEN:
        return [SPECIAL_SPRITE_BY_TOKEN[token]]
    if token.endswith("_GIGA"):
        base = token[: -len("_GIGA")]
        return [f"gFrontSpriteGiga{_to_pascal_from_token(base)}.png"]
    return []


def _build_species_form_meta(species_db: dict[int, str], alias_map: dict[int, dict] | None = None) -> dict[int, dict]:
    by_name: dict[str, list[int]] = {}
    for sid, name in species_db.items():
        key = (name or "").strip().lower()
        if not key:
            continue
        by_name.setdefault(key, []).append(sid)

    for ids in by_name.values():
        ids.sort()

    out: dict[int, dict] = {}
    for sid, name in species_db.items():
        key = (name or "").strip().lower()
        ids = by_name.get(key, [sid])
        variant_count = len(ids)
        variant_index = max(1, ids.index(sid) + 1) if sid in ids else 1
        is_form_variant = variant_count > 1
        display_name = name or "Unknown"
        alias_label = None
        if alias_map:
            alias_meta = alias_map.get(int(sid), {})
            if isinstance(alias_meta, dict) and alias_meta.get("confidence") == "high":
                alias_value = alias_meta.get("alias")
                if alias_value:
                    alias_label = f"{display_name} ({alias_value})"

        if alias_label:
            label = alias_label
        else:
            label = f"{display_name} (Form {variant_index})" if is_form_variant else display_name
        out[sid] = {
            "species_display_name": display_name,
            "species_label": label,
            "species_variant_index": variant_index,
            "species_variant_count": variant_count,
            "is_form_variant": is_form_variant,
        }
    return out


def _species_meta(sid: int) -> dict:
    meta = species_form_meta.get(int(sid))
    if meta:
        return meta
    fallback_name = party_mod.DB_SPECIES.get(int(sid), "Unknown")
    return {
        "species_display_name": fallback_name,
        "species_label": fallback_name,
        "species_variant_index": 1,
        "species_variant_count": 1,
        "is_form_variant": False,
    }


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

    # 4. Token-based fallback (non-numeric sprite naming, e.g. Giga forms)
    token = species_id_tokens.get(species_id)
    candidates = _sprite_candidates_from_token(token)
    if candidates:
        for folder in search_dirs:
            if not os.path.exists(folder):
                continue
            for filename in candidates:
                probe = os.path.join(folder, filename)
                if os.path.exists(probe):
                    icon_cache[species_id] = probe
                    return FileResponse(probe)

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

    species_form_aliases.clear()
    species_form_aliases.update(_load_species_form_aliases())

    species_id_tokens.clear()
    species_id_tokens.update(_load_species_id_tokens())

    species_form_meta.clear()
    species_form_meta.update(_build_species_form_meta(party_mod.DB_SPECIES, species_form_aliases))

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
    """Load the .sav or .srm file into memory."""
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
        clamped_amount = money_mod.clamp_money(amount)
        # Reuse patch_money_everywhere; it already handles checksums and BCD
        new_data = money_mod.patch_money_everywhere(current_save["data"], clamped_amount)
        current_save["data"] = bytearray(new_data)
        return {
            "message": f"Money updated to {clamped_amount}",
            "new_money": clamped_amount,
            "requested_money": amount,
            "was_clamped": clamped_amount != amount,
        }
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


class IdentityUpdate(BaseModel):
    shiny: bool | None = None
    gender: str | None = None


class AbilityUpdate(BaseModel):
    hidden: bool

class AbilitySwitch(BaseModel):
    ability_index: int  # 0: Slot1, 1: Slot2, 2: HA


class ItemUpdate(BaseModel):
    item_id: int


class SpeciesUpdate(BaseModel):
    species_id: int


class NicknameUpdate(BaseModel):
    nickname: str


def _assert_species_unchanged(pk, expected_species_id: int, op_label: str):
    current_species_id = pk.get_species_id()
    if current_species_id != expected_species_id:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Safety check failed during {op_label}: species changed unexpectedly "
                f"from {expected_species_id} to {current_species_id}."
            ),
        )


def _resolve_current_ability(current_index: int, ability_1_id, ability_1_name, ability_2_id, ability_2_name, ability_hidden_id, ability_hidden_name):
    effective_id = None
    effective_name = None
    label = "Unknown Ability"

    if current_index == 0:
        effective_id = ability_1_id if ability_1_id not in (None, 0) else ability_2_id
        effective_name = ability_1_name if ability_1_name else ability_2_name
        label = effective_name or "Slot 1 (Standard)"
    elif current_index == 1:
        effective_id = ability_2_id if ability_2_id not in (None, 0) else ability_1_id
        effective_name = ability_2_name if ability_2_name else ability_1_name
        label = effective_name or "Slot 2 (Standard)"
    elif current_index == 2:
        effective_id = ability_hidden_id if ability_hidden_id not in (None, 0) else None
        effective_name = ability_hidden_name
        label = effective_name or "Hidden Ability"

    return effective_id, effective_name, label


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


def _infer_default_owner_template() -> dict:
    counts: dict[tuple, int] = {}
    order: dict[tuple, int] = {}

    def add_owner(otid_value, name_value, misc_1=0, misc_2=0):
        try:
            otid = int(otid_value) & 0xFFFFFFFF
        except Exception:
            return
        name = str(name_value or "").strip()
        if otid == 0 or not name:
            return
        key = (otid, name, int(misc_1) & 0xFF, int(misc_2) & 0xFF)
        if key not in order:
            order[key] = len(order)
        counts[key] = counts.get(key, 0) + 1

    trainer_off = get_active_trainer_offset()
    if trainer_off is not None and current_save.get("data"):
        sec_data = current_save["data"][trainer_off: trainer_off + party_mod.SECTION_SIZE]
        team_count = min(6, int(party_mod.ru32(sec_data, 0x34)))
        for idx in range(team_count):
            mon_off = 0x38 + (idx * 100)
            raw = sec_data[mon_off: mon_off + 100]
            if len(raw) < 100:
                continue
            try:
                p = party_mod.Pokemon(raw)
                owner_name = box_mod.decode_text(raw[0x14:0x14 + 7])
                owner_misc_1 = int(raw[0x12])
                owner_misc_2 = int(raw[0x13])
                add_owner(p.otid, owner_name, owner_misc_1, owner_misc_2)
            except Exception:
                continue

    for mon in current_save.get("pc_context", {}).get("mons", []):
        try:
            owner_misc_1, owner_misc_2 = mon.get_owner_misc()
            add_owner(mon.get_otid(), mon.get_owner_name(), owner_misc_1, owner_misc_2)
        except Exception:
            continue

    if not counts:
        return {
            "otid": 0,
            "ot_name": "",
            "ot_misc_1": 0,
            "ot_misc_2": 0,
        }

    best_key = max(counts.items(), key=lambda kv: (kv[1], -order.get(kv[0], 10**9)))[0]
    return {
        "otid": int(best_key[0]),
        "ot_name": str(best_key[1]),
        "ot_misc_1": int(best_key[2]),
        "ot_misc_2": int(best_key[3]),
    }


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
        smeta = _species_meta(pk.get_species_id())
        ability_1_id, ability_2_id, ability_hidden_id = party_mod.get_species_ability_ids(pk.get_species_id())
        ability_1_name = party_mod.get_ability_name(ability_1_id)
        ability_2_name = party_mod.get_ability_name(ability_2_id)
        ability_hidden_name = party_mod.get_ability_name(ability_hidden_id)
        current_ability_index = 2 if pk.get_hidden_ability_flag() else pk.get_standard_ability_slot()
        effective_ability_id, ability_name_current, ability_label_current = _resolve_current_ability(
            current_ability_index,
            ability_1_id,
            ability_1_name,
            ability_2_id,
            ability_2_name,
            ability_hidden_id,
            ability_hidden_name,
        )

        party.append({
            "index": i,
            "nickname": pk.nickname,
            "species_name": smeta["species_label"],
            "species_display_name": smeta["species_display_name"],
            "species_label": smeta["species_label"],
            "species_variant_index": smeta["species_variant_index"],
            "species_variant_count": smeta["species_variant_count"],
            "is_form_variant": smeta["is_form_variant"],
            "level": sec_data[mon_off + 0x54],
            "exp": pk.get_exp(),
            "nature": pk.get_nature_name(),
            "nature_id": pk.get_nature_id(),
            "pid": pk.pid,
            "is_shiny": pk.is_shiny(),
            "gender": pk.get_gender(),
            "gender_mode": pk.get_gender_mode(),
            "gender_editable": pk.get_gender_mode() == "dynamic",
            "is_hidden_ability": bool(pk.get_hidden_ability_flag()),
            "ivs": pk.get_ivs(),
            "evs": pk.get_evs(),
            "species_id": pk.get_species_id(),
            "species_growth_rate": party_mod.get_species_growth_rate(pk.get_species_id()),
            "moves": pk.get_moves_ids(),
            "move_pp": pk.get_move_pp(),
            "move_pp_ups": pk.get_move_pp_ups(),
            "move_pp_max": pk.get_move_pp_max(),
            "ability_slot": pk.get_standard_ability_slot(),  # 0 or 1
            "current_ability_index": current_ability_index,
            "ability_1_id": ability_1_id,
            "ability_1_name": ability_1_name,
            "ability_2_id": ability_2_id,
            "ability_2_name": ability_2_name,
            "ability_hidden_id": ability_hidden_id,
            "ability_hidden_name": ability_hidden_name,
            "effective_ability_id": effective_ability_id,
            "effective_ability_name": ability_name_current,
            "ability_name_current": ability_name_current,
            "ability_label_current": ability_label_current,
            "item_id": pk.get_item_id(),
        })
    return party


@app.post("/party/{idx}/item")
async def update_party_item(idx: int, data: ItemUpdate):
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])
    species_before = pk.get_species_id()

    pk.set_item(data.item_id)
    _assert_species_unchanged(pk, species_before, "party item update")

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "Item updated"}


@app.post("/party/{idx}/nickname")
async def update_party_nickname(idx: int, data: NicknameUpdate):
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])
    species_before = pk.get_species_id()

    pk.set_nickname(data.nickname)
    _assert_species_unchanged(pk, species_before, "party nickname update")

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "Nickname updated", "nickname": pk.nickname}


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
    species_before = pk.get_species_id()

    pk.set_ability_slot(data.ability_index)
    _assert_species_unchanged(pk, species_before, "party ability switch")

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
    species_before = pk.get_species_id()

    # Apply new IVs (mapping frontend keys to backend keys)
    new_ivs = {
        'HP': stats.hp, 'Atk': stats.atk, 'Def': stats.dfe,
        'Spd': stats.spe, 'SpA': stats.spa, 'SpD': stats.spd
    }
    pk.set_ivs(new_ivs)
    pk.recalculate_party_stats(clamp_hp=True)
    _assert_species_unchanged(pk, species_before, "party IV update")

    # Pack and write back to local buffer
    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "IVs updated in memory"}


@app.post("/party/{idx}/nature")
async def update_nature(idx: int, data: NatureUpdate):
    """Update nature and recalculate PID."""
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)

    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])
    species_before = pk.get_species_id()
    pk.set_nature(data.nature_id)
    pk.recalculate_party_stats(clamp_hp=True)
    _assert_species_unchanged(pk, species_before, "party nature update")

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": f"Nature changed to {party_mod.DB_NATURES.get(data.nature_id)}"}


@app.post("/party/{idx}/identity")
async def update_identity(idx: int, data: IdentityUpdate):
    off = get_active_trainer_offset()
    if off is None:
        raise HTTPException(status_code=404, detail="Invalid save file")
    mon_off = off + 0x38 + (idx * 100)

    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])
    species_before = pk.get_species_id()

    try:
        pk.set_identity(shiny=data.shiny, gender=data.gender)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    pk.recalculate_party_stats(clamp_hp=True)
    _assert_species_unchanged(pk, species_before, "party identity update")

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {
        "status": "Identity updated",
        "pid": pk.pid,
        "is_shiny": pk.is_shiny(),
        "gender": pk.get_gender(),
        "gender_mode": pk.get_gender_mode(),
    }


@app.post("/party/{idx}/level")
async def update_party_level(idx: int, data: PartyLevelUpdate):
    off = get_active_trainer_offset()
    if off is None:
        raise HTTPException(status_code=404, detail="Invalid save file")

    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])
    species_before = pk.get_species_id()

    requested_level = int(data.target_level)
    target_level = max(1, min(100, requested_level))
    visual_level = current_save["data"][mon_off + 0x54]
    current_exp = pk.get_exp()

    if data.growth_rate is not None:
        if data.growth_rate < 0 or data.growth_rate > 5:
            raise HTTPException(status_code=400, detail="growth_rate must be between 0 and 5")
        growth_rate, confidence = data.growth_rate, "manual"
    else:
        species_growth = party_mod.get_species_growth_rate(pk.get_species_id())
        if species_growth is not None:
            growth_rate, confidence = species_growth, "species"
        else:
            growth_rate, confidence = party_mod.guess_growth_rate(current_exp, visual_level)

    new_exp = party_mod.get_exp_at_level(growth_rate, target_level)
    pk.set_exp(new_exp)
    pk.set_visual_level(target_level)
    pk.recalculate_party_stats(clamp_hp=True)
    _assert_species_unchanged(pk, species_before, "party level update")

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {
        "status": "Level updated",
        "requested_level": requested_level,
        "target_level": target_level,
        "was_clamped": requested_level != target_level,
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
    rows = []
    for k, v in party_mod.DB_SPECIES.items():
        if k == 0:
            continue
        smeta = _species_meta(k)
        rows.append(
            {
                "id": k,
                "name": v,
                "label": smeta["species_label"],
                "display_name": smeta["species_display_name"],
                "variant_index": smeta["species_variant_index"],
                "variant_count": smeta["species_variant_count"],
                "is_form_variant": smeta["is_form_variant"],
            }
        )
    rows.sort(key=lambda x: x["id"])
    return rows


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
        "mons": [],
        "fallback_box_starts": {},
        "fallback_slot_offsets": {},
        "absolute_touched_sectors": []
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

    # Load known fallback fragmented boxes only when missing in normal stream.
    box_counts = {}
    for mon in current_save["pc_context"]["mons"]:
        box_counts[mon.box] = box_counts.get(mon.box, 0) + 1

    fallback_starts = box_mod.detect_fallback_box_starts(current_save["data"])
    current_save["pc_context"]["fallback_box_starts"] = dict(fallback_starts)
    current_save["pc_context"]["fallback_slot_offsets"] = box_mod.build_fallback_slot_offsets(
        current_save["data"],
        box_ids=sorted(fallback_starts.keys()),
    )

    for box_id in sorted(fallback_starts.keys()):
        if box_counts.get(box_id, 0) > 0:
            continue
        slot_offsets = current_save["pc_context"].get("fallback_slot_offsets", {}).get(int(box_id), {})
        for slot in range(1, 31):
            abs_off = slot_offsets.get(int(slot))
            if abs_off is None:
                continue
            raw = current_save["data"][abs_off: abs_off + box_mod.MON_SIZE_PC]
            mon = box_mod.UnboundPCMon(raw, box_id, slot)
            if mon.is_valid:
                mon.buffer_offset = abs_off
                mon.buffer_kind = "absolute"
                current_save["pc_context"]["mons"].append(mon)

    return {"count": len(current_save["pc_context"]["mons"]), "message": "PC loaded"}


@app.get("/pc/box/{box_id}")
async def get_box(box_id: int):
    """Return all Pokemon in a box with edit-ready data."""
    # Filter loaded Pokemon in context by selected box
    mons = [m for m in current_save["pc_context"]["mons"] if m.box == box_id]

    out = []
    for m in mons:
        smeta = _species_meta(m.species_id)
        ability_1_id, ability_2_id, ability_hidden_id = box_mod.get_species_ability_ids(m.species_id)
        ability_1_name = box_mod.get_ability_name(ability_1_id)
        ability_2_name = box_mod.get_ability_name(ability_2_id)
        ability_hidden_name = box_mod.get_ability_name(ability_hidden_id)
        current_ability_index = 2 if m.get_hidden_ability_flag() else (m.get_pid() & 1)
        effective_ability_id, ability_name_current, ability_label_current = _resolve_current_ability(
            current_ability_index,
            ability_1_id,
            ability_1_name,
            ability_2_id,
            ability_2_name,
            ability_hidden_id,
            ability_hidden_name,
        )

        out.append({
            "species_name": smeta["species_label"],
            "species_display_name": smeta["species_display_name"],
            "species_label": smeta["species_label"],
            "species_variant_index": smeta["species_variant_index"],
            "species_variant_count": smeta["species_variant_count"],
            "is_form_variant": smeta["is_form_variant"],
            "box": m.box,
            "slot": m.slot,
            "nickname": m.nickname,
            "species_id": m.species_id,
            "species_growth_rate": box_mod.get_species_growth_rate(m.species_id),
            "item_id": m.get_item_id(),
            "exp": m.exp,
            "nature_id": m.get_nature_id(),
            "pid": m.get_pid(),
            "is_shiny": m.is_shiny(),
            "gender": m.get_gender(),
            "gender_mode": m.get_gender_mode(),
            "gender_editable": m.get_gender_mode() == "dynamic",
            "ivs": m.get_ivs(),
            "evs": m.get_evs(),
            "moves": m.get_moves(),
            "move_pp": m.get_move_pp(),
            "move_pp_ups": m.get_move_pp_ups(),
            "move_pp_max": m.get_move_pp_max(),
            "current_ability_index": current_ability_index,
            "ability_1_id": ability_1_id,
            "ability_1_name": ability_1_name,
            "ability_2_id": ability_2_id,
            "ability_2_name": ability_2_name,
            "ability_hidden_id": ability_hidden_id,
            "ability_hidden_name": ability_hidden_name,
            "effective_ability_id": effective_ability_id,
            "effective_ability_name": ability_name_current,
            "ability_name_current": ability_name_current,
            "ability_label_current": ability_label_current,
        })
    return out


class PCUpdate(BaseModel):
    box: int
    slot: int
    moves: List[int] = None
    move_pp: List[int] = None
    move_pp_ups: List[int] = None
    item_id: int = None


@app.post("/pc/edit")
async def edit_pc_mon(upd: PCUpdate):
    # Find target Pokemon in global state
    target = next((m for m in current_save["pc_context"]["mons"]
                   if m.box == upd.box and m.slot == upd.slot), None)

    if not target:
        raise HTTPException(status_code=404, detail="Pokemon not found")

    species_before = target.species_id

    # Apply object updates
    if upd.moves is not None:
        target.set_moves(upd.moves, move_pp=upd.move_pp, move_pp_ups=upd.move_pp_ups)
    elif upd.move_pp_ups is not None:
        target.set_move_pp_ups(upd.move_pp_ups)
    if upd.item_id is not None: target.set_item_id(upd.item_id)

    if target.species_id != species_before:
        raise HTTPException(
            status_code=400,
            detail=f"Safety check failed during PC edit: species changed unexpectedly from {species_before} to {target.species_id}.",
        )

    # Reflect updates in the corresponding buffer
    if target.box == 26:
        buf = current_save["pc_context"]["preset_buffer"]
        off = target.buffer_offset
    elif getattr(target, "buffer_kind", None) == "absolute":
        off = target.buffer_offset
        current_save["data"][off: off + box_mod.MON_SIZE_PC] = target.raw
        sector_off = (off // box_mod.SECTION_SIZE) * box_mod.SECTION_SIZE
        touched = set(current_save["pc_context"].get("absolute_touched_sectors", []))
        touched.add(sector_off)
        current_save["pc_context"]["absolute_touched_sectors"] = sorted(touched)
        return {"status": "Update saved to temporary buffer"}
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
    move_pp: List[int] | None = None
    move_pp_ups: List[int] | None = None


class ItemUpdate(BaseModel):
    item_id: int


# --- Additional party endpoints ---

@app.post("/party/{idx}/evs")
async def update_evs(idx: int, stats: EvUpdate):
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])
    species_before = pk.get_species_id()

    new_evs = {
        'HP': stats.hp, 'Atk': stats.atk, 'Def': stats.dfe,
        'Spd': stats.spe, 'SpA': stats.spa, 'SpD': stats.spd
    }
    pk.set_evs(new_evs)
    pk.recalculate_party_stats(clamp_hp=True)
    _assert_species_unchanged(pk, species_before, "party EV update")
    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "EVs updated"}


@app.post("/party/{idx}/ability")
async def update_ability(idx: int, data: AbilityUpdate):
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])
    species_before = pk.get_species_id()

    # In Unbound, the HA flag is handled inside the IVs/Ability byte
    pk.set_hidden_ability_flag(1 if data.is_hidden else 0)
    _assert_species_unchanged(pk, species_before, "party ability flag update")

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "Ability updated"}


@app.post("/party/{idx}/moves")
async def update_party_moves(idx: int, data: MovesUpdate):
    off = get_active_trainer_offset()
    mon_off = off + 0x38 + (idx * 100)
    pk = party_mod.Pokemon(current_save["data"][mon_off: mon_off + 100])
    species_before = pk.get_species_id()

    for move_id in data.moves:
        mv = int(move_id)
        if mv < 0 or mv > 1023:
            raise HTTPException(status_code=400, detail="Invalid move_id in moves payload")

    pk.set_moves(data.moves, move_pp=data.move_pp, move_pp_ups=data.move_pp_ups)
    _assert_species_unchanged(pk, species_before, "party moves update")

    current_save["data"][mon_off: mon_off + 100] = pk.pack_data()
    return {"status": "Moves updated"}


@app.get("/moves")
async def get_all_moves():
    """Return move list for dropdown."""
    out = []
    for move_id, name in box_mod.DB_MOVES.items():
        out.append({
            "id": move_id,
            "name": name,
            "base_pp": box_mod.get_move_base_pp(move_id),
        })
    return out


@app.get("/abilities")
async def get_all_abilities():
    """Return ability list for dropdown/catalog usage."""
    return [{"id": k, "name": v} for k, v in sorted(party_mod.DB_ABILITIES.items(), key=lambda x: x[0])]


# Model for full PC update payload
class PCFullUpdate(BaseModel):
    box: int
    slot: int
    nickname: str = None
    moves: List[int] = None
    move_pp: List[int] = None
    move_pp_ups: List[int] = None
    item_id: int = None
    species_id: int = None
    ivs: dict = None
    evs: dict = None
    nature_id: int = None
    exp: int = None
    shiny: bool = None
    gender: str = None
    current_ability_index: int = None


class PCInsert(BaseModel):
    box: int
    slot: int = None
    species_id: int
    nickname: str = None
    level: int = 5
    exp: int = None
    item_id: int = 0
    moves: List[int] = None
    ivs: dict = None
    evs: dict = None
    nature_id: int = None
    shiny: bool = None
    gender: str = None
    current_ability_index: int = 0


@app.post("/pc/edit-full")
async def edit_pc_mon_full(upd: PCFullUpdate):
    # Find pokemon in loaded context
    target = next((m for m in current_save["pc_context"]["mons"]
                   if m.box == upd.box and m.slot == upd.slot), None)

    if not target:
        raise HTTPException(status_code=404, detail="Pokemon not found in PC")

    species_before = target.species_id

    # Apply updates using UnboundPCMon methods (v16)
    if upd.nickname is not None: target.set_nickname(upd.nickname)
    if upd.moves is not None:
        target.set_moves(upd.moves, move_pp=upd.move_pp, move_pp_ups=upd.move_pp_ups)
    elif upd.move_pp_ups is not None:
        target.set_move_pp_ups(upd.move_pp_ups)
    if upd.item_id is not None: target.set_item_id(upd.item_id)
    if upd.species_id is not None:
        if upd.species_id <= 0 or upd.species_id not in box_mod.DB_SPECIES:
            raise HTTPException(status_code=400, detail="Invalid species_id")
        target.set_species_id(upd.species_id)
    if upd.ivs: target.set_ivs(upd.ivs)
    if upd.evs: target.set_evs(upd.evs)
    if upd.current_ability_index is not None:
        try:
            target.set_ability_slot(upd.current_ability_index)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    if upd.nature_id is not None: target.set_nature(upd.nature_id)
    if upd.shiny is not None or upd.gender is not None:
        try:
            target.set_identity(shiny=upd.shiny, gender=upd.gender)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    if upd.exp is not None: target.set_exp(upd.exp)

    if upd.species_id is None and target.species_id != species_before:
        raise HTTPException(
            status_code=400,
            detail=f"Safety check failed during PC full edit: species changed unexpectedly from {species_before} to {target.species_id}.",
        )

    # Sync buffer (stream 1-25 or preset 26)
    if target.box == 26:
        buf = current_save["pc_context"]["preset_buffer"]
        off = target.buffer_offset
    elif getattr(target, "buffer_kind", None) == "absolute":
        off = target.buffer_offset
        current_save["data"][off: off + box_mod.MON_SIZE_PC] = target.raw
        sector_off = (off // box_mod.SECTION_SIZE) * box_mod.SECTION_SIZE
        touched = set(current_save["pc_context"].get("absolute_touched_sectors", []))
        touched.add(sector_off)
        current_save["pc_context"]["absolute_touched_sectors"] = sorted(touched)
        return {"status": "PC updates applied to buffer"}
    else:
        buf = current_save["pc_context"]["pc_buffer"]
        # Compute linear stream offset
        off = ((target.box - 1) * 30 + (target.slot - 1)) * box_mod.MON_SIZE_PC

    buf[off: off + box_mod.MON_SIZE_PC] = target.raw
    return {"status": "PC updates applied to buffer"}


@app.post("/pc/insert")
async def insert_pc_mon(upd: PCInsert):
    if not current_save["data"]:
        raise HTTPException(status_code=400, detail="Upload a .sav file")

    if current_save["pc_context"].get("pc_buffer") is None:
        await load_pc()

    box = int(upd.box)
    if box < 1 or box > 26:
        raise HTTPException(status_code=400, detail="Invalid box")

    occupied = {int(m.slot) for m in current_save["pc_context"].get("mons", []) if int(m.box) == box}

    slot = upd.slot
    if slot is not None:
        slot = int(slot)
        if slot < 1 or slot > 30:
            raise HTTPException(status_code=400, detail="Invalid slot")
        if slot in occupied:
            raise HTTPException(status_code=400, detail="Target slot is occupied")
    else:
        slot = next((s for s in range(1, 31) if s not in occupied), None)
        if slot is None:
            raise HTTPException(status_code=400, detail="Box is full")

    kind = "stream"
    off = None
    if box == 26:
        kind = "preset"
        off = box_mod.OFFSET_PRESET_START + ((slot - 1) * box_mod.MON_SIZE_PC)
        if off + box_mod.MON_SIZE_PC > len(current_save["pc_context"]["preset_buffer"]):
            raise HTTPException(status_code=400, detail="Invalid preset slot")
    else:
        stream_off = ((box - 1) * 30 + (slot - 1)) * box_mod.MON_SIZE_PC
        pc_buf = current_save["pc_context"]["pc_buffer"]
        if stream_off + box_mod.MON_SIZE_PC <= len(pc_buf):
            off = stream_off
        else:
            has_fallback = bool(current_save["pc_context"].get("fallback_box_starts", {}).get(box))
            slot_offsets = current_save["pc_context"].get("fallback_slot_offsets", {}).get(int(box), {})
            abs_off = slot_offsets.get(int(slot)) if has_fallback else None
            if abs_off is None or abs_off + box_mod.MON_SIZE_PC > len(current_save["data"]):
                raise HTTPException(status_code=400, detail="Slot not writable in this save layout")
            kind = "absolute"
            off = abs_off

    try:
        inferred_owner = _infer_default_owner_template()
        raw = box_mod.build_pc_mon_raw(
            species_id=upd.species_id,
            nickname=upd.nickname,
            level=upd.level,
            exp=upd.exp,
            nature_id=upd.nature_id,
            item_id=upd.item_id,
            moves=upd.moves,
            ivs=upd.ivs,
            evs=upd.evs,
            current_ability_index=upd.current_ability_index,
            shiny=upd.shiny,
            gender=upd.gender,
            otid=inferred_owner.get("otid"),
            ot_name=inferred_owner.get("ot_name"),
            ot_misc_1=inferred_owner.get("ot_misc_1"),
            ot_misc_2=inferred_owner.get("ot_misc_2"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    mon = box_mod.UnboundPCMon(raw, box, slot)
    if not mon.is_valid:
        raise HTTPException(status_code=400, detail="Failed to build a valid Pokemon")

    mon.buffer_offset = off
    if kind == "preset":
        current_save["pc_context"]["preset_buffer"][off: off + box_mod.MON_SIZE_PC] = mon.raw
    elif kind == "absolute":
        mon.buffer_kind = "absolute"
        current_save["data"][off: off + box_mod.MON_SIZE_PC] = mon.raw
        sector_off = (off // box_mod.SECTION_SIZE) * box_mod.SECTION_SIZE
        touched = set(current_save["pc_context"].get("absolute_touched_sectors", []))
        touched.add(sector_off)
        current_save["pc_context"]["absolute_touched_sectors"] = sorted(touched)
    else:
        current_save["pc_context"]["pc_buffer"][off: off + box_mod.MON_SIZE_PC] = mon.raw

    current_save["pc_context"]["mons"].append(mon)

    smeta = _species_meta(mon.species_id)
    ability_1_id, ability_2_id, ability_hidden_id = box_mod.get_species_ability_ids(mon.species_id)
    ability_1_name = box_mod.get_ability_name(ability_1_id)
    ability_2_name = box_mod.get_ability_name(ability_2_id)
    ability_hidden_name = box_mod.get_ability_name(ability_hidden_id)
    current_ability_index = 2 if mon.get_hidden_ability_flag() else (mon.get_pid() & 1)
    effective_ability_id, ability_name_current, ability_label_current = _resolve_current_ability(
        current_ability_index,
        ability_1_id,
        ability_1_name,
        ability_2_id,
        ability_2_name,
        ability_hidden_id,
        ability_hidden_name,
    )

    return {
        "status": "Pokemon inserted into PC buffer",
        "pokemon": {
            "species_name": smeta["species_label"],
            "species_display_name": smeta["species_display_name"],
            "species_label": smeta["species_label"],
            "species_variant_index": smeta["species_variant_index"],
            "species_variant_count": smeta["species_variant_count"],
            "is_form_variant": smeta["is_form_variant"],
            "box": mon.box,
            "slot": mon.slot,
            "nickname": mon.nickname,
            "species_id": mon.species_id,
            "species_growth_rate": box_mod.get_species_growth_rate(mon.species_id),
            "item_id": mon.get_item_id(),
            "exp": mon.exp,
            "nature_id": mon.get_nature_id(),
            "pid": mon.get_pid(),
            "is_shiny": mon.is_shiny(),
            "gender": mon.get_gender(),
            "gender_mode": mon.get_gender_mode(),
            "gender_editable": mon.get_gender_mode() == "dynamic",
            "ivs": mon.get_ivs(),
            "evs": mon.get_evs(),
            "moves": mon.get_moves(),
            "move_pp": mon.get_move_pp(),
            "move_pp_ups": mon.get_move_pp_ups(),
            "move_pp_max": mon.get_move_pp_max(),
            "current_ability_index": current_ability_index,
            "ability_1_id": ability_1_id,
            "ability_1_name": ability_1_name,
            "ability_2_id": ability_2_id,
            "ability_2_name": ability_2_name,
            "ability_hidden_id": ability_hidden_id,
            "ability_hidden_name": ability_hidden_name,
            "effective_ability_id": effective_ability_id,
            "effective_ability_name": ability_name_current,
            "ability_name_current": ability_name_current,
            "ability_label_current": ability_label_current,
        }
    }


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
        # Sector 13 is the main items sector (fixed 0x450).
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

    # 4. Recalculate checksums for any absolute-sector PC edits.
    for sec_off in ctx.get("absolute_touched_sectors", []):
        if sec_off < 0 or sec_off + 0x1000 > len(current_save["data"]):
            continue
        sec_id = party_mod.ru16(current_save["data"], sec_off + 0xFF4)
        if sec_id == 0:
            chk_data = current_save["data"][sec_off: sec_off + 0xADC]
            new_chk = bag_mod.gba_checksum(chk_data)
            party_mod.wu16(current_save["data"], sec_off + 0xFF6, new_chk)
        else:
            chk_data = current_save["data"][sec_off: sec_off + 0xFF4]
            new_chk = bag_mod.gba_checksum(chk_data)
            party_mod.wu16(current_save["data"], sec_off + 0xFF6, new_chk)

    with open(SAVE_FILE_NAME, "wb") as f:
        f.write(current_save["data"])

    return {"message": "Save completed and checksums recalculated!"}

@app.get("/download")
async def download_save():
    if not os.path.exists(SAVE_FILE_NAME):
        raise HTTPException(status_code=400, detail="File not generated yet")

    return FileResponse(SAVE_FILE_NAME, filename=current_save["filename"])
