#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWITCH_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SWITCH_ROOT/.." && pwd)"

SAVE_FILE="${1:-$SWITCH_ROOT/artifacts/Unbound.sav}"
KEEP_TMP=false
if [[ "${2:-}" == "--keep-tmp" ]]; then
  KEEP_TMP=true
fi

if [[ ! -f "$SAVE_FILE" ]]; then
  echo "Save file not found: $SAVE_FILE" >&2
  exit 1
fi

mkdir -p "$SWITCH_ROOT/build/host"

"$SWITCH_ROOT/scripts/parity_tmp.sh" init

CPP_COMMON=(
  -std=c++17
  -I"$SWITCH_ROOT/include"
  "$SWITCH_ROOT/source/core/SaveSections.cpp"
  "$SWITCH_ROOT/source/core/SaveSession.cpp"
)

g++ "${CPP_COMMON[@]}" "$SWITCH_ROOT/tests/test_phase1.cpp" -o "$SWITCH_ROOT/build/host/test_phase1"
g++ "${CPP_COMMON[@]}" "$SWITCH_ROOT/tests/checksum_report.cpp" -o "$SWITCH_ROOT/build/host/checksum_report"

"$SWITCH_ROOT/build/host/test_phase1" "$SAVE_FILE"

PORT_OUT="$SWITCH_ROOT/artifacts/tmp/port/phase1_checksums.txt"
SOURCE_OUT="$SWITCH_ROOT/artifacts/tmp/source/phase1_checksums.txt"

"$SWITCH_ROOT/build/host/checksum_report" "$SAVE_FILE" > "$PORT_OUT"

python3 - <<'PY' "$SAVE_FILE" "$SOURCE_OUT"
import struct
import sys
from pathlib import Path

save_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])

SECTION_SIZE = 0x1000
FOOTER_VALIDLEN_OFF = 0xFF0
FOOTER_ID_OFF = 0xFF4
FOOTER_CHK_OFF = 0xFF6
FOOTER_SAVEINDEX_OFF = 0xFFC

raw = save_path.read_bytes()

def ru16(b, o):
    return struct.unpack_from('<H', b, o)[0]

def ru32(b, o):
    return struct.unpack_from('<I', b, o)[0]

def checksum(payload: bytes, valid_len: int) -> int:
    if not (0 < valid_len <= len(payload)):
        L = len(payload)
    else:
        L = valid_len
    pad = (4 - (L % 4)) % 4
    p = payload[:L] + (b'\x00' * pad)
    total = 0
    for i in range(0, len(p), 4):
        total = (total + struct.unpack_from('<I', p, i)[0]) & 0xFFFFFFFF
    lower = total & 0xFFFF
    upper = (total >> 16) & 0xFFFF
    return (lower + upper) & 0xFFFF

lines = []
count = len(raw) // SECTION_SIZE
for idx in range(count):
    off = idx * SECTION_SIZE
    sec = raw[off:off + SECTION_SIZE]
    if len(sec) < SECTION_SIZE:
        continue
    sec_id = ru16(sec, FOOTER_ID_OFF)
    valid_len = ru32(sec, FOOTER_VALIDLEN_OFF)
    stored = ru16(sec, FOOTER_CHK_OFF)
    save_idx = ru32(sec, FOOTER_SAVEINDEX_OFF)
    calc = checksum(sec[:FOOTER_ID_OFF], valid_len)
    lines.append(f"{idx},{sec_id},{valid_len},{stored},{calc},{save_idx}")

out_path.write_text('\n'.join(lines) + ('\n' if lines else ''), encoding='utf-8')
PY

"$SWITCH_ROOT/scripts/parity_tmp.sh" compare "$SOURCE_OUT" "$PORT_OUT"

if [[ "$KEEP_TMP" == false ]]; then
  "$SWITCH_ROOT/scripts/parity_tmp.sh" cleanup
fi

echo "Phase 1 local test + parity check complete."
