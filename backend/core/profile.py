"""Built-in verified game profiles. Recognition never proves an exact version.

Unbound and Radical Red 4.1 are explicitly registered in schema v1. Legacy core
entry points use the selected immutable built-in; sessions retain its ID. Adding another profile requires
codecs and operation dispatch, not just dropping a JSON file into this folder.
"""
import json
from pathlib import Path
from types import MappingProxyType
from core.profile_schema import validate_contract

DEFAULT_PROFILE_ID = 'unbound-2.1.1.1'


def _freeze(value):
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


_ROOT = Path(__file__).resolve().parents[1] / 'data/profiles'
_IDS = (DEFAULT_PROFILE_ID, 'radical-red-4.1')
_SERIALIZATIONS = {id_:(_ROOT/(id_+'.json')).read_text(encoding='utf-8') for id_ in _IDS}
_REGISTRY = MappingProxyType({id_:_freeze(validate_contract(json.loads(value))) for id_,value in _SERIALIZATIONS.items()})
_active_id = DEFAULT_PROFILE_ID


class _ActiveProfile:
    """Read-only view of the profile attached to the single editor session."""
    def __getitem__(self, key): return _REGISTRY[_active_id][key]
    def get(self, key, default=None): return _REGISTRY[_active_id].get(key, default)


PROFILE = _ActiveProfile()


def get_profile(profile_id=None):
    profile_id = _active_id if profile_id is None else profile_id
    if profile_id not in _REGISTRY:
        raise ValueError(f'Unsupported game profile: {profile_id}')
    return _REGISTRY[profile_id]


def all_profiles():
    return tuple(_REGISTRY.values())


def select_profile(profile_id):
    """Select explicitly; validate assets before refreshing profile-scoped legacy caches.

    Each application has one loaded editing session. Recognition itself uses
    immutable descriptors and never changes the selected profile/caches.
    """
    global _active_id
    profile = get_profile(profile_id)
    base = Path(__file__).resolve().parents[1] / "data" / profile.get("catalog_base", "")
    for entry in profile["catalogs"].values():
        if not (base / entry["file"]).is_file(): raise ValueError("Missing required profile catalog: " + entry["file"])
    if profile_id == _active_id: return
    _active_id = profile_id
    import importlib, sys
    for name in ('core.sections','modules.party','modules.pc','modules.bag','modules.money'):
        if name in sys.modules:
            module = importlib.reload(sys.modules[name])
            if hasattr(module, 'load_static_data'): module.load_static_data()
            if name == 'modules.bag':
                module.load_item_names_from_file()
                module.load_tm_names_from_file()


def serialized_profile(profile_id=None):
    return _SERIALIZATIONS[get_profile(profile_id)['id']]


def catalog_file(key, profile_id=None):
    profile = get_profile(profile_id)
    base = profile.get('catalog_base', '')
    return str(Path(base)/profile['catalogs'][key]['file'])


def supports(feature, runtime='backend'):
    profile=get_profile()
    status=profile['capabilities'].get(feature,{}).get(runtime)
    if status is None and profile['id']==DEFAULT_PROFILE_ID:
        if feature=='pc_insert':status=profile['capabilities']['pc'][runtime]
        elif feature in ('bp','caught_ball_edit','trainer'):status='read-write'
    return status not in (None,'unavailable','preserve-only')


def require_capability(feature, runtime='backend'):
    if not supports(feature, runtime):
        raise ValueError(f'Unsupported operation for {get_profile()["id"]}: {feature}')


def native_identity(native_id, profile_id=None):
    """Native IDs remain primary; national mappings are optional metadata."""
    return (get_profile(profile_id)['id'], int(native_id))


def inspect_pc_record(raw, known_species=(), profile_id=None):
    """Classify storage without coercing unknown/invalid data into empty slots.

    Existing public readers keep their legacy validity filters; this lossless
    inspector makes absence of catalog metadata distinct from an empty record.
    """
    profile = get_profile(profile_id)
    codec = profile['codecs']['pc']
    if len(raw) != codec['record_size']:
        raise ValueError('Invalid compact record width')
    off = codec['fields']['species']
    species_id = int.from_bytes(raw[off:off + 2], 'little')
    state = 'empty' if species_id == 0 else 'known' if species_id in known_species else 'unknown'
    return {'identity': native_identity(species_id, profile_id), 'state': state, 'raw': bytes(raw)}


def recognize_save(data):
    from core.sections import active_slot
    candidates = []
    for profile in all_profiles():
        if active_slot(data, profile, verify_checksums=False):
            candidates.append({'profile_id':profile['id'], 'game':profile['identity']['game'],
                'versions':list(profile['identity']['versions']),
                'confidence':'structural-family-candidate',
                'requires_explicit_selection':profile['id'] != DEFAULT_PROFILE_ID})
    return {'candidates':candidates,'requires_selection':len(candidates)>1 or any(c['requires_explicit_selection'] for c in candidates)}


def choose_profile(data, requested=None):
    recognition = recognize_save(data)
    if requested:
        profile = get_profile(requested)
        if not any(c['profile_id']==requested for c in recognition['candidates']):
            raise ValueError('Save does not match the selected profile container')
        return profile['id']
    if recognition['requires_selection']:
        raise ValueError('Explicit game/version selection required; a save signature does not prove Radical Red 4.1')
    return recognition['candidates'][0]['profile_id'] if recognition['candidates'] else DEFAULT_PROFILE_ID
