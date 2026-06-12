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
- [x] RTC quick-fix UI — 3 profiles, applies directly to Unbound.sav, entered from MoneyScreen

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
- [x] RTC quick-fix UI (manifest at romfs:/data/rtc_manifest_unbound_v1.json; entered from MoneyScreen)

## Phase 10 — Distribution
- [x] `makerom` + `bannertool` added to Dockerfile (built from source: Project_CTR + Steveice10/bannertool)
- [x] `puse-3ds.rsf`: UniqueId `0xF8100`, UseOnSD, FreeProductCode, AppType Application
- [x] `scripts/build_cia.sh`: auto-generates placeholder banner.png (256×128 navy) + banner.wav (silence) if none provided; calls bannertool + makerom; fixes ownership
- [x] Supply real banner.png (256×128 art) — navy bg + icon; banner.wav stays silent placeholder
- [x] README: install via Homebrew Launcher (.3dsx) or FBI (.cia)
- [ ] Optional: Universal-Updater UniStore entry
- [x] Rebuild Docker image — makerom built from source; bannertool removed (repo gone, smdhtool from 3dstools handles SMDH, CIA built without banner section)

---

## Phase 11 — Hardware boot triage (2026-05-27)

App built fine and ran in Azahar but on real Old 3DS hardware: CIA showed "SD card removed", .3dsx hard-locked the system. Black-screen freeze on both after intermediate fixes. Root issues identified and partly resolved; UI rendering still corrupted, deferred.

### Confirmed fixes (committed)
- **libstarlight `RenderCore::LoadTexture` redundant `gspWaitForPPF()` removed.** `C3D_SyncDisplayTransfer` already calls `gspWaitForPPF` internally and consumes the PPF event. The extra wait blocked forever on libctru 2.7.0 (event already consumed). This was the root cause of the hardware black-screen freeze after init.
- **libstarlight `CRenderTarget` depth `-1` → `GPU_RB_DEPTH24_STENCIL8`.** With `-1` depth on citro3d 1.7.1, `C3D_FrameBegin` reported GPU permanently busy.
- **libstarlight `C3D_Init(0x80000*8)` (4 MB) → `C3D_DEFAULT_CMDBUF_SIZE` (256 KB).** Old 3DS linear-heap pressure was likely root cause of pre-fix .3dsx system hang.
- **libstarlight `C3D_FrameBegin(0)` → `C3D_FrameBegin(C3D_FRAME_SYNCDRAW)`.** Safer.
- **`puse-3ds.rsf` full `AccessControlInfo`** based on Universal-Updater template (FileSystemAccess `DirectSdmc`/`DirectSdmcWrite`, IoAccessControl, SystemCallAccess, ServiceAccessControl, Dependency block). Without these the CIA could not access SD; OS returned the "SD card removed" notice.
- **`Core::Init` SD-wide save discovery.** Probes likely paths (`/3ds/puse`, `/3ds/open_agb_firm/saves`, `/3ds/openagbfw/saves`, `/3ds`, `/saves`, `/retroarch/saves`, root) then bounded recursive walk under `/3ds`, `/roms`, `/saves`. Discovered path is stored; `SaveWithBackup` + `RtcScreen::WriteBytes` write back to the same location. Mirrors what `open_agb_firm` users expect.

### Experimental tweaks kept (harmless, may or may not help on hardware)
- **Warm-up frames in `RenderCore::Open`**: 2 empty `BeginFrame`/`EndFrame` pairs after pipeline setup.
- **`GSPGPU_InvalidateDataCache` on uploaded texture data** right after `C3D_SyncDisplayTransfer`.

### Still broken (Azahar; not yet retested on hardware)
- **Text rendered with `normal.12` font is garbled** (BaseScreen header "PUSE 3DS", BaseScreen footer hints, Button labels). `normal.16` (PartyListScreen top_info_, mon list) renders cleanly. Both fonts load via the same `ThemeManager::Fulfill` → `LoadPNG` → `RenderCore::LoadTexture` path. Same image size (256×256 RGBA8). Same code. Working theory: the first lazy texture upload during the first frame races with the rendering pipeline and ends up with stale tiling. Subsequent uploads (normal.16) land cleanly.
- **Form stacking**: opening a child screen (Pokemon detail) renders on top of the previous screen instead of replacing it. New form likely missing the right `FormFlags::canOcclude*` bits. See `Application::_mainLoop` form-stack rebuild logic and `Form::flags` defaults.

### Approaches that did NOT fix the font/stacking issues
- `gfxSet3D(false)` — no change.
- Moving `touchScreen->PreDraw()` / `topScreen->PreDraw()` to BEFORE `RenderCore::BeginFrame()` — caused immediate crash (`unmapped Write32 @ 0x000003A4` looked like C3D writing commands to a NULL cmdlist; PreDraw needs an active frame even though it does not draw).
- 2 empty warm-up frames before user code.
- `GSPGPU_InvalidateDataCache` on uploaded texture data.

### Approaches NOT yet tried
- **Preload every theme asset (font + drawable)** before the first frame by walking the metrics.json / theme dir and calling `ThemeManager::GetAsset(name).Get()` / `GetFont(name).Get()` from `Core::Init` — guarantees no asset Fulfill happens lazily inside a frame.
- **Replace `C3D_SyncDisplayTransfer`** with a manual `GX_DisplayTransfer` + explicit per-call event wait (using a fresh event handle), or with CPU-side tiling + plain `memcpy` to GPU memory. Bypasses the GSP PPF event race entirely.
- **Diff RenderCore.cpp against an upstream/fork of libstarlight that works on libctru 2.x + citro3d 1.7.1.** The current copy in `tools/libstarlight/` is from an older snapshot; the testbed may have been built against citro3d 1.x.
- **Cross-reference `tools/FBI/` and any other 3DS homebrew dropped into `tools/`** for their texture upload + UI rendering pattern. FBI uses libctru directly with manual screen + ImGui-like rendering; not libstarlight. Worth comparing to see what works on current hardware.
- **Form stacking**: ensure each `Open()`ed `Form` defaults to `FormFlags::canOcclude | occludeTouch | occludeTop` so the underlying form is hidden from the canvas rebuild step.

### Build + verify loop
- Image rebuild required after any libstarlight source change (`docker build -t puse-3ds-dev -f tools/Dockerfile tools/`).
- `./scripts/build_docker.sh` → `puse-3ds.3dsx`.
- `./scripts/build_cia.sh` → `puse-3ds.cia`.
- Azahar SD root: `/home/zappaganini/.var/app/org.azahar_emu.Azahar/data/azahar-emu/sdmc/`.
- Boot log helper (if needed again): `freopen` stdout to `sdmc:/3ds/puse/boot.log` in `main()` + `fopen`-per-line trace macros in libstarlight. Newlib `_IONBF` on sdmc devoptab does NOT actually sync per write; use atomic `fopen`+`fwrite`+`fclose` per trace line for reliable hardware logs.

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
