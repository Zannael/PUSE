# Changelog

## Unreleased

### Planned

- Add create/insert workflows to add Pokemon to party (with validation and checksum-safe writes).
- Add ROM-truth sprites for Pokémons and items with ROM-based sprites extraction.
- Investigate save flags editing feasibility for difficulty mode and NG+ state.
- Extend Trainer Profile editing to include identity metadata: name (with character encoding validation), gender/style flags, and appearance parameters (hair color/skin tone).
- Implement "Costume Box" unlocker and wardrobe editing.
- Find a way to manually flag "Seen" or "Caught" when editing a species that hasn't be seen/caught before. Leaving the decision to flag it to the user, thus the "manually".
- Extend PC write-layout support so currently non-writable empty slots/boxes in uncommon save layouts can be edited safely (instead of UI-locked).

#### Community Feedback UX Backlog

- Add keyboard-assisted stat editing shortcuts (Ctrl+click to set max, Alt+click to set zero) for IV/EV fields.
- ~Investigate ROM-truth naming mismatch reports (for example Rhyperior shown as `Filter` vs expected `Solid Rock`) and align visible labels where appropriate.~ This now has [an opened issue](https://github.com/Zannael/PUSE/issues/7).

### Changed

#### ROM Truth Data

- Added Unbound ROM move extraction tooling (`backend/tools/extract_unbound_moves_table.py`) with diagnostic output (`backend/data/move_table_from_rom.json`).
- Move extraction now infers move count directly from ROM (instead of inheriting a previous `moves.txt` cap), and refreshed catalogs now include the full detected Unbound move table (`922` moves).
- `backend/data/move_table_from_rom.json` now supports merged `base_pp` per move row when PP metadata is provided from ROM-derived extraction.
- Move catalogs are now synchronized from ROM truth with `backend/data/moves.txt` as canonical runtime source (mirrored to `frontend/public/data/moves.txt` for local mode parity).
- Added Unbound ROM ability extraction tooling (`backend/tools/extract_unbound_abilities_table.py`) with diagnostic output (`backend/data/ability_table_from_rom.json`).
- Ability catalogs are now synchronized from ROM truth with `backend/data/abilities.txt` as canonical runtime source (mirrored to `frontend/public/data/abilities.txt` for local mode parity).
- Added Unbound ROM species extraction tooling (`backend/tools/extract_unbound_species_table.py`) with diagnostic output (`backend/data/species_table_from_rom.json`).
- Species catalogs are now synchronized from ROM truth with backend/frontend parity, and species base stats were regenerated from ROM (`backend/tools/extract_unbound_species_base_stats.py`).
- Added Unbound ROM species growth-rate extraction tooling (`backend/tools/extract_unbound_species_growth_rates.py`) and synchronized species growth metadata (`backend/data/species_growth_rates.json` mirrored to `frontend/src/core/speciesGrowthRates.json`) for backend/local parity.
- Added Unbound ROM species abilities metadata extraction tooling (`backend/tools/extract_unbound_species_abilities_meta.py`) with anchor validation (Gliscor -> Poison Heal, Raticate base -> Hustle), and synchronized metadata (`backend/data/species_abilities_meta.json` mirrored to `frontend/src/core/speciesAbilitiesMeta.json`).
- Added ROM-derived species form alias extraction tooling (`backend/tools/extract_unbound_species_form_aliases.py`) with synchronized alias metadata (`backend/data/species_form_aliases.json` mirrored to `frontend/src/core/speciesFormAliases.json`) and diagnostics output (`backend/data/species_form_aliases_diagnostics.json`).

#### Species, Forms, and Nicknames

- Pokemon species editing is now available in the editor for both Party and PC flows, with matching behavior in `backend` and `local` runtime modes.
- Species UI payloads now expose form-aware metadata (`species_label`, `species_variant_index`, `species_variant_count`, `is_form_variant`) so duplicate-name forms are distinguishable (for example `Goodra (Form 1)` / `Goodra (Form 2)`).
- Added nickname editing support for Party and PC flows in both backend and local modes, including save-path parity.
- Species editor now includes nickname controls and a guided rename behavior when changing species, so users can keep custom nicknames or automatically align nicknames with the selected species.
- Species labels now prefer high-confidence ROM-derived aliases (for example Alolan/Galarian/Hisuian/Mega/Giga and special cases like Aegislash Blade / Darmanitan Zen / Polteageist Chipped) with safe fallback to `Form N` labels when aliases are uncertain.

#### Party and PC Correctness

- Party stat bytes are now recalculated after species/stat-affecting edits (species, IVs, EVs, nature, level) using ROM-derived base stats and nature modifiers, with current HP clamped to the new max HP.
- Fixed PC Box move packing/parsing to use the correct CFRU compact 40-bit layout in both backend and local mode.
- Fixed local-mode 32-bit overflow during 40-bit move bit-packing by switching to `BigInt`, resolving slot corruption cases (for example `DragonAscent`/`V-create` turning into wrong moves in frontend or in-game).
- Added fragmented absolute-layout fallback support for PC boxes 22-24 in save variants where the standard contiguous PC stream does not include those boxes, with backend/local parity for read/edit/save/checksum flows.
- Fixed fallback PC box extraction for rotated save-section layouts by resolving box 23/24 offsets from active logical sections (instead of static absolute addresses), with backend/local mode parity and regression verification across local artifact saves.
- Added focused regression coverage for fallback PC boxes (`frontend/scripts/pc-fallback-regression.mjs`) to validate FewTimesDead box 22-24 detection, fallback slot parity, absolute fallback edits, touched-sector checksum updates, and Unbound false-positive guards.
- Added `PC insert` workflows (backend + local mode parity) to create Pokemon directly in empty box slots, including stream boxes, preset box 26, and fragmented fallback box layouts.
- Added species drift safety checks for non-species edit flows and tightened save paths to send only changed fields, reducing unintended side effects.
- Party level edits now default to ROM-truth species growth rate when available, with fallback to previous growth inference behavior when metadata is unavailable.
- PC level editing now defaults to ROM-truth species growth rate in the editor flow (manual override still supported), reducing EXP/level ambiguity.
- Party and PC payloads now expose full ROM-derived ability metadata (slot 1/slot 2/hidden IDs and names) with runtime parity.

#### Move PP Integrity and Editing

- Added ROM-truth move PP wiring from `move_table_from_rom.json` (`base_pp` by `move_id`) into backend/local PP calculations.
- Added Party PP fields end-to-end (`move_pp`, `move_pp_ups`, `move_pp_max`) with legality enforcement in save writes.
- Added move-swap PP safety: changing a move now resets current PP to the new legal max, preventing invalid `M/N` states.
- Added PC PP Up support (`move_pp_ups`) and legal max PP derivation in payloads for backend/local parity.
- Extended Party/PC update contracts to accept PP fields and keep backend/local behavior aligned.
- Added editor controls for per-slot PP/PP Up with `MAX PP` action and live `current/max` display in move editing flows.

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
- Main pocket detection now resolves from active section `id=13` first (anchor template) and supports unusually long pocket streams, fixing bootstrap/search failures on long-list saves (for example FewTimesDead variants) with backend/local parity.
- Bag editing now uses an explicit save flow: slot edits are applied in memory, and `SAVE BAG CHANGES` is required to write updates to the `.sav` file.
- Bag UX now keeps save actions visible at the top of pocket view and warns users when navigating back/changing sections with unsaved bag edits.
- Fixed item-sector checksum window for Unbound main items sector (`id=13`) to `0x450` in both backend and local mode, preventing intermittent save corruption caused by extra trailing bytes.
- Backend money updates now clamp requested values to the legal in-game range (`0..999999`) and return clamp metadata (`requested_money`, `was_clamped`) for safer API behavior.

#### Editor UX

- Pokemon editor Info tab now shows Species controls before level/nature/item controls for faster access.
- Ability controls now show resolved ROM-truth ability names for slot buttons and current-ability labels (including hidden ability names when available).
- PC grid empty slots now support in-place add flow via modal (species search + nickname + level) with save-path parity across backend/local modes.
- PC box navigation now reflects Unbound UX (`Box 1..24` + `Preset`), hides `Box 25` from frontend navigation, and labels internal box `26` as `Preset` in UI.
- Standardized visible stat abbreviations across party cards and editor sliders to `HP/ATK/DEF/SPA/SPD/SPE`, and enforced the standard display order to avoid `SPD` ambiguity between Special Defense and Speed.
- Saving edits in PC now preserves the currently selected box instead of resetting to Box 1.
- Money modal input now enforces whole-number entry and a six-digit cap (`999999`) in UI.
- Money modal now includes a hover note clarifying that backend safety clamps values to the legal in-game range.
- Added a global `Legit` header toggle (default OFF) that keeps per-stat EV cap (`0..252`) always enforced and applies total EV cap (`510`) only when enabled.
- EV editing now shows explicit legal-spread feedback (`Total EV` and `Remaining`) while Legit mode is ON.
- Level editing now surfaces explicit `1..100` cap guidance and normalizes out-of-range values in editor flows, with backend party level updates returning clamp metadata (`requested_level`, `was_clamped`).
- Editor tabs were reorganized for faster stat workflows: `Stats` now groups Level, Nature, IVs, EVs, and Ability controls in one place.
- Hidden ability labels now prioritize readability by showing ability name first (for example `Sheer Force (HA)`).
- Added Showdown/Smogon set import via `FROM SMOGON` in both Add Pokemon and existing Pokemon editor flows, with strict catalog validation (species/item/ability/moves), clear blocking errors, and deterministic duplicate-item fallback (lowest ID + warning).
- Smogon species resolution now supports regional suffix input (`-Alola`, `-Galar`, `-Hisui`) and defaults multi-form base species imports to the canonical base form (lowest-ID deterministic fallback with warning).
- New PC Pokemon insertions now default IVs to `31/31/31/31/31/31` and infer full owner template from existing save data (OT name + IDNo/TID-linked OTID + owner bytes) instead of zeroed owner fields.

#### RTC Recovery and Metadata Editing

- Added backend RTC pair-repair API endpoint `POST /rtc/repair-candidates` to generate a repair zip pack (manifest + ordered fallback candidates) from tampered and NPC-fixed save files.
- Added backend RTC quick-fix API endpoint `POST /rtc/quick-fix` to generate single-file fallback candidates using tracked manifest data (`backend/data/rtc_manifest_unbound_v1.json`).
- Added frontend metadata editing card for RTC workflows on the load screen, including tabbed actions (`Pair Repair` and `Quick Fix`).
- Added API client download helpers for RTC pair and quick-fix packs in `frontend/src/services/apiClient.js`, then extended them to full backend/local runtime parity.
- Added full local-mode RTC parity for GitHub Pages usage: manifest generation, pair candidate generation, quick-fix candidate generation, and zip pack downloads now run fully in frontend JS.
- Added RTC parity regression script (`frontend/scripts/rtc-parity-regression.mjs`) and npm commands to run RTC + existing parity checks.
- Fixed RTC quick-fix candidate generation to copy source footer bytes correctly during coherent layout rebuild (instead of destination footer bytes).
- Fixed RTC quick-fix opaque checksum handling to apply fixed-reference checksum metadata for patched opaque sections (`id 0`, `4`, `13`).
- Refreshed quick-fix manifest payload (`backend/data/rtc_manifest_unbound_v1.json`, mirrored to frontend public data) from the known tampered `Unbound_2_before_promote_working.sav` to `Unbound_2_fixed.sav` pair.
- Fixed pair-repair backend wiring to build manifests through `backend/tools/rtc_patch.py` (`build_manifest`) before candidate generation.

#### Responsive UI and Internationalization

- Reworked the frontend shell for responsive behavior across desktop/tablet/mobile while preserving single-page dynamic sections.
- App title in UI now uses `PUSE` and the pre-upload screen now includes concise onboarding content plus visible upload and drag-and-drop actions.
- Branding now references Pokemon Unbound in both the browser tab title and onboarding copy, while keeping a compact `PUSE` header label on small screens.
- Added onboarding note clarifying compatibility with `.sav` files from CFRU + DPE ROM hacks.
- Upload flow now accepts `.srm` files in addition to `.sav`, preserves the original extension on download, and updates the download button label accordingly.
- Added explicit `RESTART / LOAD NEW FILE` control in the loaded-state header.
- Standardized modal dismissal UX: money modal, Pokemon editor modal, and bag edit modal now close via `X`, outside click, and `Esc`.
- PC Box view now renders explicit empty slots and keeps a responsive grid (up to 6 columns where space allows) without forced horizontal scrolling on small devices.
- Party card icon sizing was adjusted to avoid sprite cropping in slot frames.
- Nature labels were normalized to English-only for public international UX parity in both backend and local mode flows (`Hardy`, `Adamant`, etc.); fallback text is now `Unknown`.

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
