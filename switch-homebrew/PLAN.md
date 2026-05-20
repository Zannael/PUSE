# Switch Homebrew Port Plan (End-to-End)

This document defines the full implementation plan to reproduce the main software as a Nintendo Switch homebrew app (`.nro`) with functional parity.

It follows `switch-homebrew/RULES.md` and treats backend behavior as canonical.

## 1) Target Outcome

- Deliver a Switch app (Plutonium + libnx) that reproduces all core functionality of the existing software.
- Preserve save mutation behavior exactly (offsets, checksums, sector logic, validation, clamping).
- Deliver two final build variants:
  - standard `.nro` with media/icons
  - lightweight `.nro` without media/icons
- Ensure all functions are runnable/testable locally before validating `.nro` behavior.

## 2) Scope and Feature Inventory

The port must cover all major user-facing features exposed by backend/frontend flows.

### Save session and file lifecycle

- Upload/load save file into session state.
- Read current money.
- Apply edits in memory.
- Commit/save all edits with checksum updates.
- Export/download edited save.

### Party editing

- Read party list and metadata.
- Update per-slot:
  - item
  - nickname
  - species
  - ability switch / ability index
  - IVs
  - EVs
  - nature
  - identity (shiny/gender)
  - level/EXP flow
  - moves, PP, PP Ups

### PC editing

- Load PC context.
- Read box content by box id.
- Read writable slot map.
- Full edit of a PC mon.
- Insert new mon into PC slot.

### Bag editing

- Load items catalog.
- Scan bag pockets from anchor item.
- Bootstrap quick pocket candidates.
- Open/map a pocket from anchor offset.
- Edit slot item/quantity with pocket-specific constraints.
- Save bag changes through save-all flow.

### RTC tools

- Build repair candidates pack from broken + fixed save pair.
- Build quick-fix candidates pack from one save + manifest.

### Catalogs and references

- Species catalog.
- Items catalog.
- Moves catalog.
- Abilities catalog.
- Species forms/alias metadata.
- Growth rates, identity metadata, abilities metadata.

### Icons/media

- Pokemon icon retrieval parity with backend fallback behavior.
- Item icon retrieval parity with resolver heuristics.
- Graceful no-media behavior.

## 3) Canonical Sources (What We Translate)

### Behavior source of truth

- Primary: `backend/` (Python)
- Key files:
  - `backend/main.py`
  - `backend/modules/party.py`
  - `backend/modules/pc.py`
  - `backend/modules/bag.py`
  - `backend/modules/money.py`
  - `backend/tools/rtc_*.py`
  - `backend/core/item_icon_resolver.py`

### UI/flow source

- `frontend/src/App.jsx` and components (`PartyGrid`, `PCGrid`, `BagView`, modals).
- Reproduce interaction patterns where feasible for controller navigation.

### Data source of truth

- `backend/data/`
- `backend/icons/`
- Synced to ROMFS via `switch-homebrew/scripts/sync_romfs_data.sh`.

## 4) Architecture Plan

Create a layered Switch app with strict behavior/UI separation.

### Layer A: Core domain (portable C++)

- Binary primitives (read/write LE u8/u16/u32, bounds checks).
- Save section model and checksum utilities.
- Party domain.
- PC domain.
- Bag domain.
- Money domain.
- RTC patch domain.
- Catalog/data loading domain.
- Icon resolver domain (pokemon + item).

This layer contains all game/save logic and must mirror backend semantics.

### Layer B: Application/session services

- Active save buffer and filename.
- Dirty flags and staged edits.
- Save-all commit orchestrator.
- Data/index caches.
- Error mapping for UI messages.

### Layer C: Plutonium UI

- Screen navigation and modal flows.
- Input handling (buttons, stick, keyboard where needed).
- User feedback (confirm dialogs, warnings, status toasts).
- No direct binary mutations from UI components.

## 5) Implementation Phases

## Phase 0 - Environment and Repository Bootstrap

- Validate toolchain in `switch-homebrew/tools/` (devkitPro + Plutonium).
- Ensure baseline build from `switch-homebrew/Makefile` produces a minimal `.nro`.
- Create source tree:
  - `switch-homebrew/source/`
  - `switch-homebrew/source/core/`
  - `switch-homebrew/source/io/`
  - `switch-homebrew/include/`
- Sync canonical assets:
  - run `switch-homebrew/scripts/sync_romfs_data.sh`

Exit criteria:
- Minimal app boots on Switch/emulator and can read ROMFS file list.

## Phase 1 - Core Save Infrastructure

- Port shared binary helpers.
- Port section parsing and checksum functions.
- Implement save session store (buffer, metadata, lifecycle methods).
- Implement save import/export utilities.

Parity checks:
- checksum outputs match backend for reference sectors.

## Phase 2 - Catalog/Data Pipeline

- Implement ROMFS data loader for text/json tables.
- Build in-memory catalogs (species/items/moves/abilities + meta).
- Mirror backend parsing/normalization behavior.

Parity checks:
- catalog cardinalities and representative entries match backend.

## Phase 3 - Party Module Port

- Port party read model and slot decoding.
- Port all party mutation operations.
- Preserve validation rules and clamping.
- Preserve growth/EXP and level editing logic.
- Preserve identity/gender/shiny handling.

Parity checks:
- for each operation, compare output save bytes to backend output on same input.

## Phase 4 - PC Module Port

- Port PC context loading and sector mapping.
- Port box read and writable-slot detection.
- Port full edit and insertion flows.
- Preserve fallback layouts and sector touching semantics.

Parity checks:
- per-operation byte parity and checksum validity.

## Phase 5 - Bag Module Port

- Port scan candidates logic.
- Port pocket bootstrap heuristics.
- Port map pocket from anchor.
- Port slot update behavior and encoding handling.
- Preserve TM/HM/key-item quantity behavior parity.

Parity checks:
- candidate selection and written bytes match backend behavior.

## Phase 6 - Money and Save-All Orchestration

- Port money read/update logic.
- Port save-all checksum/commit orchestration across touched sectors.
- Verify combined workflows (party + bag + pc edits then save-all).

Parity checks:
- resulting save file hash equality against backend for same edit sequence.

## Phase 7 - RTC Tooling Port

- Port pair-based candidate generation.
- Port quick-fix candidate generation using manifest from ROMFS data.
- Port zip packaging behavior and summary metadata semantics.

Parity checks:
- generated candidate files and json fields match backend behavior.

## Phase 8 - Icon and Media Support

- Port pokemon icon lookup parity from backend (`main.py` behavior).
- Port item icon resolver parity from `item_icon_resolver.py`.
- Add fallback placeholder behavior.
- Ensure zero-crash behavior when icons are missing.

Parity checks:
- resolution result (found/miss path class) matches backend for test IDs.

## Phase 9 - Plutonium UI Implementation

- Build tab/screen model matching frontend flows:
  - Party
  - PC
  - Bag
  - RTC tools
  - Save/export controls
- Implement modal-driven edit flows for Pokemon edit and PC insert.
- Implement warning/confirmation patterns equivalent to frontend behavior.

Acceptance checks:
- all operations are reachable through UI and produce expected outputs.

## Phase 10 - Dual Build Variants

- Add build configuration for two binaries:
  - `with-media` (includes icons in ROMFS)
  - `lite` (no icons/media; uses fallback paths)
- Ensure both variants pass same functional tests.

Acceptance checks:
- both `.nro` files boot and execute all non-media features correctly.

## 6) Local Test Strategy (Mandatory Before .nro Validation)

All functions must be locally runnable/testable before Switch packaging checks.

### Local execution approach

- Keep core logic in portable C++ units (independent from UI).
- Provide host-side test harness/CLI wrappers for core operations.
- Use backend outputs as expected results for parity tests.

### Parity artifact workflow

- Initialize temp workspace: `switch-homebrew/scripts/parity_tmp.sh init`
- Store backend outputs in: `switch-homebrew/artifacts/tmp/source/`
- Store C++ port outputs in: `switch-homebrew/artifacts/tmp/port/`
- Compare files with: `switch-homebrew/scripts/parity_tmp.sh compare <source> <candidate>`
- Clean temp artifacts after validation: `switch-homebrew/scripts/parity_tmp.sh cleanup`

### Required parity coverage

- One test per mutation endpoint/operation at minimum.
- Mixed-flow integration tests (multiple edits before save-all).
- Regression fixtures for edge cases (forms, abilities, pocket heuristics, fallback sectors, missing media).

## 7) UI/UX Parity Plan

- Reproduce frontend interaction behavior where feasible:
  - edit confirmation patterns
  - unsaved changes warnings
  - modal editing flow
  - user feedback for success/failure
- Adapt for controller ergonomics without changing operation semantics.
- Keep labels and operation grouping familiar to existing users.

## 8) Detailed Endpoint-to-Module Mapping (Reference Checklist)

Use this list to track feature completion parity.

- `/upload` -> save session import
- `/money`, `/money/update` -> money read/write module
- `/party` + party mutation endpoints -> party read/write module
- `/items`, `/species`, `/moves`, `/abilities` -> catalog service
- `/bag/scan/*`, `/bag/pockets/bootstrap`, `/bag/pocket`, `/bag/item/update` -> bag module
- `/pc/load`, `/pc/box/*`, `/pc/writable-slots/*`, `/pc/edit`, `/pc/edit-full`, `/pc/insert` -> pc module
- `/rtc/repair-candidates`, `/rtc/quick-fix` -> rtc module
- `/pokemon-icon/*`, `/item-icon/*` -> icon resolver module
- `/save-all`, `/download` -> commit/export pipeline

## 9) Quality Gates per Milestone

Each phase is complete only if all are true:

- Code compiles for host test harness and Switch target.
- Feature tests run locally.
- Parity comparisons pass against backend outputs.
- Temporary parity artifacts are cleaned.
- No regressions on previously completed features.

## 10) Release Readiness Checklist

- `sync_romfs_data.sh` executed and ROMFS in sync.
- Local parity suite green for all implemented operations.
- Manual UI smoke test complete for Party/PC/Bag/RTC/Save flows.
- Build both variants (`with-media`, `lite`).
- Verify both `.nro` variants on target runtime environment.
- Archive final binaries and changelog notes.

## 11) Risks and Mitigations

- Hidden backend edge rules missed during translation.
  - Mitigation: line-by-line mapping from backend functions and fixture-based parity tests.
- Media dependency causing runtime failures in lite build.
  - Mitigation: explicit no-media test matrix and fallback-first design.
- Drift between ROMFS data and backend data.
  - Mitigation: mandatory sync script usage and reproducible data pipeline.

## 12) Execution Order Summary

1. bootstrap build + ROMFS sync
2. core/save/checksum infrastructure
3. catalogs
4. party
5. pc
6. bag
7. money + save-all
8. rtc
9. icons/media
10. plutonium ui integration
11. dual-variant packaging
12. final parity and release verification

---

This plan is the operational roadmap from zero implementation to full parity release on Switch.
