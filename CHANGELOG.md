# Changelog

## Unreleased

### Planned

- Add create/insert workflows to add Pokemon to party and PC boxes (with validation and checksum-safe writes).
- Add ROM-truth form alias metadata (Alolan/Galarian/Hisuian/Mega/Giga where confidently identifiable) on top of current neutral `Form N` labels.
- Add ROM-truth sprites for Pokémons and items with ROM-based sprites extraction.
- Investigate save flags editing feasibility for difficulty mode and NG+ state.
- Add clearer changelog/update visibility in project docs.
- Extend Trainer Profile editing to include identity metadata: name (with character encoding validation), gender/style flags, and appearance parameters (hair color/skin tone).
- Implement "Costume Box" unlocker and wardrobe editing.

### Changed

#### ROM Truth Data

- Added Unbound ROM move extraction tooling (`backend/tools/extract_unbound_moves_table.py`) with diagnostic output (`backend/data/move_table_from_rom.json`).
- Move catalogs are now synchronized from ROM truth with `backend/data/moves.txt` as canonical runtime source (mirrored to `frontend/public/data/moves.txt` for local mode parity).
- Added Unbound ROM ability extraction tooling (`backend/tools/extract_unbound_abilities_table.py`) with diagnostic output (`backend/data/ability_table_from_rom.json`).
- Ability catalogs are now synchronized from ROM truth with `backend/data/abilities.txt` as canonical runtime source (mirrored to `frontend/public/data/abilities.txt` for local mode parity).
- Added Unbound ROM species extraction tooling (`backend/tools/extract_unbound_species_table.py`) with diagnostic output (`backend/data/species_table_from_rom.json`).
- Species catalogs are now synchronized from ROM truth with backend/frontend parity, and species base stats were regenerated from ROM (`backend/tools/extract_unbound_species_base_stats.py`).
- Added Unbound ROM species growth-rate extraction tooling (`backend/tools/extract_unbound_species_growth_rates.py`) and synchronized species growth metadata (`backend/data/species_growth_rates.json` mirrored to `frontend/src/core/speciesGrowthRates.json`) for backend/local parity.
- Added Unbound ROM species abilities metadata extraction tooling (`backend/tools/extract_unbound_species_abilities_meta.py`) with anchor validation (Gliscor -> Poison Heal, Raticate base -> Hustle), and synchronized metadata (`backend/data/species_abilities_meta.json` mirrored to `frontend/src/core/speciesAbilitiesMeta.json`).

#### Species, Forms, and Nicknames

- Pokemon species editing is now available in the editor for both Party and PC flows, with matching behavior in `backend` and `local` runtime modes.
- Species UI payloads now expose form-aware metadata (`species_label`, `species_variant_index`, `species_variant_count`, `is_form_variant`) so duplicate-name forms are distinguishable (for example `Goodra (Form 1)` / `Goodra (Form 2)`).
- Added nickname editing support for Party and PC flows in both backend and local modes, including save-path parity.
- Species editor now includes nickname controls and a guided rename behavior when changing species, so users can keep custom nicknames or automatically align nicknames with the selected species.

#### Party and PC Correctness

- Party stat bytes are now recalculated after species/stat-affecting edits (species, IVs, EVs, nature, level) using ROM-derived base stats and nature modifiers, with current HP clamped to the new max HP.
- Fixed PC Box move packing/parsing to use the correct CFRU compact 40-bit layout in both backend and local mode.
- Fixed local-mode 32-bit overflow during 40-bit move bit-packing by switching to `BigInt`, resolving slot corruption cases (for example `DragonAscent`/`V-create` turning into wrong moves in frontend or in-game).
- Added species drift safety checks for non-species edit flows and tightened save paths to send only changed fields, reducing unintended side effects.
- Party level edits now default to ROM-truth species growth rate when available, with fallback to previous growth inference behavior when metadata is unavailable.
- PC level editing now defaults to ROM-truth species growth rate in the editor flow (manual override still supported), reducing EXP/level ambiguity.
- Party and PC payloads now expose full ROM-derived ability metadata (slot 1/slot 2/hidden IDs and names) with runtime parity.

#### Party and PC Identity with PID Safety

- Implemented identity editing controls in the Pokemon editor for both Party and PC flows (shiny toggle + gender toggle), with PID side-effect warnings in UI.
- Added identity update flows for Party and PC in both runtime modes (`backend` and `local`) to preserve parity.
- Identity PID solving now preserves nature and standard ability-slot parity while applying shiny/gender targets when valid across Party and PC edits.
- Added species identity metadata (`gender_threshold`) extracted from ROM truth and mirrored to frontend local mode.
- Added explicit validation for incompatible gender requests (fixed male/fixed female/genderless species), returning clear errors instead of silent mutation.
- Added PID-focused regression coverage (`frontend/scripts/identity-regression.mjs`) for Party and PC shiny/gender toggles, HA preservation, invalid-gender guards, and mixed PID edit sequences across backend/local parity.

#### Bag UX and Safety

- Bag quick-pocket safety now gates TM Case and Berry Pouch editing by unlock state: non-empty pockets are editable, while empty pockets are editable only when the corresponding key item is present (`TM Case` / `Berry Pouch`).
- Quick-pocket responses now include readiness/lock metadata (`ready`, `locked`, `locked_reason`, `unlock_via`) and can expose safe empty-slot bootstrap candidates only for unlocked TM/Berry flows.
- Bag editing now uses an explicit save flow: slot edits are applied in memory, and `SAVE BAG CHANGES` is required to write updates to the `.sav` file.
- Bag UX now keeps save actions visible at the top of pocket view and warns users when navigating back/changing sections with unsaved bag edits.

#### Editor UX

- Pokemon editor Info tab now shows Species controls before level/nature/item controls for faster access.
- Ability controls now show resolved ROM-truth ability names for slot buttons and current-ability labels (including hidden ability names when available).

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
