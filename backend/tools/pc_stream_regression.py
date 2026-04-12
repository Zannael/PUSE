#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modules import pc  # noqa: E402


def build_stream_buffer(save_data: bytearray, payload_size: int) -> bytearray:
    sectors = pc.get_active_pc_sectors(save_data)
    stream = [s for s in sectors if s["id"] in pc.POKEMON_STREAM_SECTORS]
    out = bytearray()
    for sec in stream:
        off = sec["offset"]
        out += save_data[off + pc.SECTOR_HEADER_SIZE: off + pc.SECTOR_HEADER_SIZE + payload_size]
    return out


def scan_buffer(buf: bytearray) -> tuple[dict[tuple[int, int], pc.UnboundPCMon], int, int, int]:
    mons: dict[tuple[int, int], pc.UnboundPCMon] = {}
    valid = 0
    invalid = 0
    empty = 0

    for box in range(1, 26):
        for slot in range(1, 31):
            off = ((box - 1) * 30 + (slot - 1)) * pc.MON_SIZE_PC
            if off + pc.MON_SIZE_PC > len(buf):
                continue
            raw = buf[off: off + pc.MON_SIZE_PC]
            mon = pc.UnboundPCMon(raw, box, slot)
            if mon.is_valid:
                mons[(box, slot)] = mon
                valid += 1
            elif all(b == 0 for b in raw):
                empty += 1
            else:
                invalid += 1

    return mons, valid, invalid, empty


def assert_equal(actual, expected, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_true(cond: bool, label: str) -> None:
    if not cond:
        raise AssertionError(label)


def main() -> None:
    pc.load_static_data()

    fixtures = {
        "unbound": ROOT / "local_artifacts" / "issue_sav" / "unbound.sav",
        "pre_edit": ROOT / "local_artifacts" / "issue_sav" / "pre_edit.sav",
        "post_edit_fixed": ROOT / "local_artifacts" / "issue_sav" / "post_edit_fixed.sav",
    }

    for name, path in fixtures.items():
        if not path.exists():
            raise FileNotFoundError(f"Missing fixture: {path}")

        data = bytearray(path.read_bytes())
        current_buf = build_stream_buffer(data, pc.SECTOR_PAYLOAD_SIZE)
        current_mons, valid, invalid, empty = scan_buffer(current_buf)

        print(f"[{name}] payload=0x{pc.SECTOR_PAYLOAD_SIZE:X} valid={valid} invalid={invalid} empty={empty}")
        assert_equal(invalid, 0, f"{name} invalid slots with current payload")

        # Guard against regressing back to the truncated payload window.
        truncated_buf = build_stream_buffer(data, 0xFEC)
        _, valid_trunc, invalid_trunc, _ = scan_buffer(truncated_buf)
        print(f"[{name}] payload=0xFEC valid={valid_trunc} invalid={invalid_trunc}")
        assert_true(valid >= valid_trunc, f"{name} current payload should not decode fewer mons")

        if name == "unbound":
            expected_box3 = {
                1: "Cubone",
                2: "Espurr",
                3: "Shinx",
                4: "Doduo",
                5: "Abra",
                6: "Mareep",
                7: "Doduo",
                8: "Ledian",
                9: "Arbok",
                10: "Bronzor",
                11: "Cryogonal",
                12: "Snover",
            }
            for slot, expected_species in expected_box3.items():
                mon = current_mons.get((3, slot))
                assert_true(mon is not None, f"unbound box3 slot{slot} missing")
                species = pc.DB_SPECIES.get(mon.species_id, str(mon.species_id))
                assert_equal(species, expected_species, f"unbound box3 slot{slot}")

            expected_box4 = {
                1: "Electabuzz",
                2: "Ferroseed",
                3: "Elekid",
                4: "Tynamo",
                5: "Tynamo",
                6: "Magneton",
                7: "Luvdisc",
                8: "Crobat",
                9: "Shellder",
                10: "Munna",
                11: "Sawsbuck",
                12: "Fletchling",
            }
            for slot, expected_species in expected_box4.items():
                mon = current_mons.get((4, slot))
                assert_true(mon is not None, f"unbound box4 slot{slot} missing")
                species = pc.DB_SPECIES.get(mon.species_id, str(mon.species_id))
                assert_equal(species, expected_species, f"unbound box4 slot{slot}")

            egg_mon = current_mons.get((4, 28))
            assert_true(egg_mon is not None, "unbound box4 slot28 missing")
            iv_word = pc.ru32(egg_mon.raw, pc.OFF_IVS)
            is_egg = (iv_word >> 30) & 1
            assert_equal(is_egg, 1, "unbound box4 slot28 egg flag")

    print("PC stream regression checks passed.")


if __name__ == "__main__":
    main()
