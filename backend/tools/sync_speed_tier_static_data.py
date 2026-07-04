#!/usr/bin/env python3
"""Sync static data used by unbound speed tier generation."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

from core.rom_paths import find_unbound_rom

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
FRONTEND_CORE = ROOT / "frontend" / "src" / "core"
CSV_PATH = ROOT / "unbound_speed_tiers.csv"
BUILD_SCRIPT = ROOT / "scripts" / "build_unbound_speed_tiers.py"
XLSX_PATH = BACKEND / "local_artifacts" / "expert_bosses.xlsx"


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def mirror_json(name: str) -> None:
    src = BACKEND / "data" / name
    dst = FRONTEND_CORE / name
    if not src.exists():
        print(f"[SKIP] Missing {src.relative_to(ROOT)}")
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    print(f"[OK] Synced {dst.relative_to(ROOT)}")


def sync_species_types() -> None:
    subprocess.run(
        [sys.executable, str(BACKEND / "tools" / "bootstrap_species_types.py")],
        check=True,
        env={**__import__("os").environ, "PYTHONPATH": str(BACKEND)},
    )
    mirror_json("species_types.json")


def sync_base_stats() -> None:
    rom = find_unbound_rom()
    if rom is None:
        print("[SKIP] Base stats ROM not found; keeping existing speciesBaseStats.json")
        return
    out_backend = BACKEND / "data" / "species_base_stats.json"
    run([sys.executable, str(BACKEND / "tools" / "extract_unbound_species_base_stats.py"), str(rom), "--out", str(out_backend)])
    dst = FRONTEND_CORE / "speciesBaseStats.json"
    shutil.copy2(out_backend, dst)
    print(f"[OK] Synced {dst.relative_to(ROOT)}")


def sync_speed_tier_artifacts() -> None:
    mirror_json("unbound_level_caps.json")
    mirror_json("expert_mode_rules.json")

    if XLSX_PATH.exists():
        run([sys.executable, str(BUILD_SCRIPT)])
        return

    if not CSV_PATH.exists():
        print("[SKIP] Speed tier CSV missing; run scripts/build_unbound_speed_tiers.py when expert_bosses.xlsx is available")
        return

    run(
        [sys.executable, str(BACKEND / "tools" / "csv_to_unbound_speed_tiers_json.py")],
        env={**__import__("os").environ, "PYTHONPATH": str(BACKEND)},
    )


def main() -> None:
    sync_species_types()
    sync_base_stats()
    sync_speed_tier_artifacts()


if __name__ == "__main__":
    main()