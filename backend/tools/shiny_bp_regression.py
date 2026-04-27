#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modules import party  # noqa: E402


SECTION_SIZE = 0x1000
BP_REL_OFF = 0xF34


def active_section_offset(data: bytearray, section_id: int) -> int:
    best_idx = None
    best_off = None
    total = (len(data) // SECTION_SIZE) * SECTION_SIZE
    for off in range(0, total, SECTION_SIZE):
        sid = party.ru16(data, off + 0xFF4)
        if sid != int(section_id):
            continue
        idx = party.ru32(data, off + 0xFFC)
        if best_idx is None or idx > best_idx:
            best_idx = idx
            best_off = off
    if best_off is None:
        raise RuntimeError(f"Active section {section_id} not found")
    return best_off


def shiny_value(otid: int, pid: int) -> int:
    return (otid & 0xFFFF) ^ ((otid >> 16) & 0xFFFF) ^ (pid & 0xFFFF) ^ ((pid >> 16) & 0xFFFF)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def get_party_slot_mon(data: bytearray, slot_index_1based: int) -> party.Pokemon:
    trainer_off = active_section_offset(data, party.TRAINER_SECTION_ID)
    sec = data[trainer_off: trainer_off + SECTION_SIZE]
    mo = 0x38 + ((int(slot_index_1based) - 1) * 100)
    raw = sec[mo: mo + 100]
    if len(raw) < 100:
        raise RuntimeError("Party slot raw length is invalid")
    return party.Pokemon(raw)


def main() -> None:
    party.load_static_data()

    pre_path = ROOT / "local_artifacts" / "FewTimesDead_noshiny.sav"
    post_path = ROOT / "local_artifacts" / "FewTimesDead.sav"
    issue_path = ROOT / "local_artifacts" / "issue_sav" / "unbound.sav"

    for path in (pre_path, post_path, issue_path):
        if not path.exists():
            raise FileNotFoundError(f"Missing fixture: {path}")

    pre = bytearray(pre_path.read_bytes())
    post = bytearray(post_path.read_bytes())
    issue = bytearray(issue_path.read_bytes())

    # BP regression: verify scammer transaction delta reflected in section 4 BP slot.
    pre_sec4 = active_section_offset(pre, 4)
    post_sec4 = active_section_offset(post, 4)
    pre_bp = party.ru16(pre, pre_sec4 + BP_REL_OFF)
    post_bp = party.ru16(post, post_sec4 + BP_REL_OFF)
    print(f"FewTimesDead BP: {pre_bp} -> {post_bp}")
    assert_true(pre_bp == 64754, f"Expected pre BP 64754, got {pre_bp}")
    assert_true(post_bp == 64154, f"Expected post BP 64154, got {post_bp}")
    assert_true(pre_bp - post_bp == 600, f"Expected BP delta 600, got {pre_bp - post_bp}")

    # Scammer shiny regression: party slot 6 Mudkip becomes shiny by SV band 8..15.
    pre_mudkip = get_party_slot_mon(pre, 6)
    post_mudkip = get_party_slot_mon(post, 6)
    pre_sv = shiny_value(pre_mudkip.otid, pre_mudkip.pid)
    post_sv = shiny_value(post_mudkip.otid, post_mudkip.pid)
    print(f"FewTimesDead Mudkip SV: {pre_sv} -> {post_sv}")
    assert_true(party.DB_SPECIES.get(pre_mudkip.get_species_id()) == "Mudkip", "Expected pre slot6 species Mudkip")
    assert_true(party.DB_SPECIES.get(post_mudkip.get_species_id()) == "Mudkip", "Expected post slot6 species Mudkip")
    assert_true(pre_sv >= 16, f"Expected pre Mudkip non-shiny band >=16, got {pre_sv}")
    assert_true(8 <= post_sv < 16, f"Expected post Mudkip SV in 8..15, got {post_sv}")
    assert_true(not pre_mudkip.is_shiny(), "Expected pre Mudkip not shiny")
    assert_true(post_mudkip.is_shiny(), "Expected post Mudkip shiny under <16 rule")

    # Issue fixture regression: party Zoroark + Necrozma must be recognized shiny.
    trainer_off = active_section_offset(issue, party.TRAINER_SECTION_ID)
    sec = issue[trainer_off: trainer_off + SECTION_SIZE]
    expected = {
        2: "Zoroark",
        5: "Necrozma",
    }
    for slot, species_name in expected.items():
        mo = 0x38 + ((slot - 1) * 100)
        mon = party.Pokemon(sec[mo: mo + 100])
        actual_species = party.DB_SPECIES.get(mon.get_species_id())
        sv = shiny_value(mon.otid, mon.pid)
        print(f"issue slot{slot} {actual_species} SV={sv} shiny={mon.is_shiny()}")
        assert_true(actual_species == species_name, f"Expected slot {slot} {species_name}, got {actual_species}")
        assert_true(8 <= sv < 16, f"Expected {species_name} SV in 8..15, got {sv}")
        assert_true(mon.is_shiny(), f"Expected {species_name} shiny under <16 rule")

    print("Shiny + BP regression checks passed.")


if __name__ == "__main__":
    main()
