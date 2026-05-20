#!/usr/bin/env python3
"""Phase-1 static reverse engineering helper for Unbound Mystery Gift.

This script does read-only ROM reconnaissance to answer:
- where Mystery Gift related text lives
- where those text offsets are referenced from script/native data
- whether known 12-char gift codes are stored verbatim
- where 12-char uppercase/digit code-like sequences are clustered

The output is a JSON report to guide phase-2 runtime experiments.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path


PTR_BASE = 0x08000000
MIN_TEXT_LEN = 8
MAX_TEXT_LEN = 220
CODE_LEN = 12


def build_charmap() -> tuple[dict[int, str], dict[str, int]]:
    decode: dict[int, str] = {
        0x00: " ",
        0xAB: "!",
        0xAC: "?",
        0xAD: ".",
        0xAE: "-",
        0xAF: "·",
        0xB0: "...",
        0xB4: "'",
        0xB5: "♂",
        0xB6: "♀",
        0xB7: "$",
        0xB8: ",",
        0xB9: "x",
        0xBA: "/",
        0xF0: ":",
        0xFF: "",
    }
    for i, c in enumerate("0123456789"):
        decode[0xA1 + i] = c
    for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
        decode[0xBB + i] = c
    for i, c in enumerate("abcdefghijklmnopqrstuvwxyz"):
        decode[0xD5 + i] = c

    encode = {v: k for k, v in decode.items() if v and len(v) == 1}
    return decode, encode


DECODE, ENCODE = build_charmap()
DECODE_ALLOWED = set(DECODE.keys()) | {0xFC, 0xFD, 0xFE}
KEYWORDS_STRICT = (
    "mystery gift",
    "mystery",
    "password",
    "available gifts",
    "we look forward",
)
KEYWORDS_LOOSE = ("gift",)


@dataclass
class TextHit:
    offset: int
    text: str
    relevance: str


def sha1_hex(data: bytes) -> str:
    h = hashlib.sha1()
    h.update(data)
    return h.hexdigest()


def decode_text_block(raw: bytes) -> str:
    out: list[str] = []
    for b in raw:
        if b == 0xFF:
            break
        if b == 0xFE:
            out.append("\n")
            continue
        if b == 0xFD:
            out.append("<VAR>")
            continue
        if b == 0xFC:
            out.append("<CTRL>")
            continue
        out.append(DECODE.get(b, "?"))
    return "".join(out).strip()


def scan_keyword_text(rom: bytes) -> list[TextHit]:
    hits: list[TextHit] = []
    i = 0
    n = len(rom)
    while i < n - MIN_TEXT_LEN:
        b0 = rom[i]
        if b0 not in DECODE_ALLOWED or b0 == 0xFF:
            i += 1
            continue

        j = i
        steps = 0
        bad = 0
        while j < n and steps < MAX_TEXT_LEN:
            bj = rom[j]
            if bj == 0xFF:
                j += 1
                break
            if bj not in DECODE_ALLOWED:
                bad += 1
                if bad > 2:
                    break
            j += 1
            steps += 1

        raw = rom[i:j]
        if len(raw) < MIN_TEXT_LEN or (not raw or raw[-1] != 0xFF):
            i += 1
            continue

        text = decode_text_block(raw)
        low = text.lower()
        if text and any(k in low for k in KEYWORDS_STRICT):
            hits.append(TextHit(offset=i, text=text, relevance="strict"))
            i = j
            continue

        if text and any(k in low for k in KEYWORDS_LOOSE):
            hits.append(TextHit(offset=i, text=text, relevance="loose"))
            i = j
            continue

        i += 1

    dedup: dict[int, TextHit] = {}
    for h in hits:
        dedup[h.offset] = h
    return sorted(dedup.values(), key=lambda x: x.offset)


def find_all_occurrences(haystack: bytes, needle: bytes) -> list[int]:
    out: list[int] = []
    pos = 0
    while True:
        p = haystack.find(needle, pos)
        if p < 0:
            break
        out.append(p)
        pos = p + 1
    return out


def rom_ptr_to_offset(ptr: int, rom_len: int) -> int | None:
    if ptr < PTR_BASE:
        return None
    off = ptr - PTR_BASE
    if 0 <= off < rom_len:
        return off
    return None


def xrefs_for_offset(rom: bytes, target_off: int) -> list[int]:
    ptr = (target_off + PTR_BASE).to_bytes(4, "little")
    return find_all_occurrences(rom, ptr)


def extract_rom_pointers_from_window(rom: bytes, center: int, radius: int = 96) -> list[int]:
    start = max(0, center - radius)
    end = min(len(rom), center + radius)
    out: list[int] = []
    for i in range(start, max(start, end - 3)):
        raw = rom[i: i + 4]
        if len(raw) < 4:
            break
        val = int.from_bytes(raw, "little")
        off = rom_ptr_to_offset(val, len(rom))
        if off is not None:
            out.append(off)
    return out


def encode_code_text(code: str) -> bytes:
    return bytes(ENCODE[ch] for ch in code)


def search_known_codes(rom: bytes, codes: list[str]) -> dict:
    ascii_hits = []
    encoded_hits = []
    for code in codes:
        a = find_all_occurrences(rom, code.encode("ascii"))
        if a:
            ascii_hits.append({"code": code, "offsets": a})

        try:
            enc = encode_code_text(code)
        except KeyError:
            continue
        e = find_all_occurrences(rom, enc)
        if e:
            encoded_hits.append({"code": code, "offsets": e})

    return {
        "ascii_hits": ascii_hits,
        "encoded_hits": encoded_hits,
        "ascii_hit_count": len(ascii_hits),
        "encoded_hit_count": len(encoded_hits),
    }


def decode_code_byte(b: int) -> str | None:
    if 0xA1 <= b <= 0xAA:
        return chr(ord("0") + b - 0xA1)
    if 0xBB <= b <= 0xD4:
        return chr(ord("A") + b - 0xBB)
    return None


def find_code_like_sequences(rom: bytes) -> list[dict]:
    valid = set(range(0xA1, 0xAB)) | set(range(0xBB, 0xD5))
    terminators = {0xFF, 0x00, 0xFC, 0xFD, 0xFE}

    rows: list[dict] = []
    for i in range(0, len(rom) - CODE_LEN):
        chunk = rom[i: i + CODE_LEN]
        if any(c not in valid for c in chunk):
            continue
        prev_b = rom[i - 1] if i > 0 else 0
        next_b = rom[i + CODE_LEN] if i + CODE_LEN < len(rom) else 0
        if prev_b in valid:
            continue
        if next_b not in terminators:
            continue

        text = "".join(decode_code_byte(c) or "?" for c in chunk)
        rows.append({
            "offset": i,
            "text": text,
            "next_byte": next_b,
        })

    return rows


def cluster_offsets(offsets: list[int], max_gap: int = 0x200) -> list[dict]:
    if not offsets:
        return []
    xs = sorted(offsets)
    clusters: list[list[int]] = [[xs[0]]]
    for x in xs[1:]:
        if x - clusters[-1][-1] <= max_gap:
            clusters[-1].append(x)
        else:
            clusters.append([x])

    out = []
    for c in clusters:
        out.append(
            {
                "start": c[0],
                "end": c[-1],
                "count": len(c),
            }
        )
    return out


def top_native_pointer_candidates(rom: bytes, all_xrefs: list[int], top_n: int = 30) -> list[dict]:
    counter: Counter[int] = Counter()
    sources: dict[int, list[int]] = {}
    for xr in all_xrefs:
        ptrs = extract_rom_pointers_from_window(rom, xr, radius=96)
        for p in ptrs:
            counter[p] += 1
            sources.setdefault(p, [])
            if len(sources[p]) < 8 and xr not in sources[p]:
                sources[p].append(xr)

    rows = []
    for target, count in counter.most_common(top_n):
        rows.append(
            {
                "target_offset": target,
                "target_hex": f"0x{target:X}",
                "score": count,
                "xrefs_sample": sources.get(target, []),
            }
        )
    return rows


def load_gift_codes(path: Path) -> list[str]:
    arr = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for row in arr:
        code = str(row.get("code", "")).strip()
        if code:
            out.append(code)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase-1 static RE for Unbound Mystery Gift")
    parser.add_argument("rom", type=Path, help="Path to Unbound.gba")
    parser.add_argument(
        "--gifts",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "mistery_gifts.json",
        help="Path to mistery_gifts.json",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "mystery_gift_phase1_report.json",
        help="Output JSON report path",
    )
    parser.add_argument(
        "--max-text-hits",
        type=int,
        default=80,
        help="Limit number of keyword text hits in output",
    )
    parser.add_argument(
        "--max-code-like",
        type=int,
        default=400,
        help="Limit number of code-like 12-char entries in output",
    )
    args = parser.parse_args()

    rom = args.rom.read_bytes()
    codes = load_gift_codes(args.gifts)

    code_pattern = re.compile(r"^[0-9A-Z]{12}$")
    malformed = [c for c in codes if not code_pattern.match(c)]

    text_hits = scan_keyword_text(rom)

    strict_hits = [h for h in text_hits if h.relevance == "strict"]
    loose_hits = [h for h in text_hits if h.relevance == "loose"]

    text_rows = []
    xrefs_all: list[int] = []
    for h in text_hits[: args.max_text_hits]:
        xrefs = xrefs_for_offset(rom, h.offset)
        xrefs_all.extend(xrefs)
        text_rows.append(
            {
                "offset": h.offset,
                "offset_hex": f"0x{h.offset:X}",
                "text": h.text,
                "relevance": h.relevance,
                "xref_count": len(xrefs),
                "xrefs_sample": xrefs[:20],
            }
        )

    xref_clusters = cluster_offsets(sorted(set(xrefs_all)), max_gap=0x280)
    pointer_candidates = top_native_pointer_candidates(rom, sorted(set(xrefs_all)), top_n=40)

    known_search = search_known_codes(rom, codes)
    code_like = find_code_like_sequences(rom)
    code_like_clusters = cluster_offsets([r["offset"] for r in code_like], max_gap=0x200)

    payload = {
        "rom": str(args.rom),
        "rom_sha1": sha1_hex(rom),
        "rom_size": len(rom),
        "gift_code_file": str(args.gifts),
        "gift_code_count": len(codes),
        "gift_code_malformed": malformed,
        "known_code_verbatim_search": known_search,
        "keyword_text_hits_count": len(text_hits),
        "keyword_text_hits_strict_count": len(strict_hits),
        "keyword_text_hits_loose_count": len(loose_hits),
        "keyword_text_hits": text_rows,
        "xref_clusters": [
            {
                **c,
                "start_hex": f"0x{c['start']:X}",
                "end_hex": f"0x{c['end']:X}",
            }
            for c in xref_clusters
        ],
        "native_pointer_candidates": pointer_candidates,
        "code_like_sequences_count": len(code_like),
        "code_like_sequences": code_like[: args.max_code_like],
        "code_like_clusters": [
            {
                **c,
                "start_hex": f"0x{c['start']:X}",
                "end_hex": f"0x{c['end']:X}",
            }
            for c in code_like_clusters
        ],
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"[OK] ROM: {args.rom}")
    print(f"[OK] SHA1: {payload['rom_sha1']}")
    print(f"[OK] Gift codes: {len(codes)} (malformed={len(malformed)})")
    print(
        "[OK] Known-code hits: "
        f"ascii={known_search['ascii_hit_count']} encoded={known_search['encoded_hit_count']}"
    )
    print(f"[OK] Keyword text hits: {len(text_hits)}")
    print(f"[OK] Xref clusters: {len(xref_clusters)}")
    print(f"[OK] Code-like 12-char sequences: {len(code_like)}")
    print(f"[OK] Wrote report: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
