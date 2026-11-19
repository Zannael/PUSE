"""Read-only, profile-scoped known fields. Never classify arbitrary event bits."""
from core.profile import get_profile
from core.sections import active_unbound_slot
from modules.party import decode_text

NOTICE = 'Known fields for the selected profile; layout evidence does not confirm the ROM version. Unknown flags are not classified.'


def build_field_report(data):
    profile = get_profile()
    sections = active_unbound_slot(data)
    if len(sections) != 14:
        raise ValueError('No coherent save generation for the selected profile')
    fields = []

    def add(key, label, sid, relative, width, bit=None, decoder=None, confidence='verified-layout'):
        offset = sections[sid]['offset'] + relative
        raw = bytes(data[offset:offset + width])
        value = int.from_bytes(raw, 'little')
        decoded = ('true' if value & (1 << bit) else 'false') if bit is not None else str(value)
        if decoder is not None:
            decoded = decoder(raw)
        fields.append(dict(id=key, label=label, section_id=sid, relative_offset=relative,
                           file_offset=offset, width=width, bit=bit, raw_hex=raw.hex(),
                           decoded=decoded, confidence=confidence))

    add('trainer.name', 'Trainer name', 0, 0, 7, decoder=decode_text)
    add('trainer.gender', 'Trainer gender byte (unclassified enum)', 0, 8, 1, confidence='layout-only')
    add('trainer.tid', 'Trainer ID', 0, 0xA, 2)
    add('trainer.sid', 'Secret ID', 0, 0xC, 2)
    party = profile['storage']['party']
    add('party.count', 'Stored party count', party['section_id'], party['count_offset'], 4)
    resources = profile['storage']['resources']
    key = 0
    if profile['id'] == 'radical-red-4.1':
        add('money.key', 'Money XOR key', 0, resources['key_offset'], 4)
        key = int.from_bytes(data[sections[0]['offset'] + resources['key_offset']:sections[0]['offset'] + resources['key_offset'] + 4], 'little')
    add('money.value', 'Stored money (decoded)', resources['trainer_section_id'], resources['money_offset'], 4,
        decoder=lambda raw: str(int.from_bytes(raw, 'little') ^ key))
    if profile['id'] == 'unbound-2.1.1.1':
        # These are the named flags already used by game_progress.py. The
        # standard flag array crosses section 1 into logical section 2.
        for flag, name, label in [(0x820 + n, f'badge.{n + 1}', f'Badge {n + 1}') for n in range(8)] + [
                (0x82C, 'progress.champion', 'Champion'), (0x91E, 'progress.dexnav', 'DexNav')]:
            if flag >= 0x900:
                sid, relative = 4, 0xD98 + (flag - 0x900) // 8
            else:
                sid, relative = 1, 0xEE0 + flag // 8
                while relative >= 0xFF0:
                    sid, relative = sid + 1, relative - 0xFF0
            add(name, label, sid, relative, 1, bit=flag % 8)
    return dict(schema_version=1, profile_id=profile['id'], read_only=True,
                exact_rom_version_confirmed=False, notice=NOTICE,
                save_index=sections[0]['idx'], fields=fields)
