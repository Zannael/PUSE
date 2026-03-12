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
