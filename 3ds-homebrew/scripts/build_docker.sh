#!/usr/bin/env bash
# Build PUSE 3DS .3dsx inside Docker (image: puse-3ds-dev)
# Mirrors switch-homebrew/scripts/build_docker.sh pattern.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="puse-3ds-dev"

# Build image if missing
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo ">>> Building Docker image $IMAGE"
    docker build -t "$IMAGE" -f "$ROOT/tools/Dockerfile" "$ROOT/tools"
fi

echo ">>> make clean"
docker run --rm -v "$ROOT":/work -w /work "$IMAGE" make clean

echo ">>> make"
docker run --rm -v "$ROOT":/work -w /work "$IMAGE" make -j"$(nproc)"

echo ">>> chown artifacts back to host user"
docker run --rm -v "$ROOT":/work "$IMAGE" \
    chown -R "$(id -u):$(id -g)" /work/puse-3ds.3dsx /work/puse-3ds.elf /work/puse-3ds.smdh /work/build 2>/dev/null || true

echo ">>> done — artifacts:"
ls -la "$ROOT"/puse-3ds.3dsx "$ROOT"/puse-3ds.elf 2>/dev/null || echo "  (build failed)"
