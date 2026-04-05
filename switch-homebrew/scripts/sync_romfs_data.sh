#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWITCH_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SWITCH_ROOT/.." && pwd)"

SRC_BACKEND_DATA="$REPO_ROOT/backend/data"
SRC_BACKEND_ICONS="$REPO_ROOT/backend/icons"

DST_ROMFS_ROOT="$SWITCH_ROOT/romfs"
DST_ROMFS_DATA="$DST_ROMFS_ROOT/data"
DST_ROMFS_ICONS="$DST_ROMFS_ROOT/icons"

SYNC_DATA=true
SYNC_ICONS=true
DELETE_MODE=true

usage() {
  cat <<'EOF'
Usage: sync_romfs_data.sh [options]

Sync canonical backend assets into switch-homebrew/romfs.

Options:
  --data-only     Sync only backend/data -> romfs/data
  --icons-only    Sync only backend/icons -> romfs/icons
  --no-delete     Do not remove stale files in romfs
  -h, --help      Show this help

Default behavior:
  - sync backend/data and backend/icons
  - mirror mode with deletion enabled (rsync --delete)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-only)
      SYNC_DATA=true
      SYNC_ICONS=false
      ;;
    --icons-only)
      SYNC_DATA=false
      SYNC_ICONS=true
      ;;
    --no-delete)
      DELETE_MODE=false
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

if ! command -v rsync >/dev/null 2>&1; then
  echo "Error: rsync is required for deterministic sync." >&2
  exit 1
fi

mkdir -p "$DST_ROMFS_ROOT"

sync_dir() {
  local src="$1"
  local dst="$2"
  local label="$3"

  if [[ ! -d "$src" ]]; then
    echo "[WARN] Missing source dir for $label: $src"
    return
  fi

  mkdir -p "$dst"

  local -a flags=(-a)
  if [[ "$DELETE_MODE" == true ]]; then
    flags+=(--delete)
  fi

  echo "[SYNC] $label"
  echo "       $src -> $dst"
  rsync "${flags[@]}" "$src/" "$dst/"
}

if [[ "$SYNC_DATA" == true ]]; then
  sync_dir "$SRC_BACKEND_DATA" "$DST_ROMFS_DATA" "backend data"
fi

if [[ "$SYNC_ICONS" == true ]]; then
  sync_dir "$SRC_BACKEND_ICONS" "$DST_ROMFS_ICONS" "backend icons"
fi

echo "Done. ROMFS assets are in: $DST_ROMFS_ROOT"
