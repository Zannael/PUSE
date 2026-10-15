#!/usr/bin/env python3
"""Profile contract, lifecycle and pre-refactor byte-equivalence regressions."""
import sys, hashlib, json, contextlib, io
import copy, subprocess, tempfile, asyncio
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'backend'))
from tools.pc_storage_regression import fixture, backend_result
from modules import pc, money, party, bag, pokedex_flags
from core.sections import active_unbound_slot, refresh_checksum

def digest(data): return hashlib.sha256(data).hexdigest()
def snapshots():
    result={}
    for name,counters,rotations in [('normal',(40,41),(7,3)),('rollover',(0xffffffff,0),(0,13)),('first',(41,40),(13,0))]:
        save,stream,maps=fixture(counters,rotations)
        selected=active_unbound_slot(save)
        key=lambda case:name+'/'+case
        result[key('noop')]=digest(backend_result(save)[0])
        edited=bytearray(stream); edited[58:116]=bytes(58); edited[0:58]=stream[116:174]
        result[key('pc')]=digest(backend_result(save,edited)[0])
        sectors=pc.get_active_pc_sectors(save)
        buf,headers,originals,preset=pc.rebuild_buffer(save,sectors)
        preset[0xb0+25]=91
        pc.write_save_HYBRID(save,sectors,buf,headers,originals,None,preset)
        with contextlib.redirect_stdout(io.StringIO()):
            save=bytearray(money.patch_money_everywhere(save,123456))
            bagoff=selected[13]['offset']
            save[bagoff+0x1a8:bagoff+0x1ac]=bytes([1,0,2,0]); refresh_checksum(save,bagoff)
            bag.write_slot(save,bagoff+0x1a8,1,9,'id_qty')
        off=selected[1]['offset']
        raw=bytearray(100); raw[0x20:0x22]=(1).to_bytes(2,'little')
        mon=party.Pokemon(raw); mon.set_happiness(123)
        save[off+0x38:off+0x38+100]=mon.pack_data(); refresh_checksum(save,off)
        pokedex_flags.set_pokedex_flag(save,1,'caught',True)
        result[key('combined')]=digest(save)
    return result

BASELINE = {
  "first/combined": "4965052296192fe7898fcfd04d590c8e0288d2f5af3bd0f89111d857edaffa36",
  "first/noop": "6faa089fddda8b004288252f119e17a53b75c4f93f213a857efdcc0d3bfdfd05",
  "first/pc": "7e35555e12bbaaa10352bb454f4d2fe83d307aa693b907577d75223dc346b845",
  "normal/combined": "17b68aa7bea05f6c4264641f634c7a4afe91945ec6e06287a47f03cf16a9f326",
  "normal/noop": "7903e81fa8cf354fc084f42fc9b5f5cd386837297966870e878a4928efce3926",
  "normal/pc": "e5871cdb2209c2ef9c8525c3f51d1cdb8bf34bdf7297a4d7682096c86a76a0b1",
  "rollover/combined": "f4374d08a77faa1fa6e1f263a4f50ba938651b2d0bd61ae8f4655b73a803e153",
  "rollover/noop": "d1d0cdbca0983127af3989f1e0aebaf8477f3093e9e9f460d7660f834248c20f",
  "rollover/pc": "899dd004bd4542263ed6e63196ea5d4098a3b762c84a08fa6b053c821780e190"
}


def main():
    from core.profile import PROFILE, get_profile, inspect_pc_record, native_identity, serialized_profile
    from core.profile_schema import validate_contract
    assert snapshots() == BASELINE, 'Pre-profile Unbound output bytes changed'
    try:
        get_profile('unknown')
        raise AssertionError('Unregistered profile accepted')
    except ValueError: pass
    try:
        PROFILE['rules']['shiny_threshold'] = 8
        raise AssertionError('Profile is mutable')
    except TypeError: pass
    canonical = json.loads(serialized_profile())
    for mutate in [lambda p: p.update(schema_version=2), lambda p: p.update(id='unknown'),
                   lambda p: p['codecs']['pc'].update(record_size=59),
                   lambda p: p['catalogs']['species'].update(file='../private.sav'),
                   lambda p: p['storage']['pc']['regions'].pop(),
                   lambda p: p['capabilities']['pc'].pop('3ds')]:
        bad = copy.deepcopy(canonical); mutate(bad)
        try:
            validate_contract(bad)
            raise AssertionError('Invalid contract accepted')
        except ValueError: pass
    unknown = bytearray(58)
    assert inspect_pc_record(unknown)['state'] == 'empty'
    unknown[28:30] = bytes([255,255])
    assert inspect_pc_record(unknown)['state'] == 'unknown'
    assert inspect_pc_record(unknown)['raw'] == unknown
    assert inspect_pc_record(unknown, {65535})['state'] == 'known'
    assert native_identity(65535) == ('unbound-2.1.1.1',65535)
    source, stream, maps = fixture()
    # Unknown species survive a neighboring PC release, even when legacy
    # presentation filters omit them. Presence is never rewritten as emptiness.
    stream[58:116] = unknown
    from tools.pc_storage_regression import scatter, refresh
    for offsets in maps: scatter(source, offsets, stream); refresh(source, offsets)
    edited = bytearray(stream); edited[116:174] = bytes(58)
    expected, _ = backend_result(source, edited)
    assert backend_result(expected)[1][58:116] == unknown
    subprocess.run([sys.executable,str(ROOT/'backend/tools/sync_game_profiles.py'),'--check'],check=True)
    ports = ['switch-homebrew','3ds-homebrew']
    for port in ports:
        existing=ROOT/port/'artifacts/tmp'
        if existing.exists() and any(existing.iterdir()): raise RuntimeError(f'Preserve existing artifacts in {existing}')
    try:
        for port in ports:
            subprocess.run([str(ROOT/port/'scripts/parity_tmp.sh'),'init'],check=True)
            tmp=ROOT/port/'artifacts/tmp'
            inp=tmp/'source/input.sav'; inp.write_bytes(source)
            (tmp/'source/profile.json').write_text(serialized_profile())
            binary=tmp/'port/profile'
            subprocess.run(['g++','-std=c++17','-I'+str(ROOT/port/'include'),
                *[str(ROOT/port/f'source/core/{name}.cpp') for name in ['SaveSession','SaveSections','Pc','Party']],
                str(ROOT/port/'source/io/DataLoader.cpp'),
                str(ROOT/port/'tests/profile_parity.cpp'),'-o',str(binary)],check=True)
            exported=tmp/'port/export.sav'
            compiled=subprocess.check_output([str(binary),str(inp),str(exported)])
            assert json.loads(compiled) == canonical, port
            assert exported.read_bytes() == source, port
            (tmp/'port/profile.json').write_bytes(compiled)
            subprocess.run([str(ROOT/port/'scripts/parity_tmp.sh'),'compare',str(tmp/'source/profile.json'),str(tmp/'port/profile.json')],check=True)
            browser=subprocess.check_output(['node',str(ROOT/'frontend/scripts/profile-regression.mjs'),str(inp)])
            assert json.loads(browser) == canonical
    finally:
        for port in ports: subprocess.run([str(ROOT/port/'scripts/parity_tmp.sh'),'cleanup'],check=True)
    # Upload contract remains unchanged while the backend session binds a profile.
    with contextlib.redirect_stdout(io.StringIO()):
        import main as api
        from fastapi import UploadFile
        upload=UploadFile(filename='synthetic.sav',file=io.BytesIO(source))
        upload.file._rolled=False
        response=asyncio.run(api.upload_save(upload))
    assert response == {'message':'File synthetic.sav loaded successfully!'}
    assert api.current_save['profile_id'] == PROFILE['id']
    assert api.current_save['data'] == source
    async def reject_unknown_insert():
        await api.load_pc()
        before = bytes(api.current_save['pc_context']['pc_buffer'])
        from fastapi import HTTPException
        try:
            await api.insert_pc_mon(api.PCInsert(box=1,slot=2,species_id=1,level=5))
            raise AssertionError('Unknown record overwritten')
        except HTTPException as error:
            assert error.status_code == 400 and error.detail == 'Target slot is occupied'
        assert api.current_save['pc_context']['pc_buffer'] == before
        preset = api.current_save['pc_context']['preset_buffer']
        preset[0xB0+28:0xB0+30] = bytes([255,255])
        preset_before = bytes(preset)
        try:
            await api.insert_pc_mon(api.PCInsert(box=26,slot=1,species_id=1,level=5))
            raise AssertionError('Unknown preset overwritten')
        except HTTPException as error:
            assert error.status_code == 400 and error.detail == 'Target slot is occupied'
        assert preset == preset_before
    asyncio.run(reject_unknown_insert())
    print('PASS: shared contract, immutable selection, session lifecycle, native IDs and pre-refactor byte equivalence')


if __name__ == '__main__': main()
