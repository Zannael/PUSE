#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[1/2] Building Plutonium library"
docker run --rm -v "${ROOT_DIR}":/work -w /work switch-plutonium-dev make -C Plutonium

echo "[2/2] Building Plutonium example"
docker run --rm -v "${ROOT_DIR}":/work -w /work/Plutonium/example switch-plutonium-dev make clean && \
docker run --rm -v "${ROOT_DIR}":/work -w /work/Plutonium/example switch-plutonium-dev make

echo "Plutonium environment verification: PASS"
