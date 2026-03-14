import os
import re
from difflib import SequenceMatcher


def _normalize(text: str) -> str:
    text = text or ""
    text = text.lower()
    text = text.replace("é", "e")
    text = re.sub(r"[^a-z0-9]", "", text)
    return text


def _tokenize(text: str) -> set[str]:
    text = text or ""
    text = text.lower().replace("é", "e")
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    if not text:
        return set()
    return {t for t in text.split(" ") if t}


def _looks_unknown_item_name(name: str) -> bool:
    if not name:
        return True
    n = name.strip()
    if not n or n == "--- VUOTO ---":
        return True
    low = n.lower()
    return low.startswith("item ") or low.startswith("id ") or low == "unknown"


class ItemIconResolver:
    def __init__(self, root_dir: str):
        self.root_dir = root_dir
        self.by_norm: dict[str, str] = {}
        self.by_tokens: list[tuple[set[str], str, str]] = []
        self.by_stem_norm: dict[str, str] = {}
        self.available = False
        self._index_icons()

    def _add_index_entry(self, full_path: str):
        stem = os.path.splitext(os.path.basename(full_path))[0]
        norm = _normalize(stem)
        tokens = _tokenize(stem)

        if norm and norm not in self.by_norm:
            self.by_norm[norm] = full_path
        if tokens:
            self.by_tokens.append((tokens, norm, full_path))
        if norm and norm not in self.by_stem_norm:
            self.by_stem_norm[norm] = full_path

    def _iter_pngs(self, folder: str):
        for root, _, files in os.walk(folder):
            for file in files:
                if file.lower().endswith(".png"):
                    yield os.path.join(root, file)

    def _index_icons(self):
        if not os.path.isdir(self.root_dir):
            return

        base_items_dir = os.path.join(self.root_dir, "Base Items")

        # Priority 1: Base Items (including its subfolders).
        if os.path.isdir(base_items_dir):
            for full_path in self._iter_pngs(base_items_dir):
                self._add_index_entry(full_path)

        # Priority 2: all other folders in items/.
        for entry in sorted(os.listdir(self.root_dir)):
            entry_path = os.path.join(self.root_dir, entry)
            if not os.path.isdir(entry_path):
                continue
            if os.path.normpath(entry_path) == os.path.normpath(base_items_dir):
                continue
            for full_path in self._iter_pngs(entry_path):
                self._add_index_entry(full_path)

        self.available = len(self.by_tokens) > 0

    def _resolve_tm_hm(self, item_name: str) -> str | None:
        if not item_name:
            return None

        name = item_name.strip()

        hm_match = re.search(r"\bHM\s*0?(\d{1,2})\b", name, re.IGNORECASE)
        if hm_match:
            hm_num = int(hm_match.group(1))
            if hm_num > 0:
                for candidate in (f"hm{hm_num:02d}", f"hm{hm_num}"):
                    path = self.by_stem_norm.get(_normalize(candidate))
                    if path:
                        return path

        tm_match = re.search(r"\bTM\s*0?(\d{1,3})\b", name, re.IGNORECASE)
        if tm_match:
            tm_type = None
            if "-" in name:
                maybe_type = name.rsplit("-", 1)[1].strip()
                if maybe_type:
                    tm_type = maybe_type.lower()

            if tm_type:
                for candidate in (f"tm-{tm_type}", f"tm{tm_type}"):
                    path = self.by_stem_norm.get(_normalize(candidate))
                    if path:
                        return path

            tm_num = int(tm_match.group(1))
            if tm_num > 0:
                for candidate in (f"tm{tm_num:02d}", f"tm{tm_num:03d}", f"tm{tm_num}"):
                    path = self.by_stem_norm.get(_normalize(candidate))
                    if path:
                        return path

        return None

    def resolve(self, item_name: str) -> str | None:
        if not self.available or _looks_unknown_item_name(item_name):
            return None

        target_norm = _normalize(item_name)
        if not target_norm:
            return None

        tm_hm_match = self._resolve_tm_hm(item_name)
        if tm_hm_match:
            return tm_hm_match

        # 1) Exact normalized match
        direct = self.by_norm.get(target_norm)
        if direct:
            return direct

        # 2) Exact token-set match
        target_tokens = _tokenize(item_name)
        for tokens, _, path in self.by_tokens:
            if tokens == target_tokens:
                return path

        # 3) Fuzzy ratio with conservative threshold
        best_ratio = 0.0
        best_path = None
        for _, norm, path in self.by_tokens:
            ratio = SequenceMatcher(None, target_norm, norm).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_path = path

        if best_ratio >= 0.88:
            return best_path
        return None
