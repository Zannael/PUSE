#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWITCH_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NRO_PATH="$SWITCH_ROOT/puse-switch.nro"
OUT_ROOT="$SWITCH_ROOT/artifacts/sdmc/switch/puse"

INCLUDE_ICONS=true
if [[ "${1:-}" == "--no-icons" ]]; then
  INCLUDE_ICONS=false
fi

if [[ ! -f "$NRO_PATH" ]]; then
  echo "Missing NRO: $NRO_PATH" >&2
  exit 1
fi

mkdir -p "$OUT_ROOT"
cp "$NRO_PATH" "$OUT_ROOT/puse-switch.nro"

rm -rf "$OUT_ROOT/data"
mkdir -p "$OUT_ROOT/data"
cp -r "$SWITCH_ROOT/romfs/data/." "$OUT_ROOT/data/"

if [[ "$INCLUDE_ICONS" == true ]]; then
  rm -rf "$OUT_ROOT/icons"
  mkdir -p "$OUT_ROOT/icons"
  cp -r "$SWITCH_ROOT/romfs/icons/." "$OUT_ROOT/icons/"
else
  rm -rf "$OUT_ROOT/icons"
fi

# Include lite NRO if present
LITE_NRO_PATH="$SWITCH_ROOT/puse-switch-lite.nro"
if [[ -f "$LITE_NRO_PATH" ]]; then
  cp "$LITE_NRO_PATH" "$OUT_ROOT/puse-switch-lite.nro"
  echo "Lite NRO included: puse-switch-lite.nro"
fi

echo "Prepared SD bundle under: $OUT_ROOT"
echo "Copy 'switch/puse' to SD card root."
