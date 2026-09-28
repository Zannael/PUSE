#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT_ROOT="$REPO_ROOT/$1"
SAVE_FILE="${2:-$PORT_ROOT/artifacts/Unbound.sav}"
mkdir -p "$PORT_ROOT/build/host"
"$PORT_ROOT/scripts/parity_tmp.sh" init

g++ -std=c++17 -I"$PORT_ROOT/include" \
    "$PORT_ROOT/source/core/SaveSections.cpp" \
    "$PORT_ROOT/source/core/SaveSession.cpp" \
    "$PORT_ROOT/source/core/Party.cpp" \
    "$PORT_ROOT/source/core/Pc.cpp" \
    "$PORT_ROOT/source/io/DataLoader.cpp" \
    "$REPO_ROOT/backend/tools/happiness_native_parity.cpp" \
    -o "$PORT_ROOT/build/host/happiness_native_parity"

for values in '0 255' '255 0' '70 143'; do
    read -r party_value pc_value <<< "$values"
    source_out="$PORT_ROOT/artifacts/tmp/source/happiness_${party_value}_${pc_value}.sav"
    port_out="$PORT_ROOT/artifacts/tmp/port/happiness_${party_value}_${pc_value}.sav"
    PYTHONPATH="$REPO_ROOT/backend" python3 "$REPO_ROOT/backend/tools/happiness_save_fixture.py" \
        "$SAVE_FILE" "$party_value" "$pc_value" > "$source_out"
    "$PORT_ROOT/build/host/happiness_native_parity" "$SAVE_FILE" "$port_out" "$party_value" "$pc_value"
    "$PORT_ROOT/scripts/parity_tmp.sh" compare "$source_out" "$port_out"
done

"$PORT_ROOT/scripts/parity_tmp.sh" cleanup
echo "Happiness native full-save parity passed: $1"
