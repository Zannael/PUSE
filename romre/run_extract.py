#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"


def slugify(name: str) -> str:
    base = name.strip().lower()
    base = re.sub(r"[^a-z0-9]+", "_", base)
    base = re.sub(r"_+", "_", base).strip("_")
    return base or "rom"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass(frozen=True)
class ExtractTask:
    key: str
    data_type: str
    script: str

    def command(self, rom_path: Path, out_root: Path, context: dict[str, int]) -> list[str]:
        json_dir = out_root / "json"
        txt_dir = out_root / "txt"

        script_path = Path("tools") / self.script
        cmd = [sys.executable, str(script_path)]

        if self.key == "species_table":
            cmd += [str(rom_path), "--out-json", str(json_dir / "species_table_from_rom.json"), "--out-txt", str(txt_dir / "pokemon.txt")]
        elif self.key == "abilities_table":
            cmd += [str(rom_path), "--structural-scan", "--out-json", str(json_dir / "ability_table_from_rom.json"), "--out-txt", str(txt_dir / "abilities.txt")]
        elif self.key == "moves_table":
            cmd += [str(rom_path), "--generic-scan", "--out-json", str(json_dir / "move_table_from_rom.json"), "--out-txt", str(txt_dir / "moves.txt")]
        elif self.key == "item_table":
            cmd += [str(rom_path), "--out", str(json_dir / "item_table_from_rom.json")]
        elif self.key == "species_base_stats":
            cmd += [str(rom_path), "--out", str(json_dir / "species_base_stats.json")]
            if context.get("species_count"):
                cmd += ["--species-count", str(context["species_count"])]
        elif self.key == "species_growth_rates":
            cmd += [str(rom_path), "--out", str(json_dir / "species_growth_rates.json")]
            if context.get("species_count"):
                cmd += ["--species-count", str(context["species_count"])]
        elif self.key == "species_identity_meta":
            cmd += [str(rom_path), "--out", str(json_dir / "species_identity_meta.json")]
            if context.get("species_count"):
                cmd += ["--species-count", str(context["species_count"])]
        elif self.key == "species_abilities_meta":
            cmd += [str(rom_path), "--out", str(json_dir / "species_abilities_meta.json")]
            if context.get("species_count"):
                cmd += ["--species-count", str(context["species_count"])]
            cmd += ["--skip-anchor-validation"]
        else:
            raise ValueError(f"Unknown task key: {self.key}")

        return cmd

    def expected_outputs(self, out_root: Path) -> list[Path]:
        json_dir = out_root / "json"
        txt_dir = out_root / "txt"

        mapping = {
            "species_table": [json_dir / "species_table_from_rom.json", txt_dir / "pokemon.txt"],
            "abilities_table": [json_dir / "ability_table_from_rom.json", txt_dir / "abilities.txt"],
            "moves_table": [json_dir / "move_table_from_rom.json", txt_dir / "moves.txt"],
            "item_table": [json_dir / "item_table_from_rom.json"],
            "species_base_stats": [json_dir / "species_base_stats.json"],
            "species_growth_rates": [json_dir / "species_growth_rates.json"],
            "species_identity_meta": [json_dir / "species_identity_meta.json"],
            "species_abilities_meta": [json_dir / "species_abilities_meta.json"],
        }
        return mapping[self.key]


TASKS: list[ExtractTask] = [
    ExtractTask("species_table", "species", "extract_unbound_species_table.py"),
    ExtractTask("abilities_table", "abilities", "extract_unbound_abilities_table.py"),
    ExtractTask("moves_table", "moves", "extract_unbound_moves_table.py"),
    ExtractTask("species_base_stats", "species_meta", "extract_unbound_species_base_stats.py"),
    ExtractTask("species_growth_rates", "species_meta", "extract_unbound_species_growth_rates.py"),
    ExtractTask("species_identity_meta", "species_meta", "extract_unbound_species_identity_meta.py"),
    ExtractTask("species_abilities_meta", "species_meta", "extract_unbound_species_abilities_meta.py"),
]


def make_output_dirs(root: Path) -> None:
    for name in ("json", "txt", "icons", "reports"):
        (root / name).mkdir(parents=True, exist_ok=True)


def run_task(task: ExtractTask, rom_path: Path, out_root: Path, reports_dir: Path, context: dict[str, int]) -> dict:
    command = task.command(rom_path, out_root, context)
    env = dict(**os.environ)
    current_pp = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = f"{BACKEND_ROOT}:{current_pp}" if current_pp else str(BACKEND_ROOT)
    proc = subprocess.run(command, capture_output=True, text=True, cwd=str(BACKEND_ROOT), env=env)

    log_path = reports_dir / f"{task.key}.log"
    log_path.write_text((proc.stdout or "") + ("\n" if proc.stdout else "") + (proc.stderr or ""), encoding="utf-8")

    expected = task.expected_outputs(out_root)
    missing = [str(p.relative_to(out_root)) for p in expected if not p.exists()]

    return {
        "key": task.key,
        "data_type": task.data_type,
        "script": f"backend/tools/{task.script}",
        "command": command,
        "exit_code": proc.returncode,
        "ok": proc.returncode == 0 and not missing,
        "missing_outputs": missing,
        "log": str(log_path.relative_to(out_root)),
        "outputs": [str(p.relative_to(out_root)) for p in expected if p.exists()],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run ROM extraction pipeline into romre/data/<rom_slug>")
    parser.add_argument("--rom", type=Path, required=True, help="Path to ROM (.gba)")
    parser.add_argument("--slug", type=str, default=None, help="Override output slug (default: ROM filename stem)")
    parser.add_argument("--data-root", type=Path, default=REPO_ROOT / "romre" / "data", help="Base output root")
    parser.add_argument("--only", nargs="*", default=None, help="Optional subset of task keys")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    rom_path = args.rom.resolve()

    if not rom_path.exists() or not rom_path.is_file():
        print(f"[ERR] ROM not found: {rom_path}")
        return 2

    rom_slug = slugify(args.slug or rom_path.stem)
    out_root = args.data_root.resolve() / rom_slug
    make_output_dirs(out_root)

    selected = TASKS
    if args.only:
        allow = set(args.only)
        selected = [t for t in TASKS if t.key in allow]
        missing_keys = sorted(allow.difference({t.key for t in TASKS}))
        if missing_keys:
            print(f"[ERR] Unknown task keys: {', '.join(missing_keys)}")
            return 2

    reports_dir = out_root / "reports"
    results = []
    context: dict[str, int] = {}
    for task in selected:
        print(f"[RUN] {task.key} ({task.data_type})")
        result = run_task(task, rom_path, out_root, reports_dir, context)
        results.append(result)
        state = "OK" if result["ok"] else "FAIL"
        print(f"[{state}] {task.key} -> {result['log']}")
        if result["ok"] and task.key == "species_table":
            species_json = out_root / "json" / "species_table_from_rom.json"
            if species_json.exists():
                try:
                    raw = json.loads(species_json.read_text(encoding="utf-8"))
                    count = int(raw.get("species_count") or 0)
                    if count > 0:
                        context["species_count"] = count
                except Exception:
                    pass

    manifest = {
        "rom": {
            "path": str(rom_path),
            "filename": rom_path.name,
            "size_bytes": rom_path.stat().st_size,
            "sha256": sha256_file(rom_path),
        },
        "profile": rom_slug,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "pipeline": "romre/run_extract.py",
        "tasks": results,
        "summary": {
            "total": len(results),
            "ok": sum(1 for r in results if r["ok"]),
            "failed": sum(1 for r in results if not r["ok"]),
        },
        "notes": [
            "Current pipeline reuses backend/tools/extract_unbound_*.py and will be generalized for non-Unbound CFRU hacks.",
            "Pipeline currently contains only ROM-pure extractors.",
            "icons/ is reserved for future icon extraction/manifests.",
        ],
    }

    manifest_path = out_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"[DONE] profile={rom_slug}")
    print(f"[DONE] manifest={manifest_path}")

    return 0 if manifest["summary"]["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
