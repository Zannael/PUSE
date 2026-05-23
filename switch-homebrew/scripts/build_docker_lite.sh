#!/usr/bin/env bash
# Build the lite NRO variant (data-only ROMFS, no icon assets).
# Produces puse-switch-lite.nro alongside the standard build.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWITCH_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TOOLS_ROOT="$SWITCH_ROOT/tools"
IMAGE_NAME="switch-plutonium-dev"

echo "[1/4] Building Docker image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" -f "$TOOLS_ROOT/Dockerfile" "$TOOLS_ROOT"

echo "[2/4] Building lite NRO (no icon assets)"
docker run --rm -v "$SWITCH_ROOT":/work -w /work "$IMAGE_NAME" make clean-lite
docker run --rm -v "$SWITCH_ROOT":/work -w /work "$IMAGE_NAME" make lite

echo "[3/4] Fixing host ownership for lite build outputs"
docker run --rm -v "$SWITCH_ROOT":/work "$IMAGE_NAME" sh -lc \
    "chown -R $(id -u):$(id -g) /work/puse-switch-lite.nro /work/puse-switch-lite.elf /work/build-lite 2>/dev/null || true"

echo "[4/4] Done"
echo "Lite NRO: $SWITCH_ROOT/puse-switch-lite.nro"
echo "Copy to SD card: sdmc:/switch/puse/puse-switch-lite.nro"
