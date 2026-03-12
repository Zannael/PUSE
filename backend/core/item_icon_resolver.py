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
        self.available = False
        self._index_icons()

    def _index_icons(self):
        if not os.path.isdir(self.root_dir):
            return

        for root, _, files in os.walk(self.root_dir):
            for file in files:
                if not file.lower().endswith(".png"):
                    continue
                full_path = os.path.join(root, file)
                stem = os.path.splitext(file)[0]
                norm = _normalize(stem)
                tokens = _tokenize(stem)
                if norm and norm not in self.by_norm:
                    self.by_norm[norm] = full_path
                if tokens:
                    self.by_tokens.append((tokens, norm, full_path))

        self.available = len(self.by_tokens) > 0

    def resolve(self, item_name: str) -> str | None:
        if not self.available or _looks_unknown_item_name(item_name):
            return None

        target_norm = _normalize(item_name)
        if not target_norm:
            return None

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
