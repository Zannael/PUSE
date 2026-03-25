import json
from pathlib import Path


def backend_root() -> Path:
    return Path(__file__).resolve().parents[1]


def data_path(filename: str) -> Path:
    return backend_root() / "data" / filename


def load_id_name_file(filename: str) -> dict[int, str]:
    path = data_path(filename)
    if not path.exists():
        return {}

    out: dict[int, str] = {}
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or ":" not in line:
            continue
        left, right = line.split(":", 1)
        left = left.strip()
        if not left.isdigit():
            continue
        out[int(left)] = right.strip()
    return out


def load_move_base_pp_map(filename: str = "move_table_from_rom.json") -> dict[int, int]:
    path = data_path(filename)
    if not path.exists():
        return {}

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}

    rows = raw.get("moves") if isinstance(raw, dict) else None
    if not isinstance(rows, list):
        return {}

    out: dict[int, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            move_id = int(row.get("move_id"))
            base_pp = int(row.get("base_pp"))
        except (TypeError, ValueError):
            continue
        if move_id <= 0:
            continue
        if base_pp < 0:
            base_pp = 0
        elif base_pp > 255:
            base_pp = 255
        out[move_id] = base_pp
    return out
