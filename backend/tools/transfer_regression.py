#!/usr/bin/env python3
"""Cross-runtime Party/PC Transfer parity regression (Python, JS, Switch C++, 3DS C++)."""
import argparse
import asyncio
import importlib.util
import json
from pathlib import Path
import random
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
sys.path.insert(0, str(ROOT / 'backend/tools'))

from core.profile import get_profile, select_profile
from core.sections import active_unbound_slot, refresh_checksum
from modules import party as party_mod, pc as pc_mod, transfer as transfer_mod
from modules.change_ledger import ChangeLedger
from tools.mutation_property_regression import fixture

PORTS = ('switch-homebrew', '3ds-homebrew')


def _make_party_record(species_id, *, pid, otid, item_id, exp, moves, pp_ups, happiness, ball_id, evs, iv_word, nickname, ot_name, markings=0x05, pokerus=0x23, met_loc=0x44, origins=0x1234):
    raw = bytearray(100)
    struct.pack_into('<II', raw, 0x00, pid, otid)
    raw[0x08:0x12] = party_mod.encode_text(nickname, 10)
    raw[0x12] = 0x02
    raw[0x13] = 0x02
    raw[0x14:0x1B] = party_mod.encode_text(ot_name, 7)
    raw[0x1B] = markings
    struct.pack_into('<HHI', raw, 0x20, species_id, item_id, exp)
    pp_up_byte = (pp_ups[0] & 3) | ((pp_ups[1] & 3) << 2) | ((pp_ups[2] & 3) << 4) | ((pp_ups[3] & 3) << 6)
    raw[0x28] = pp_up_byte
    raw[0x29] = happiness
    raw[0x2A] = ball_id
    for i in range(4):
        struct.pack_into('<H', raw, 0x2C + i * 2, moves[i])
        raw[0x34 + i] = min(255, party_mod.calculate_max_pp(moves[i], pp_ups[i]))
    raw[0x38:0x3E] = bytes(evs)
    raw[0x44] = pokerus
    raw[0x45] = met_loc
    struct.pack_into('<HI', raw, 0x46, origins, iv_word)
    pk = party_mod.Pokemon(raw)
    gr = party_mod.get_species_growth_rate(species_id)
    lv = max(1, min(100, party_mod.calc_current_level(0 if gr is None else gr, exp)))
    pk.raw[0x54] = lv
    pk.raw[0x55] = 0xFF
    pk.recalculate_party_stats(clamp_hp=False)
    return bytearray(pk.pack_data())


def _build_test_saves(profile_id: str, rng: random.Random):
    select_profile(profile_id)
    profile = get_profile()
    is_unbound = profile_id == 'unbound-2.1.1.1'
    base, _ = fixture(profile, rng, (40, 41), (7, 3), 16)
    offsets = active_unbound_slot(base)
    sec1_off = offsets[1]['offset']

    # Clear all ordinary PC slots first, then populate deterministic slots
    sectors = pc_mod.get_active_pc_sectors(base)
    stream, headers, originals, _ = pc_mod.rebuild_buffer(base, sectors)
    stream[:] = b'\x00' * len(stream)

    party_specs = [
        (1, 0x11223344, 0x0A0B0C0D, 13, 125000, [33, 618, 620, 89], [1, 2, 3, 0], 140, 3, [4, 252, 0, 252, 0, 0], 0xBFFFFFFF, 'Bulba', 'Red'),
        (6, 0x22334455, 0x0A0B0C0D, 17, 250000, [53, 89, 52, 0], [3, 0, 1, 0], 200, 1, [0, 0, 4, 252, 252, 0], 0x3FFFFFFF, 'Zard', 'Red'),
        (25, 0x33445566, 0x0A0B0C0D, 20, 64000, [85, 98, 231, 113], [2, 1, 0, 3], 255, 4, [0, 100, 50, 100, 0, 0], 0x8001F01F, 'Pika', 'Red'),
        (150, 0x44556677, 0x0A0B0C0D, 0, 500000, [94, 196, 247, 105], [3, 3, 3, 3], 70, 0, [6, 0, 0, 252, 252, 0], 0x3FFFFFFF, 'Mewtwo', 'Red'),
        (257, 0x55667788, 0x0A0B0C0D, 13, 320000, [136, 157, 24, 14], [1, 2, 3, 1], 90, 10, [0, 252, 0, 252, 0, 4], 0x3FFFFFFF, 'Blaze', 'Red'),
        (445, 0x66778899, 0x0A0B0C0D, 17, 700000, [89, 200, 444, 157], [3, 3, 0, 2], 180, 12, [4, 252, 0, 252, 0, 0], 0xBFFFFFFF, 'Chomp', 'Red'),
    ]
    for i, sp in enumerate(party_specs):
        rec = _make_party_record(
            sp[0], pid=sp[1], otid=sp[2], item_id=sp[3], exp=sp[4], moves=sp[5],
            pp_ups=sp[6], happiness=sp[7], ball_id=sp[8], evs=sp[9], iv_word=sp[10],
            nickname=sp[11], ot_name=sp[12],
        )
        off = sec1_off + 0x38 + i * 100
        base[off:off + 100] = rec
    struct.pack_into('<I', base, sec1_off + 0x34, 6)
    refresh_checksum(base, sec1_off)

    # Box 1 slot 1: valid mon (high move IDs + HA bit + PP ups)
    pc_mon_1 = transfer_mod.party_raw_to_pc_raw(_make_party_record(
        130, pid=0x99887766, otid=0x12345678, item_id=17, exp=350000,
        moves=[618, 620, 89, 53], pp_ups=[3, 2, 1, 0], happiness=123,
        ball_id=5, evs=[4, 252, 0, 252, 0, 0], iv_word=0xBFFFFFFF,
        nickname='Gyara', ot_name='Leaf', markings=0x0A, pokerus=0x35, met_loc=0x7B, origins=0x2345,
    ))
    stream[0:58] = pc_mon_1

    # Box 1 slot 2: unknown native species record (must stay reserved and untouched!)
    unknown_rec = bytearray(58)
    struct.pack_into('<H', unknown_rec, 28, 0xFFFF)
    unknown_rec[0:8] = b'\xDE\xAD\xBE\xEF\xCA\xFE\xBA\xBE'
    stream[58:116] = unknown_rec

    # Swap slot: Unbound Box 23 slot 4 (crosses sec 2/3 boundary), RR Box 25 slot 1
    swap_box, swap_slot = (23, 4) if is_unbound else (25, 1)
    swap_idx = ((swap_box - 1) * 30 + (swap_slot - 1)) * 58
    stream[swap_idx:swap_idx + 58] = transfer_mod.party_raw_to_pc_raw(_make_party_record(
        149, pid=0xABCDEF01, otid=0x01020304, item_id=13, exp=420000,
        moves=[200, 89, 245, 7], pp_ups=[2, 2, 2, 2], happiness=210,
        ball_id=11, evs=[0, 252, 0, 252, 4, 0], iv_word=0x3FFFFFFF,
        nickname='Dnite', ot_name='Blue',
    ))

    # Leave boundary target empty: Unbound Box 20 slot 1, RR Box 25 slot 5
    pc_mod.write_save_HYBRID(base, sectors, stream, headers, originals, None, preset_buffer=None)
    main_save = bytes(base)

    # Single-mon party fixture
    one_buf = bytearray(main_save)
    struct.pack_into('<I', one_buf, sec1_off + 0x34, 1)
    for idx in range(1, 6):
        off = sec1_off + 0x38 + idx * 100
        one_buf[off:off + 100] = b'\x00' * 100
    refresh_checksum(one_buf, sec1_off)
    one_save = bytes(one_buf)

    # Full-PC fixture (every ordinary slot has non-zero species)
    full_buf = bytearray(main_save)
    full_sectors = pc_mod.get_active_pc_sectors(full_buf)
    full_stream, full_headers, full_originals, _ = pc_mod.rebuild_buffer(full_buf, full_sectors)
    for pos in range(0, len(full_stream), 58):
        if struct.unpack_from('<H', full_stream, pos + 28)[0] == 0:
            full_stream[pos:pos + 58] = pc_mon_1
    pc_mod.write_save_HYBRID(full_buf, full_sectors, full_stream, full_headers, full_originals, None, preset_buffer=None)
    full_save = bytes(full_buf)

    return main_save, one_save, full_save, bytes(unknown_rec), bytes(pc_mon_1)


def _assert_rejects_immutable(base: bytes, **kwargs):
    copy = bytearray(base)
    try:
        transfer_mod.transfer_party_pc(copy, **kwargs)
    except (ValueError, LookupError):
        assert bytes(copy) == base, f'Rejected transfer mutated bytes for {kwargs}'
        return
    raise AssertionError(f'Expected rejection for {kwargs}')


def _format_label(res: dict) -> str:
    p_num = int(res['party_index']) + 1
    if res['mode'] == 'party_to_pc':
        return f"Move Party #{p_num} -> Box {res['box']}-{res['slot']}"
    if res['mode'] == 'pc_to_party':
        return f"Move Box {res['box']}-{res['slot']} -> Party #{p_num}"
    return f"Swap Party #{p_num} <-> Box {res['box']}-{res['slot']}"


def _run_python(main_save: bytes, one_save: bytes, full_save: bytes, unknown_rec: bytes, pc_mon_1: bytes, profile_id: str, out_prefix: Path):
    select_profile(profile_id)
    is_unbound = profile_id == 'unbound-2.1.1.1'
    boundary_box, boundary_slot = (20, 1) if is_unbound else (25, 5)
    swap_box, swap_slot = (23, 4) if is_unbound else (25, 1)
    box_count = 24 if is_unbound else 25

    buf = bytearray(main_save)
    ledger = ChangeLedger()

    def do_step(**kwargs):
        before = bytes(buf)
        res = transfer_mod.transfer_party_pc(buf, **kwargs)
        assert ledger.record(before, buf, 'party_pc_transfer', _format_label(res)) is not None
        return res

    r1 = do_step(mode='party_to_pc', party_index=0, box=boundary_box, slot=boundary_slot)
    assert r1['party_count'] == 5
    # Verify compaction and zeroed trailing 100 B slot
    sec1_off = active_unbound_slot(buf)[1]['offset']
    assert buf[sec1_off + 0x38 + 5 * 100 : sec1_off + 0x38 + 6 * 100] == b'\x00' * 100
    out_prefix.with_name(f'{out_prefix.name}-s1.sav').write_bytes(bytes(buf))

    r2 = do_step(mode='party_to_pc', party_index=1, box=None, slot=None)
    assert (r2['box'], r2['slot'], r2['party_count']) == (1, 3, 4)
    # Unknown species slot 1-2 must stay untouched!
    secs = pc_mod.get_active_pc_sectors(buf)
    stream, _, _, _ = pc_mod.rebuild_buffer(buf, secs)
    assert bytes(stream[58:116]) == unknown_rec
    out_prefix.with_name(f'{out_prefix.name}-s2.sav').write_bytes(bytes(buf))

    r3 = do_step(mode='pc_to_party', party_index=None, box=1, slot=1)
    assert (r3['party_index'], r3['party_count']) == (4, 5)
    # Verify decompressed Party fields from pc_mon_1
    mon_off = sec1_off + 0x38 + 4 * 100
    party_raw = bytes(buf[mon_off:mon_off + 100])
    assert struct.unpack_from('<H', party_raw, 0x1C)[0] == 0
    assert struct.unpack_from('<I', party_raw, 0x50)[0] == 0
    assert party_raw[0x55] == 0xFF
    assert party_raw[0x44:0x4C] == pc_mon_1[0x32:0x3A]
    pk = party_mod.Pokemon(party_raw)
    assert pk.get_moves_ids() == [618, 620, 89, 53]
    assert pk.get_move_pp() == pk.get_move_pp_max()
    expected_stats = party_mod.calculate_battle_stats(130, party_raw[0x54], pk.get_nature_id(), pk.get_ivs(), pk.get_evs())
    assert struct.unpack_from('<HHHHHHH', party_raw, 0x56) == (
        expected_stats['HP'], expected_stats['HP'], expected_stats['Atk'],
        expected_stats['Def'], expected_stats['Spe'], expected_stats['SpA'], expected_stats['SpD'],
    )
    secs = pc_mod.get_active_pc_sectors(buf)
    stream, _, _, _ = pc_mod.rebuild_buffer(buf, secs)
    assert bytes(stream[0:58]) == b'\x00' * 58
    out_prefix.with_name(f'{out_prefix.name}-s3.sav').write_bytes(bytes(buf))

    r4 = do_step(mode='swap_party_pc', party_index=2, box=swap_box, slot=swap_slot)
    assert r4['party_count'] == 5
    out_prefix.with_name(f'{out_prefix.name}-s4.sav').write_bytes(bytes(buf))

    r5a = do_step(mode='party_to_pc', party_index=4, box=1, slot=1)
    assert r5a['party_count'] == 4
    r5b = do_step(mode='pc_to_party', party_index=None, box=1, slot=1)
    assert (r5b['party_index'], r5b['party_count']) == (4, 5)
    assert bytes(buf[mon_off:mon_off + 100]) == party_raw
    out_prefix.with_name(f'{out_prefix.name}-s5.sav').write_bytes(bytes(buf))

    # Verify inactive generation, opaque sec 4 (Unbound), aux footers, and RTC trailer preserved
    assert bytes(buf[-16:]) == main_save[-16:]
    inactive_start = 0 if sec1_off >= 14 * 4096 else 14 * 4096
    assert bytes(buf[inactive_start:inactive_start + 14 * 4096]) == main_save[inactive_start:inactive_start + 14 * 4096]
    if is_unbound:
        sec4_off = active_unbound_slot(main_save)[4]['offset']
        assert bytes(buf[sec4_off:sec4_off + 4096]) == main_save[sec4_off:sec4_off + 4096]
    assert bytes(buf[30 * 4096 + 4080:31 * 4096]) == main_save[30 * 4096 + 4080:31 * 4096]
    assert bytes(buf[31 * 4096 + 4080:32 * 4096]) == main_save[31 * 4096 + 4080:32 * 4096]

    # Rejections with zero-byte immutability
    _assert_rejects_immutable(bytes(buf), mode='party_to_pc', party_index=0, box=1, slot=3)
    _assert_rejects_immutable(bytes(buf), mode='party_to_pc', party_index=0, box=1, slot=2)
    _assert_rejects_immutable(bytes(buf), mode='pc_to_party', party_index=None, box=1, slot=1)
    _assert_rejects_immutable(bytes(buf), mode='pc_to_party', party_index=None, box=1, slot=2)
    _assert_rejects_immutable(bytes(buf), mode='swap_party_pc', party_index=0, box=1, slot=1)
    _assert_rejects_immutable(bytes(buf), mode='swap_party_pc', party_index=0, box=1, slot=2)
    _assert_rejects_immutable(bytes(buf), mode='party_to_pc', party_index=0, box=26, slot=1)
    _assert_rejects_immutable(bytes(buf), mode='pc_to_party', party_index=None, box=26, slot=1)
    _assert_rejects_immutable(bytes(buf), mode='party_to_pc', party_index=0, box=box_count + 1, slot=1)
    _assert_rejects_immutable(bytes(buf), mode='party_to_pc', party_index=0, box=1, slot=31)
    _assert_rejects_immutable(bytes(buf), mode='party_to_pc', party_index=5, box=1, slot=1)
    _assert_rejects_immutable(main_save, mode='pc_to_party', party_index=None, box=1, slot=3)

    ledger.undo(buf)
    ledger.undo(buf)
    out_prefix.with_name(f'{out_prefix.name}-undo_to_s4.sav').write_bytes(bytes(buf))
    while ledger.summary(buf, main_save)['can_undo']:
        ledger.undo(buf)
    assert bytes(buf) == main_save
    out_prefix.with_name(f'{out_prefix.name}-undo_all.sav').write_bytes(bytes(buf))

    do_step(mode='swap_party_pc', party_index=0, box=1, slot=1)
    assert bytes(buf) != main_save
    ledger.reset(buf, main_save)
    assert bytes(buf) == main_save
    out_prefix.with_name(f'{out_prefix.name}-reset.sav').write_bytes(bytes(buf))

    # Single-mon fixture
    _assert_rejects_immutable(one_save, mode='party_to_pc', party_index=0, box=1, slot=3)
    _assert_rejects_immutable(one_save, mode='party_to_pc', party_index=0, box=None, slot=None)
    one_buf = bytearray(one_save)
    one_res = transfer_mod.transfer_party_pc(one_buf, mode='swap_party_pc', party_index=0, box=1, slot=1)
    assert one_res['party_count'] == 1
    out_prefix.with_name(f'{out_prefix.name}-one_swap.sav').write_bytes(bytes(one_buf))

    # Full-PC fixture
    _assert_rejects_immutable(full_save, mode='party_to_pc', party_index=0, box=None, slot=None)
    _assert_rejects_immutable(full_save, mode='party_to_pc', party_index=0, box=1, slot=None)

    return ['s1', 's2', 's3', 's4', 's5', 'undo_to_s4', 'undo_all', 'reset', 'one_swap']


async def _run_asgi_smoke(main_save: bytes, profile_id: str):
    from urllib.parse import urlsplit
    import main as main_app

    async def req(method: str, path: str, body_json=None, file_bytes=None):
        body = b''
        headers = []
        if file_bytes is not None:
            boundary = 'PUSETransferBoundary'
            body = (
                f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.sav"\r\n'
                f'Content-Type: application/octet-stream\r\n\r\n'
            ).encode() + file_bytes + f'\r\n--{boundary}--\r\n'.encode()
            headers = [(b'content-type', f'multipart/form-data; boundary={boundary}'.encode())]
        elif body_json is not None:
            body = json.dumps(body_json).encode('utf-8')
            headers = [(b'content-type', b'application/json')]
        headers.append((b'content-length', str(len(body)).encode()))
        url = urlsplit(path)
        sent = False
        messages = []

        async def receive():
            nonlocal sent
            if sent:
                return {'type': 'http.disconnect'}
            sent = True
            return {'type': 'http.request', 'body': body, 'more_body': False}

        async def send(message):
            messages.append(message)

        scope = {
            'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
            'method': method, 'scheme': 'http', 'path': url.path, 'raw_path': url.path.encode(),
            'query_string': url.query.encode(), 'root_path': '', 'headers': headers,
            'client': ('test', 1), 'server': ('test', 80),
        }
        await main_app.app(scope, receive, send)
        status = next(m['status'] for m in messages if m['type'] == 'http.response.start')
        raw_body = b''.join(m.get('body', b'') for m in messages if m['type'] == 'http.response.body')
        return status, json.loads(raw_body.decode('utf-8'))

    st, _ = await req('POST', f'/upload?profile_id={profile_id}', file_bytes=main_save)
    assert st == 200
    st, _ = await req('GET', '/pc/load')
    assert st == 200

    # Transfer while pc_context is loaded; verify stale context was invalidated and /pc/box reflects change
    st, body = await req('POST', '/transfer/party-pc', body_json={
        'mode': 'party_to_pc', 'party_index': 0, 'box': None, 'slot': None,
    })
    assert st == 200 and body['box'] == 1 and body['slot'] == 3 and body['party_count'] == 5, body
    st, party_rows = await req('GET', '/party')
    assert st == 200 and len(party_rows) == 5
    st, box1_rows = await req('GET', '/pc/box/1')
    assert st == 200 and any(int(r['slot']) == 3 for r in box1_rows)

    # Preset Box 26 rejected
    st, _ = await req('POST', '/transfer/party-pc', body_json={
        'mode': 'party_to_pc', 'party_index': 0, 'box': 26, 'slot': 1,
    })
    assert st == 400

    # Undo restores exact initial party & PC state
    st, _ = await req('POST', '/history/undo')
    assert st == 200
    st, party_rows = await req('GET', '/party')
    assert st == 200 and len(party_rows) == 6
    st, box1_rows = await req('GET', '/pc/box/1')
    assert st == 200 and not any(int(r['slot']) == 3 for r in box1_rows)


def _run_asgi_or_delegate(save_path: Path, profile_id: str, main_save: bytes):
    has_asgi = (
        importlib.util.find_spec('fastapi') is not None
        and importlib.util.find_spec('starlette') is not None
        and (
            importlib.util.find_spec('python_multipart') is not None
            or importlib.util.find_spec('multipart') is not None
        )
    )
    if has_asgi:
        asyncio.run(_run_asgi_smoke(main_save, profile_id))
        return
    venv_py = ROOT / 'backend/.venv/bin/python3'
    if venv_py.is_file():
        subprocess.run(
            [str(venv_py), str(Path(__file__).resolve()), '--asgi-only', str(save_path), profile_id],
            check=True,
        )
        return
    raise RuntimeError('FastAPI/Starlette unavailable for ASGI smoke check')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=int, default=20261126)
    parser.add_argument('--asgi-only', nargs=2, metavar=('SAVE', 'PROFILE'))
    args = parser.parse_args()

    if args.asgi_only:
        save_path, profile_id = args.asgi_only
        asyncio.run(_run_asgi_smoke(Path(save_path).read_bytes(), profile_id))
        return

    rng = random.Random(args.seed)

    select_profile('unbound-2.1.1.1')
    party_mod.load_static_data()
    pc_mod.load_static_data()

    initialized = []
    try:
        for port in PORTS:
            tmp = ROOT / port / 'artifacts/tmp'
            if tmp.exists() and any(tmp.iterdir()):
                raise RuntimeError(f'Preserve existing parity artifacts: {tmp}')

        binaries = []
        core_sources = ('SaveSections', 'SaveHealth', 'ChangeLedger', 'SaveSession', 'Party', 'Pc', 'Transfer')
        for port in PORTS:
            subprocess.run([str(ROOT / port / 'scripts/parity_tmp.sh'), 'init'], check=True)
            initialized.append(port)
            binary = ROOT / port / 'artifacts/tmp/port/transfer-native'
            subprocess.run([
                'g++', '-std=c++17', '-O1', '-I' + str(ROOT / port / 'include'),
                *[str(ROOT / port / f'source/core/{name}.cpp') for name in core_sources],
                str(ROOT / port / 'source/io/DataLoader.cpp'),
                str(ROOT / 'backend/tools/transfer_native.cpp'),
                '-o', str(binary),
            ], check=True)
            binaries.append((port, binary))

        tmp = ROOT / PORTS[0] / 'artifacts/tmp'
        js_cases = []
        expected_stages = []

        for profile_id in ('unbound-2.1.1.1', 'radical-red-4.1'):
            main_save, one_save, full_save, unknown_rec, pc_mon_1 = _build_test_saves(profile_id, rng)
            main_inp = tmp / f'source/{profile_id}-main.sav'
            one_inp = tmp / f'source/{profile_id}-one.sav'
            full_inp = tmp / f'source/{profile_id}-full.sav'
            main_inp.write_bytes(main_save)
            one_inp.write_bytes(one_save)
            full_inp.write_bytes(full_save)

            py_prefix = tmp / f'source/py-{profile_id}'
            stages = _run_python(main_save, one_save, full_save, unknown_rec, pc_mon_1, profile_id, py_prefix)

            for port, binary in binaries:
                port_prefix = ROOT / port / f'artifacts/tmp/port/native-{profile_id}'
                subprocess.run(
                    [str(binary), str(main_inp), str(one_inp), str(full_inp), str(port_prefix), profile_id],
                    cwd=ROOT / port,
                    check=True,
                )
                for stage in stages:
                    expected_path = py_prefix.with_name(f'{py_prefix.name}-{stage}.sav')
                    actual_path = port_prefix.with_name(f'{port_prefix.name}-{stage}.sav')
                    subprocess.run(
                        [str(ROOT / port / 'scripts/parity_tmp.sh'), 'compare', str(expected_path), str(actual_path)],
                        check=True,
                        stdout=subprocess.DEVNULL,
                    )

            _run_asgi_or_delegate(main_inp, profile_id, main_save)

            js_prefix = tmp / f'port/js-{profile_id}'
            js_cases.append({
                'profile': profile_id,
                'main_input': str(main_inp),
                'one_input': str(one_inp),
                'full_pc_input': str(full_inp),
                'out_prefix': str(js_prefix),
            })
            expected_stages.append((py_prefix, js_prefix, stages, profile_id))

        manifest_path = tmp / 'source/transfer_cases.json'
        manifest_path.write_text(json.dumps(js_cases))
        subprocess.run(['node', str(ROOT / 'frontend/scripts/transfer-runner.mjs'), str(manifest_path)], check=True)
        for py_prefix, js_prefix, stages, profile_id in expected_stages:
            for stage in stages:
                expected = py_prefix.with_name(f'{py_prefix.name}-{stage}.sav').read_bytes()
                actual = js_prefix.with_name(f'{js_prefix.name}-{stage}.sav').read_bytes()
                assert actual == expected, f'JS mismatch at {profile_id}/{stage}'

        print(f'PASS: Party/PC transfer parity verified across all 4 runtimes ({len(js_cases)} profiles x all stages + ASGI smoke).')
    finally:
        select_profile('unbound-2.1.1.1')
        for port in initialized:
            subprocess.run([str(ROOT / port / 'scripts/parity_tmp.sh'), 'cleanup'], check=True)


if __name__ == '__main__':
    main()
