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
        "fewtimesdead": ROOT / "local_artifacts" / "FewTimesDead_noshiny.sav",
        "unbound_issue": ROOT / "local_artifacts" / "issue_sav" / "unbound.sav",
        "unbound2_fixed": ROOT / "local_artifacts" / "Unbound_2_fixed.sav",
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
        assert_true(
            invalid_trunc > 0 or (valid - valid_trunc) >= 10,
            f"{name} truncated payload should show measurable regression",
        )

    print("PC stream regression checks passed.")


if __name__ == "__main__":
    main()
