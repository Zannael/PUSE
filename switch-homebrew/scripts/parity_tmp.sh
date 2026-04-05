#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWITCH_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$SWITCH_ROOT/artifacts/tmp"

usage() {
  cat <<'EOF'
Usage:
  parity_tmp.sh init
  parity_tmp.sh compare <source_file> <candidate_file>
  parity_tmp.sh status
  parity_tmp.sh cleanup

Commands:
  init      Create artifacts/tmp folders for parity work
  compare   Byte-compare two files and return non-zero on mismatch
  status    Show current artifacts/tmp layout
  cleanup   Remove all temporary parity artifacts

Conventions:
  - Source of truth output should be stored under artifacts/tmp/source/
  - Switch-port output should be stored under artifacts/tmp/port/
EOF
}

cmd_init() {
  mkdir -p "$TMP_DIR/source" "$TMP_DIR/port"
  echo "Initialized: $TMP_DIR"
}

cmd_compare() {
  if [[ $# -ne 2 ]]; then
    echo "compare requires: <source_file> <candidate_file>" >&2
    usage
    exit 1
  fi

  local source_file="$1"
  local candidate_file="$2"

  if [[ ! -f "$source_file" ]]; then
    echo "Missing source file: $source_file" >&2
    exit 1
  fi
  if [[ ! -f "$candidate_file" ]]; then
    echo "Missing candidate file: $candidate_file" >&2
    exit 1
  fi

  if cmp -s "$source_file" "$candidate_file"; then
    echo "PARITY OK"
    echo "  source:    $source_file"
    echo "  candidate: $candidate_file"
    return 0
  fi

  local src_hash
  local cand_hash
  src_hash="$(sha256sum "$source_file" | cut -d' ' -f1)"
  cand_hash="$(sha256sum "$candidate_file" | cut -d' ' -f1)"

  echo "PARITY MISMATCH" >&2
  echo "  source:    $source_file" >&2
  echo "  candidate: $candidate_file" >&2
  echo "  sha256(source):    $src_hash" >&2
  echo "  sha256(candidate): $cand_hash" >&2
  exit 1
}

cmd_status() {
  if [[ ! -d "$TMP_DIR" ]]; then
    echo "No temp parity directory yet: $TMP_DIR"
    return 0
  fi
  echo "Temporary parity directory: $TMP_DIR"
  ls -la "$TMP_DIR"
}

cmd_cleanup() {
  mkdir -p "$TMP_DIR"
  rm -rf "$TMP_DIR"/*
  echo "Cleaned: $TMP_DIR"
}

main() {
  if [[ $# -lt 1 ]]; then
    usage
    exit 1
  fi

  local cmd="$1"
  shift

  case "$cmd" in
    init)
      cmd_init "$@"
      ;;
    compare)
      cmd_compare "$@"
      ;;
    status)
      cmd_status "$@"
      ;;
    cleanup)
      cmd_cleanup "$@"
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      echo "Unknown command: $cmd" >&2
      usage
      exit 1
      ;;
  esac
}

main "$@"
