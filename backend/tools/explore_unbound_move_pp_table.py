#!/usr/bin/env python3
"""Explore likely ROM move-PP table layouts for Pokemon Unbound.

This is a discovery helper, not a final extractor.

It searches around the move-name table for candidate strided layouts where the
PP byte stream looks sane (mostly in 1..64) and optionally matches a known
early-move PP anchor.

Output:
- diagnostics JSON with ranked candidates
- optional extracted move->base_pp JSON from the top candidate
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from extract_unbound_moves_table import find_moves_table_base, infer_move_count_from_rom, load_move_count_from_txt


DEFAULT_PP_ANCHOR = [35, 25, 10, 15, 20, 20, 15, 15, 15, 35]


def parse_anchor(raw: str | None) -> list[int]:
    if not raw:
        return list(DEFAULT_PP_ANCHOR)
    out: list[int] = []
    for part in raw.split(","):
        token = part.strip()
        if not token:
            continue
        val = int(token)
        if val < 0 or val > 255:
            raise ValueError(f"Anchor value out of byte range: {val}")
        out.append(val)
    if not out:
        raise ValueError("Anchor cannot be empty")
    return out


def _as_int_pp(value) -> int | None:
    if isinstance(value, dict):
        if "base_pp" in value:
            value = value.get("base_pp")
        elif "pp" in value:
            value = value.get("pp")
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    if n < 0 or n > 255:
        return None
    return n


def load_reference_pp(path: Path, move_count: int) -> list[int] | None:
    if not path.exists():
        return None

    raw = json.loads(path.read_text(encoding="utf-8"))

    if isinstance(raw, dict) and "moves" in raw and isinstance(raw["moves"], dict):
        raw = raw["moves"]

    seq: list[int] = []

    if isinstance(raw, list):
        for entry in raw:
            pp = _as_int_pp(entry)
            if pp is None:
                continue
            seq.append(pp)
    elif isinstance(raw, dict):
        # Numeric-keyed map: {"1": 35} or {"1": {"base_pp": 35}}
        numeric_keys = [k for k in raw.keys() if str(k).isdigit()]
        if numeric_keys:
            by_id: dict[int, int] = {}
            for k, v in raw.items():
                ks = str(k)
                if not ks.isdigit():
                    continue
                pp = _as_int_pp(v)
                if pp is None:
                    continue
                by_id[int(ks)] = pp

            if 0 in by_id and 1 not in by_id:
                seq = [by_id.get(i, 0) for i in range(1, move_count + 1)]
            else:
                seq = [by_id.get(i, 0) for i in range(1, move_count + 1)]
        else:
            # Symbol-keyed map (e.g. MOVE_NONE, MOVE_POUND, ...): rely on insertion order.
            ordered = list(raw.items())
            if ordered and str(ordered[0][0]).upper() == "MOVE_NONE":
                ordered = ordered[1:]
            for _, v in ordered:
                pp = _as_int_pp(v)
                if pp is None:
                    continue
                seq.append(pp)
    else:
        raise RuntimeError(f"Unsupported reference format: {path}")

    if len(seq) < move_count:
        return None
    return seq[:move_count]


def pp_stats(seq: list[int]) -> dict[str, float | int]:
    n = len(seq)
    if n == 0:
        return {
            "count": 0,
            "in_1_64": 0,
            "in_1_80": 0,
            "zeros": 0,
            "gt_80": 0,
            "ratio_in_1_64": 0.0,
            "ratio_in_1_80": 0.0,
        }
    in_1_64 = sum(1 for x in seq if 1 <= x <= 64)
    in_1_80 = sum(1 for x in seq if 1 <= x <= 80)
    zeros = sum(1 for x in seq if x == 0)
    gt_80 = sum(1 for x in seq if x > 80)
    return {
        "count": n,
        "in_1_64": in_1_64,
        "in_1_80": in_1_80,
        "zeros": zeros,
        "gt_80": gt_80,
        "ratio_in_1_64": in_1_64 / n,
        "ratio_in_1_80": in_1_80 / n,
    }


def read_pp_sequence(rom: bytes, base: int, struct_size: int, pp_offset: int, count: int) -> list[int] | None:
    last = base + ((count - 1) * struct_size) + pp_offset
    if base < 0 or last >= len(rom):
        return None
    return [rom[base + (i * struct_size) + pp_offset] for i in range(count)]


def score_candidate(pp_seq: list[int], anchor: list[int], reference_seq: list[int] | None = None) -> tuple[int, int, int]:
    stats = pp_stats(pp_seq)
    base_score = int(stats["in_1_64"]) * 3 + int(stats["in_1_80"]) - int(stats["zeros"]) * 2 - int(stats["gt_80"]) * 4
    anchor_matches = 0
    for i, expected in enumerate(anchor):
        if i >= len(pp_seq):
            break
        if pp_seq[i] == expected:
            anchor_matches += 1

    reference_matches = 0
    if reference_seq is not None:
        upto = min(len(pp_seq), len(reference_seq))
        for i in range(upto):
            if pp_seq[i] == reference_seq[i]:
                reference_matches += 1

    return base_score + (anchor_matches * 20) + (reference_matches * 50), anchor_matches, reference_matches


def explore_candidates(
    rom: bytes,
    move_count: int,
    names_base: int,
    radius: int,
    struct_min: int,
    struct_max: int,
    anchor: list[int],
    reference_seq: list[int] | None,
    min_anchor_matches: int,
    min_reference_matches: int,
    topk: int,
) -> list[dict]:
    start = max(0, names_base - radius)
    end = min(len(rom), names_base + radius)
    first_anchor = anchor[0]

    first_positions = [i for i in range(start, end) if rom[i] == first_anchor]
    seen: set[tuple[int, int, int]] = set()
    ranked: list[tuple[int, dict]] = []

    for struct_size in range(struct_min, struct_max + 1):
        for pp_offset in range(struct_size):
            for pos in first_positions:
                base = pos - pp_offset
                key = (base, struct_size, pp_offset)
                if base < start or key in seen:
                    continue
                seen.add(key)

                quick_matches = 0
                for i, expected in enumerate(anchor):
                    addr = base + (i * struct_size) + pp_offset
                    if addr >= len(rom):
                        break
                    if rom[addr] == expected:
                        quick_matches += 1
                if quick_matches < min_anchor_matches:
                    continue

                seq = read_pp_sequence(rom, base, struct_size, pp_offset, move_count)
                if seq is None:
                    continue

                score, anchor_matches, reference_matches = score_candidate(seq, anchor, reference_seq)
                stats = pp_stats(seq)
                candidate = {
                    "table_base": base,
                    "struct_size": struct_size,
                    "pp_offset": pp_offset,
                    "score": score,
                    "anchor_matches": anchor_matches,
                    "reference_matches": reference_matches,
                    "reference_match_ratio": (reference_matches / len(reference_seq)) if reference_seq else None,
                    "stats": stats,
                    "sample_first_16": seq[:16],
                }
                if reference_seq is not None and reference_matches < min_reference_matches:
                    continue
                ranked.append((score, candidate))

    ranked.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in ranked[:topk]]


def export_pp_table(rom: bytes, move_count: int, candidate: dict) -> dict:
    base = int(candidate["table_base"])
    struct_size = int(candidate["struct_size"])
    pp_offset = int(candidate["pp_offset"])
    seq = read_pp_sequence(rom, base, struct_size, pp_offset, move_count)
    if seq is None:
        raise RuntimeError("Candidate points outside ROM bounds")
    return {
        str(move_id): {"base_pp": int(seq[move_id - 1])}
        for move_id in range(1, move_count + 1)
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Explore likely move PP table layouts from ROM")
    parser.add_argument("rom", type=Path, help="Path to Unbound.gba")
    parser.add_argument(
        "--count",
        type=int,
        default=None,
        help="Move count to read (default: infer directly from ROM)",
    )
    parser.add_argument(
        "--count-from-txt",
        action="store_true",
        help="Use backend/data/moves.txt to determine count when --count is omitted",
    )
    parser.add_argument(
        "--radius",
        type=lambda x: int(x, 0),
        default=0x300000,
        help="Search radius around move-name table base (default: 0x300000)",
    )
    parser.add_argument("--struct-min", type=int, default=8, help="Min candidate struct size")
    parser.add_argument("--struct-max", type=int, default=32, help="Max candidate struct size")
    parser.add_argument(
        "--anchor",
        type=str,
        default=None,
        help="Comma-separated PP anchor (default: Gen3 early moves)",
    )
    parser.add_argument("--min-anchor-matches", type=int, default=7, help="Minimum anchor hits required")
    parser.add_argument(
        "--reference",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "moves_pp.json",
        help="Optional PP reference file for ranking validation",
    )
    parser.add_argument(
        "--min-reference-matches",
        type=int,
        default=0,
        help="Filter out candidates below this exact match count against reference",
    )
    parser.add_argument("--topk", type=int, default=20, help="How many ranked candidates to store")
    parser.add_argument(
        "--out-diagnostics",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "move_pp_probe_diagnostics.json",
        help="Diagnostics JSON output path",
    )
    parser.add_argument(
        "--out-pp-json",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "moves_pp_meta.json",
        help="Exported PP JSON path (top candidate)",
    )
    parser.add_argument(
        "--write-top",
        action="store_true",
        help="Write base_pp table using the top-ranked candidate",
    )
    args = parser.parse_args()

    rom = args.rom.read_bytes()
    names_base = find_moves_table_base(rom)

    if args.count is not None:
        move_count = int(args.count)
    elif args.count_from_txt:
        fallback_moves_txt = Path(__file__).resolve().parents[1] / "data" / "moves.txt"
        move_count = load_move_count_from_txt(fallback_moves_txt)
    else:
        move_count = infer_move_count_from_rom(rom, names_base)

    anchor = parse_anchor(args.anchor)
    reference_seq = load_reference_pp(args.reference, move_count) if args.reference else None

    candidates = explore_candidates(
        rom=rom,
        move_count=move_count,
        names_base=names_base,
        radius=int(args.radius),
        struct_min=int(args.struct_min),
        struct_max=int(args.struct_max),
        anchor=anchor,
        reference_seq=reference_seq,
        min_anchor_matches=int(args.min_anchor_matches),
        min_reference_matches=int(args.min_reference_matches),
        topk=int(args.topk),
    )

    payload = {
        "source_rom": str(args.rom),
        "move_count": move_count,
        "move_names_table_base": names_base,
        "search_radius": int(args.radius),
        "struct_min": int(args.struct_min),
        "struct_max": int(args.struct_max),
        "anchor": anchor,
        "min_anchor_matches": int(args.min_anchor_matches),
        "reference_path": str(args.reference) if args.reference else None,
        "reference_loaded": bool(reference_seq is not None),
        "reference_count": len(reference_seq) if reference_seq is not None else 0,
        "min_reference_matches": int(args.min_reference_matches),
        "candidates": candidates,
    }

    args.out_diagnostics.parent.mkdir(parents=True, exist_ok=True)
    args.out_diagnostics.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(f"[OK] Move names base: 0x{names_base:X}")
    print(f"[OK] Candidates found: {len(candidates)}")
    if reference_seq is not None:
        print(f"[OK] Reference loaded: {args.reference} ({len(reference_seq)} rows)")
    else:
        print("[INFO] Reference not loaded; ranking uses anchor/statistics only")
    print(f"[OK] Wrote diagnostics: {args.out_diagnostics}")

    if args.write_top:
        if not candidates:
            raise RuntimeError("No candidates found; cannot export PP table")
        pp_table = export_pp_table(rom, move_count, candidates[0])
        top = candidates[0]
        out_payload = {
            "source_rom": str(args.rom),
            "move_count": move_count,
            "selected_candidate": {
                "table_base": int(top["table_base"]),
                "struct_size": int(top["struct_size"]),
                "pp_offset": int(top["pp_offset"]),
                "score": int(top["score"]),
                "anchor_matches": int(top["anchor_matches"]),
            },
            "moves": pp_table,
        }
        args.out_pp_json.parent.mkdir(parents=True, exist_ok=True)
        args.out_pp_json.write_text(json.dumps(out_payload, indent=2), encoding="utf-8")
        print(f"[OK] Wrote top-candidate PP table: {args.out_pp_json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
