# switch-homebrew — CLAUDE.md

Nintendo Switch `.nro` save editor for Pokemon Unbound v2.1.1.1. Built with Plutonium (SDL2 UI) + libnx. Phases 0–3 complete (party editing works). Phases 4+ (PC, Bag, Money, RTC) are planned.

---

## Build

All builds require Docker + devkitPro toolchain.

```bash
# Full build (image + compile + SD bundle + fix ownership)
switch-homebrew/scripts/build_docker.sh

# Individual steps
docker build -t switch-plutonium-dev -f switch-homebrew/tools/Dockerfile switch-homebrew/tools
docker run --rm -v "$(pwd)/switch-homebrew":/work -w /work switch-plutonium-dev make clean
docker run --rm -v "$(pwd)/switch-homebrew":/work -w /work switch-plutonium-dev make
switch-homebrew/scripts/prepare_sd_bundle.sh
# Fix ownership after Docker build:
docker run --rm -v "$(pwd)/switch-homebrew":/work switch-plutonium-dev \
  sh -lc "chown -R $(id -u):$(id -g) /work/puse-switch.nro /work/puse-switch.elf /work/build /work/artifacts/sdmc"

# Sync data from backend (run before build if backend/data changed)
switch-homebrew/scripts/sync_romfs_data.sh
```

No host compilation. All C++ targets Switch ARM64 via devkitPro. Host-side parity tests compile the core layer separately.

---

## Architecture

Three strict layers. UI must not call save-binary logic directly.

### Layer A — Core domain (`source/core/`, `include/puse/core/`)

Pure portable C++. No Plutonium, no libnx dependencies.

| File | Responsibility |
|---|---|
| `SaveSession.cpp/.hpp` | Load/export `.sav` file; holds in-memory `std::vector<uint8_t>` buffer |
| `SaveSections.cpp/.hpp` | Parse 0x1000-byte save sections; compute/validate GBA checksums |
| `Party.cpp/.hpp` | Party read, all mutation ops, stat recalc, shiny/gender math, checksum commit |

Key domain types:
- `PartyEntry` — UI-facing struct with all decoded fields for one party slot
- `core::ParseParty(buf, species_db)` → `vector<PartyEntry>`
- All `UpdateParty*()` functions return `bool` + write `error` string

### Layer B — I/O services (`source/io/`, `include/puse/io/`)

| File | Responsibility |
|---|---|
| `DataLoader.cpp/.hpp` | Load `id:name` text files and JSON metadata from ROMFS; `ResolveAssetPath()` |

### Layer C — Plutonium UI (`source/MainApplication.cpp`, `include/MainApplication.hpp`)

All screen layout, input handling, dialog flows. No binary mutations here — always delegates to Layer A.

---

## Current Screen Flow

```
OnLoad
  → (error) DiagnosticsLayout         # boot failure page
  → PartyListLayout                    # 6-slot party grid
      → PokemonSectionsLayout          # per-mon 4-section picker + icon
          → PokemonFieldsLayout        # editable field list
```

Navigation: explicit layout stack. `ShowLayoutScreen()` = push + `LoadLayout()`. `PopLayoutScreen()` = pop + restore. `B` button always pops.

Global input (`SetOnInput`): `X` = save, `+` = exit, `B` = pop layout.

---

## Layouts (current, pre-refactor)

### `BasePageLayout`
Common shell: header bar (bg rectangle + icon + title + subtitle), footer bar (bg rectangle + hints text). All layouts extend this.

### `PartyListLayout`
One `Menu` filling content area. Items: `"#N  Name   Lv N   Nature"` with Pokemon icon.

### `PokemonSectionsLayout`
`Menu` on left (4 section items: Summary / Battle / Training / Moves), large Pokemon `Image` on right.

### `PokemonFieldsLayout`
Single `Menu` with `"Field   Value"` concatenated label per editable row. Flat — no visual grouping.
- Summary: 5 items
- Battle: 5 items (Item, Ability, Ability Slot, PID, OTID)
- Training: 12 items (6 IVs + 6 EVs flat list)
- Moves: 12 items (Move/PP/PP-Up × 4, flat list)

### `DiagnosticsLayout`
`TextBlock` rows. Bug: text color `{35, 45, 60}` is near-invisible against dark `page_bg {16, 22, 35}`.

---

## Plutonium Component Reference

**Mandatory reading before any UI work:** RULES.md §6.1 and §6.2.

### Available Plutonium elements (`tools/Plutonium/Plutonium/include/pu/ui/elm/`)
- `elm_Menu.hpp` — scrollable list; per-item icon, A/B callbacks via `AddOnKey`
- `elm_MenuItem.hpp` — one menu row; `SetColor`, `SetIcon`, `AddOnKey`
- `elm_TextBlock.hpp` — text; `SetFont`, `SetColor`, `SetMaxWidth`, `SetScroll`
- `elm_Image.hpp` — texture display; `SetWidth`, `SetHeight`, `SetImage`
- `elm_Rectangle.hpp` — solid color fill; use as divider, stat bar, card bg
- `elm_Button.hpp` — pressable button with label
- `elm_Toggle.hpp` — boolean toggle
- `elm_ProgressBar.hpp` — progress/fill bar

### Other Plutonium UI (`tools/Plutonium/Plutonium/include/pu/ui/`)
- `ui_Dialog.hpp` — `CreateShowDialog(title, content, options, use_last)` → int option index
- `ui_Overlay.hpp` — overlay screen
- `extras/extras_Toast.hpp` — `Toast::New(msg, font, color, bg)`, `StartShow(toast, ms)`

### No dedicated Slider or Card in this Plutonium snapshot
Compose from `Rectangle` + `TextBlock` + `Image` when needed.

### Font sizes
`pu::ui::GetDefaultFont(pu::ui::DefaultFontSize::Small/Medium/MediumLarge/Large)`

---

## UI Theme

```cpp
page_bg    = {16, 22, 35, 0xFF}    // deep navy
header_bg  = {12, 17, 29, 0xFF}    // darker navy
footer_bg  = {12, 17, 29, 0xFF}
panel_bg   = {28, 38, 58, 0xFF}    // mid navy (card backgrounds)
text_primary   = {240, 246, 255, 0xFF}
text_secondary = {191, 205, 226, 0xFF}
accent     = {236, 74, 80, 0xFF}   // red accent
menu_item  = {44, 56, 79, 0xFF}
menu_focus = {0, 120, 214, 0xFF}
```

---

## Icon Resolution

### Pokemon icons
Search roots: `romfs:/icons/pokemon`, `sdmc:/switch/puse/icons/pokemon`, `sdmc:/switch/puse/romfs/icons/pokemon`.
File naming: `gFrontSprite{ID:03d}*.png` — prefix match, reject if next char is a digit (avoids ID-extension collision). Giga forms handled via `species_id_tokens_` table.

### Item icons
Recursive walk of icon roots. Norm-to-path map first, then token set match, then TM/HM regex. Graceful empty texture on miss.

Both cached in `unordered_map<uint16_t, TextureHandle::Ref>` after first load.

---

## Data Files (ROMFS)

All under `romfs/data/`, synced from `backend/data/` via `sync_romfs_data.sh`.

| File | Content |
|---|---|
| `pokemon.txt` | `id:name` species |
| `items.txt` | `id:name` items |
| `moves.txt` | `id:name` moves |
| `abilities.txt` | `id:name` abilities |
| `species_base_stats.json` | `{hp,atk,def,spe,spa,spd}` per species |
| `species_identity_meta.json` | gender threshold per species |
| `species_growth_rates.json` | growth rate (0–5) per species |
| `species_abilities_meta.json` | ability slot IDs per species |
| `move_table_from_rom.json` | base PP + flags per move |
| `species_id.txt` | `SPECIES_TOKEN  0xHEX` — for icon fallback |

Loaded in `MainApplication::RefreshPartyData()` and `puse::core::EnsurePartyStaticDataLoaded()`.

---

## Parity & Testing

Backend Python is canonical. Any C++ output must byte-match backend for same input.

```bash
switch-homebrew/scripts/parity_tmp.sh init
# run C++ port → artifacts/tmp/port/
# run backend  → artifacts/tmp/source/
switch-homebrew/scripts/parity_tmp.sh compare <source> <candidate>
switch-homebrew/scripts/parity_tmp.sh cleanup
```

Phase tests:
```bash
make test-phase1    # checksum parity
make test-phase2    # party mutation parity
```

---

## Key Constraints (from RULES.md)

1. **Behavior parity with backend is non-negotiable.** Any write op must byte-match backend output for same input.
2. **Before any UI code:** read Goldleaf UI sources (`tools/Goldleaf/ui/`) + Plutonium docs (`tools/Plutonium/docs/`) + example (`tools/Plutonium/example/source/`).
3. **Use existing Plutonium components first.** Custom widgets only after documenting why stock components fail.
4. **Full-screen navigation only.** No sub-boxes inside same view for major context switches. Stack-push on enter, stack-pop on back.
5. **No business logic in UI layer.** All save mutations go through Layer A functions.
6. **Checksum after every mutation.** `WriteMonChecksum()` + `CommitPartySectionChecksums()`.
7. **Two build variants:** standard (with icons) and lite (no media). Both must work.

---

## Goldleaf Reference Points

- Shell + layout stack + dialog patterns: `tools/Goldleaf/ui/ui_MainApplication.cpp`
- Icon loading: `tools/Goldleaf/ui/ui_Utils.cpp`
- Feature layouts: `tools/Goldleaf/ui/ui_Browser*.cpp`, `tools/Goldleaf/ui/ui_Application*.cpp`

---

## Save File Location (on Switch)

`sdmc:/switch/puse/Unbound.sav` — loaded on boot, written on X press.

Export path defaults to source path. No download flow (unlike web backend). Write in-place.
