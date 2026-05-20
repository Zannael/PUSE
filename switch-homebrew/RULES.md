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
- UI implementation must follow the mandatory UI/UX reference workflow below for every UI touch.
- Frontend (`frontend/`) can be used as flow/feature-division inspiration (what screens and controls exist), but not as a direct implementation template.
- Keep feature parity with existing app flows while adapting layout to controller-based navigation.
- Replicate frontend interaction patterns as closely as feasible (navigation flow, edit affordances, feedback timing, validation messaging).
- Prioritize user-friendly interaction over strict visual matching when controller ergonomics require adaptation.
- UI restyling is allowed, but behavior is not:
  - Same operations.
  - Same validation outcomes.
- Same resulting save modifications.
- If icons are used, load them from ROMFS paths mapped from `backend/icons/`.

### 6.1) Mandatory UI Reference Workflow (Non-Negotiable)

- Any time code is touched in a UI/UX way, you must explicitly review both of these before coding:
  - Goldleaf UI sources under `switch-homebrew/tools/Goldleaf/ui/`
  - Plutonium docs under `switch-homebrew/tools/Plutonium/docs/`
- For new screens or layout rewrites, also review the Plutonium example app under `switch-homebrew/tools/Plutonium/example/`.
- Skipping this review is not allowed. If these references are unavailable, UI work must stop until access is restored.
- PRs/patch notes for UI changes must state which Goldleaf files and which Plutonium doc pages were checked.

### 6.2) Where Plutonium Pre-Made UI Components Are (Must Be Used First)

- Canonical component index (docs): `switch-homebrew/tools/Plutonium/docs/files.html`
- Canonical component headers (source of truth): `switch-homebrew/tools/Plutonium/Plutonium/include/pu/ui/`
- Core ready-to-use UI elements are in: `switch-homebrew/tools/Plutonium/Plutonium/include/pu/ui/elm/`
  - `elm_Button.hpp`
  - `elm_Menu.hpp` (includes `MenuItem`, selection callbacks, per-item icon support)
  - `elm_Toggle.hpp`
  - `elm_ProgressBar.hpp`
  - `elm_TextBlock.hpp`
  - `elm_Image.hpp`
  - `elm_Rectangle.hpp`
- Other built-ins to use before custom widgets:
  - `switch-homebrew/tools/Plutonium/Plutonium/include/pu/ui/ui_Dialog.hpp` (dialogs, option lists, dialog icon)
  - `switch-homebrew/tools/Plutonium/Plutonium/include/pu/ui/ui_Overlay.hpp`
  - `switch-homebrew/tools/Plutonium/Plutonium/include/pu/ui/extras/extras_Toast.hpp`

### 6.3) Component Selection Policy

- This policy is mandatory and applies to every UI/UX change, including very small components.
- If a component might already exist in Plutonium (even with slight doubt), the required sequence is:
  1) Search for the component in Plutonium docs/headers (`tools/Plutonium/docs/`, `tools/Plutonium/Plutonium/include/pu/ui/`).
  2) Check Goldleaf UI for real usage patterns (`tools/Goldleaf/ui/`).
  3) Understand constraints/API from docs + usage.
  4) Only then implement.
- Do not create custom controls if an existing Plutonium control can do the job.
- In this vendored Plutonium snapshot, there is no dedicated `Card` or `Slider` element in `pu/ui/elm`; build those by composition (`Rectangle` + `TextBlock` + `Image`/`Menu`) only when required.
- In this vendored Plutonium snapshot, Nintendo button icons are not exposed as a dedicated built-in Plutonium widget; use explicit assets/glyphs and keep usage consistent across screens.

### 6.5) Mandatory Escalation When Component Is Missing or Hard

- If a UI/UX idea cannot be mapped cleanly to existing Plutonium + known Goldleaf patterns, implementation must pause and an explicit decision note must be provided before continuing.
- The decision note is mandatory and must include:
  - what was searched (docs pages, headers, Goldleaf files),
  - why existing components/patterns are insufficient,
  - 1-3 concrete implementation options,
  - trade-offs (UX quality, complexity, maintenance risk, parity risk),
  - recommended option.
- No speculative custom widget should be implemented without this explicit note/decision step.

### 6.6) Mandatory Multi-Page Navigation and Full-Screen Usage

- This policy is mandatory for all information navigation flows.
- When changing information context (list -> details, details -> edit form, category -> subcategory, etc.), navigate to another full page/layout.
- Do not open nested sub-blocks/sub-boxes inside the same view for major information changes.
- Every page must have a deterministic way to return to the previous page (standard back-stack behavior, typically `B`).
- Navigation must be implemented as an explicit page stack (`push` on enter, `pop` on back), preserving consistent return behavior.
- For every screen, use the maximum available screen area intentionally; avoid partial-screen layouts that leave large unused regions without purpose.
- Re-check Goldleaf multi-view patterns whenever implementing or changing navigation:
  - `switch-homebrew/tools/Goldleaf/ui/ui_MainApplication.cpp`
  - related feature layouts under `switch-homebrew/tools/Goldleaf/ui/`

### 6.4) Goldleaf UI Reference Points For Icons/Patterns

- Goldleaf UI source reference: `switch-homebrew/tools/Goldleaf/ui/`
- Common icon loading pattern reference: `switch-homebrew/tools/Goldleaf/ui/ui_Utils.cpp`
- App shell/layout stack and dialog usage reference: `switch-homebrew/tools/Goldleaf/ui/ui_MainApplication.cpp`

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
- Preferred build environment is Docker using `switch-homebrew/tools/Dockerfile` to avoid host toolchain/glibc mismatches.
- Standard Docker build flow:
  - `docker build -t switch-plutonium-dev -f switch-homebrew/tools/Dockerfile switch-homebrew/tools`
  - `docker run --rm -v "$(pwd)/switch-homebrew":/work -w /work switch-plutonium-dev make clean && docker run --rm -v "$(pwd)/switch-homebrew":/work -w /work switch-plutonium-dev make`
- After building `.nro`, SD artifacts must also be refreshed (mandatory):
  - `switch-homebrew/scripts/prepare_sd_bundle.sh`
  - This updates `switch-homebrew/artifacts/sdmc/switch/puse/puse-switch.nro` and required `data/` (and `icons/` when enabled).
- After Docker build, fix artifact ownership on host (mandatory):
  - `docker run --rm -v "$(pwd)/switch-homebrew":/work switch-plutonium-dev sh -lc "chown -R $(id -u):$(id -g) /work/puse-switch.nro /work/puse-switch.elf /work/build /work/artifacts/sdmc"`
- Preferred one-command path:
  - `switch-homebrew/scripts/build_docker.sh`
  - This performs Docker image build, project build, SD bundle refresh, and ownership fix.
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
