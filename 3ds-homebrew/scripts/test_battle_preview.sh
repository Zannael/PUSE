#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
mkdir -p "$ROOT/build/host"
g++ -std=c++17 -I"$ROOT/include" \
  "$ROOT/source/core/SaveSections.cpp" \
  "$ROOT/source/core/Party.cpp" \
  "$ROOT/source/io/DataLoader.cpp" \
  "$ROOT/tests/battle_preview_test.cpp" \
  -o "$ROOT/build/host/battle_preview_test"
(cd "$ROOT" && "$ROOT/build/host/battle_preview_test")
