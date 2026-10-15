#!/usr/bin/env python3
"""Radical Red 4.1 cross-runtime byte checks; optional private fixture stays local."""
from pathlib import Path
import sys,struct,subprocess,tempfile,hashlib,contextlib,io
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))
from core.profile import select_profile,choose_profile,get_profile
from core.sections import active_unbound_slot,refresh_checksum
from modules import pc,party,money,radical_bag

def backend(source,mode):
    select_profile('radical-red-4.1');save=bytearray(source)
    sectors=pc.get_active_pc_sectors(save)
    stream,headers,originals,preset=pc.rebuild_buffer(save,sectors)
    assert len(stream)==43500
    if mode=='edit':
        active=active_unbound_slot(save);off=active[1]['offset']+0x38
        mon=party.Pokemon(save[off:off+100]);mon.set_happiness(123);mon.set_item(616);mon.set_nature(3)
        mon.set_moves([1003,999,0,33], move_pp=[99,99,0,99], move_pp_ups=[3,2,0,1])
        mon.set_identity(shiny=True);mon.set_nickname("RR TEST");mon.set_ot_name("PUSE")
        mon.recalculate_party_stats();save[off:off+100]=mon.pack_data();refresh_checksum(save,active[1]['offset'])
        stream[24*1740+37]=91
        save=bytearray(money.patch_money_everywhere(save,123456789))
        positions=radical_bag.offsets(save)
        for rows in positions.values():radical_bag.write(save,rows[0],struct.unpack_from('<H',save,rows[0])[0],17)
        radical_bag.write(save,positions['main'][0],0,0)
    pc.write_save_HYBRID(save,sectors,stream,headers,originals,None)
    return save

def main():
    path=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'backend/local_artifacts/radicalred.sav'
    source=path.read_bytes();before=hashlib.sha256(source).hexdigest()
    try:choose_profile(source);raise AssertionError('Automatic Radical Red selection')
    except ValueError:pass
    assert choose_profile(source,'radical-red-4.1')=='radical-red-4.1'
    # Controlled boundary case derived in memory: Box 25 occupied, main pocket
    # full across its 326/124-slot split. Never modify the private input.
    select_profile('radical-red-4.1')
    source=bytearray(source)
    sectors=pc.get_active_pc_sectors(source)
    stream,headers,originals,preset=pc.rebuild_buffer(source,sectors)
    record=next(stream[i:i+58] for i in range(0,len(stream),58) if int.from_bytes(stream[i+28:i+30],'little'))
    stream[24*1740:24*1740+58]=record
    unknown=bytearray(record);unknown[28:30]=bytes([255,255]);stream[24*1740+58:24*1740+116]=unknown
    pc.write_save_HYBRID(source,sectors,stream,headers,originals,None)
    positions=radical_bag.offsets(source)
    for index,off in enumerate(positions['main']):struct.pack_into('<HH',source,off,13,index+1)
    for section in active_unbound_slot(source).values():refresh_checksum(source,section['offset'])
    # A damaged section 4 must select the older coherent ordinary generation.
    active=active_unbound_slot(source); damaged=bytearray(source)
    damaged[active[4]['offset']+4] ^= 1
    assert active_unbound_slot(damaged)[0]['idx'] != active[0]['idx']
    # Serial rollover is modulo 32 bits; signature never identifies a version.
    rollover=bytearray(source)
    for sector in range(28):struct.pack_into('<I',rollover,sector*4096+0xFFC,0xffffffff if sector<14 else 0)
    assert active_unbound_slot(rollover)[0]['idx']==0
    # Wrong pocket and skipped-empty insertions reject before mutation.
    positions=radical_bag.offsets(source)
    for key,item in [('key',13),('tm',13),('ball',13)]:
        attempted=bytearray(source)
        try:radical_bag.write(attempted,positions[key][0],item,0 if key!='ball' else 1);raise AssertionError('Wrong pocket accepted')
        except ValueError:pass
        assert attempted==source
    with tempfile.TemporaryDirectory(prefix='puse-rr-parity-') as directory:
        tmp=Path(directory);inp=tmp/'input.sav';inp.write_bytes(source)
        binaries=[]
        for port in ['switch-homebrew','3ds-homebrew']:
            binary=tmp/port
            subprocess.run(['g++','-std=c++17','-I'+str(ROOT/port/'include'),*[str(ROOT/port/f'source/core/{name}.cpp') for name in ['SaveSession','SaveSections','Pc','Party','Bag','Money','PokedexFlags']],str(ROOT/port/'source/io/DataLoader.cpp'),str(ROOT/port/'tests/radical_red_parity.cpp'),'-o',str(binary)],check=True)
            binaries.append((port,binary))
        for mode in ['noop','edit']:
            with contextlib.redirect_stdout(io.StringIO()):expected=backend(source,mode)
            assert mode!='noop' or expected==source
            if mode=='edit':
                selected=active_unbound_slot(source)
                inactive=0 if selected[0]['offset']>=14*4096 else 14*4096
                assert expected[inactive:inactive+14*4096]==source[inactive:inactive+14*4096]
                for sector in [30,31]:assert expected[sector*4096+0xFF0:(sector+1)*4096]==source[sector*4096+0xFF0:(sector+1)*4096]
                main=radical_bag.offsets(expected)['main']
                assert struct.unpack_from('<H',expected,main[325]+2)[0]==327
                assert expected[main[-1]:main[-1]+4]==bytes(4)
            output=tmp/'browser.sav'
            subprocess.run(['node',str(ROOT/'frontend/scripts/radical-red-regression.mjs'),str(inp),str(output),mode],check=True)
            assert output.read_bytes()==expected, f'browser {mode}: '+str(next((i for i,(a,b) in enumerate(zip(output.read_bytes(),expected)) if a!=b),None))
            for port,binary in binaries:
                output=tmp/(port+'.sav')
                subprocess.run([str(binary),str(inp),str(output),mode],cwd=ROOT/port,check=True)
                actual=output.read_bytes();assert actual==expected,f'{port} {mode}: '+str(next((i for i,(a,b) in enumerate(zip(actual,expected)) if a!=b),None))
    assert hashlib.sha256(path.read_bytes()).hexdigest()==before
    select_profile('unbound-2.1.1.1')
    print('Radical Red no-op and combined-edit bytes match all four runtimes; private fixture unchanged.')
if __name__=='__main__':main()
