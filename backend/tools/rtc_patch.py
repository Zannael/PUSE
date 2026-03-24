#!/usr/bin/env python3
import argparse
import json
import struct
from pathlib import Path

SECTION_SIZE = 0x1000
PAYLOAD_SIZE = 0xFF0
CHECKSUM_LEN_MAX = 0xFF4
SAVE_BODY_LEN = 0x20000


def ru16(buf, off):
    return struct.unpack_from("<H", buf, off)[0]


def ru32(buf, off):
    return struct.unpack_from("<I", buf, off)[0]


def wu16(buf, off, value):
    struct.pack_into("<H", buf, off, value & 0xFFFF)


def iter_sections(buf):
    body_len = min(len(buf), SAVE_BODY_LEN)
    for off in range(0, body_len, SECTION_SIZE):
        sid = ru16(buf, off + 0xFF4)
        sidx = ru32(buf, off + 0xFFC)
        yield {
            "off": off,
            "id": sid,
            "save_idx": sidx,
            "valid_len": ru32(buf, off + 0xFF0),
        }


def sections_by_id(buf):
    out = {}
    for sec in iter_sections(buf):
        out.setdefault(sec["id"], []).append(sec)
    for sid in out:
        out[sid].sort(key=lambda s: s["save_idx"], reverse=True)
    return out


def latest_section(by_id, sid):
    items = by_id.get(sid, [])
    return items[0] if items else None


def gba_checksum(buf, section_off, length):
    full = length - (length % 4)
    total = 0
    for i in range(0, full, 4):
        total = (total + ru32(buf, section_off + i)) & 0xFFFFFFFF
    if length % 4:
        tail = bytes(buf[section_off + full: section_off + length]) + (b"\x00" * (4 - (length % 4)))
        total = (total + struct.unpack("<I", tail)[0]) & 0xFFFFFFFF
    return ((total >> 16) + (total & 0xFFFF)) & 0xFFFF


def normalized_valid_len(vlen):
    if vlen == 0 or vlen > CHECKSUM_LEN_MAX:
        return CHECKSUM_LEN_MAX
    return vlen


def recalc_section_checksum(buf, sec):
    ln = normalized_valid_len(sec["valid_len"])
    chk = gba_checksum(buf, sec["off"], ln)
    wu16(buf, sec["off"] + 0xFF6, chk)
    return chk


def build_manifest(broken_bytes, fixed_bytes):
    broken_map = sections_by_id(broken_bytes)
    fixed_map = sections_by_id(fixed_bytes)

    changes_by_id = {}
    for sid in sorted(set(broken_map.keys()) & set(fixed_map.keys())):
        bsec = latest_section(broken_map, sid)
        fsec = latest_section(fixed_map, sid)
        if bsec is None or fsec is None:
            continue

        sec_changes = []
        boff = bsec["off"]
        foff = fsec["off"]
        for rel in range(PAYLOAD_SIZE):
            bv = broken_bytes[boff + rel]
            fv = fixed_bytes[foff + rel]
            if bv != fv:
                sec_changes.append({
                    "rel_off": rel,
                    "from": bv,
                    "to": fv,
                })

        if sec_changes:
            changes_by_id[str(sid)] = {
                "sid": sid,
                "broken_latest": {"save_idx": bsec["save_idx"], "off": bsec["off"]},
                "fixed_latest": {"save_idx": fsec["save_idx"], "off": fsec["off"]},
                "count": len(sec_changes),
                "changes": sec_changes,
            }

    rtc_core_ids = [0]
    rtc_aux_ids = [sid for sid in sorted(int(k) for k in changes_by_id.keys()) if sid not in rtc_core_ids]

    return {
        "format": 1,
        "notes": "Derived from broken vs NPC-fixed save. Apply carefully by section id/relative offsets.",
        "changes_by_id": changes_by_id,
        "profiles": {
            "core_only": rtc_core_ids,
            "core_plus_aux": rtc_core_ids + rtc_aux_ids,
        },
    }


def apply_profile(input_bytes, manifest, profile_name, mirror_count):
    out = bytearray(input_bytes)
    sec_map = sections_by_id(out)

    if profile_name not in manifest["profiles"]:
        raise ValueError(f"Unknown profile: {profile_name}")

    target_ids = manifest["profiles"][profile_name]
    touched_offsets = set()

    for sid in target_ids:
        sid_key = str(sid)
        info = manifest["changes_by_id"].get(sid_key)
        if not info:
            continue

        copies = [s for s in sec_map.get(sid, []) if s["save_idx"] > 0]
        if not copies:
            continue
        copies = copies[:max(1, mirror_count)]

        for sec in copies:
            base = sec["off"]
            for ch in info["changes"]:
                rel = ch["rel_off"]
                out[base + rel] = ch["to"]
            touched_offsets.add(base)

    for sid in target_ids:
        for sec in sec_map.get(sid, [])[:max(1, mirror_count)]:
            if sec["off"] in touched_offsets:
                recalc_section_checksum(out, sec)

    return bytes(out)


def cmd_diff(args):
    broken = Path(args.broken).read_bytes()
    fixed = Path(args.fixed).read_bytes()
    if len(broken) != len(fixed):
        raise SystemExit(f"Size mismatch: broken={len(broken)} fixed={len(fixed)}")

    manifest = build_manifest(broken, fixed)
    out_path = Path(args.out)
    out_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"Manifest written: {out_path}")
    for sid in sorted(int(k) for k in manifest["changes_by_id"].keys()):
        c = manifest["changes_by_id"][str(sid)]["count"]
        print(f"  section {sid}: {c} byte changes")
    print(f"Profiles: {manifest['profiles']}")


def cmd_apply(args):
    input_bytes = Path(args.input).read_bytes()
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    out_bytes = apply_profile(input_bytes, manifest, args.profile, args.mirror_count)

    out_path = Path(args.out)
    out_path.write_bytes(out_bytes)
    print(f"Patched save written: {out_path}")


def build_coherent_generation(base_bytes, source_idx, target_idx):
    out = bytearray(base_bytes)
    sec_map = sections_by_id(out)

    # Work on regular section ids 0..13 only.
    work_ids = list(range(14))
    dest_by_id = {}

    for sid in work_ids:
        copies = sec_map.get(sid, [])
        src = next((s for s in copies if s["save_idx"] == source_idx), None)
        if src is None:
            raise ValueError(f"Missing source section id={sid} save_idx={source_idx}")

        older = [s for s in copies if s["save_idx"] < source_idx]
        if not older:
            raise ValueError(f"Missing destination section id={sid} older than save_idx={source_idx}")
        dst = sorted(older, key=lambda s: s["save_idx"], reverse=True)[0]

        # Copy payload and key footer fields from source to destination.
        out[dst["off"]: dst["off"] + PAYLOAD_SIZE] = out[src["off"]: src["off"] + PAYLOAD_SIZE]

        src_valid_len = ru32(out, src["off"] + 0xFF0)
        struct.pack_into("<I", out, dst["off"] + 0xFF0, src_valid_len)
        # Preserve section index/footer aux bytes from source.
        out[dst["off"] + 0xFF8: dst["off"] + 0xFFC] = out[src["off"] + 0xFF8: src["off"] + 0xFFC]

        wu16(out, dst["off"] + 0xFF4, sid)
        struct.pack_into("<I", out, dst["off"] + 0xFFC, target_idx)

        dest_by_id[sid] = {
            "off": dst["off"],
            "id": sid,
            "save_idx": target_idx,
            "valid_len": src_valid_len,
        }

    for sid in work_ids:
        recalc_section_checksum(out, dest_by_id[sid])

    return bytes(out), dest_by_id


def cmd_repair(args):
    broken = Path(args.broken).read_bytes()
    fixed = Path(args.fixed).read_bytes()
    if len(broken) != len(fixed):
        raise SystemExit(f"Size mismatch: broken={len(broken)} fixed={len(fixed)}")

    manifest = build_manifest(broken, fixed)
    broken_map = sections_by_id(broken)

    if args.source_saveidx is None:
        src_candidates = []
        for sid in range(14):
            if sid in broken_map and broken_map[sid]:
                src_candidates.append(broken_map[sid][0]["save_idx"])
        if not src_candidates:
            raise SystemExit("Could not infer source save_idx")
        source_idx = min(src_candidates)
    else:
        source_idx = int(args.source_saveidx)

    target_idx = int(args.target_saveidx) if args.target_saveidx is not None else (source_idx + 1)

    coherent_bytes, dest_by_id = build_coherent_generation(broken, source_idx, target_idx)

    out = bytearray(coherent_bytes)
    if args.profile not in manifest["profiles"]:
        raise SystemExit(f"Unknown profile: {args.profile}")

    for sid in manifest["profiles"][args.profile]:
        sid_key = str(sid)
        info = manifest["changes_by_id"].get(sid_key)
        if not info:
            continue
        dst = dest_by_id.get(sid)
        if not dst:
            continue
        base = dst["off"]
        for ch in info["changes"]:
            out[base + ch["rel_off"]] = ch["to"]
        recalc_section_checksum(out, dst)

    Path(args.out).write_bytes(bytes(out))
    print(f"Repaired save written: {args.out}")
    print(f"source_idx={source_idx} target_idx={target_idx} profile={args.profile}")
    print("Patched section ids:", manifest["profiles"][args.profile])


def latest_map(buf):
    out = {}
    for sid, items in sections_by_id(buf).items():
        if items:
            out[sid] = items[0]
    return out


def cmd_repair_layout(args):
    broken = bytearray(Path(args.broken).read_bytes())
    fixed = bytearray(Path(args.fixed).read_bytes())
    if len(broken) != len(fixed):
        raise SystemExit(f"Size mismatch: broken={len(broken)} fixed={len(fixed)}")

    manifest = build_manifest(broken, fixed)
    profile = args.profile
    if profile not in manifest["profiles"]:
        raise SystemExit(f"Unknown profile: {profile}")

    broken_latest = latest_map(broken)
    fixed_latest = latest_map(fixed)

    source_idx = int(args.source_saveidx) if args.source_saveidx is not None else 766
    target_idx = int(args.target_saveidx) if args.target_saveidx is not None else 767

    out = bytearray(broken)
    for sid in range(14):
        bsec = broken_latest.get(sid)
        fsec = fixed_latest.get(sid)
        if bsec is None or fsec is None:
            raise SystemExit(f"Missing section id={sid} in broken/fixed")
        if bsec["save_idx"] != source_idx:
            raise SystemExit(f"Unexpected broken save_idx for id={sid}: {bsec['save_idx']} (expected {source_idx})")
        if fsec["save_idx"] != target_idx:
            raise SystemExit(f"Unexpected fixed save_idx for id={sid}: {fsec['save_idx']} (expected {target_idx})")

        so = bsec["off"]
        do = fsec["off"]

        out[do:do + PAYLOAD_SIZE] = out[so:so + PAYLOAD_SIZE]
        out[do + 0xFF0:do + SECTION_SIZE] = fixed[do + 0xFF0:do + SECTION_SIZE]

        wu16(out, do + 0xFF4, sid)
        struct.pack_into("<I", out, do + 0xFFC, target_idx)

        recalc_section_checksum(out, {
            "off": do,
            "id": sid,
            "save_idx": target_idx,
            "valid_len": ru32(out, do + 0xFF0),
        })

    for sid in manifest["profiles"][profile]:
        info = manifest["changes_by_id"].get(str(sid))
        if not info:
            continue
        fsec = fixed_latest[sid]
        do = fsec["off"]
        for ch in info["changes"]:
            out[do + ch["rel_off"]] = ch["to"]
        recalc_section_checksum(out, {
            "off": do,
            "id": sid,
            "save_idx": target_idx,
            "valid_len": ru32(out, do + 0xFF0),
        })

    Path(args.out).write_bytes(bytes(out))
    print(f"Layout-aware repaired save written: {args.out}")
    print(f"source_idx={source_idx} target_idx={target_idx} profile={profile}")
    print("Patched section ids:", manifest["profiles"][profile])


def main():
    p = argparse.ArgumentParser(description="RTC tampering diff/apply helper")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("diff", help="Build manifest from broken vs fixed saves")
    d.add_argument("--broken", required=True)
    d.add_argument("--fixed", required=True)
    d.add_argument("--out", required=True)
    d.set_defaults(func=cmd_diff)

    a = sub.add_parser("apply", help="Apply manifest profile to target save")
    a.add_argument("--input", required=True)
    a.add_argument("--manifest", required=True)
    a.add_argument("--profile", default="core_only")
    a.add_argument("--mirror-count", type=int, default=2)
    a.add_argument("--out", required=True)
    a.set_defaults(func=cmd_apply)

    r = sub.add_parser("repair", help="Create coherent new generation then apply RTC profile")
    r.add_argument("--broken", required=True)
    r.add_argument("--fixed", required=True)
    r.add_argument("--profile", default="core_only")
    r.add_argument("--source-saveidx", type=int)
    r.add_argument("--target-saveidx", type=int)
    r.add_argument("--out", required=True)
    r.set_defaults(func=cmd_repair)

    rl = sub.add_parser("repair-layout", help="Repair using fixed-file physical layout for target generation")
    rl.add_argument("--broken", required=True)
    rl.add_argument("--fixed", required=True)
    rl.add_argument("--profile", default="core_only")
    rl.add_argument("--source-saveidx", type=int)
    rl.add_argument("--target-saveidx", type=int)
    rl.add_argument("--out", required=True)
    rl.set_defaults(func=cmd_repair_layout)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
