# PUSE Cross-Mode Parity Rules

This file governs any agent, model, or developer working on this project across its three runtime modes. It is the highest-level authority on cross-mode behavior and overrides any mode-specific document when they conflict on parity requirements.

---

## 1. Three Modes

| Mode | Stack | Location | Internal rules |
|---|---|---|---|
| **Backend** | Python / FastAPI | `backend/` | — |
| **Frontend (local)** | JavaScript / React + Vite | `frontend/` | `CLAUDE.md` §Frontend |
| **Switch homebrew** | C++ / Plutonium + libnx | `switch-homebrew/` | `switch-homebrew/RULES.md`, `switch-homebrew/CLAUDE.md` |

Each mode is a full, independent runtime. A user chooses one at runtime. All three must produce identical save-file mutations for the same inputs.

---

## 2. Backend Is the Canonical Behavior Reference

**The backend Python code is always right.** When any dispute exists between modes about what a mutation should produce, the backend output resolves it — no exceptions.

This includes:
- Save offsets and field encodings
- Checksum algorithms and the sections they cover
- Validation rules, clamping limits, and error conditions
- Pocket scanning heuristics (bag module)
- RTC candidate generation logic
- Icon resolution heuristics

Frontend local mode and Switch homebrew are **ports** of backend behavior, not independent implementations.

---

## 3. The Parity Mandate

> **If you change save logic in one mode, you must change all other applicable modes before closing the task.**

"Save logic" means any code that reads, writes, validates, or checksums save-file bytes. This includes:
- Parsing or decoding a field
- Writing or encoding a field
- Checksum computation or sector commit
- Validation or clamping rules
- Pocket/section scanning heuristics
- Data structure offsets or sizes
- Bug fixes in any of the above

"Applicable" means: all three modes implement the affected feature. If only two modes implement it today, update both.

### 3.1 Cross-Mode Sync Table

When you change or add something, this table tells you what else must change:

| Changed in | Must also update |
|---|---|
| `backend/modules/` | `frontend/src/core/` (same-named `.js` file) **and** `switch-homebrew/source/core/` |
| `frontend/src/core/` | Verify against backend; update `switch-homebrew/source/core/` if Switch implements same feature |
| `switch-homebrew/source/core/` | Verify against backend; update `frontend/src/core/` if frontend implements same feature |
| `backend/main.py` (endpoint logic) | `frontend/src/services/apiClient.js` (backend client path) **and** Switch UI flow if endpoint is exposed there |

### 3.2 What Does NOT Require Cross-Mode Sync

The following are mode-specific and do not require parity propagation:

- UI layout, navigation, visual design, input handling
- Backend infrastructure (FastAPI routing, session management, file upload/download)
- Frontend infrastructure (React state, Vite config, component hierarchy)
- Switch homebrew infrastructure (Plutonium layout, libnx calls, ROMFS packing)
- Logging, error formatting, and CLI output
- I/O delivery mechanism (see §8)

---

## 4. Data File Sync

`backend/data/` is the canonical source for all lookup tables (species, items, moves, abilities, pocket maps, RTC manifest, etc.).

**Never edit files in `frontend/src/core/` JSON files or `switch-homebrew/romfs/data/` by hand.** These are derived from `backend/data/`.

Sync flows:

| Destination | How to sync |
|---|---|
| `switch-homebrew/romfs/data/` | `switch-homebrew/scripts/sync_romfs_data.sh` |
| `frontend/src/core/*.json` | Manually copy or via project tooling if added |

If `backend/data/` is updated (e.g., new species, new pocket map), run the sync scripts before building or testing other modes.

---

## 5. API Contract Stability

Payload field names exchanged between frontend and backend (`nature_id`, `item_id`, `ability_index`, `current_ability_index`, etc.) are shared contracts.

**Change payload keys on both sides together, or not at all.**

The local-mode frontend client (`frontend/src/services/apiClient.js` local path) and the backend-mode client (same file, backend path) must expose identical method signatures and parameter shapes.

---

## 6. Checksum After Every Mutation — All Modes

Every code path that writes save-file bytes must end with checksum recalculation. This is non-negotiable in all three modes.

| Mode | Checksum call |
|---|---|
| Backend | `bag_mod.gba_checksum` / `recalculate_checksum` / `party_mod.wu16` (per module) |
| Frontend local | `checksum.js` utilities + `commit.js` |
| Switch homebrew | `ComputeSectionChecksum` + `CommitPartySectionChecksums` + `CommitBagSectorChecksums` + `CommitPcStream` |

Sector-specific rules (e.g., bag sector 13 uses fixed valid_len=0x450; PC sectors 5–12; party section ID varies by active save index) must be replicated identically across all three modes.

---

## 7. Verification

Before closing any task that touches save logic, verify parity with the backend.

### Frontend local mode

```bash
cd frontend
npm run parity:all          # all regression scripts (rtc, pc-fallback, identity)
```

Individual regression scripts are in `frontend/scripts/`. Output from local-mode client must byte-match backend output for the same input.

### Switch homebrew

```bash
cd switch-homebrew
make test-phase1            # checksum parity
make test-phase2            # party mutation parity
```

For new features: use the parity tmp workflow:

```bash
switch-homebrew/scripts/parity_tmp.sh init
# run backend → artifacts/tmp/source/
# run C++ port → artifacts/tmp/port/
switch-homebrew/scripts/parity_tmp.sh compare <source> <candidate>
switch-homebrew/scripts/parity_tmp.sh cleanup
```

**A task is only complete when parity tests pass. Skipping verification is not permitted.**

---

## 8. Allowed Divergence: I/O Delivery Mechanism

The three modes differ in how they deliver input/output to the user. This is acceptable and does not violate the parity mandate because the binary mutations are identical — only the delivery wrapper differs.

| Operation | Backend / Frontend | Switch homebrew |
|---|---|---|
| Load save | Upload via HTTP / file picker | Read `sdmc:/switch/puse/Unbound.sav` on boot |
| Write save | In-memory until `/save-all`; download via `/download` | Write in-place on X button press |
| RTC candidates | Zip archive downloaded via browser | `.sav` files written to `sdmc:/switch/puse/rtc/` |
| Icons | Served from `backend/icons/` or frontend manifest | Loaded from ROMFS or SD card |

Any difference beyond I/O delivery is a parity bug.

---

## 9. Adding a New Feature — Required Steps

When implementing a new save-editing feature (new field, new section, new operation):

1. **Implement in backend first.** Backend is the canonical reference; it defines correct behavior.
2. **Write a parity fixture.** Use the same `.sav` input, capture backend output bytes.
3. **Port to frontend local mode.** Verify against fixture.
4. **Port to Switch homebrew.** Verify against fixture.
5. **Run all verification commands** (§7) for both non-backend modes.
6. **Sync data files** if new lookup tables were added (§4).
7. **Update API contracts** if new endpoint payload keys were introduced (§5).

If a feature exists only in one mode today, document it as "partial" in that mode's CLAUDE.md or PLAN.md — do not leave it silently missing.

---

## 10. Adding a Dependency or Tool

If a new external library, tool, or data format is introduced in one mode, assess whether other modes need an equivalent. If they do, add it or document the gap explicitly.

Examples:
- New lookup JSON added to `backend/data/` → sync to romfs + frontend (§4)
- New Python helper in `backend/modules/` → equivalent `.js` in `frontend/src/core/` and `.cpp` in `switch-homebrew/source/core/`

---

## 11. Mode-Specific Internal Rules

Each mode has additional internal rules that apply only within that mode. These do not override §2–§9 above.

| Mode | Internal rules document |
|---|---|
| Switch homebrew | `switch-homebrew/RULES.md` (Plutonium UI, build, parity workflow, data sync) |
| All modes | `CLAUDE.md` (project overview, commands, architecture, conventions) |

If a mode-specific rule conflicts with this document, **this document wins on parity and behavior; mode-specific rules win on internal implementation details**.

---

## Enforcement Summary

| Rule | Enforcement |
|---|---|
| Backend is canonical | Disputes resolved by backend output, not by vote or preference |
| Save logic change → all modes | Task incomplete until all applicable modes updated |
| Checksum after every mutation | Code review / parity test failure reveals violations |
| Data files not hand-edited | Use sync scripts; hand edits will be overwritten |
| API keys stable | Change both sides or neither |
| Parity tests pass before close | Explicitly required; skipping is a rule violation |
