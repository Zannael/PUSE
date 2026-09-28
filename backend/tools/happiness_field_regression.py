"""Probe compact friendship mapping against local, ignored cross-save transfers.

The same Pokemon is identified by PID, OTID and species in a Party fixture and
a different PC fixture. Personal saves are read locally and never copied here.
"""

from pathlib import Path

from modules import party, pc


ROOT = Path(__file__).resolve().parents[1] / "local_artifacts"
# party file, party index, PC file, box, slot, observed in-game friendship
PAIRS = [
    ("FewTimesDead_noshiny.sav", 5, "edited_few.sav", 14, 10, 50),
    ("edited_few.sav", 5, "FewTimesDead_noshiny.sav", 14, 1, 255),
    ("Unbound_2_before_promote_working.sav", 5, "Unbound.sav", 8, 12, 255),
]


def party_mon(filename, index):
    save = (ROOT / filename).read_bytes()
    trainer = pc.resolve_active_section_offsets(save, {1})[1]
    start = trainer + 0x38 + index * 100
    return party.Pokemon(save[start:start + 100])


def pc_mon(filename, box, slot):
    save = (ROOT / filename).read_bytes()
    sectors = pc.get_active_pc_sectors(save)
    stream, _, _, _ = pc.rebuild_buffer(save, sectors)
    start = ((box - 1) * 30 + slot - 1) * pc.MON_SIZE_PC
    return pc.UnboundPCMon(stream[start:start + pc.MON_SIZE_PC], box, slot)


for party_file, index, pc_file, box, slot, expected in PAIRS:
    p = party_mon(party_file, index)
    c = pc_mon(pc_file, box, slot)
    assert c.is_valid
    assert (p.pid, p.otid, p.get_species_id()) == (c.get_pid(), c.get_otid(), c.species_id)
    assert p.get_happiness() == c.raw[0x25] == c.get_happiness() == expected
    assert c.raw[0x26] == c.get_ball_id()  # adjacent caught-ball byte

    for value in (0, 1, 70, 254, 255):
        before = bytes(c.raw)
        c.set_happiness(value)
        changed = [i for i, (old, new) in enumerate(zip(before, c.raw)) if old != new]
        assert changed == ([] if before[0x25] == value else [0x25])
        assert c.get_happiness() == value

        p.set_happiness(value)
        assert p.get_happiness() == value
        assert p.pack_data()[0x20 + 9] == value

    for invalid in (-1, 256):
        for mon in (p, c):
            try:
                mon.set_happiness(invalid)
            except ValueError:
                pass
            else:
                raise AssertionError("out-of-range happiness accepted")

print(f"Happiness offset 0x25 proven across {len(PAIRS)} cross-save Party/PC transfers.")
