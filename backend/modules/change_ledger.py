"""Bounded sparse-diff change ledger with grouped edits, undo, and reset."""
from dataclasses import dataclass

from modules import save_health as save_health_mod

DEFAULT_MAX_ENTRIES = 50


def _compute_runs(before_bytes: bytes, after_bytes: bytes):
    """Return sparse (offset, before_slice) runs and total changed byte count."""
    min_len = min(len(before_bytes), len(after_bytes))
    runs = []
    changed = 0
    i = 0
    while i < min_len:
        if before_bytes[i] == after_bytes[i]:
            i += 1
            continue
        start = i
        while i < min_len and before_bytes[i] != after_bytes[i]:
            i += 1
        chunk = bytes(before_bytes[start:i])
        runs.append((start, chunk))
        changed += len(chunk)

    tail_before = b""
    if len(before_bytes) > len(after_bytes):
        tail_before = bytes(before_bytes[len(after_bytes):])
        changed += len(tail_before)
    elif len(after_bytes) > len(before_bytes):
        changed += len(after_bytes) - len(before_bytes)

    return tuple(runs), len(before_bytes), tail_before, changed


def _extract_regions(before_bytes: bytes, after_bytes: bytes, changed_bytes: int):
    report = save_health_mod.build_save_report(before_bytes, after_bytes, _include_source=False)
    regions = []
    seen = set()
    for sector in report["changes"]["sectors"]:
        for field in sector["fields"]:
            name = field["name"]
            if name not in seen:
                seen.add(name)
                regions.append(name)
    if not regions and changed_bytes > 0:
        regions.append("Save footer")
    return tuple(regions)


def _count_byte_diffs(a: bytes, b: bytes) -> int:
    if a == b:
        return 0
    min_len = min(len(a), len(b))
    diff = sum(1 for x, y in zip(a[:min_len], b[:min_len]) if x != y)
    return diff + abs(len(a) - len(b))


@dataclass(frozen=True)
class _LedgerEntry:
    id: int
    kind: str
    label: str
    runs: tuple
    before_len: int
    tail_before: bytes
    changed_bytes: int
    regions: tuple

    def to_dict(self):
        return {
            "id": self.id,
            "kind": self.kind,
            "label": self.label,
            "changed_bytes": self.changed_bytes,
            "regions": list(self.regions),
        }


class ChangeLedger:
    """In-memory LIFO change history backed by sparse pre-mutation byte runs."""

    def __init__(self, max_entries: int = DEFAULT_MAX_ENTRIES):
        if int(max_entries) <= 0:
            raise ValueError("max_entries must be positive")
        self._max_entries = int(max_entries)
        self._entries: list[_LedgerEntry] = []
        self._next_id = 1
        self._last_saved_entry_id = 0
        self._evicted_bag_dirty = False
        self._group = None

    def clear(self):
        self._entries.clear()
        self._next_id = 1
        self._last_saved_entry_id = 0
        self._evicted_bag_dirty = False
        self._group = None

    def has_active_group(self) -> bool:
        return self._group is not None

    def begin_group(self, current_data, kind: str, label: str):
        if self._group is not None:
            raise ValueError("A change group is already active")
        self._group = {
            "kind": str(kind or "edit"),
            "label": str(label or "Edit save"),
            "baseline": bytes(current_data),
        }

    def commit_group(self, current_data):
        if self._group is None:
            raise ValueError("No active change group")
        group = self._group
        self._group = None
        return self._push_diff(group["baseline"], bytes(current_data), group["kind"], group["label"])

    def abort_group(self, current_data: bytearray):
        if self._group is None:
            return False
        baseline = self._group["baseline"]
        self._group = None
        current_data[:] = baseline
        return True

    def record(self, before_bytes: bytes, after_data, kind: str, label: str):
        if self._group is not None:
            return None
        return self._push_diff(bytes(before_bytes), bytes(after_data), str(kind or "edit"), str(label or "Edit save"))

    def _push_diff(self, before_bytes: bytes, after_bytes: bytes, kind: str, label: str):
        if before_bytes == after_bytes:
            return None
        runs, before_len, tail_before, changed_bytes = _compute_runs(before_bytes, after_bytes)
        if changed_bytes == 0:
            return None
        regions = _extract_regions(before_bytes, after_bytes, changed_bytes)
        entry = _LedgerEntry(
            id=self._next_id,
            kind=kind,
            label=label,
            runs=runs,
            before_len=before_len,
            tail_before=tail_before,
            changed_bytes=changed_bytes,
            regions=regions,
        )
        self._next_id += 1
        self._entries.append(entry)
        while len(self._entries) > self._max_entries:
            dropped = self._entries.pop(0)
            if dropped.id > self._last_saved_entry_id and dropped.kind == "bag_edit":
                self._evicted_bag_dirty = True
        return entry.to_dict()

    def undo(self, current_data: bytearray):
        if self._group is not None:
            raise ValueError("Cannot undo while a change group is active")
        if not self._entries:
            raise LookupError("Nothing to undo")
        entry = self._entries.pop()
        if len(current_data) > entry.before_len:
            del current_data[entry.before_len:]
        elif len(current_data) < entry.before_len:
            current_data.extend(b"\x00" * (entry.before_len - len(current_data)))
        for offset, before_chunk in entry.runs:
            current_data[offset:offset + len(before_chunk)] = before_chunk
        if entry.tail_before:
            tail_start = entry.before_len - len(entry.tail_before)
            current_data[tail_start:entry.before_len] = entry.tail_before
        return entry.to_dict()

    def reset(self, current_data: bytearray, original_data: bytes):
        self._entries.clear()
        self._group = None
        self._last_saved_entry_id = 0
        self._evicted_bag_dirty = False
        current_data[:] = original_data

    def mark_saved(self):
        self._last_saved_entry_id = self._entries[-1].id if self._entries else 0
        self._evicted_bag_dirty = False

    def has_uncommitted_bag_changes(self) -> bool:
        if self._evicted_bag_dirty:
            return True
        return any(
            entry.id > self._last_saved_entry_id and entry.kind == "bag_edit"
            for entry in self._entries
        )

    def summary(self, current_data, original_data):
        current_bytes = bytes(current_data) if current_data is not None else b""
        original_bytes = bytes(original_data) if original_data is not None else b""
        total_changed = _count_byte_diffs(original_bytes, current_bytes)
        return {
            "entries": [entry.to_dict() for entry in reversed(self._entries)],
            "can_undo": len(self._entries) > 0,
            "can_reset": bool(current_data is not None and (total_changed > 0 or len(self._entries) > 0)),
            "total_changed_bytes": total_changed,
            "max_entries": self._max_entries,
        }
