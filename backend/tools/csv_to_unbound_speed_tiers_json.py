#!/usr/bin/env python3
"""Convert unbound_speed_tiers.csv to JSON for backend + frontend mirrors."""

from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from core.data_loader import backend_root, data_path

ROOT = backend_root().parent
CSV_PATH = ROOT / "unbound_speed_tiers.csv"
BACKEND_OUT = data_path("unbound_speed_tiers.json")
FRONTEND_OUT = ROOT / "frontend" / "src" / "core" / "unbound_speed_tiers.json"

FIELD_MAP = {
    "Level Cap": "level_cap",
    "Boss Name": "boss_name",
    "Key Speed Threat": "threat",
    "Base Speed": "base_speed",
    "Boss Level": "boss_level",
    "Benchmark Speed Stat": "benchmark_speed_stat",
    "Cap Benchmark Speed": "cap_benchmark_speed",
    "Required Roster Speed": "required_roster_speed",
    "Threat Mechanics": "threat_mechanics",
}

INT_FIELDS = {
    "level_cap",
    "base_speed",
    "boss_level",
    "benchmark_speed_stat",
    "cap_benchmark_speed",
    "required_roster_speed",
}


def parse_row(row: dict[str, str]) -> dict:
    entry: dict = {}
    for csv_key, json_key in FIELD_MAP.items():
        raw = row.get(csv_key, "")
        if json_key == "threat_mechanics":
            token = str(raw or "None").strip()
            entry[json_key] = [part for part in token.split("|") if part] or ["None"]
            continue
        if json_key in INT_FIELDS:
            entry[json_key] = int(float(raw))
        else:
            entry[json_key] = str(raw).strip()
    return entry


def build_payload(rows: list[dict]) -> dict:
    return {
        "mode": "expert",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "csv": "unbound_speed_tiers.csv",
            "trainers_workbook": "backend/local_artifacts/expert_bosses.xlsx",
            "level_caps": "backend/data/unbound_level_caps.json",
            "expert_rules": "backend/data/expert_mode_rules.json",
            "base_stats": "frontend/src/core/speciesBaseStats.json",
            "species_types": "frontend/src/core/species_types.json",
        },
        "entries": rows,
    }


def main() -> None:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"Missing speed tier CSV: {CSV_PATH}")

    with CSV_PATH.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = [parse_row(row) for row in reader]

    payload = build_payload(rows)
    encoded = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    BACKEND_OUT.write_text(encoded, encoding="utf-8")
    FRONTEND_OUT.parent.mkdir(parents=True, exist_ok=True)
    FRONTEND_OUT.write_text(encoded, encoding="utf-8")
    print(f"[OK] Wrote {len(rows)} entries -> {BACKEND_OUT.relative_to(ROOT)}")
    print(f"[OK] Mirrored -> {FRONTEND_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
