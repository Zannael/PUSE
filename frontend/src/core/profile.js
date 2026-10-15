import contract from './gameProfile.json' with { type: 'json' };

// Only this verified profile is registered. This is explicit selection, not
// save recognition. Additional games require codecs and operation dispatch.
function freeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}
export const PROFILE = freeze(contract);
export const DEFAULT_PROFILE_ID = PROFILE.id;
if (PROFILE.schema_version !== 1 || DEFAULT_PROFILE_ID !== 'unbound-2.1.1.1') {
    throw new Error('Unsupported built-in profile contract');
}

export function getProfile(id = DEFAULT_PROFILE_ID) {
    if (id !== DEFAULT_PROFILE_ID) throw new Error(`Unsupported game profile: ${id}`);
    return PROFILE;
}

export function catalogFile(key, id = DEFAULT_PROFILE_ID) {
    const entry = getProfile(id).catalogs[key];
    if (!entry) throw new Error(`Unknown profile catalog: ${key}`);
    return entry.file;
}

export function nativeIdentity(id, profileId = DEFAULT_PROFILE_ID) {
    return [getProfile(profileId).id, Number(id)];
}

export function inspectPcRecord(raw, knownSpecies = new Set(), profileId = DEFAULT_PROFILE_ID) {
    const codec = getProfile(profileId).codecs.pc;
    if (raw.length !== codec.record_size) throw new Error('Invalid compact record width');
    const off = codec.fields.species;
    const speciesId = raw[off] | (raw[off + 1] << 8);
    return {
        identity: nativeIdentity(speciesId, profileId),
        state: speciesId === 0 ? 'empty' : knownSpecies.has(speciesId) ? 'known' : 'unknown',
        raw: new Uint8Array(raw),
    };
}
