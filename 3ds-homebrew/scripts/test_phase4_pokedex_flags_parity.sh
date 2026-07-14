#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THREEDS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$THREEDS_ROOT/.." && pwd)"

SAVE_FILE="${1:-$THREEDS_ROOT/artifacts/Unbound.sav}"
KEEP_TMP=false
if [[ "${2:-}" == "--keep-tmp" ]]; then
  KEEP_TMP=true
fi

if [[ ! -f "$SAVE_FILE" ]]; then
  echo "Save file not found: $SAVE_FILE" >&2
  exit 1
fi

mkdir -p "$THREEDS_ROOT/build/host"
"$THREEDS_ROOT/scripts/parity_tmp.sh" init

CPP_COMMON=(
  -std=c++17
  -I"$THREEDS_ROOT/include"
  "$THREEDS_ROOT/source/core/SaveSections.cpp"
  "$THREEDS_ROOT/source/core/SaveSession.cpp"
  "$THREEDS_ROOT/source/core/PokedexFlags.cpp"
  "$THREEDS_ROOT/source/io/DataLoader.cpp"
)

g++ "${CPP_COMMON[@]}" "$THREEDS_ROOT/tests/pokedex_flags_dump.cpp" -o "$THREEDS_ROOT/build/host/pokedex_flags_dump"

PORT_OUT="$THREEDS_ROOT/artifacts/tmp/port/phase4_pokedex_flags.csv"
SOURCE_OUT="$THREEDS_ROOT/artifacts/tmp/source/phase4_pokedex_flags.csv"

"$THREEDS_ROOT/build/host/pokedex_flags_dump" "$SAVE_FILE" > "$PORT_OUT"

PYTHONPATH="$REPO_ROOT/backend" python3 - <<'PY' "$SAVE_FILE" "$SOURCE_OUT"
from pathlib import Path
import sys
from modules import pokedex_flags

buf = bytearray(Path(sys.argv[1]).read_bytes())
out_path = Path(sys.argv[2])

def fmt(label, flags):
    return ','.join(str(x) for x in [
        label,
        1 if flags.get('trackable') else 0,
        1 if flags.get('seen') else 0,
        1 if flags.get('caught') else 0,
    ])

lines = []
lines.append(fmt('initial_25', pokedex_flags.get_pokedex_flags(buf, 25)))
lines.append(fmt('set_seen_25', pokedex_flags.set_pokedex_flag(buf, 25, 'seen', True)))
lines.append(fmt('set_caught_25', pokedex_flags.set_pokedex_flag(buf, 25, 'caught', True)))
lines.append(fmt('clear_caught_25', pokedex_flags.set_pokedex_flag(buf, 25, 'caught', False)))
lines.append(fmt('form_1020', pokedex_flags.get_pokedex_flags(buf, 1020)))
lines.append(fmt('untracked_1300', pokedex_flags.get_pokedex_flags(buf, 1300)))
out_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
PY

"$THREEDS_ROOT/scripts/parity_tmp.sh" compare "$SOURCE_OUT" "$PORT_OUT"

if [[ "$KEEP_TMP" == false ]]; then
  "$THREEDS_ROOT/scripts/parity_tmp.sh" cleanup
fi

echo "Phase 4 Pokédex flags parity check complete."
