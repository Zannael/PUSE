"""Shared paths for local ROM/save artifacts."""

from __future__ import annotations

from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
LOCAL_ARTIFACTS = BACKEND_ROOT / "local_artifacts"


def find_unbound_rom() -> Path | None:
    if not LOCAL_ARTIFACTS.is_dir():
        return None

    preferred = LOCAL_ARTIFACTS / "Unbound.gba"
    if preferred.is_file():
        return preferred

    gba_files = sorted(LOCAL_ARTIFACTS.glob("*.gba"), key=lambda p: p.stat().st_mtime, reverse=True)
    return gba_files[0] if gba_files else None
