# Changelog

## Unreleased

- No changes yet.

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
