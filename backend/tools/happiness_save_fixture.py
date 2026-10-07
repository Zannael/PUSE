"""Emit canonical finalized bytes for the happiness parity regression."""

import contextlib
import io
import sys
from pathlib import Path

from modules import party, pc
from core.sections import refresh_checksum

with contextlib.redirect_stdout(io.StringIO()):
    from main import _finalize_save_bytes


save = bytearray(Path(sys.argv[1]).read_bytes())
party_value = int(sys.argv[2])
pc_value = int(sys.argv[3])
trainer = pc.resolve_active_section_offsets(save, {1})[1]
sectors = pc.get_active_pc_sectors(save)
with contextlib.redirect_stdout(io.StringIO()):
    stream, headers, originals, preset = pc.rebuild_buffer(save, sectors)
start = trainer + 0x38
mon = party.Pokemon(save[start:start + 100])
assert mon.get_species_id() > 0
mon.set_happiness(party_value)
save[start:start + 100] = mon.pack_data()
refresh_checksum(save, trainer)

pc_mon = pc.UnboundPCMon(stream[:pc.MON_SIZE_PC], 1, 1)
assert pc_mon.is_valid
pc_mon.set_happiness(pc_value)
stream[:pc.MON_SIZE_PC] = pc_mon.raw
ctx = {
    "sectors": sectors,
    "pc_buffer": stream,
    "headers": headers,
    "originals": originals,
    "preset_buffer": preset,
    "absolute_touched_sectors": [],
}
with contextlib.redirect_stdout(io.StringIO()):
    result = _finalize_save_bytes(save, ctx)
sys.stdout.buffer.write(result)
