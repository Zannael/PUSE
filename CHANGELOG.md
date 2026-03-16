# Changelog

## Unreleased

### Planned

- Add Pokemon identity controls in editor (shiny toggle, gender toggle).
- Add create/insert workflows to add Pokemon to party and PC boxes.
- Investigate save flags editing feasibility for difficulty mode and NG+ state.
- Add clearer changelog/update visibility in project docs.

### Changed

- Bag quick-pocket safety now gates TM Case and Berry Pouch editing by unlock state: non-empty pockets are editable, while empty pockets are editable only when the corresponding key item is present (`TM Case` / `Berry Pouch`).
- Quick-pocket responses now include readiness/lock metadata (`ready`, `locked`, `locked_reason`, `unlock_via`) and can expose safe empty-slot bootstrap candidates only for unlocked TM/Berry flows.
- Pokemon species editing is now available in the editor for both Party and PC flows, with matching behavior in `backend` and `local` runtime modes.
- Party stat bytes are now recalculated after species/stat-affecting edits (species, IVs, EVs, nature, level) using ROM-derived base stats and nature modifiers, with current HP clamped to the new max HP.
- Added Unbound ROM species base-stat extraction tooling (`backend/tools/extract_unbound_species_base_stats.py`) and generated base-stat datasets for backend/frontend parity.
- Bag editing now uses an explicit save flow: slot edits are applied in memory, and `SAVE BAG CHANGES` is required to write updates to the `.sav` file.
- Bag UX now keeps save actions visible at the top of pocket view and warns users when navigating back/changing sections with unsaved bag edits.
- Pokemon editor Info tab now shows Species controls before level/nature/item controls for faster access.

## v1.1.0 - 2026-03-16

### Added

- Frontend runtime mode abstraction with `backend` and `local` modes.
- In-browser local save editing engine (`frontend/src/core/*`) for party, PC, bag, money, checksums, and save export.
- GitHub Pages deployment workflow (`.github/workflows/deploy-pages.yml`) with SPA fallback support.
- Maintainer/developer docs: save editing guide and frontend local migration spec.
- Party level editing with growth-curve support (auto detection + manual override).
- PC level editing in the Pokemon editor modal (manual growth-curve selection).
- Shared frontend growth utilities for deterministic level-to-EXP conversion.
- Key Items pocket quick-detection and editing support (backend + local mode).
- Initial pocket mapping data file for item-family classification (`key`, `tm`, `hm`, `ball`, `berry`, `main`).
- ROM item probe utility for early reverse-engineering checks against `.gba` files.
- ROM item table extractor for Unbound (`44`-byte item structs, pocket-code metadata export).

### Changed

- App now routes UI operations through a unified API client (`frontend/src/services/apiClient.js`) instead of direct `fetch` calls in components.
- Bag quick pocket detection improved with richer confidence metadata and clearer fallback guidance in UI.
- Item icon resolution now prioritizes `backend/icons/items/Base Items/` before other item icon folders.
- TM item naming data updated to include type suffixes (for example `TM01: Focus Punch - Fighting`).
- README updated for frontend-first runtime model, simplified local run instructions, and compact maintainer deployment notes.
- Pokemon editor tab renamed from `Nature & Item` to `LV, Nature & Item`.
- Backend party payload now includes `exp` to support level workflows.
- Bag editor now forces quantity to `1` for TM/HM and Key Items to keep pocket writes consistent.
- Added reverse-engineering notes documenting discovered ROM item-table anchors and pocket byte mapping.
- Bag pocket family classification now uses ROM-derived item pocket metadata (backend and local mode), with fallback constants if metadata is unavailable.

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
