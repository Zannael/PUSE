#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PORT_ROOT/.." && pwd)"

mkdir -p "$PORT_ROOT/build/host"
"$PORT_ROOT/scripts/parity_tmp.sh" init

SOURCE_INPUT="$PORT_ROOT/artifacts/tmp/source/rtc_time_fixer_input.sav"
SOURCE_OUTPUT="$PORT_ROOT/artifacts/tmp/source/rtc_time_fixer_output.sav"
PORT_OUTPUT="$PORT_ROOT/artifacts/tmp/port/rtc_time_fixer_output.sav"

PYTHONPATH="$REPO_ROOT/backend/tools" python3 - "$SOURCE_INPUT" "$SOURCE_OUTPUT" <<'PY'
from pathlib import Path
import sys
from rtc_time_fixer_regression import build_save
from rtc_repair_from_pair import reenable_time_fixer

source, _, _ = build_save()
Path(sys.argv[1]).write_bytes(source)
Path(sys.argv[2]).write_bytes(reenable_time_fixer(source)["bytes"])
PY

g++ -std=c++17 -I"$PORT_ROOT/include" \
  "$PORT_ROOT/source/core/SaveSections.cpp" \
  "$PORT_ROOT/source/core/Rtc.cpp" \
  "$PORT_ROOT/tests/rtc_time_fixer_test.cpp" \
  -o "$PORT_ROOT/build/host/rtc_time_fixer_test"

"$PORT_ROOT/build/host/rtc_time_fixer_test" "$SOURCE_INPUT" "$PORT_OUTPUT"
"$PORT_ROOT/scripts/parity_tmp.sh" compare "$SOURCE_OUTPUT" "$PORT_OUTPUT"
"$PORT_ROOT/scripts/parity_tmp.sh" cleanup
echo "RTC Time Fixer backend/C++ parity check complete."
