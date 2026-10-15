"""Verified Unbound 2.1.1.1 ordinary-slot selection and checksum domains."""
import struct
from core.profile import PROFILE

SECTION_SIZE = PROFILE["container"]["section_size"]
SLOT_SECTIONS = PROFILE["container"]["sections_per_slot"]
FOOTER = PROFILE["container"]["footer"]
OPAQUE_IDS = PROFILE["container"]["checksum"]["opaque_ids"]
UNBOUND_SIGNATURES = frozenset(PROFILE["container"]["signatures"])

def ru16(data, off): return struct.unpack_from('<H', data, off)[0]
def ru32(data, off): return struct.unpack_from('<I', data, off)[0]
def section_checksum_length(section_id):
    domain = PROFILE["container"]["checksum"]
    return domain["lengths"].get(str(section_id), domain["default_length"])

def calculate_checksum(payload):
    total = sum(struct.unpack('<' + 'I' * (len(payload)//4), payload)) & 0xFFFFFFFF
    return ((total & 0xFFFF) + (total >> 16)) & 0xFFFF

def refresh_checksum(data, offset):
    # Auxiliary sectors have no ordinary section footer/checksum.
    if offset >= PROFILE["container"]["slot_count"] * SLOT_SECTIONS * SECTION_SIZE:
        return
    sid = ru16(data, offset + FOOTER["id"])
    if sid in OPAQUE_IDS:
        return
    struct.pack_into('<H', data, offset + FOOTER["checksum"],
                     calculate_checksum(data[offset:offset + section_checksum_length(sid)]))

def active_unbound_slot(data, verify_checksums=True):
    """Select one complete, coherent, intact slot; never mix generations.

    Section 4 remains opaque: its footer/signature/counter are checked, but its
    checksum is deliberately not used to reject or rewrite a slot.
    Auxiliary sectors 30/31 and the RTC trailer have no ordinary footers.
    """
    slots = []
    for slot in range(PROFILE["container"]["slot_count"]):
        base = slot * SLOT_SECTIONS * SECTION_SIZE
        if base + SLOT_SECTIONS * SECTION_SIZE > len(data):
            continue
        sections = {}
        for index in range(SLOT_SECTIONS):
            off = base + index * SECTION_SIZE
            sid = ru16(data, off + FOOTER["id"])
            if sid not in range(SLOT_SECTIONS) or sid in sections:
                break
            if ru32(data, off + FOOTER["signature"]) not in UNBOUND_SIGNATURES:
                break
            if verify_checksums and sid not in OPAQUE_IDS and calculate_checksum(data[off:off + section_checksum_length(sid)]) != ru16(data, off + FOOTER["checksum"]):
                break
            sections[sid] = {'id': sid, 'idx': ru32(data, off + FOOTER["counter"]), 'offset': off}
        if len(sections) == SLOT_SECTIONS and len({sec['idx'] for sec in sections.values()}) == 1:
            slots.append(sections)
    if not slots:
        return {}
    if len(slots) == 2:
        delta = (slots[1][0]['idx'] - slots[0][0]['idx']) & 0xFFFFFFFF
        if 0 < delta < 0x80000000:
            return slots[1]
    return slots[0]


def active_sections(data):
    return [{'id': sid, 'off': sec['offset'], 'saveidx': sec['idx'],
             'index': sec['offset']//SECTION_SIZE,
             'valid_len': section_checksum_length(sid),
             'data': bytearray(data[sec['offset']:sec['offset']+SECTION_SIZE])}
            for sid, sec in active_unbound_slot(data).items()]
