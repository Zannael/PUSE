"""Verified Radical Red 4.1 fixed pockets, including the split main pocket."""
import json
import struct
from core.data_loader import catalog_path
from core.sections import active_unbound_slot, refresh_checksum

from core.profile import get_profile
_BAG = get_profile('radical-red-4.1')['storage']['bag']
POCKETS = {key:(regions,_BAG['pocket_capacities'][key]) for key,regions in _BAG['pocket_regions'].items()}
POCKET_NUMBER = {'main':1,'key':2,'ball':3,'tm':4,'berry':5}


def offsets(data):
    selected=active_unbound_slot(data)
    if not selected: raise ValueError('No intact Radical Red save generation')
    result={}
    for key,(regions,count) in POCKETS.items():
        positions=[]
        for sid,start,end in regions:
            base=selected[sid]['offset'] if sid<14 else sid*4096
            if base+end>len(data):raise ValueError('Bag auxiliary storage is truncated')
            positions.extend(range(base+start,base+end,4))
        assert len(positions)==count
        result[key]=positions
    return result


def rows(data, positions, names):
    filled=[]; empty=[]
    for position in positions:
        item,qty=struct.unpack_from('<HH',data,position)
        row={'offset':position,'id':item,'qty':qty,'name':names.get(item,f'Unknown item {item}'),'encoding':'id_qty'}
        (filled if item else empty).append(row)
    return filled+empty[:1]


def pocket(data, anchor, names):
    for positions in offsets(data).values():
        if anchor in positions:return rows(data,positions,names)
    raise ValueError('Invalid Radical Red bag anchor')


def bootstrap(data):
    result={}
    for key,positions in offsets(data).items():
        occupied=sum(struct.unpack_from('<H',data,position)[0]!=0 for position in positions)
        result[key]={'pocket_type':key,'anchor_offset':positions[0],'quality':'strict','slot_count':occupied,
                     'dup_count':0,'source':'verified-radical-red-4.1-regions','confidence':'high',
                     'ready':True,'locked':False,'is_empty_candidate':occupied==0}
    return result


def write(data, offset, item, quantity, encoding=None):
    if encoding not in (None,'id_qty'):raise ValueError('Invalid Radical Red bag encoding')
    layout=offsets(data)
    key=next((key for key,positions in layout.items() if offset in positions),None)
    if key is None:raise ValueError('Invalid Radical Red bag slot')
    catalog=json.loads(catalog_path('pockets').read_text())['pockets']
    if not 0<=item<=749 or not 0<=quantity<=65535:raise ValueError('Invalid bag item or quantity')
    if key in ('key','tm') and item:quantity=max(1,quantity)
    if item and quantity and item not in catalog[key]['ids']:raise ValueError('This item belongs in a different bag pocket')
    positions=layout[key];index=positions.index(offset)
    if item and quantity and struct.unpack_from('<H',data,offset)[0]==0:
        first=next((off for off in positions if struct.unpack_from('<H',data,off)[0]==0),None)
        if first!=offset:raise ValueError('Insert into the first empty bag slot')
    touched=[]
    if item==0 or quantity==0:
        for source,destination in zip(positions[index+1:],positions[index:-1]):
            replacement=data[source:source+4]
            if data[destination:destination+4]!=replacement:
                data[destination:destination+4]=replacement;touched.append(destination)
        data[positions[-1]:positions[-1]+4]=bytes(4);touched.append(positions[-1])
    else:
        struct.pack_into('<HH',data,offset,item,quantity);touched.append(offset)
    for base in {off//4096*4096 for off in touched}:
        refresh_checksum(data,base)
