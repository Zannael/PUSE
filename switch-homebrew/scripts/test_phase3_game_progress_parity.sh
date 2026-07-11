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
  "$SWITCH_ROOT/source/core/Money.cpp"
  "$SWITCH_ROOT/source/core/Bag.cpp"
  "$SWITCH_ROOT/source/core/GameProgress.cpp"
  "$SWITCH_ROOT/source/io/DataLoader.cpp"
)

g++ "${CPP_COMMON[@]}" "$SWITCH_ROOT/tests/game_progress_dump.cpp" -o "$SWITCH_ROOT/build/host/game_progress_dump"

PORT_OUT="$SWITCH_ROOT/artifacts/tmp/port/phase3_game_progress.csv"
SOURCE_OUT="$SWITCH_ROOT/artifacts/tmp/source/phase3_game_progress.csv"

"$SWITCH_ROOT/build/host/game_progress_dump" "$SAVE_FILE" > "$PORT_OUT"

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

"$SWITCH_ROOT/scripts/parity_tmp.sh" compare "$SOURCE_OUT" "$PORT_OUT"

if [[ "$KEEP_TMP" == false ]]; then
  "$SWITCH_ROOT/scripts/parity_tmp.sh" cleanup
fi

echo "Phase 3 game progress parity check complete."
