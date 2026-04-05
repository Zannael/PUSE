# Switch Homebrew Porting Rules

These rules define how we port this project to Nintendo Switch (`.nro`) while keeping behavior identical to the existing app.

## 1) Primary Goal

- Build a native Switch homebrew app using Plutonium and libnx.
- Preserve functional behavior exactly, especially save parsing/writing and checksum correctness.

## 2) Single Source of Truth (Code)

- **Canonical implementation for behavior: `backend/` (Python).**
- Use backend modules/endpoints as the authoritative reference for:
  - Save structure, offsets, field encoding/decoding, and mutations.
  - Checksum computation and sector selection/update rules.
  - Icon resolution behavior and fallback rules.
  - Validation, clamping, and error handling semantics.
- Frontend (`frontend/`) is a UI/flow reference only (labels, screen flow, UX expectations), not behavior authority.
- If frontend and backend ever differ, backend wins unless we explicitly document a migration decision.

## 3) Single Source of Truth (Data)

- **Canonical data source: `backend/data/`.**
- The Switch app consumes data from `switch-homebrew/romfs/data/`, but that data must be derived from `backend/data/`.
- Do not create hand-edited, drifting copies of canonical data files.
- If conversion/packing is needed for Switch, keep it deterministic and reproducible, with the source still in `backend/data/`.

## 4) Save Editing Parity (Non-Negotiable)

- Any write operation must preserve backend-equivalent behavior byte-for-byte for equivalent inputs.
- Maintain exact compatibility for:
  - Endianness and integer sizes.
  - Offsets/section boundaries.
  - Clamp limits and fallback rules.
  - Checksum recomputation workflow.
  - Active save index/sector handling logic.
- Never "simplify" or "optimize" save logic if it changes observable output.
- If a write path differs from backend output, treat it as a bug.

## 5) Icon Rules (Must Mirror Backend Logic)

- Icon assets source: `backend/icons/`.
- Pokemon icon lookup behavior must reflect `backend/main.py` logic:
  - Numeric prefix search (`gFrontSprite{species_id}`) with remainder digit filtering.
  - Token-based special fallback handling (for non-numeric/special forms).
  - Final fallback to a valid placeholder image when no icon is found.
- Item icon lookup must reflect `backend/core/item_icon_resolver.py` behavior:
  - Same normalization/tokenization rules.
  - Same TM/HM matching heuristics.
  - Same fuzzy-match threshold semantics.

## 6) UI/UX Rules for Switch

- UI framework: **Plutonium**.
- Keep feature parity with existing app flows while adapting layout to controller-based navigation.
- Replicate frontend interaction patterns as closely as feasible (navigation flow, edit affordances, feedback timing, validation messaging).
- Prioritize user-friendly interaction over strict visual matching when controller ergonomics require adaptation.
- UI restyling is allowed, but behavior is not:
  - Same operations.
  - Same validation outcomes.
  - Same resulting save modifications.
- If icons are used, load them from ROMFS paths mapped from `backend/icons/`.

## 7) Implementation Discipline

- For each ported feature, map it to specific backend reference functions/files before coding.
- Keep a clear translation boundary:
  - Backend logic -> C++ domain/service layer.
  - Plutonium views -> presentation/input layer.
- Avoid embedding business logic in UI components.

## 8) Parity Verification Requirements

- Every mutation feature must be verified against backend behavior using the same `.sav` input.
- All produced functions/features must be runnable and testable locally before `.nro` build verification.
- Tests are mandatory after code generation for each implemented feature.
- Minimum verification for a completed feature:
  - Run operation in backend and in Switch-port logic.
  - Compare produced files against the source of truth output.
  - Compare resulting bytes/sections affected.
  - Confirm checksum-valid output and loadability.
- Store intermediate parity outputs under `switch-homebrew/artifacts/tmp/`.
- Clean `switch-homebrew/artifacts/tmp/` after parity is confirmed to avoid stale validation artifacts.
- Use `switch-homebrew/artifacts/` files for repeatable local checks unless a feature requires additional fixtures.

## 9) Allowed Divergence Policy

- Divergence from backend behavior is allowed only when explicitly documented and approved.
- Any intentional divergence must include:
  - What differs.
  - Why it is necessary.
  - User-visible impact.
  - Migration/back-compat implications.

## 10) Build and Repo Hygiene

- Build target is `.nro` via `switch-homebrew/Makefile` and toolchain under `switch-homebrew/tools/`.
- Local functional/parity tests must pass before packaging `.nro` binaries.
- Maintain support for two final variants:
  - Standard `.nro` with media/icons.
  - Lightweight `.nro` without media/icons.
- Runtime behavior must remain correct in both media-present and media-absent configurations.
- Keep changes focused; do not edit vendored tool repositories unless required for integration.
- Do not modify artifacts in ways that hide parity issues.

## 11) Data Sync Workflow

- Use `switch-homebrew/scripts/sync_romfs_data.sh` to mirror canonical assets into ROMFS.
- Default sync copies:
  - `backend/data/` -> `switch-homebrew/romfs/data/`
  - `backend/icons/` -> `switch-homebrew/romfs/icons/`
- Prefer mirrored sync (with deletion) to avoid stale ROMFS files causing false parity issues.
- Use `switch-homebrew/scripts/parity_tmp.sh` for parity temp lifecycle:
  - `init` before parity runs.
  - `compare` for byte-parity checks between source-of-truth outputs and port outputs.
  - `cleanup` after parity is confirmed.

## 12) Required Scripts (Operational)

- `switch-homebrew/scripts/sync_romfs_data.sh`: canonical asset sync for ROMFS (data + icons).
- `switch-homebrew/scripts/parity_tmp.sh`: temporary parity artifact management and byte-compare checks in `switch-homebrew/artifacts/tmp/`.

---

If a future rule conflicts with "behavioral parity with backend", parity takes precedence.
