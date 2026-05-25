#!/usr/bin/env bash
# Sync backend/data -> 3ds-homebrew/romfs/data
# Same role as switch-homebrew/scripts/sync_romfs_data.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"

SRC="$REPO_ROOT/backend/data"
DST="$ROOT/romfs/data"

if [ ! -d "$SRC" ]; then
    echo "ERROR: $SRC does not exist" >&2
    exit 1
fi

mkdir -p "$DST"
rsync -a --delete "$SRC/" "$DST/"
echo ">>> synced $SRC -> $DST"
ls "$DST" | head -20
