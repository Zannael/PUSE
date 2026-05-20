#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWITCH_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SWITCH_ROOT/.." && pwd)"

SAVE_FILE="${1:-$SWITCH_ROOT/artifacts/Unbound.sav}"
SPECIES_FILE="$SWITCH_ROOT/romfs/data/pokemon.txt"
KEEP_TMP=false
if [[ "${2:-}" == "--keep-tmp" ]]; then
  KEEP_TMP=true
fi

if [[ ! -f "$SAVE_FILE" ]]; then
  echo "Save file not found: $SAVE_FILE" >&2
  exit 1
fi

if [[ ! -f "$SPECIES_FILE" ]]; then
  echo "Species file not found: $SPECIES_FILE" >&2
  exit 1
fi

mkdir -p "$SWITCH_ROOT/build/host"
"$SWITCH_ROOT/scripts/parity_tmp.sh" init

CPP_COMMON=(
  -std=c++17
  -I"$SWITCH_ROOT/include"
  "$SWITCH_ROOT/source/core/SaveSections.cpp"
  "$SWITCH_ROOT/source/core/SaveSession.cpp"
  "$SWITCH_ROOT/source/core/Party.cpp"
  "$SWITCH_ROOT/source/io/DataLoader.cpp"
)

g++ "${CPP_COMMON[@]}" "$SWITCH_ROOT/tests/party_dump.cpp" -o "$SWITCH_ROOT/build/host/party_dump"

PORT_OUT="$SWITCH_ROOT/artifacts/tmp/port/phase2_party.csv"
SOURCE_OUT="$SWITCH_ROOT/artifacts/tmp/source/phase2_party.csv"

"$SWITCH_ROOT/build/host/party_dump" "$SAVE_FILE" "$SPECIES_FILE" > "$PORT_OUT"

python3 - <<'PY' "$SAVE_FILE" "$SOURCE_OUT"
import struct
import sys
from pathlib import Path

save_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])

SECTION_SIZE = 0x1000
TRAINER_SECTION_ID = 1
TEAM_COUNT_OFF = 0x34
PARTY_BASE_OFF = 0x38
MON_SIZE = 100
MON_DATA_START = 0x20
MON_NICK_OFF = 0x08
MON_LEVEL_OFF = 0x54

charmap = {0x00: ' ', 0xAB: '!', 0xAC: '?', 0xAD: '.', 0xAE: '-'}
for i, c in enumerate('0123456789'):
    charmap[0xB0 + i] = c
for i, c in enumerate('ABCDEFGHIJKLMNOPQRSTUVWXYZ'):
    charmap[0xBB + i] = c
for i, c in enumerate('abcdefghijklmnopqrstuvwxyz'):
    charmap[0xD5 + i] = c

def ru16(b, o):
    return struct.unpack_from('<H', b, o)[0]

def ru32(b, o):
    return struct.unpack_from('<I', b, o)[0]

def decode_text(raw: bytes) -> str:
    out = []
    for x in raw:
        if x == 0xFF:
            break
        out.append(charmap.get(x, '?'))
    return ''.join(out).rstrip(' ')

raw = save_path.read_bytes()
sections = []
for idx in range(len(raw) // SECTION_SIZE):
    off = idx * SECTION_SIZE
    sec = raw[off:off+SECTION_SIZE]
    sections.append({
        'off': off,
        'id': ru16(sec, 0xFF4),
        'saveidx': ru32(sec, 0xFFC),
    })

trainers = [s for s in sections if s['id'] == TRAINER_SECTION_ID]
if not trainers:
    out_path.write_text('', encoding='utf-8')
    raise SystemExit(0)

trainers.sort(key=lambda x: x['saveidx'], reverse=True)
off = trainers[0]['off']
sec = raw[off:off+SECTION_SIZE]
team_count = min(6, ru32(sec, TEAM_COUNT_OFF))

lines = []
for i in range(team_count):
    mon_off = PARTY_BASE_OFF + i * MON_SIZE
    mon = sec[mon_off: mon_off + MON_SIZE]
    if len(mon) < MON_SIZE:
        continue
    pid = ru32(mon, 0)
    species_id = ru16(mon, MON_DATA_START + 0)
    if pid == 0 and species_id == 0:
        continue
    item_id = ru16(mon, MON_DATA_START + 2)
    exp = ru32(mon, MON_DATA_START + 4)
    level = mon[MON_LEVEL_OFF]
    nature_id = pid % 25
    nickname = decode_text(mon[MON_NICK_OFF:MON_NICK_OFF+10])
    lines.append(f"{i},{species_id},{item_id},{level},{exp},{nature_id},{nickname}")

out_path.write_text('\n'.join(lines) + ('\n' if lines else ''), encoding='utf-8')
PY

"$SWITCH_ROOT/scripts/parity_tmp.sh" compare "$SOURCE_OUT" "$PORT_OUT"

if [[ "$KEEP_TMP" == false ]]; then
  "$SWITCH_ROOT/scripts/parity_tmp.sh" cleanup
fi

echo "Phase 2 party parity check complete."
