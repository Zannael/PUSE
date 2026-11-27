"""Atomic Party <-> PC transfer and 100-byte <-> 58-byte record conversion."""
import struct

from core import sections as sections_mod
from core.profile import get_profile, require_capability
from modules import party as party_mod
from modules import pc as pc_mod

PARTY_MON_SIZE = 100
PC_MON_SIZE = 58
_VALID_MODES = ("party_to_pc", "pc_to_party", "swap_party_pc")


def _ensure_static_data():
    if not party_mod.DB_SPECIES_BASE_STATS and not party_mod.DB_MOVE_BASE_PP:
        party_mod.load_static_data()


def _parse_int(value, label: str) -> int:
    if isinstance(value, bool) or value is None:
        raise ValueError(f"Invalid {label}")
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid {label}") from exc


def _is_valid_pc_record(pc_raw: bytes, profile) -> bool:
    fields = profile["codecs"]["pc"]["fields"]
    val = profile["codecs"]["pc"]["legacy_validation"]
    species_id = struct.unpack_from("<H", pc_raw, int(fields["species"]))[0]
    exp = struct.unpack_from("<I", pc_raw, int(fields["exp"]))[0]
    return (
        species_id != 0
        and species_id <= int(val["max_species_id"])
        and int(val["min_exp"]) <= exp <= int(val["max_exp"])
    )


def party_raw_to_pc_raw(party_raw: bytes | bytearray | memoryview) -> bytearray:
    """Convert a 100-byte plain Party Pokemon record to a 58-byte compact PC record."""
    if party_raw is None or len(party_raw) != PARTY_MON_SIZE:
        raise ValueError("Invalid party record width")

    raw = bytearray(PC_MON_SIZE)
    raw[0x00:0x1C] = party_raw[0x00:0x1C]
    raw[0x1C:0x27] = party_raw[0x20:0x2B]

    packed_moves = 0
    for i in range(4):
        move_id = struct.unpack_from("<H", party_raw, 0x2C + (i * 2))[0] & 0x3FF
        packed_moves |= move_id << (10 * i)
    for i in range(5):
        raw[0x27 + i] = (packed_moves >> (8 * i)) & 0xFF

    raw[0x2C:0x32] = party_raw[0x38:0x3E]
    raw[0x32:0x3A] = party_raw[0x44:0x4C]
    return raw


def pc_raw_to_party_raw(pc_raw: bytes | bytearray | memoryview) -> bytearray:
    """Convert a 58-byte compact PC record to a 100-byte Party Pokemon record."""
    if pc_raw is None or len(pc_raw) != PC_MON_SIZE:
        raise ValueError("Invalid PC record width")

    _ensure_static_data()
    profile = get_profile()

    raw = bytearray(PARTY_MON_SIZE)
    raw[0x00:0x1C] = pc_raw[0x00:0x1C]
    raw[0x1C:0x20] = b"\x00\x00\x00\x00"
    raw[0x20:0x2B] = pc_raw[0x1C:0x27]

    packed_moves = 0
    for i in range(5):
        packed_moves |= pc_raw[0x27 + i] << (8 * i)
    pp_ups_byte = raw[0x28]
    for i in range(4):
        move_id = (packed_moves >> (10 * i)) & 0x3FF
        struct.pack_into("<H", raw, 0x2C + (i * 2), move_id)
        pp_up = (pp_ups_byte >> (2 * i)) & 0x03
        max_pp = party_mod.calculate_max_pp(move_id, pp_up)
        raw[0x34 + i] = max(0, min(255, int(max_pp)))

    raw[0x38:0x3E] = pc_raw[0x2C:0x32]
    raw[0x44:0x4C] = pc_raw[0x32:0x3A]
    raw[0x50:0x54] = b"\x00\x00\x00\x00"

    species_id = struct.unpack_from("<H", raw, 0x20)[0]
    exp = struct.unpack_from("<I", raw, 0x24)[0]
    growth_rate = party_mod.get_species_growth_rate(species_id)
    if growth_rate is None:
        growth_rate = 0
    level_max = int(profile["rules"]["level_max"])
    level = max(1, min(level_max, int(party_mod.calc_current_level(growth_rate, exp))))
    raw[0x54] = level
    raw[0x55] = 0xFF

    pk = party_mod.Pokemon(raw)
    pk.recalculate_party_stats(clamp_hp=False)
    return bytearray(pk.pack_data())


def find_first_empty_pc_slot(stream: bytes | bytearray, *, box: int | None = None, profile=None):
    """Return the first ordinary (box, slot) whose native species_id is 0, skipping unknown reserved slots."""
    profile = get_profile() if profile is None else profile
    pc_cfg = profile["storage"]["pc"]
    box_count = int(pc_cfg["box_count"])
    slots_per_box = int(pc_cfg["slots_per_box"])
    rec_size = int(pc_cfg["record_size"])
    species_off = int(profile["codecs"]["pc"]["fields"]["species"])

    if box is not None:
        target_box = _parse_int(box, "PC box")
        if target_box < 1 or target_box > box_count:
            raise ValueError("Invalid PC box")
        boxes = (target_box,)
    else:
        boxes = range(1, box_count + 1)

    for b in boxes:
        for s in range(1, slots_per_box + 1):
            off = ((b - 1) * slots_per_box + (s - 1)) * rec_size
            if off + rec_size > len(stream):
                break
            if struct.unpack_from("<H", stream, off + species_off)[0] == 0:
                return (b, s)
    return None


def _validate_explicit_box_slot(box, slot, pc_buffer_len: int, profile) -> tuple[int, int, int]:
    pc_cfg = profile["storage"]["pc"]
    box_count = int(pc_cfg["box_count"])
    slots_per_box = int(pc_cfg["slots_per_box"])
    rec_size = int(pc_cfg["record_size"])

    if box is None:
        raise ValueError("PC box is required")
    b = _parse_int(box, "PC box")
    if b < 1 or b > box_count:
        raise ValueError("Invalid PC box")

    if slot is None:
        raise ValueError("PC slot is required")
    s = _parse_int(slot, "PC slot")
    if s < 1 or s > slots_per_box:
        raise ValueError("Invalid PC slot")

    stream_off = ((b - 1) * slots_per_box + (s - 1)) * rec_size
    if stream_off + rec_size > pc_buffer_len:
        raise ValueError("PC slot out of bounds")
    return b, s, stream_off


def transfer_party_pc(
    data: bytearray,
    *,
    mode: str,
    party_index: int | None = None,
    box: int | None = None,
    slot: int | None = None,
) -> dict:
    """Atomically transfer or swap a Pokemon between Party and ordinary PC storage."""
    if not isinstance(data, bytearray):
        raise ValueError("Mutable bytearray save buffer required")

    require_capability("party")
    require_capability("pc")

    mode_norm = str(mode or "").strip().lower()
    if mode_norm not in _VALID_MODES:
        raise ValueError("Invalid transfer mode")

    profile = get_profile()
    party_cfg = profile["storage"]["party"]
    pc_cfg = profile["storage"]["pc"]

    active_slot = sections_mod.active_unbound_slot(data)
    trainer_sid = int(party_cfg["section_id"])
    if not active_slot or trainer_sid not in active_slot:
        raise LookupError("Trainer section not found")
    trainer_off = int(active_slot[trainer_sid]["offset"])

    sectors = pc_mod.get_active_pc_sectors(data)
    if not sectors:
        raise LookupError("PC sectors not found")
    pc_buffer, headers, originals, _ = pc_mod.rebuild_buffer(data, sectors)

    count_offset = int(party_cfg["count_offset"])
    party_start = int(party_cfg["start"])
    party_rec_size = int(party_cfg["record_size"])
    party_cap = int(party_cfg["capacity"])
    party_species_off = int(profile["codecs"]["party"]["fields"]["data_start"])

    box_count = int(pc_cfg["box_count"])
    slots_per_box = int(pc_cfg["slots_per_box"])
    pc_rec_size = int(pc_cfg["record_size"])
    pc_species_off = int(profile["codecs"]["pc"]["fields"]["species"])

    party_count = struct.unpack_from("<I", data, trainer_off + count_offset)[0]
    if party_count > party_cap:
        raise ValueError("Invalid party count")

    if mode_norm == "party_to_pc":
        if party_count <= 1:
            raise ValueError("Cannot move the last Pokemon out of your party")
        if party_index is None:
            raise ValueError("party_index is required")
        idx = _parse_int(party_index, "party_index")
        if idx < 0 or idx >= party_count:
            raise LookupError("Party Pokemon not found")

        party_off = trainer_off + party_start + (idx * party_rec_size)
        party_raw = bytes(data[party_off : party_off + party_rec_size])
        if struct.unpack_from("<H", party_raw, party_species_off)[0] == 0:
            raise LookupError("Party Pokemon not found")

        if box is None or (not isinstance(box, bool) and int(box) == 0):
            if slot is not None and not (not isinstance(slot, bool) and int(slot) == 0):
                raise ValueError("PC box is required when slot is specified")
            found = find_first_empty_pc_slot(pc_buffer, profile=profile)
            if found is None:
                raise ValueError("PC storage is full")
            target_box, target_slot = found
            stream_off = ((target_box - 1) * slots_per_box + (target_slot - 1)) * pc_rec_size
        elif slot is None or (not isinstance(slot, bool) and int(slot) == 0):
            target_box = _parse_int(box, "PC box")
            if target_box < 1 or target_box > box_count:
                raise ValueError("Invalid PC box")
            found = find_first_empty_pc_slot(pc_buffer, box=target_box, profile=profile)
            if found is None:
                raise ValueError("Target box is full")
            target_box, target_slot = found
            stream_off = ((target_box - 1) * slots_per_box + (target_slot - 1)) * pc_rec_size
        else:
            target_box, target_slot, stream_off = _validate_explicit_box_slot(box, slot, len(pc_buffer), profile)

        if struct.unpack_from("<H", pc_buffer, stream_off + pc_species_off)[0] != 0:
            raise ValueError("Target PC slot is occupied")

        next_pc = party_raw_to_pc_raw(party_raw)

        # Commit mutations atomically after all validations and conversions succeed.
        pc_buffer[stream_off : stream_off + pc_rec_size] = next_pc
        for k in range(idx, party_count - 1):
            dst = trainer_off + party_start + (k * party_rec_size)
            src = trainer_off + party_start + ((k + 1) * party_rec_size)
            data[dst : dst + party_rec_size] = data[src : src + party_rec_size]
        tail_off = trainer_off + party_start + ((party_count - 1) * party_rec_size)
        data[tail_off : tail_off + party_rec_size] = b"\x00" * party_rec_size
        new_count = party_count - 1
        struct.pack_into("<I", data, trainer_off + count_offset, new_count)
        sections_mod.refresh_checksum(data, trainer_off)
        pc_mod.write_save_HYBRID(data, sectors, pc_buffer, headers, originals, None, preset_buffer=None)
        return {
            "mode": mode_norm,
            "party_index": idx,
            "box": target_box,
            "slot": target_slot,
            "party_count": new_count,
        }

    if mode_norm == "pc_to_party":
        if party_count >= party_cap:
            raise ValueError("Party is full")
        target_box, target_slot, stream_off = _validate_explicit_box_slot(box, slot, len(pc_buffer), profile)
        pc_raw = bytes(pc_buffer[stream_off : stream_off + pc_rec_size])
        if struct.unpack_from("<H", pc_raw, pc_species_off)[0] == 0:
            raise LookupError("Source PC slot is empty")
        if not _is_valid_pc_record(pc_raw, profile):
            raise ValueError("Source PC slot is invalid or unsupported")

        next_party = pc_raw_to_party_raw(pc_raw)

        dst_off = trainer_off + party_start + (party_count * party_rec_size)
        data[dst_off : dst_off + party_rec_size] = next_party
        new_count = party_count + 1
        struct.pack_into("<I", data, trainer_off + count_offset, new_count)
        sections_mod.refresh_checksum(data, trainer_off)
        pc_buffer[stream_off : stream_off + pc_rec_size] = b"\x00" * pc_rec_size
        pc_mod.write_save_HYBRID(data, sectors, pc_buffer, headers, originals, None, preset_buffer=None)
        return {
            "mode": mode_norm,
            "party_index": party_count,
            "box": target_box,
            "slot": target_slot,
            "party_count": new_count,
        }

    # swap_party_pc
    if party_count <= 0:
        raise LookupError("Party is empty")
    if party_index is None:
        raise ValueError("party_index is required")
    idx = _parse_int(party_index, "party_index")
    if idx < 0 or idx >= party_count:
        raise LookupError("Party Pokemon not found")

    target_box, target_slot, stream_off = _validate_explicit_box_slot(box, slot, len(pc_buffer), profile)
    party_off = trainer_off + party_start + (idx * party_rec_size)
    party_raw = bytes(data[party_off : party_off + party_rec_size])
    if struct.unpack_from("<H", party_raw, party_species_off)[0] == 0:
        raise LookupError("Party Pokemon not found")

    pc_raw = bytes(pc_buffer[stream_off : stream_off + pc_rec_size])
    if struct.unpack_from("<H", pc_raw, pc_species_off)[0] == 0:
        raise LookupError("Source PC slot is empty")
    if not _is_valid_pc_record(pc_raw, profile):
        raise ValueError("Source PC slot is invalid or unsupported")

    next_pc = party_raw_to_pc_raw(party_raw)
    next_party = pc_raw_to_party_raw(pc_raw)

    data[party_off : party_off + party_rec_size] = next_party
    sections_mod.refresh_checksum(data, trainer_off)
    pc_buffer[stream_off : stream_off + pc_rec_size] = next_pc
    pc_mod.write_save_HYBRID(data, sectors, pc_buffer, headers, originals, None, preset_buffer=None)
    return {
        "mode": mode_norm,
        "party_index": idx,
        "box": target_box,
        "slot": target_slot,
        "party_count": party_count,
    }
