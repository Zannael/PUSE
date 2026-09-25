"""Print canonical nickname bytes after clearing party 0 and PC box 1 slot 1."""

import contextlib
import io
import struct
import sys
from pathlib import Path

from modules import party, pc


def active_section(sections, section_id):
    return max(
        (section for section in sections if struct.unpack_from("<H", section, 0xFF4)[0] == section_id),
        key=lambda section: struct.unpack_from("<I", section, 0xFFC)[0],
    )


def main(save_path):
    with contextlib.redirect_stdout(io.StringIO()):
        party.load_static_data()
        pc.load_static_data()

    save = Path(save_path).read_bytes()
    sections = [save[offset:offset + 0x1000] for offset in range(0, len(save) // 0x1000 * 0x1000, 0x1000)]
    trainer = active_section(sections, 1)
    mon = party.Pokemon(trainer[0x38:0x38 + 100])
    mon.set_nickname("   ")
    print(mon.pack_data()[0x08:0x12].hex())

    stream = b"".join(active_section(sections, section_id)[4:4 + 0xFF0] for section_id in range(5, 13))
    pc_mon = pc.UnboundPCMon(stream[:58], 1, 1)
    if not pc_mon.is_valid:
        raise ValueError("PC box 1 slot 1 must be occupied for nickname parity")
    pc_mon.set_nickname("")
    print(pc_mon.raw[0x08:0x12].hex())


if __name__ == "__main__":
    main(sys.argv[1])
