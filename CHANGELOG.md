# Changelog

## Unreleased

### Added

- Frontend runtime mode abstraction with `backend` and `local` modes.
- In-browser local save editing engine (`frontend/src/core/*`) for party, PC, bag, money, checksums, and save export.
- GitHub Pages deployment workflow (`.github/workflows/deploy-pages.yml`) with SPA fallback support.
- Maintainer/developer docs: save editing guide and frontend local migration spec.
- Party level editing with growth-curve support (auto detection + manual override).
- PC level editing in the Pokemon editor modal (manual growth-curve selection).
- Shared frontend growth utilities for deterministic level-to-EXP conversion.

### Changed

- App now routes UI operations through a unified API client (`frontend/src/services/apiClient.js`) instead of direct `fetch` calls in components.
- Bag quick pocket detection improved with richer confidence metadata and clearer fallback guidance in UI.
- Item icon resolution now prioritizes `backend/icons/items/Base Items/` before other item icon folders.
- TM item naming data updated to include type suffixes (for example `TM01: Focus Punch - Fighting`).
- README updated for frontend-first runtime model, simplified local run instructions, and compact maintainer deployment notes.
- Pokemon editor tab renamed from `Nature & Item` to `LV, Nature & Item`.
- Backend party payload now includes `exp` to support level workflows.

### Fixed

- Held item icon visibility in Pokemon editor modal (header + current item panel), with robust fallback for missing/broken icons.
- TM/HM icon matching logic:
  - HM resolves by numeric icon naming (`hm01`, `hm02`, ...).
  - TM prefers type-based icons (`tm-fighting`, `tm-water`, ...), then falls back to numeric variants if available.

### Removed

- Legacy `backend/icons.py` test utility script.

## v1.0.0 - 2026-03-12

### Added

- Public repo baseline: `README.md`, `CONTRIBUTING.md`, `LICENSE`, env examples, backend requirements.
- Fast bag workflows: quick pocket bootstrap (main/ball/berry/tm) while keeping item search as canonical fallback.
- Reliable pocket support for Ball pouch, Berry pouch, and TM case (including add/edit flows).
- Frontend money editing modal connected to backend money patch endpoint.
- Static data loading from `backend/data/items.txt`, `backend/data/pokemon.txt`, `backend/data/moves.txt`, and `backend/data/tms.txt`.
- Optional item icon lookup endpoint with fuzzy matching and graceful no-icon behavior.

### Changed

- Backend refactor to module-based structure under `backend/modules/`.
- API startup now uses static lookup files instead of CT/Lua parsing at runtime.
- Bag editing robustness improved (encoding handling, TM/HM quantity safeguards, candidate quality metadata).
- Optional sprite behavior hardened: app runs even when pokemon/item icon assets are missing.

### Removed

- Legacy runtime dependency on `backend/data/extractor.py`.
- Legacy reverse-engineering scripts and Qt GUI from active v1 scope.
