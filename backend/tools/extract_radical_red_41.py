#!/usr/bin/env python3
"""Extract the explicitly verified English Radical Red 4.1 catalogs.

This is a hash-pinned profile extractor, not generic ROM discovery. It reads
live tables referenced by this ROM's header/code. Never writes ROM/save input.
"""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_unbound_item_table import DECODE

ROM_SHA256 = '679d112cdfe699c2793d82c7e7999ac9dfca9e222ad5a85d4f8f1e457cd0283f'
TABLES = {'species_names':0x14042CC, 'base_stats':0x17B98EC,
          'ability_names':0x10E32C0, 'move_names':0x10F3188,
          'move_data':0x11521D0, 'items':0x13C0000}
COUNTS = {'species':1376, 'abilities':282, 'moves':1004, 'items':750}


def decode(raw):
    return ''.join(DECODE.get(value, '?') for value in raw.split(b'\xff',1)[0]).strip()


def extract(rom):
    if hashlib.sha256(rom).hexdigest() != ROM_SHA256:
        raise ValueError('Unsupported ROM hash: this extractor is restricted to verified Radical Red 4.1')
    u32=lambda off:struct.unpack_from('<I',rom,off)[0]
    assert u32(0x144)==0x08000000+TABLES['species_names']
    assert u32(0x1BC)==0x08000000+TABLES['base_stats']
    assert u32(0x1C0)==0x08000000+TABLES['ability_names']
    assert u32(0x1C8)==0x08000000+TABLES['items']
    assert u32(0x1CC)==0x08000000+TABLES['move_data']
    assert u32(0x10A512C)==COUNTS['items']-1  # Live SanitizeItemId bound.
    assert rom[0x444B0:0x444B4] == bytes.fromhex('072a00d8') # shiny XOR <= 7.
    catalogs={key:{} for key in ['species','items','moves','abilities','base_stats','identity','growth','species_abilities','pockets','move_pp','friendship']}
    for sid in range(COUNTS['species']):
        base=TABLES['species_names']+sid*11
        catalogs['species'][str(sid)]=decode(rom[base:base+11])
        off=TABLES['base_stats']+sid*28
        catalogs['base_stats'][str(sid)]=dict(zip(['hp','atk','def','spe','spa','spd'],rom[off:off+6]))
        catalogs['identity'][str(sid)]={'gender_threshold':rom[off+0x10]}
        catalogs['growth'][str(sid)]={'growth_rate':rom[off+0x13]}
        catalogs['friendship'][str(sid)]=rom[off+0x12]
        catalogs['species_abilities'][str(sid)]={'ability_1_id':rom[off+0x16],'ability_2_id':rom[off+0x17],'hidden_ability_id':rom[off+0x1A]}
    for aid in range(COUNTS['abilities']):
        off=TABLES['ability_names']+aid*17
        catalogs['abilities'][str(aid)]=decode(rom[off:off+17])
    for mid in range(COUNTS['moves']):
        off=TABLES['move_names']+mid*13
        catalogs['moves'][str(mid)]=decode(rom[off:off+13])
        catalogs['move_pp'][str(mid)]=rom[TABLES['move_data']+mid*12+4]
    for iid in range(COUNTS['items']):
        off=TABLES['items']+iid*44
        # ItemId_GetName supports an indirect name pointer in this live routine.
        pointer=u32(off)
        name=decode(rom[pointer-0x08000000:pointer-0x08000000+128]) if rom[off+3]==8 and 0x08000000<=pointer<0x0A000000 else decode(rom[off:off+14])
        catalogs['items'][str(iid)]=name
        catalogs['pockets'][str(iid)]=rom[off+26]
    assert catalogs['species']['1370']=='Terapagos'
    assert catalogs['species']['1375']=='Chillet'
    assert catalogs['items']['616']=='Clear Amulet'
    assert catalogs['move_pp']['1']==35
    assert all(0<=value['growth_rate']<=5 for sid,value in catalogs['growth'].items() if sid!='0')
    return {'profile_id':'radical-red-4.1','rom_sha256':ROM_SHA256,'tables':TABLES,'counts':COUNTS,'catalogs':catalogs}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    payload=extract(args.rom.read_bytes())
    args.out.mkdir(parents=True,exist_ok=True)
    (args.out/'catalog.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
    for key,file in [('species','pokemon.txt'),('items','items.txt'),('moves','moves.txt'),('abilities','abilities.txt')]:
        (args.out/file).write_text(''.join(f'{sid}:{name}\n' for sid,name in payload['catalogs'][key].items()))
    files={'base_stats':'species_base_stats.json','identity':'species_identity_meta.json','growth':'species_growth_rates.json','species_abilities':'species_abilities_meta.json'}
    for key,file in files.items(): (args.out/file).write_text(json.dumps(payload['catalogs'][key],indent=2)+'\n')
    moves={'moves':[{'move_id':int(mid),'base_pp':pp,'name':payload['catalogs']['moves'][mid]} for mid,pp in payload['catalogs']['move_pp'].items()]}
    (args.out/'move_table_from_rom.json').write_text(json.dumps(moves,indent=2)+'\n')
    pocket_names={1:'main',2:'key',3:'ball',4:'tm',5:'berry'}
    pockets={name:{'ids':[int(iid) for iid,pocket in payload['catalogs']['pockets'].items() if pocket==number and int(iid)>0]} for number,name in pocket_names.items()}
    pockets['hm']={'ids':[]}  # Distinct HM classification is not guessed from Unbound IDs.
    (args.out/'item_pocket_map.json').write_text(json.dumps({'pockets':pockets},indent=2)+'\n')
    print('Extracted verified Radical Red 4.1 native catalogs:',COUNTS)


if __name__=='__main__':main()
