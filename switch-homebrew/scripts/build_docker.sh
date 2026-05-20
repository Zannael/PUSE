#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWITCH_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TOOLS_ROOT="$SWITCH_ROOT/tools"
IMAGE_NAME="switch-plutonium-dev"

echo "[1/5] Building Docker image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" -f "$TOOLS_ROOT/Dockerfile" "$TOOLS_ROOT"

echo "[2/5] Building switch-homebrew (.nro/.elf)"
docker run --rm -v "$SWITCH_ROOT":/work -w /work "$IMAGE_NAME" make clean
docker run --rm -v "$SWITCH_ROOT":/work -w /work "$IMAGE_NAME" make

echo "[3/5] Preparing SD bundle under artifacts/sdmc"
docker run --rm -v "$SWITCH_ROOT":/work -w /work "$IMAGE_NAME" ./scripts/prepare_sd_bundle.sh

echo "[4/5] Fixing host ownership for build outputs"
docker run --rm -v "$SWITCH_ROOT":/work "$IMAGE_NAME" sh -lc "chown -R $(id -u):$(id -g) /work/puse-switch.nro /work/puse-switch.elf /work/build /work/artifacts/sdmc"

echo "[5/5] Done"
echo "NRO: $SWITCH_ROOT/puse-switch.nro"
echo "SD bundle: $SWITCH_ROOT/artifacts/sdmc/switch/puse"
