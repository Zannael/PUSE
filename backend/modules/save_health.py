"""Read-only save layout, checksum, and byte-change report."""

import struct

from .money import compute_section_checksum

SECTION_SIZE = 0x1000
SECTION_IDS = range(14)
PARTY_START = 0x38
PARTY_SIZE = 100
PC_MON_SIZE = 58


def _u16(data, offset):
    return struct.unpack_from("<H", data, offset)[0]


def _u32(data, offset):
    return struct.unpack_from("<I", data, offset)[0]


def _sections(data):
    out = []
    for index in range(len(data) // SECTION_SIZE):
        offset = index * SECTION_SIZE
        out.append({
            "index": index,
            "id": _u16(data, offset + 0xFF4),
            "save_index": _u32(data, offset + 0xFFC),
            "stored": _u16(data, offset + 0xFF6),
            "valid_len": _u32(data, offset + 0xFF0),
        })
    return out


def _pc_field(prefix, inside):
    for start, end, label in ((0x00, 0x04, "PID"), (0x04, 0x08, "owner ID"),
                              (0x08, 0x12, "nickname"), (0x1C, 0x1E, "species"),
                              (0x1E, 0x20, "held item"), (0x20, 0x24, "EXP"),
                              (0x24, 0x25, "PP Ups"), (0x26, 0x27, "caught ball"),
                              (0x27, 0x2C, "moves"), (0x2C, 0x32, "EVs"),
                              (0x36, 0x3A, "IVs/ability flag")):
        if start <= inside < end:
            return f"{prefix} {label}"
    return f"{prefix} data"


def _field_label(section_id, offset):
    if section_id == 1:
        if 0x34 <= offset < 0x38:
            return "Party count"
        if PARTY_START <= offset < PARTY_START + 6 * PARTY_SIZE:
            slot = (offset - PARTY_START) // PARTY_SIZE + 1
            inside = (offset - PARTY_START) % PARTY_SIZE
            if 0x08 <= inside < 0x12:
                return f"Party {slot} nickname"
            if inside == 0x54:
                return f"Party {slot} level"
            return f"Party {slot} data"
        return "Trainer data"
    if section_id == 0 and 0xB0 <= offset < 0xB0 + 30 * PC_MON_SIZE:
        relative = offset - 0xB0
        return _pc_field(f"Preset slot {relative // PC_MON_SIZE + 1}", relative % PC_MON_SIZE)
    if section_id in range(5, 13) and 4 <= offset < 0xFF4:
        relative = (section_id - 5) * 0xFF0 + (offset - 4)
        mon_index, inside = divmod(relative, PC_MON_SIZE)
        if mon_index < 18 * 30:
            return _pc_field(f"Box {mon_index // 30 + 1} slot {mon_index % 30 + 1}", inside)
        return "PC storage"
    if section_id in range(13, 17):
        return "Bag data"
    if section_id == 4 and 0xF34 <= offset < 0xF36:
        return "Battle Points"
    return "Section data"


def build_save_report(original, current, _include_source=True):
    """Inspect current bytes and compare them to an immutable upload snapshot."""
    original = bytes(original)
    current = bytes(current)
    sections = _sections(current)
    active = {}
    for section in sections:
        if section["id"] in SECTION_IDS and section["save_index"] > 0:
            prev = active.get(section["id"])
            if prev is None or section["save_index"] > prev["save_index"]:
                active[section["id"]] = section

    warnings = []
    if len(current) < 28 * SECTION_SIZE:
        warnings.append({"code": "short_save", "message": "Save has fewer than 28 complete sectors."})
    if len(original) != len(current):
        warnings.append({"code": "size_changed", "message": "Save size changed after upload."})
    missing = [section_id for section_id in SECTION_IDS if section_id not in active]
    if missing:
        warnings.append({"code": "missing_sections", "message": "Active save is missing section IDs: " + ", ".join(map(str, missing)) + "."})

    checksums = []
    for section_id in SECTION_IDS:
        section = active.get(section_id)
        if section is None:
            continue
        index = section["index"]
        if section_id == 4:
            checksums.append({"id": section_id, "index": index, "status": "opaque", "stored": section["stored"], "computed": None})
            continue
        length = 0xADC if section_id == 0 else 0x450 if section_id == 13 else section["valid_len"]
        if not 0 < length <= 0xFF4:
            length = 0xFF4
        offset = index * SECTION_SIZE
        computed = compute_section_checksum(current[offset:offset + length], length)
        status = "ok" if computed == section["stored"] else "mismatch"
        checksums.append({"id": section_id, "index": index, "status": status, "stored": section["stored"], "computed": computed})
        if status == "mismatch":
            warnings.append({"code": "checksum_mismatch", "message": f"Active section {section_id} checksum differs from its stored value."})

    changed_sectors = []
    changed_bytes = 0
    for index in range(max(len(original), len(current)) // SECTION_SIZE):
        offset = index * SECTION_SIZE
        before = original[offset:offset + SECTION_SIZE]
        after = current[offset:offset + SECTION_SIZE]
        if not before and not after:
            continue
        metadata = sections[index] if index < len(sections) else {"id": None, "save_index": None}
        fields = {}
        payload_count = footer_count = 0
        for inside in range(max(len(before), len(after))):
            old = before[inside] if inside < len(before) else None
            new = after[inside] if inside < len(after) else None
            if old == new:
                continue
            changed_bytes += 1
            if inside >= 0xFF0:
                footer_count += 1
            else:
                payload_count += 1
                label = _field_label(metadata["id"], inside)
                fields[label] = fields.get(label, 0) + 1
        if payload_count or footer_count:
            changed_sectors.append({"index": index, "id": metadata["id"], "save_index": metadata["save_index"],
                                    "payload_bytes": payload_count, "footer_bytes": footer_count,
                                    "fields": [{"name": name, "changed_bytes": count} for name, count in fields.items()]})
    for offset in range((max(len(original), len(current)) // SECTION_SIZE) * SECTION_SIZE, max(len(original), len(current))):
        old = original[offset] if offset < len(original) else None
        new = current[offset] if offset < len(current) else None
        changed_bytes += old != new

    return {
        "layout": {"size": len(current), "section_count": len(sections), "trailing_bytes": len(current) % SECTION_SIZE,
                   "active_save_index": max((s["save_index"] for s in active.values()), default=None),
                   "missing_ids": missing},
        "checksums": checksums,
        "warnings": warnings,
        "source_warnings": build_save_report(original, original, False)["warnings"] if _include_source else [],
        "changes": {"changed_bytes": changed_bytes, "sectors": changed_sectors},
    }
