import { PROFILE, gameCatalog } from './profile.js';
import { activeUnboundSlot } from './sections.js';
import { ru16, wu16 } from './binary.js';
import { recalculateSectionChecksum } from './checksum.js';

export function radicalBagOffsets(buffer) {
    const selected=activeUnboundSlot(buffer);
    if (!selected.size) throw new Error('No intact Radical Red save generation');
    const result={};
    for(const [key,regions] of Object.entries(PROFILE.storage.bag.pocket_regions)) {
        const positions=[];
        for(const [sid,start,end] of regions) {
            const base=sid<14?selected.get(sid).offset:sid*4096;
            if(base+end>buffer.length) throw new Error('Bag auxiliary storage is truncated');
            for(let off=base+start;off<base+end;off+=4) positions.push(off);
        }
        result[key]=positions;
    }
    return result;
}
export function radicalBagRows(buffer,anchor,names = new Map()) {
    const positions=Object.values(radicalBagOffsets(buffer)).find((rows)=>rows.includes(anchor));
    if(!positions) throw new Error('Invalid Radical Red bag anchor');
    const filled=[];const empty=[];
    for(const off of positions) {
        const id=ru16(buffer,off);const qty=ru16(buffer,off+2);
        const row={offset:off,id,qty,name:names.get(id)??`Unknown item ${id}`,encoding:'id_qty'};
        (id?filled:empty).push(row);
    }
    return [...filled,...empty.slice(0,1)];
}
export function radicalBagBootstrap(buffer) {
    return Object.fromEntries(Object.entries(radicalBagOffsets(buffer)).map(([key,positions])=>{
        const count=positions.filter((off)=>ru16(buffer,off)!==0).length;
        return [key,{pocket_type:key,anchor_offset:positions[0],quality:'strict',slot_count:count,dup_count:0,source:'verified-radical-red-4.1-regions',confidence:'high',ready:true,locked:false,is_empty_candidate:count===0}];
    }));
}
export function radicalBagWrite(buffer,off,item,quantity,encoding = null) {
    if(encoding!==null && encoding!=='id_qty') throw new Error('Invalid Radical Red bag encoding');
    const layout=radicalBagOffsets(buffer);
    const key=Object.keys(layout).find((key)=>layout[key].includes(off));
    if(!key) throw new Error('Invalid Radical Red bag slot');
    if(!Number.isInteger(item) || !Number.isInteger(quantity) || item<0 || item>749 || quantity<0 || quantity>65535) throw new Error('Invalid bag item or quantity');
    const number={main:1,key:2,ball:3,tm:4,berry:5}[key];
    if(['key','tm'].includes(key) && item) quantity=Math.max(1,quantity);
    if(item && quantity && gameCatalog().pockets[item]!==number) throw new Error('This item belongs in a different bag pocket');
    const positions=layout[key];const index=positions.indexOf(off);
    if(item && quantity && ru16(buffer,off)===0 && positions.find((at)=>ru16(buffer,at)===0)!==off) throw new Error('Insert into the first empty bag slot');
    const touched=new Set();
    if(item===0 || quantity===0) {
        for(let i=index;i<positions.length-1;i+=1) {
            const src=positions[i+1],dest=positions[i];
            for(let j=0;j<4;j+=1) {
                if(buffer[dest+j]!==buffer[src+j]) {buffer[dest+j]=buffer[src+j];touched.add(Math.floor(dest/4096)*4096);}
            }
        }
        buffer.fill(0,positions.at(-1),positions.at(-1)+4);touched.add(Math.floor(positions.at(-1)/4096)*4096);
    } else {wu16(buffer,off,item);wu16(buffer,off+2,quantity);touched.add(Math.floor(off/4096)*4096);}
    for(const base of touched) recalculateSectionChecksum(buffer,base);
}
