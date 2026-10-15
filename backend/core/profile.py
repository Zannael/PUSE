"""Built-in verified game profiles. Selection is explicit, never save detection.

Only Unbound is registered in schema v1. Legacy core entry points use that
immutable built-in; sessions retain its ID. Adding another profile requires
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


_PROFILE_PATH = Path(__file__).resolve().parents[1] / 'data/profiles' / (DEFAULT_PROFILE_ID + '.json')
_SERIALIZED = _PROFILE_PATH.read_text(encoding='utf-8')
_RAW = validate_contract(json.loads(_SERIALIZED))
if _RAW['schema_version'] != 1 or _RAW['id'] != DEFAULT_PROFILE_ID:
    raise ValueError('Unsupported built-in profile contract')
PROFILE = _freeze(_RAW)


def get_profile(profile_id=DEFAULT_PROFILE_ID):
    if profile_id != DEFAULT_PROFILE_ID:
        raise ValueError(f'Unsupported game profile: {profile_id}')
    return PROFILE


def serialized_profile():
    return _SERIALIZED


def catalog_file(key, profile_id=DEFAULT_PROFILE_ID):
    return get_profile(profile_id)['catalogs'][key]['file']


def native_identity(native_id, profile_id=DEFAULT_PROFILE_ID):
    """Native IDs remain primary; national mappings are optional metadata."""
    return (get_profile(profile_id)['id'], int(native_id))


def inspect_pc_record(raw, known_species=(), profile_id=DEFAULT_PROFILE_ID):
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
