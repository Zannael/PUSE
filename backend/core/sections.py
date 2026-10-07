"""Verified Unbound 2.1.1.1 ordinary-slot selection and checksum domains."""
import struct

SECTION_SIZE = 0x1000
UNBOUND_SIGNATURES = {0x01121999, 0x01121998}

def ru16(data, off): return struct.unpack_from('<H', data, off)[0]
def ru32(data, off): return struct.unpack_from('<I', data, off)[0]
def section_checksum_length(section_id):
    return {0: 0xF24, 4: 0xD98, 13: 0x450}.get(section_id, 0xFF0)

def calculate_checksum(payload):
    total = sum(struct.unpack('<' + 'I' * (len(payload)//4), payload)) & 0xFFFFFFFF
    return ((total & 0xFFFF) + (total >> 16)) & 0xFFFF

def refresh_checksum(data, offset):
    # Auxiliary sectors have no ordinary section footer/checksum.
    if offset >= 28 * SECTION_SIZE:
        return
    sid = ru16(data, offset + 0xFF4)
    if sid == 4:
        return
    struct.pack_into('<H', data, offset + 0xFF6,
                     calculate_checksum(data[offset:offset + section_checksum_length(sid)]))

def active_unbound_slot(data, verify_checksums=True):
    """Select one complete, coherent, intact slot; never mix generations.

    Section 4 remains opaque: its footer/signature/counter are checked, but its
    checksum is deliberately not used to reject or rewrite a slot.
    Auxiliary sectors 30/31 and the RTC trailer have no ordinary footers.
    """
    slots = []
    for base in (0, 14 * SECTION_SIZE):
        if base + 14 * SECTION_SIZE > len(data):
            continue
        sections = {}
        for index in range(14):
            off = base + index * SECTION_SIZE
            sid = ru16(data, off + 0xFF4)
            if sid not in range(14) or sid in sections:
                break
            if ru32(data, off + 0xFF8) not in UNBOUND_SIGNATURES:
                break
            if verify_checksums and sid != 4 and calculate_checksum(data[off:off + section_checksum_length(sid)]) != ru16(data, off + 0xFF6):
                break
            sections[sid] = {'id': sid, 'idx': ru32(data, off + 0xFFC), 'offset': off}
        if len(sections) == 14 and len({sec['idx'] for sec in sections.values()}) == 1:
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
