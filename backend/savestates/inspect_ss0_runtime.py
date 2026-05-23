#!/usr/bin/env python3
import argparse
import struct
import sys
import zlib
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from modules.party import (
    DB_SPECIES,
    Pokemon,
    load_static_data,
    ru16,
    ru32,
    TRAINER_SECTION_ID,
)

SECTION_SIZE = 0x1000
PARTY_OFFSET = 0x38
PARTY_MON_SIZE = 100
CHECKSUM_OFFSET = 0x1C
PAYLOAD_OFFSET = 0x20
PAYLOAD_SIZE = 48


def parse_png_chunks(png_bytes):
    if png_bytes[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Not a PNG file")

    chunks = []
    cursor = 8
    while cursor + 8 <= len(png_bytes):
        length = struct.unpack(">I", png_bytes[cursor:cursor + 4])[0]
        ctype = png_bytes[cursor + 4:cursor + 8].decode("latin1")
        data_start = cursor + 8
        data_end = data_start + length
        payload = png_bytes[data_start:data_end]
        chunks.append((ctype, payload))
        cursor = data_end + 4
        if ctype == "IEND":
            break
    return chunks


def extract_state_blobs(ss0_path):
    raw = Path(ss0_path).read_bytes()
    blobs = []
    for ctype, payload in parse_png_chunks(raw):
        if ctype not in {"gbAs", "gbAx"}:
            continue

        zdata = None
        if payload[:2] in {b"\x78\x01", b"\x78\x9c", b"\x78\xda"}:
            zdata = payload
        elif len(payload) > 10 and payload[8:10] in {b"\x78\x01", b"\x78\x9c", b"\x78\xda"}:
            zdata = payload[8:]

        if zdata is None:
            blobs.append((ctype, payload))
            continue

        blobs.append((ctype, zlib.decompress(zdata)))
    return blobs


def active_trainer_section(save_bytes):
    candidates = []
    for sec_idx in range(len(save_bytes) // SECTION_SIZE):
        sec_off = sec_idx * SECTION_SIZE
        sec_id = ru16(save_bytes, sec_off + 0xFF4)
        if sec_id == TRAINER_SECTION_ID:
            save_idx = ru32(save_bytes, sec_off + 0xFFC)
            candidates.append((save_idx, sec_off))
    if not candidates:
        raise ValueError("No trainer section found in save")
    candidates.sort(reverse=True)
    return candidates[0][1]


def load_party_from_save(save_path):
    raw = Path(save_path).read_bytes()
    trainer_off = active_trainer_section(raw)
    trainer = raw[trainer_off:trainer_off + SECTION_SIZE]
    team_count = min(ru32(trainer, 0x34), 6)

    team = []
    for i in range(team_count):
        off = PARTY_OFFSET + i * PARTY_MON_SIZE
        mon_raw = bytes(trainer[off:off + PARTY_MON_SIZE])
        mon = Pokemon(mon_raw)
        team.append((i, mon, mon_raw))
    return team


def is_valid_party_struct(raw100):
    if len(raw100) != PARTY_MON_SIZE:
        return False
    payload = raw100[PAYLOAD_OFFSET:PAYLOAD_OFFSET + PAYLOAD_SIZE]
    checksum = 0
    for i in range(0, PAYLOAD_SIZE, 2):
        checksum = (checksum + ru16(payload, i)) & 0xFFFF
    expected = ru16(raw100, CHECKSUM_OFFSET)
    return checksum == expected


def find_exact_matches(blob, needle):
    out = []
    start = 0
    while True:
        pos = blob.find(needle, start)
        if pos < 0:
            break
        out.append(pos)
        start = pos + 1
    return out


def scan_species_level_candidates(blob, species_id, level):
    matches = []
    for off in range(0, len(blob) - PARTY_MON_SIZE + 1, 4):
        candidate = blob[off:off + PARTY_MON_SIZE]
        if not is_valid_party_struct(candidate):
            continue
        mon = Pokemon(candidate)
        if mon.get_species_id() == species_id and candidate[0x54] == level:
            matches.append(off)
    return matches


def struct_diff(raw_a, raw_b):
    return [i for i, (x, y) in enumerate(zip(raw_a, raw_b)) if x != y]


def summarize_pair(pre_path, in_path, save_path):
    load_static_data()
    party = load_party_from_save(save_path)
    pre_blobs = extract_state_blobs(pre_path)
    in_blobs = extract_state_blobs(in_path)

    print("=== Blob Overview ===")
    for idx, ((pre_name, pre_blob), (in_name, in_blob)) in enumerate(zip(pre_blobs, in_blobs)):
        equal = pre_blob == in_blob
        print(f"[{idx}] {pre_name} pre={len(pre_blob)} in={len(in_blob)} equal={equal}")

    print("\n=== Party Matches (exact 100-byte from .sav) ===")
    for i, mon, mon_raw in party:
        species = DB_SPECIES.get(mon.get_species_id(), "???")
        level = mon_raw[0x54]
        print(f"\nParty {i + 1}: {mon.nickname} | species={mon.get_species_id()} ({species}) | level={level}")
        for blob_idx, ((pre_name, pre_blob), (_, in_blob)) in enumerate(zip(pre_blobs, in_blobs)):
            pre_hits = find_exact_matches(pre_blob, mon_raw)
            in_hits = find_exact_matches(in_blob, mon_raw)
            if pre_hits or in_hits:
                print(
                    f"  blob[{blob_idx}] {pre_name}: pre_hits={len(pre_hits)} {pre_hits[:6]}"
                    f" | in_hits={len(in_hits)} {in_hits[:6]}"
                )

    lucario_id = next((sid for sid, name in DB_SPECIES.items() if name == "Lucario"), None)
    moltres_id = next((sid for sid, name in DB_SPECIES.items() if name == "Moltres"), None)
    if lucario_id is None or moltres_id is None:
        return

    print("\n=== Candidate Scan (valid checksum + species + level) ===")
    for blob_idx, (blob_name, blob) in enumerate(in_blobs):
        luc_hits = scan_species_level_candidates(blob, lucario_id, 26)
        mol_hits = scan_species_level_candidates(blob, moltres_id, 22)
        if luc_hits or mol_hits:
            print(f"blob[{blob_idx}] {blob_name}")
            if luc_hits:
                print(f"  Lucario lv26 offsets: {luc_hits[:12]}")
            if mol_hits:
                print(f"  Moltres lv22 offsets: {mol_hits[:12]}")

    # Focused check: first party mon offset(s) in gbAs pre -> what happens at same offset in in-battle.
    if party and pre_blobs and in_blobs and pre_blobs[0][0] == "gbAs" and in_blobs[0][0] == "gbAs":
        first_raw = party[0][2]
        pre_gbas = pre_blobs[0][1]
        in_gbas = in_blobs[0][1]
        pre_offsets = find_exact_matches(pre_gbas, first_raw)
        if pre_offsets:
            print("\n=== First Mon Offset Mutation Check (gbAs) ===")
            for off in pre_offsets[:8]:
                pre_struct = pre_gbas[off:off + PARTY_MON_SIZE]
                in_struct = in_gbas[off:off + PARTY_MON_SIZE]
                pre_mon = Pokemon(pre_struct)
                in_mon = Pokemon(in_struct)
                changed = struct_diff(pre_struct, in_struct)
                print(
                    f"offset {off}: pre={pre_mon.get_species_id()} ({DB_SPECIES.get(pre_mon.get_species_id(), '???')})"
                    f" lv{pre_struct[0x54]} chk=0x{ru16(pre_struct, CHECKSUM_OFFSET):04X}"
                    f" -> in={in_mon.get_species_id()} ({DB_SPECIES.get(in_mon.get_species_id(), '???')})"
                    f" lv{in_struct[0x54]} chk=0x{ru16(in_struct, CHECKSUM_OFFSET):04X}"
                    f" diff_bytes={len(changed)}"
                )


def main():
    parser = argparse.ArgumentParser(description="Inspect mGBA/RetroArch .ss0 runtime payloads")
    parser.add_argument("--pre", required=True, help="Pre-battle .ss0 path")
    parser.add_argument("--inbattle", required=True, help="In-battle .ss0 path")
    parser.add_argument("--save", required=True, help="Base .sav path")
    args = parser.parse_args()

    summarize_pair(args.pre, args.inbattle, args.save)


if __name__ == "__main__":
    main()
