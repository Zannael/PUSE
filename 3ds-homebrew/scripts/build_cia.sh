#!/usr/bin/env bash
# Build puse-3ds.cia using makerom inside the puse-3ds-dev Docker image.
# Requires: puse-3ds.elf, puse-3ds.smdh, romfs/, puse-3ds.rsf all present.
# Note: bannertool (Steveice10) is unavailable; smdhtool from devkitpro handles SMDH.
#       CIA is built without a banner section (-banner omitted); app still installs/runs.
# Outputs: puse-3ds.cia

set -e
cd "$(dirname "$0")/.."

REPO_ROOT="$(pwd)"
IMAGE="puse-3ds-dev"

# Ensure .3dsx / .elf / .smdh exist (build if missing)
if [ ! -f "puse-3ds.elf" ]; then
    echo ">>> puse-3ds.elf not found — building first..."
    scripts/build_docker.sh
fi

echo ">>> Building CIA..."
docker run --rm \
    -v "$REPO_ROOT":/work \
    -w /work \
    "$IMAGE" \
    sh -lc '
        set -e

        # Build icon.icn from icon.png using smdhtool (bundled in 3dstools)
        smdhtool --create \
            "PUSE 3DS" \
            "Pokemon Unbound Save Editor" \
            "zappaganini" \
            icon.png \
            icon.icn 2>/dev/null || cp puse-3ds.smdh icon.icn

        # Build CIA; -desc app:4 fills in access descriptor template; -target t = test/false keys (Luma3DS compatible)
        makerom \
            -f cia \
            -o puse-3ds.cia \
            -elf puse-3ds.elf \
            -rsf puse-3ds.rsf \
            -icon icon.icn \
            -desc app:4 \
            -target t

        echo ">>> puse-3ds.cia built"
        ls -lh puse-3ds.cia
    '

# Fix ownership
docker run --rm -v "$REPO_ROOT":/work "$IMAGE" \
    sh -lc "chown $(id -u):$(id -g) /work/puse-3ds.cia /work/icon.icn 2>/dev/null || true"

echo ">>> CIA build done"
