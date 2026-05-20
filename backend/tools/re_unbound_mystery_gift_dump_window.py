#!/usr/bin/env python3
"""Dump ROM windows with hex and Pokemon text decode hints.

Utility for phase-1 static RE notes after running
`re_unbound_mystery_gift_phase1.py`.
"""

from __future__ import annotations

import argparse
from pathlib import Path


def build_decode() -> dict[int, str]:
    decode: dict[int, str] = {
        0x00: " ",
        0xAB: "!",
        0xAC: "?",
        0xAD: ".",
        0xAE: "-",
        0xAF: "·",
        0xB0: "...",
        0xB4: "'",
        0xB8: ",",
        0xBA: "/",
        0xF0: ":",
    }
    for i, c in enumerate("0123456789"):
        decode[0xA1 + i] = c
    for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
        decode[0xBB + i] = c
    for i, c in enumerate("abcdefghijklmnopqrstuvwxyz"):
        decode[0xD5 + i] = c
    return decode


DECODE = build_decode()


def parse_offset(token: str) -> int:
    token = token.strip().lower()
    if token.startswith("0x"):
        return int(token, 16)
    return int(token, 10)


def decode_line(bs: bytes) -> str:
    out: list[str] = []
    for b in bs:
        if b == 0xFF:
            out.append("|")
        elif b == 0xFE:
            out.append("\\n")
        elif b == 0xFD:
            out.append("<VAR>")
        elif b == 0xFC:
            out.append("<CTRL>")
        else:
            out.append(DECODE.get(b, "."))
    return "".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description="Dump ROM windows for Mystery Gift RE")
    parser.add_argument("rom", type=Path, help="Path to ROM")
    parser.add_argument("offsets", nargs="+", help="Offsets (hex like 0x1EA12B9 or decimal)")
    parser.add_argument("--before", type=int, default=96, help="Bytes before each offset")
    parser.add_argument("--after", type=int, default=224, help="Bytes after each offset")
    parser.add_argument("--width", type=int, default=16, help="Hex row width")
    args = parser.parse_args()

    rom = args.rom.read_bytes()

    for tok in args.offsets:
        off = parse_offset(tok)
        start = max(0, off - args.before)
        end = min(len(rom), off + args.after)
        chunk = rom[start:end]

        print(f"\n=== offset=0x{off:X} window=[0x{start:X}, 0x{end:X}) ===")
        for i in range(0, len(chunk), args.width):
            row_off = start + i
            row = chunk[i: i + args.width]
            hx = " ".join(f"{b:02X}" for b in row)
            text = decode_line(row)
            print(f"{row_off:08X}: {hx:<{args.width * 3}}  {text}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
