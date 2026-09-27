#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
SAVE_FILE="${1:-$ROOT/artifacts/Unbound.sav}"
KEEP_TMP="${2:-}"
if [[ ! -f "$SAVE_FILE" ]]; then
  echo "Save file not found: $SAVE_FILE" >&2
  exit 1
fi

"$ROOT/scripts/parity_tmp.sh" init
if [[ "$KEEP_TMP" != "--keep-tmp" ]]; then
  trap '"$ROOT/scripts/parity_tmp.sh" cleanup' EXIT
fi
mkdir -p "$ROOT/build/host"
g++ -std=c++17 -I"$ROOT/include" \
  "$ROOT/source/core/SaveSections.cpp" "$ROOT/source/core/SaveHealth.cpp" \
  "$ROOT/tests/save_health_dump.cpp" -o "$ROOT/build/host/save_health_dump"

SOURCE_OUT="$ROOT/artifacts/tmp/source/save_health.txt"
PORT_OUT="$ROOT/artifacts/tmp/port/save_health.txt"
PYTHONPATH="$REPO_ROOT/backend" python3 "$REPO_ROOT/backend/tools/save_health_parity.py" \
  "$SAVE_FILE" "$ROOT/artifacts/tmp/source" > "$SOURCE_OUT"
for case_name in baseline edited corrupt bag_corrupt opaque_edit old_corrupt pc_edited source_corrupt short; do
  original_file="$SAVE_FILE"
  if [[ "$case_name" == "source_corrupt" ]]; then
    original_file="$ROOT/artifacts/tmp/source/corrupt.bin"
  elif [[ "$case_name" == "short" ]]; then
    original_file="$ROOT/artifacts/tmp/source/short.bin"
  fi
  "$ROOT/build/host/save_health_dump" "$original_file" \
    "$ROOT/artifacts/tmp/source/$case_name.bin" "$case_name" >> "$PORT_OUT"
done
"$ROOT/scripts/parity_tmp.sh" compare "$SOURCE_OUT" "$PORT_OUT"
