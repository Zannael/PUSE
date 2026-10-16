import unbound from './gameProfile.json' with { type: 'json' };
import radical from './radicalRed41Profile.json' with { type: 'json' };

function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}
export const DEFAULT_PROFILE_ID = 'unbound-2.1.1.1';
const registry = freeze({ [unbound.id]: unbound, [radical.id]: radical });
let selectedId = DEFAULT_PROFILE_ID;
let radicalData = null;
export const PROFILE = new Proxy({}, {
    get: (_, key) => registry[selectedId][key],
    ownKeys: () => Reflect.ownKeys(registry[selectedId]),
    getOwnPropertyDescriptor: (_, key) => Object.hasOwn(registry[selectedId], key) ? {configurable:true,enumerable:true,value:registry[selectedId][key]} : undefined,
    set: () => false,
});

export function getProfile(id = selectedId) {
    if (!registry[id]) throw new Error(`Unsupported game profile: ${id}`);
    return registry[id];
}
export function allProfiles() { return Object.values(registry); }
export async function activateProfile(id) {
    getProfile(id);
    if (id === radical.id && !radicalData) radicalData = freeze((await import('./radicalRedCatalog.js')).default.catalogs);
    selectedId = id;
    return getProfile();
}
export function isRadicalRed() { return selectedId === radical.id; }
export function gameCatalog() {
    if (!radicalData) throw new Error('Radical Red catalog is not loaded');
    return radicalData;
}
export function profileData(key, fallback) {
    const active = () => isRadicalRed() ? (gameCatalog()[key] ?? {}) : fallback;
    return new Proxy({}, {
        get: (_, property) => active()[property],
        ownKeys: () => Reflect.ownKeys(active()),
        getOwnPropertyDescriptor: (_, property) => Object.hasOwn(active(), property) ? { configurable: true, enumerable: true, value: active()[property] } : undefined,
        set: () => false,
    });
}
export function catalogFile(key, id = selectedId) {
    const profile = getProfile(id);
    const entry = profile.catalogs[key];
    if (!entry) throw new Error(`Unknown profile catalog: ${key}`);
    return `${profile.catalog_base ? `${profile.catalog_base}/` : ''}${entry.file}`;
}
export function supports(feature, runtime = 'browser') {
    const profile = getProfile();
    let status = profile.capabilities[feature]?.[runtime];
    if (!status && profile.id === DEFAULT_PROFILE_ID) {
        if (feature === 'pc_insert') status = profile.capabilities.pc[runtime];
        else if (['bp', 'caught_ball_edit', 'trainer'].includes(feature)) status = 'read-write';
    }
    return !!status && !['unavailable', 'preserve-only'].includes(status);
}
export function requireCapability(feature) {
    if (!supports(feature)) throw new Error(`Unsupported operation for ${selectedId}: ${feature}`);
}
export function profileSummary() {
    const p = getProfile();
    return {id: p.id, game: p.identity.game, versions: p.identity.versions, box_count: p.storage.pc.box_count, capabilities: p.capabilities};
}
export function recognizeSave(bytes) {
    const candidates = [];
    const u16 = (off) => bytes[off] | (bytes[off+1] << 8);
    const u32 = (off) => (u16(off) | (u16(off+2) << 16)) >>> 0;
    for (const p of allProfiles()) {
        const c = p.container;
        for (let slot=0; slot<c.slot_count; slot+=1) {
            const base=slot*c.sections_per_slot*c.section_size;
            if (base+c.sections_per_slot*c.section_size>bytes.length) continue;
            const seen=new Set(); const counter=u32(base+c.footer.counter);
            for(let i=0; i<c.sections_per_slot; i+=1) {
                const off=base+i*c.section_size; const sid=u16(off+c.footer.id);
                if(sid>=c.sections_per_slot || seen.has(sid) || !c.signatures.includes(u32(off+c.footer.signature)) || u32(off+c.footer.counter)!==counter) break;
                seen.add(sid);
            }
            if(seen.size===c.sections_per_slot) {
                candidates.push({profile_id:p.id,game:p.identity.game,versions:p.identity.versions,confidence:'structural-family-candidate',requires_explicit_selection:p.id!==DEFAULT_PROFILE_ID});
                break;
            }
        }
    }
    return {candidates,requires_selection:candidates.length>1 || candidates.some((p)=>p.requires_explicit_selection)};
}
export function chooseProfile(bytes, requested = null) {
    const result = recognizeSave(bytes);
    if(requested) {
        getProfile(requested);
        if(!result.candidates.some((c)=>c.profile_id===requested)) throw new Error('Save does not match the selected profile container');
        return requested;
    }
    if(result.requires_selection) throw new Error('Explicit game/version selection required; a save signature does not prove Radical Red 4.1');
    return result.candidates[0]?.profile_id ?? DEFAULT_PROFILE_ID;
}
export function nativeIdentity(id, profileId = selectedId) { return [getProfile(profileId).id, Number(id)]; }
export function inspectPcRecord(raw, knownSpecies = new Set(), profileId = selectedId) {
    const codec = getProfile(profileId).codecs.pc;
    if (raw.length !== codec.record_size) throw new Error('Invalid compact record width');
    const off = codec.fields.species;
    const speciesId = raw[off] | (raw[off + 1] << 8);
    return {identity:nativeIdentity(speciesId,profileId),state:speciesId===0?'empty':knownSpecies.has(speciesId)?'known':'unknown',raw:new Uint8Array(raw)};
}
