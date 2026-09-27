"""Generate deterministic report fixtures for portable C++ parity checks."""

import struct
import sys
from pathlib import Path

from modules import money
from modules.save_health import build_save_report


def print_report(label, report):
    layout = report["layout"]
    print(f"case {label}")
    print(f"layout {layout['size']} {layout['section_count']} {layout['trailing_bytes']} {layout['active_save_index'] or 0}"
          + " " + ",".join(map(str, layout["missing_ids"])))
    for row in report["checksums"]:
        computed = "-" if row["computed"] is None else str(row["computed"])
        print(f"checksum {row['id']} {row['index']} {row['status']} {row['stored']} {computed}")
    for warning in report["warnings"]:
        print(f"warning {warning['code']}")
    for warning in report["source_warnings"]:
        print(f"source_warning {warning['code']}")
    print(f"changes {report['changes']['changed_bytes']}")
    for sector in report["changes"]["sectors"]:
        print(f"sector {sector['index']} {sector['id']} {sector['save_index']} {sector['payload_bytes']} {sector['footer_bytes']}")
        for field in sector["fields"]:
            print(f"field {field['name']} {field['changed_bytes']}")


def main():
    source = Path(sys.argv[1]).read_bytes()
    output = Path(sys.argv[2])
    output.mkdir(parents=True, exist_ok=True)
    sectors = [s for s in money.list_sections(source) if s["id"] == 1 and s["saveidx"] > 0]
    active = max(sectors, key=lambda s: s["saveidx"])
    mon_off = active["off"] + 0x38 + 0x08

    edited = bytearray(source)
    edited[mon_off] ^= 1
    payload = edited[active["off"]:active["off"] + 0xFF4]
    struct.pack_into("<H", edited, active["off"] + 0xFF6, money.compute_section_checksum(payload, 0xFF4))
    corrupt = bytearray(source)
    corrupt[mon_off] ^= 1
    bag = max((s for s in money.list_sections(source) if s["id"] == 13 and s["saveidx"] > 0), key=lambda s: s["saveidx"])
    bag_corrupt = bytearray(source)
    bag_corrupt[bag["off"] + 0x20] ^= 1
    opaque = max((s for s in money.list_sections(source) if s["id"] == 4 and s["saveidx"] > 0), key=lambda s: s["saveidx"])
    opaque_edit = bytearray(source)
    opaque_edit[opaque["off"] + 0xF34] ^= 1
    older = min(sectors, key=lambda s: s["saveidx"])
    old_corrupt = bytearray(source)
    old_corrupt[older["off"] + 0x38 + 0x08] ^= 1
    pc = max((s for s in money.list_sections(source) if s["id"] == 5 and s["saveidx"] > 0), key=lambda s: s["saveidx"])
    pc_edited = bytearray(source)
    pc_edited[pc["off"] + 4 + 0x1C] ^= 1
    pc_payload = pc_edited[pc["off"]:pc["off"] + 0xFF4]
    struct.pack_into("<H", pc_edited, pc["off"] + 0xFF6, money.compute_section_checksum(pc_payload, 0xFF4))
    cases = [("baseline", source, source), ("edited", source, bytes(edited)),
             ("corrupt", source, bytes(corrupt)), ("bag_corrupt", source, bytes(bag_corrupt)),
             ("opaque_edit", source, bytes(opaque_edit)), ("old_corrupt", source, bytes(old_corrupt)),
             ("pc_edited", source, bytes(pc_edited)),
             ("source_corrupt", bytes(corrupt), source),
             ("short", source[:16], source[:16])]
    for name, before, data in cases:
        (output / f"{name}.bin").write_bytes(data)
        print_report(name, build_save_report(before, data))


if __name__ == "__main__":
    main()
