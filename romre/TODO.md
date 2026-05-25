# ROM RE TODO

Goal: make extraction ROM-driven per CFRU hack, so app data is generated from each ROM instead of fixed shared files.

## 0) Workspace bootstrap

- [ ] Keep ROM reverse-engineering assets under `romre/`.
- [ ] Store input ROMs in `romre/roms/` (for example `Unbound.gba`, other CFRU `.gba` files).
- [ ] Store extracted outputs in `romre/data/<rom_slug>/...`.
- [ ] Define `<rom_slug>` convention once and keep it stable (recommended: lowercase filename stem, non-alnum -> `_`).

## 1) Output contract per ROM

- [ ] Create per-ROM folders:
  - `romre/data/<rom_slug>/json/`
  - `romre/data/<rom_slug>/txt/`
  - `romre/data/<rom_slug>/icons/`
  - `romre/data/<rom_slug>/reports/`
- [ ] Add a mandatory manifest file `romre/data/<rom_slug>/manifest.json` with:
  - ROM filename, size, sha256
  - extraction timestamp + tool versions/commit
  - extracted artifact list + relative paths
  - detection/confidence diagnostics

## 2) Reuse and refactor existing extractors

- [ ] Inventory current tools in `backend/tools/extract_unbound_*.py` and classify each as:
  - reusable as-is
  - needs ROM-name/generalization cleanup
  - needs pointer/anchor discovery hardening
- [ ] Refactor tools to accept generic arguments:
  - `--rom <path>`
  - `--out-root romre/data/<rom_slug>`
  - optional `--profile` (for hack-specific overrides only when auto-detect fails)
- [ ] Keep backend data generation path working during migration (no breaking switch for current PUSE behavior).

## 3) Build extraction pipeline

- [ ] Add a single orchestrator script (example: `romre/run_extract.py`) that:
  - validates ROM input
  - computes ROM hash and slug
  - runs extractors in deterministic order
  - writes `manifest.json` and summary report
  - fails loudly when required artifacts are missing
- [ ] Extraction order (initial):
  - species table
  - items table + pocket map
  - moves table + PP metadata
  - abilities table
  - species base stats
  - species growth rates
  - species identity metadata
  - species abilities metadata
  - species form aliases
  - icon mapping/manifests

## 4) Canonical data migration plan

- [ ] Introduce a new root canonical store for generated runtime data (target: repo-root `data/`), sourced from `romre/data/<rom_slug>/...`.
- [ ] Define "active ROM profile" selection for app runtimes (backend/frontend/switch/3ds).
- [ ] Update sync flows so runtime mirrors come from the selected ROM profile, not hardcoded Unbound-only artifacts.
- [ ] Keep `backend/data/` compatibility until all runtimes can load from profile-driven data.

## 5) Runtime integration

- [ ] Backend: load lookup/icon metadata from selected ROM profile; preserve existing endpoint contracts.
- [ ] Frontend local mode: consume generated JSON/TXT for selected profile.
- [ ] Switch/3DS: update ROMFS sync scripts to mirror selected profile data/icons.
- [ ] Add explicit error messages when required profile artifacts are missing.

## 6) Validation and parity gates

- [ ] For each newly extracted ROM profile, run:
  - `cd frontend && npm run parity:all`
  - `cd switch-homebrew && make test-phase1 && make test-phase2` (if feature implemented)
  - `cd 3ds-homebrew && make test-phase1 && make test-phase2` (if feature implemented)
- [ ] Add extractor regression checks (stable schema + expected anchor findings).
- [ ] Add "profile completeness" check script that verifies all required files exist.

## 7) Operational conventions

- [ ] Never commit private ROMs; commit only extracted metadata/assets allowed by project policy.
- [ ] Keep ROM hashes in manifests for reproducibility.
- [ ] Document how to add a new CFRU ROM profile in one short runbook.

## 8) Immediate next actions

- [ ] Place `Unbound.gba` in `romre/roms/`.
- [ ] Run first extraction against Unbound and emit `romre/data/unbound/...`.
- [ ] Compare generated outputs with current `backend/data/` to identify gaps.
- [ ] Prioritize refactors needed to make extractors CFRU-generic.
