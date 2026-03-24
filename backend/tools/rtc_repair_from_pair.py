#!/usr/bin/env python3
import argparse
import json
import struct
from pathlib import Path

SECTION_SIZE = 0x1000
PAYLOAD_SIZE = 0xFF0
SAVE_BODY_LEN = 0x20000
OPAQUE_IDS = {0, 4, 13}
DEFAULT_PROFILES = [
    "control",
    "id0_full",
    "id0_id13_full",
    "id0_id4_full",
    "id0_id4_id13_full",
    "id0_full_plus_aux12",
    "id0_id4_id13_full_plus_aux12",
]

QUICK_PROFILES = {
    "quick_id0_id4": [0, 4],
    "quick_id0_id4_id13": [0, 4, 13],
    "quick_id0_id4_id13_aux12": [0, 4, 13, 1, 2],
}


def ru16(buf, off):
    return struct.unpack_from("<H", buf, off)[0]


def ru32(buf, off):
    return struct.unpack_from("<I", buf, off)[0]


def wu16(buf, off, value):
    struct.pack_into("<H", buf, off, value & 0xFFFF)


def wu32(buf, off, value):
    struct.pack_into("<I", buf, off, value & 0xFFFFFFFF)


def iter_sections(buf):
    for off in range(0, SAVE_BODY_LEN, SECTION_SIZE):
        yield {
            "off": off,
            "id": ru16(buf, off + 0xFF4),
            "save_idx": ru32(buf, off + 0xFFC),
            "valid_len": ru32(buf, off + 0xFF0),
            "checksum": ru16(buf, off + 0xFF6),
        }


def latest_by_id(buf):
    out = {}
    for sec in iter_sections(buf):
        sid = sec["id"]
        if sid not in out or sec["save_idx"] > out[sid]["save_idx"]:
            out[sid] = sec
    return out


def gba_checksum(buf, off, length):
    full = length - (length % 4)
    total = 0
    for i in range(0, full, 4):
        total = (total + ru32(buf, off + i)) & 0xFFFFFFFF
    if length % 4:
        tail = bytes(buf[off + full: off + length]) + (b"\x00" * (4 - (length % 4)))
        total = (total + struct.unpack("<I", tail)[0]) & 0xFFFFFFFF
    return ((total >> 16) + (total & 0xFFFF)) & 0xFFFF


def recalc_standard_checksum(buf, sec_off):
    vlen = ru32(buf, sec_off + 0xFF0)
    ln = 0xFF4 if vlen == 0 or vlen > 0xFF4 else vlen
    chk = gba_checksum(buf, sec_off, ln)
    wu16(buf, sec_off + 0xFF6, chk)


def write_section_from_source(out, dst_sec, src_buf, src_sec, sid, target_idx):
    do = dst_sec["off"]
    so = src_sec["off"]

    out[do: do + PAYLOAD_SIZE] = src_buf[so: so + PAYLOAD_SIZE]
    out[do + 0xFF0: do + 0x1000] = src_buf[so + 0xFF0: so + 0x1000]

    wu16(out, do + 0xFF4, sid)
    wu32(out, do + 0xFFC, target_idx)

    if sid in OPAQUE_IDS:
        wu16(out, do + 0xFF6, src_sec["checksum"])
    else:
        recalc_standard_checksum(out, do)


def apply_manifest_bytes(out, dst_sec, changes, sid):
    do = dst_sec["off"]
    for ch in changes:
        out[do + int(ch["rel_off"])] = int(ch["to"])

    if sid not in OPAQUE_IDS:
        recalc_standard_checksum(out, do)


def build_candidate(broken, fixed, manifest, profile):
    out = bytearray(broken)
    b_latest = latest_by_id(broken)
    f_latest = latest_by_id(fixed)

    target_idx = max(sec["save_idx"] for sec in f_latest.values() if sec["id"] in range(14))

    section_source = {sid: "broken" for sid in range(14)}
    patch_ids = []

    if profile == "control":
        pass
    elif profile == "id0_full":
        section_source[0] = "fixed"
    elif profile == "id0_id13_full":
        section_source[0] = "fixed"
        section_source[13] = "fixed"
    elif profile == "id0_id4_full":
        section_source[0] = "fixed"
        section_source[4] = "fixed"
    elif profile == "id0_id4_id13_full":
        section_source[0] = "fixed"
        section_source[4] = "fixed"
        section_source[13] = "fixed"
    elif profile == "id0_full_plus_aux12":
        section_source[0] = "fixed"
        patch_ids = [1, 2]
    elif profile == "id0_id4_id13_full_plus_aux12":
        section_source[0] = "fixed"
        section_source[4] = "fixed"
        section_source[13] = "fixed"
        patch_ids = [1, 2]
    else:
        raise ValueError(f"Unknown profile: {profile}")

    for sid in range(14):
        dst = f_latest[sid]
        src = b_latest[sid] if section_source[sid] == "broken" else f_latest[sid]
        src_buf = broken if section_source[sid] == "broken" else fixed
        write_section_from_source(out, dst, src_buf, src, sid, target_idx)

    for sid in patch_ids:
        ch = manifest.get("changes_by_id", {}).get(str(sid), {}).get("changes", [])
        if ch:
            apply_manifest_bytes(out, f_latest[sid], ch, sid)

    return bytes(out)


def build_candidates_from_pair(broken, fixed, manifest, profiles=None):
    profile_list = profiles if profiles is not None else DEFAULT_PROFILES
    out = {}
    for prof in profile_list:
        cand = build_candidate(broken, fixed, manifest, prof)
        out[prof] = {
            "bytes": cand,
            "issues": verify_candidate(cand, fixed),
        }
    return out


def verify_candidate(buf, fixed):
    f_latest = latest_by_id(fixed)
    c_latest = latest_by_id(buf)
    target_idx = max(sec["save_idx"] for sec in f_latest.values() if sec["id"] in range(14))

    issues = []
    for sid in range(14):
        if sid not in c_latest or sid not in f_latest:
            issues.append(f"missing sid={sid}")
            continue
        cs = c_latest[sid]
        fs = f_latest[sid]
        if cs["save_idx"] != target_idx:
            issues.append(f"sid={sid} wrong idx {cs['save_idx']} != {target_idx}")
        if cs["off"] != fs["off"]:
            issues.append(f"sid={sid} wrong off {cs['off']} != {fs['off']}")
        if sid not in OPAQUE_IDS:
            vlen = ru32(buf, cs["off"] + 0xFF0)
            ln = 0xFF4 if vlen == 0 or vlen > 0xFF4 else vlen
            calc = gba_checksum(buf, cs["off"], ln)
            stored = ru16(buf, cs["off"] + 0xFF6)
            if calc != stored:
                issues.append(f"sid={sid} checksum mismatch {stored} != {calc}")
    return issues


def compute_layout_offset_for_saveidx(section_id, save_idx):
    base_block = 0 if (save_idx % 2 == 0) else 14
    rel = (section_id + (save_idx % 14)) % 14
    return (base_block + rel) * SECTION_SIZE


def build_quick_candidates_from_single(tampered, manifest):
    src_latest = latest_by_id(tampered)
    source_idx = max(src_latest[sid]["save_idx"] for sid in range(14) if sid in src_latest)
    target_idx = source_idx + 1

    # base coherent generation
    base = bytearray(tampered)
    dst_sections = {}

    for sid in range(14):
        src = src_latest.get(sid)
        if src is None:
            raise ValueError(f"Missing source section id={sid}")
        so = src["off"]
        do = compute_layout_offset_for_saveidx(sid, target_idx)

        base[do:do + PAYLOAD_SIZE] = tampered[so:so + PAYLOAD_SIZE]
        base[do + 0xFF0:do + 0x1000] = tampered[so + 0xFF0:so + 0x1000]
        wu16(base, do + 0xFF4, sid)
        wu32(base, do + 0xFFC, target_idx)

        if sid in OPAQUE_IDS:
            wu16(base, do + 0xFF6, src["checksum"])
        else:
            recalc_standard_checksum(base, do)

        dst_sections[sid] = {
            "off": do,
            "id": sid,
            "save_idx": target_idx,
            "valid_len": ru32(base, do + 0xFF0),
        }

    candidates = {}
    for name, sids in QUICK_PROFILES.items():
        cand = bytearray(base)
        for sid in sids:
            ch = manifest.get("changes_by_id", {}).get(str(sid), {}).get("changes", [])
            do = dst_sections[sid]["off"]
            for entry in ch:
                cand[do + int(entry["rel_off"])] = int(entry["to"])
            if sid not in OPAQUE_IDS:
                recalc_standard_checksum(cand, do)
            else:
                # Opaque sections use fixed reference checksum when available.
                fixed_chk = manifest.get("changes_by_id", {}).get(str(sid), {}).get("fixed_latest", {}).get("checksum")
                if fixed_chk is None:
                    fixed_chk = src_latest[sid]["checksum"]
                wu16(cand, do + 0xFF6, fixed_chk)

        candidates[name] = bytes(cand)

    return {
        "source_idx": source_idx,
        "target_idx": target_idx,
        "candidates": candidates,
    }


def main():
    p = argparse.ArgumentParser(description="Build RTC repair candidates from broken/fixed pair")
    p.add_argument("--broken", required=True)
    p.add_argument("--fixed", required=True)
    p.add_argument("--manifest", required=True)
    p.add_argument("--out-dir", required=True)
    args = p.parse_args()

    broken = Path(args.broken).read_bytes()
    fixed = Path(args.fixed).read_bytes()
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    candidates = build_candidates_from_pair(broken, fixed, manifest, DEFAULT_PROFILES)

    for prof in DEFAULT_PROFILES:
        cand = candidates[prof]["bytes"]
        out_path = out_dir / f"Unbound_2_candidate_layout2_{prof}.sav"
        out_path.write_bytes(cand)
        issues = candidates[prof]["issues"]
        print(f"{prof}: {'OK' if not issues else 'ISSUES'} -> {out_path}")
        if issues:
            for issue in issues[:10]:
                print("  -", issue)


if __name__ == "__main__":
    main()
