#!/usr/bin/env python3
"""Extract a portable graphics pack. ROM input is read-only and never copied."""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from core.graphics import extract_pack


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True, help='Private output directory (use ignored local_artifacts)')
    parser.add_argument('--profile', default=None)
    args = parser.parse_args()
    manifest, files = extract_pack(args.rom.read_bytes(), args.profile)
    if args.out.exists() and any(args.out.iterdir()):
        raise ValueError('Output directory must be empty; existing packs are never overwritten')
    for name, content in files.items():
        path = args.out / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    print(f"Extracted {len(manifest['assets'])} resources for {manifest['profile_id']} ({len(files)-2} unique PNGs)")
    for warning in manifest['warnings']:
        print(warning)


if __name__ == '__main__':
    main()
