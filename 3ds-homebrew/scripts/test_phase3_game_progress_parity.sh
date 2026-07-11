#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"

SAVE_FILE="${1:-$ROOT/artifacts/Unbound.sav}"
KEEP_TMP=false
if [[ "${2:-}" == "--keep-tmp" ]]; then
  KEEP_TMP=true
fi

if [[ ! -f "$SAVE_FILE" ]]; then
  echo "Save file not found: $SAVE_FILE" >&2
  exit 1
fi

mkdir -p "$ROOT/build/host"
"$ROOT/scripts/parity_tmp.sh" init

CPP_COMMON=(
  -std=c++17
  -I"$ROOT/include"
  "$ROOT/source/core/SaveSections.cpp"
  "$ROOT/source/core/SaveSession.cpp"
  "$ROOT/source/core/Money.cpp"
  "$ROOT/source/core/Bag.cpp"
  "$ROOT/source/core/GameProgress.cpp"
  "$ROOT/source/io/DataLoader.cpp"
)

g++ "${CPP_COMMON[@]}" "$ROOT/tests/game_progress_dump.cpp" -o "$ROOT/build/host/game_progress_dump"

PORT_OUT="$ROOT/artifacts/tmp/port/phase3_game_progress.csv"
SOURCE_OUT="$ROOT/artifacts/tmp/source/phase3_game_progress.csv"

"$ROOT/build/host/game_progress_dump" "$SAVE_FILE" > "$PORT_OUT"

PYTHONPATH="$REPO_ROOT/backend" python3 - <<'PY' "$SAVE_FILE" "$SOURCE_OUT"
from pathlib import Path
import sys
from modules import game_progress

save_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])
buf = bytearray(save_path.read_bytes())

def join_ids(ids):
    return '|'.join(str(int(x)) for x in ids)

def line(profile):
    s = game_progress.build_game_progress_snapshot(buf, cap_profile=profile)
    return ','.join(str(x) for x in [
        s['badge_count'],
        s['active_level_cap'],
        s['normal_level_cap'],
        s['expert_level_cap'],
        s['cap_profile'],
        s['effective_level_cap'],
        1 if s['difficulty_flag_known'] else 0,
        1 if s['is_champion'] else 0,
        1 if s['mega_unlocked'] else 0,
        s['money'],
        s['battle_points'],
        1 if s['tm_case_owned'] else 0,
        join_ids(s['owned_tmhm_item_ids']),
        1 if s['key_items']['dexnav'] else 0,
        1 if s['key_items']['stat_scanner'] else 0,
        1 if s['key_items']['mega_ring'] else 0,
        s['consumables']['heart_scale'],
        s['consumables']['dream_mist'],
        s['consumables']['bottle_cap'],
        s['consumables']['gold_bottle_cap'],
    ])

out_path.write_text(line('normal') + '\n' + line('expert') + '\n', encoding='utf-8')
PY

"$ROOT/scripts/parity_tmp.sh" compare "$SOURCE_OUT" "$PORT_OUT"

if [[ "$KEEP_TMP" == false ]]; then
  "$ROOT/scripts/parity_tmp.sh" cleanup
fi

echo "Phase 3 game progress parity check complete."
