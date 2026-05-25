# 3DS Homebrew Port — TODO

Save editor for Pokemon Unbound v2.1.1.1 on Nintendo 3DS. Mirrors `switch-homebrew/` architecture. UI via libstarlight (patched for citro3d 1.7.x in `tools/libstarlight/`). Build via Docker image `puse-3ds-dev`.

---

## Phase 0 — Project scaffold
- [x] Create `3ds-homebrew/{source,include,romfs,scripts,artifacts,tests}/` dirs
- [x] Write Makefile (based on libstarlight testbed) — TARGET, ARCH, link `-lstarlight -lcitro3d -lctru`
- [x] Write minimal `source/main.cpp` — libstarlight Application init + hello-world layer
- [x] Replace libctru default icon with project `icon.png` (48×48) — currently falls back
- [x] Write `scripts/build_docker.sh` (mirrors switch pattern, runs `puse-3ds-dev`)
- [x] Write `scripts/sync_romfs_data.sh` (copies `backend/data/` → `romfs/data/`)
- [x] Bundle libstarlight default theme into `romfs/` (theme files at romfs root)
- [ ] Verify `.3dsx` boots in Azahar (manual user test)

## Phase 1 — Core: SaveSession + Sections + checksum
- [x] Copy `SaveSession.{cpp,hpp}` from switch-homebrew (pure C++, zero changes expected)
- [x] Copy `SaveSections.{cpp,hpp}` (GBA checksum logic)
- [x] Copy `DataLoader.{cpp,hpp}`, adjust ROMFS path resolution (`romfs:/data/`) + SD path → `sdmc:/3ds/puse/`
- [x] Save path: `sdmc:/3ds/puse/Unbound.sav` (load on boot, write on save) — wired in Phase 3 UI
- [x] Write `tests/checksum_report.cpp` — host-build parity vs backend Python
- [x] `make test-phase1` — byte-match on fixture `.sav` (32 sections, PARITY OK)

## Phase 2 — Party module
- [x] Copy `Party.{cpp,hpp}` from switch-homebrew (fix: 2× `std::min(6U, uint32_t)` → explicit cast for ARM32)
- [x] Static-data load (pokemon.txt, items.txt, moves.txt, abilities.txt + JSONs) — via DataLoader/ResolveAssetPath
- [x] Wire `ParseParty()`, all `UpdateParty*()` ops
- [x] Write `tests/party_dump.cpp` parity test
- [x] `make test-phase2` — PARITY OK vs backend Python

## Phase 3 — UI shell + navigation
- [x] Init libstarlight: `Application`, `GFXManager`, `ThemeManager`, `InputManager` (via libstarlight Application::_init)
- [x] Layout stack = Form push/pop; B = pop (non-root), START = exit, X = save
- [x] Top-screen header: title + save name + dirty indicator (`BaseScreen` + `FillRect` UIElement)
- [x] Bottom-screen footer: per-screen button hints
- [x] Diagnostics screen for boot failure (white text on dark bg — fix Switch bug)
- [x] Theme: navy/red palette, `clearColor = Color(0.063, 0.086, 0.137)` matching Switch port

## Phase 4 — Party UI
- [x] Party list (6 slots) on bottom touchscreen, preview on top
- [x] Detail picker: Summary / Battle / Training / Moves
- [x] Field-edit rows w/ libstarlight OSK `InputHandlerBuffered` for numeric/name input
- [x] Edit flow: mutate → `CommitPartySectionChecksums` → `SetDirty` (no toast yet — Phase 9)
- [x] Legit-mode toggle (510 EV cap) persisted to `sdmc:/3ds/puse/legit_mode` (file presence), Y button on party list

## Phase 5 — PC boxes
- [x] Copy `Pc.{cpp,hpp}` from switch-homebrew (ARM32 fix: `std::max(1U,uint32_t)` → `static_cast<uint32_t>(1)` ×2)
- [x] `PcBoxScreen`: bottom 3×10 slot grid, L/R to navigate 18 boxes, top grid overview
- [x] `PcSlotScreen`: full field editor (Nickname/Species/Level/Nature/Item/Shiny/Ability/IVs/EVs/Moves+PP), insert into empty slot (OT from party), Select+YesNo to delete
- [x] `Core::RebuildPcStream` / `CommitPcStream` wrappers; stream pre-built on Init
- [x] PC entry: L button from PartyListScreen

## Phase 6 — Bag
- [x] Copy `Bag.{cpp,hpp}` (no ARM32 fixes needed)
- [x] `BagScreen`: 5 pocket tabs (Items/Balls/Key/TMs/Berries), L/R to cycle pockets
- [x] Qty edit via OSK (Key items display-only); `CommitBagSectorChecksums` after write
- [x] Top screen: pocket status + item count; pocket tab buttons wired to touchscreen

## Phase 7 — Money + RTC
- [x] Copy `Money.{cpp,hpp}` + `Rtc.{cpp,hpp}` (no ARM32 fixes; Rtc SD path `sdmc:/3ds/puse/rtc`)
- [x] `MoneyScreen`: money + BP display, OSK edit for both; `WriteMoney` handles own checksum, BP opaque (no checksum, mirrors backend)
- [ ] RTC quick-fix UI — deferred (requires romfs rtc_manifest.json and two-save workflow; see Phase 9)

## Phase 8 — Icons + assets
- [x] `io/IconLoader.{h,cpp}`: resolves mon/item icon paths from `romfs:/icons/pokemon` + `sdmc:/3ds/puse/icons/pokemon`; tries `{id:04d}.png`, `{id:03d}.png`, `gFrontSprite{id:03d}*` prefix; no icons in romfs by default (SD-only = lite mode)
- [x] `ThemeManager::GetAsset` handles PNG load + cache by path string; missing icons silently no-draw
- [x] Pokemon icon shown in `PokemonSectionsScreen` top-right (80×80) when available

## Phase 9 — Polish + save flow
- [x] `SaveWithBackup()`: checksums → backup `.sav→.bak` → write → restore on failure
- [x] X button uses `SaveWithBackup` (was direct ExportToFile)
- [x] Battery polling via `PTMU_GetBatteryLevel` every ~5s; `[LOW BATT]` shown in header
- [x] Suspend auto-flush: `aptHook(APTHOOK_ONSUSPEND)` calls `SaveWithBackup` when dirty
- [x] Success/error toast after save (libstarlight `MessageBox` — minor; save returns bool already)
- [ ] RTC quick-fix UI (requires `rtc_manifest.json` in romfs; deferred)

## Phase 10 — Distribution
- [x] `makerom` + `bannertool` added to Dockerfile (built from source: Project_CTR + Steveice10/bannertool)
- [x] `puse-3ds.rsf`: UniqueId `0xF8100`, UseOnSD, FreeProductCode, AppType Application
- [x] `scripts/build_cia.sh`: auto-generates placeholder banner.png (256×128 navy) + banner.wav (silence) if none provided; calls bannertool + makerom; fixes ownership
- [x] Supply real banner.png (256×128 art) — navy bg + icon; banner.wav stays silent placeholder
- [x] README: install via Homebrew Launcher (.3dsx) or FBI (.cia)
- [ ] Optional: Universal-Updater UniStore entry
- [ ] Rebuild Docker image to include makerom/bannertool — run: `docker build -t puse-3ds-dev -f 3ds-homebrew/tools/Dockerfile 3ds-homebrew/tools/`

---

## Cross-cutting rules (from `switch-homebrew/RULES.md`)
- Behavior parity with backend Python is non-negotiable
- No business logic in UI layer — all mutations through core
- Checksum after every mutation
- Two build variants: standard (with icons) + lite (no media)
- Backend canonical when behavior differs

## Dev workflow
- Build: `scripts/build_docker.sh`
- Emulator: `flatpak run org.azahar_emu.Azahar puse-3ds.3dsx`
- Deploy console: `3dslink -a <3DS_IP> puse-3ds.3dsx`
- Debug: Rosalina GDB stub, port 4003 (Luma3DS)
