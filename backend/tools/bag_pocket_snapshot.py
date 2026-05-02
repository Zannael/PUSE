#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modules import bag  # noqa: E402


def list_save_files(base: Path) -> list[Path]:
    out = []
    for p in sorted(base.rglob("*")):
        if p.is_file() and p.suffix.lower() in {".sav", ".srm"}:
            out.append(p)
    return out


def pocket_preview(data: bytearray, pocket_meta: dict, limit: int = 12):
    if not isinstance(pocket_meta, dict):
        return []
    anchor = pocket_meta.get("anchor_offset")
    if anchor is None:
        return []
    try:
        items = bag.map_pocket_from_anchor(data, int(anchor))
    except Exception:
        return []
    preview = []
    for it in items[:limit]:
        preview.append({
            "id": int(it.get("id", 0)),
            "qty": int(it.get("qty", 0)),
            "offset": int(it.get("offset", 0)),
            "encoding": it.get("encoding"),
            "name": it.get("name"),
        })
    return preview


def build_snapshot(base: Path) -> dict:
    bag.load_item_names_from_file()
    bag.load_tm_names_from_file()

    result = {
        "base": str(base),
        "files": {},
    }

    for path in list_save_files(base):
        rel = str(path.relative_to(base))
        data = bytearray(path.read_bytes())
        quick = bag.resolve_quick_pockets(data)

        pockets = {}
        for key in ["main", "ball", "key", "tm", "berry"]:
            meta = quick.get(key)
            if not isinstance(meta, dict):
                pockets[key] = {"meta": meta, "preview": []}
                continue
            keep = {
                "anchor_offset": meta.get("anchor_offset"),
                "quality": meta.get("quality"),
                "score": meta.get("score"),
                "slot_count": meta.get("slot_count"),
                "source": meta.get("source"),
                "confidence": meta.get("confidence"),
                "ready": meta.get("ready"),
                "locked": meta.get("locked"),
                "locked_reason": meta.get("locked_reason"),
                "detection_note": meta.get("detection_note"),
            }
            pockets[key] = {
                "meta": keep,
                "preview": pocket_preview(data, meta),
            }

        result["files"][rel] = {
            "size": len(data),
            "pockets": pockets,
        }

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Snapshot bag pocket resolution across local fixtures")
    parser.add_argument("--base", default=str(ROOT / "local_artifacts"), help="Directory containing .sav/.srm fixtures")
    parser.add_argument("--out", required=True, help="Output JSON path")
    args = parser.parse_args()

    base = Path(args.base)
    out = Path(args.out)
    snap = build_snapshot(base)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snap, indent=2), encoding="utf-8")
    print(f"Snapshot written: {out}")


if __name__ == "__main__":
    main()
