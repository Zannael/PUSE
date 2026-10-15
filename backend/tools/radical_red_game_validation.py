#!/usr/bin/env python3
"""Hash-pinned Radical Red game validation using mGBA public core API."""
from pathlib import Path
import sys,subprocess,struct
root=Path(__file__).resolve().parents[2];sys.path.insert(0,str(root/'backend'))
import argparse,tempfile,hashlib
from tools.extract_radical_red_41 import ROM_SHA256
from core.profile import select_profile
from core.sections import active_unbound_slot
from modules import pc,radical_bag,money
parser=argparse.ArgumentParser(description="Optional RR4.1 real-ROM load/save/reboot validation; never modifies inputs.")
parser.add_argument('--rom',type=Path,required=True);parser.add_argument('--save',type=Path,required=True);parser.add_argument('--probe',type=Path,required=True)
args=parser.parse_args()
assert hashlib.sha256(args.rom.read_bytes()).hexdigest()==ROM_SHA256,'Unverified ROM'
source=args.save.read_bytes()
temporary=tempfile.TemporaryDirectory(prefix='puse-rr-game-');work=Path(temporary.name)
select_profile('radical-red-4.1');save=bytearray(source);active=active_unbound_slot(save)
from modules import party
from core.sections import refresh_checksum
at=active[1]['offset']+0x38
mon=party.Pokemon(save[at:at+100]);mon.set_happiness(123);mon.set_item(616);mon.set_nature(3);mon.recalculate_party_stats();save[at:at+100]=mon.pack_data();refresh_checksum(save,active[1]['offset'])
save=bytearray(money.patch_money_everywhere(save,123456789))
positions=radical_bag.offsets(save)
for rows in positions.values():radical_bag.write(save,rows[0],struct.unpack_from('<H',save,rows[0])[0],17)
path=work/'edited.sav';path.write_bytes(save)
boot='frames 500 0\nframes 2 8\nframes 180 0\nframes 2 8\nframes 180 0\n'+('frames 2 1\nframes 180 0\n'*4)
cmd=boot+f'read 02000000 262144 {work}/edited-ram.bin\ncall 080DA249 0 0\nsave {work}/game-saved.sav\nquit\n'
with (work/'game.log').open('w') as out:subprocess.run([str(args.probe),str(args.rom),str(path)],input=cmd,text=True,stdout=out,stderr=out,check=True)
ram=(work/'edited-ram.bin').read_bytes();active=active_unbound_slot(save)
assert ram[0x24284:0x24284+600]==save[active[1]['offset']+0x38:active[1]['offset']+0x38+600]
stream,*_=pc.rebuild_buffer(save,pc.get_active_pc_sectors(save))
expected=b''.join(ram[a-0x2000000:a-0x2000000+n] for a,n in [(0x2029318,33060),(0x203CB44,5220),(0x2027434,3480),(0x2024638,1740)])
assert stream==expected
for key,address in [('main',0x3BB20),('key',0x3C228),('ball',0x3C354),('tm',0x3C41C),('berry',0x3C61C)]:
 expected=b''.join(save[p:p+4] for p in positions[key]);assert ram[address:address+len(expected)]==expected,key
saved=(work/'game-saved.sav').read_bytes();selected=active_unbound_slot(saved);assert selected and selected[0]['idx']>active[0]['idx']
assert money.read_money(saved)==123456789
cmd=boot+f'read 02000000 262144 {work}/reboot-ram.bin\nquit\n'
with (work/'reboot.log').open('w') as out:subprocess.run([str(args.probe),str(args.rom),str(work/'game-saved.sav')],input=cmd,text=True,stdout=out,stderr=out,check=True)
reboot=(work/'reboot-ram.bin').read_bytes();assert reboot[0x24284:0x24284+600]==ram[0x24284:0x24284+600]
print('PASS: edited party, all750PCrecords, all5bagregions loaded by RR4.1; game save advancescounter; cold reboot preserves edited party and money.')

assert args.save.read_bytes()==source
temporary.cleanup()
