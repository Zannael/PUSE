"""Validation for PUSE game-profile contract v1 (no optional dependencies)."""


def validate_contract(profile):
    """Reject incomplete or unsupported contracts before generating bindings."""
    def require(condition, message):
        if not condition:
            raise ValueError('Invalid game profile: ' + message)
    require(isinstance(profile, dict), 'object required')
    require(profile.get('schema_version') == 1, 'unsupported schema version')
    for key in ('id', 'identity', 'container', 'storage', 'codecs', 'rules', 'catalogs', 'capabilities', 'requirements', 'evidence'):
        require(key in profile, f'missing {key}')
    require(profile['id'] in ('unbound-2.1.1.1', 'radical-red-4.1'), 'unregistered profile ID')
    c, storage, codecs = profile['container'], profile['storage'], profile['codecs']
    require(codecs['pc']['id'] in ('unbound-cfru-compact-v1','cfru-compact-58-v1'), 'unsupported PC codec')
    require(codecs['party']['id'] in ('unbound-party-v1','cfru-party-100-v1'), 'unsupported party codec')
    require(codecs['text']['id'] == 'puse-unbound-gen3-text-v1', 'unsupported text codec')
    require(c['checksum']['algorithm'] == 'gba-u32-fold16', 'unsupported checksum codec')
    require(c['section_size'] > c['footer']['counter'] + 3, 'footer outside sector')
    require(c['slot_count'] == 2 and c['sections_per_slot'] == 14, 'unsupported generation structure')
    for length in [c['checksum']['default_length'], *c['checksum']['lengths'].values()]:
        require(isinstance(length, int) and 0 < length <= c['footer']['payload_end'] and length % 4 == 0, 'checksum domain')
    require(c['signatures'] and all(isinstance(v, int) and 0 <= v <= 0xffffffff for v in c['signatures']), 'signatures')
    pc = storage['pc']
    require(pc['record_size'] == codecs['pc']['record_size'] == 58, 'compact record width')
    require(storage['party']['record_size'] == codecs['party']['record_size'] == 100, 'party record width')
    total = 0
    for sid, start, end in pc['regions']:
        require(0 <= sid < c['flash_size']//c['section_size'] and 0 <= start < end <= c['section_size'], 'PC region')
        total += end - start
    require(total == pc['box_count'] * pc['slots_per_box'] * pc['record_size'], 'PC capacity')
    for kind in ('pc', 'party'):
        require(all(isinstance(off, int) and 0 <= off < codecs[kind]['record_size'] for off in codecs[kind]['fields'].values()), f'{kind} offsets')
    require(profile['identity']['save_version_detection'] is False, 'unverified version detection')
    require(profile.get('catalog_base', '') in ('', 'games/radical-red-4.1'), 'catalog namespace path')
    for key, entry in profile['catalogs'].items():
        require(entry['id_space'] == profile['id'], f'{key} ID namespace')
        require('/' not in entry['file'] and '\\' not in entry['file'] and '..' not in entry['file'], f'{key} filename')
    for feature, runtimes in profile['capabilities'].items():
        require(set(runtimes) == {'backend', 'browser', 'switch', '3ds'}, f'{feature} runtime matrix')
    for feature, catalogs in profile['requirements'].items():
        require(feature in profile['capabilities'] and isinstance(catalogs, list) and all(key in profile['catalogs'] for key in catalogs), f'{feature} catalog prerequisites')
    return profile
