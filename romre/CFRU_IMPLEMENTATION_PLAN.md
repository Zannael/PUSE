# PUSE: implementation path toward CFRU support

Proposed on 2026-10-07 following the PKHeX.Everywhere investigation. This is a roadmap, not an assertion that every CFRU hack shares one save format.

## Aim and design decision

Evolve PUSE through **verified, versioned game profiles backed by ROM extraction**. A profile describes binary layout, game rules, catalogs and supported editing operations. Structural discovery helps build and validate profiles; an unverified discovery does not enable save mutations.

Why: PKHeX.Everywhere supports known hacks through manually implemented formats and curated mappings. PUSE already extracts native ROM metadata, but its runtime layout, global catalogs and mutation rules remain Unbound-specific. Combining explicit save profiles with ROM-derived data preserves accuracy while reducing the work required for each additional hack.

Backend Python remains the canonical behavior reference. Applicable changes must produce equivalent bytes in browser JavaScript, Switch C++ and 3DS C++. Preserve existing API payloads, `apiClient.js`, legit-mode constraints and unrelated working-tree changes. Read `AGENTS.md` and `RULES.md` before implementation.

## Milestone 1 — verify and repair Unbound storage correctness

**Status:** completed on 2026-10-07 for the verified English Unbound 2.1.1.1 ROM. Corrective changes, four-runtime byte parity and headless game save/reboot validation passed. Capability and integrity limits are recorded below.

Audit PC stream boundaries, fragmented boxes, preset semantics, active-slot selection and checksum coverage for the supported Unbound version. Fix only demonstrated defects, backend first, then all applicable ports.

Why first: a generic profile abstraction would otherwise preserve existing layout mistakes and make them harder to distinguish from new-game differences.

Evidence to investigate:

- `backend/modules/pc.py` reads `0xFF0` bytes starting at `+4` in every stream section. The upstream adapter skips four bytes only in logical section 5, then reads subsequent sections from `+0` to `0xFF0`. PUSE's construction substitutes the previous section's final four bytes for the next section's first four bytes. A read-only comparison found eight differing complete records on the upstream Unbound 2.0 fixture. This is a discrepancy to verify against PUSE's supported version, not sufficient evidence to copy upstream behavior wholesale.
- Upstream reconstructs a continuous stream through sections 5–13, physical sectors 30/31, logical sections 2/3, and logical section 0. A record can cross these boundaries. PUSE instead combines its main stream with fallback offsets and explicitly tolerates an invalid boundary record in box 23.
- Upstream labels the region starting at logical section 0 + `0xB0` as box 25. PUSE presents that region as preset box 26. Establish the intended semantics and actual supported-version layout before changing labels or storage behavior.
- Upstream/CFRU source checksum coverage is `0xF24` for section 0, `0xD98` for section 4, `0x450` for section 13, and `0xFF0` otherwise. PUSE uses shorter section-0 coverage in some PC paths, larger spans in others, and treats section 4 as opaque. Several spans can match an existing checksum when the additional bytes contribute zero; matching one fixture does not resolve coverage. Preserve section 4's current protection until its behavior is independently established.
- Logical section IDs rotate between physical sectors. Physical sectors 30/31 are auxiliary storage without ordinary section footers. Validate complete slots, counters, integrity and rollover before deciding which data to edit.

Acceptance criteria:

1. Record verified layouts, supported fixture versions, disputed ranges and unresolved semantics. Do not assume the upstream 2.0 fixture establishes behavior for Unbound 2.1.1.1.
2. Add focused regressions for occupied records crossing each affected boundary, empty slots, fragmented records and preservation of untouched bytes. Cover slot rotation, damaged/incomplete slots and counter rollover where those paths change.
3. Distinguish checksum domains using controlled in-memory changes in the disputed ranges. Preserve input fixtures and RTC trailers.
4. Implement confirmed fixes in all four applicable runtimes. Run frontend `parity:all`, relevant feature regressions, and homebrew phases 1–4 for both ports; run Python compile checks and any changed-endpoint smoke checks. Run lint/build if frontend integration changes.
5. Document any game-validation gap. Passing reload or parity checks alone does not demonstrate acceptance by the game.

Use ignored artifact locations for saves and ROMs. Commit no personal fixtures, ROMs or extracted personal save data. Update this milestone with findings and verification results when complete.

### Milestone 1 findings and implementation — 2026-10-07

Version evidence was collected **before runtime changes**. Both ignored local ROM copies (`romre/roms/Unbound.gba`, `backend/local_artifacts/Unbound.gba`) have SHA-256 `7aa25bbf568f7cfcf6ee1cf2e9e6ff637350b3d0705c2375cabb6baa7d9739f7`. The [translation toolkit's source-ROM requirements](https://github.com/AntonyKervazoCanut/gba_translator#patch-first-setup-for-local-work), together with its [2.1.1.1 patch instructions](https://github.com/AntonyKervazoCanut/gba_translator#install-the-french-patch), identify this English source as Unbound 2.1.1.1. This is external version provenance, not a new runtime version detector.

The ROM has three matching save-size tables. Only `0xA6CD88` has an aligned absolute reference (`0xDA23C`). Thumb disassembly of the initializer around `0xDA1DC–0xDA230` shows construction of save chunks using those offsets and sizes. The other two copies were not counted as independent live-layout evidence. The 25-pointer box table at `0xA6CB2C` has 13 aligned references around `0xA0473C–0xA04BB8`. Its groups begin at RAM `0x02029318` (19 boxes), `0x0203CB44` (3 boxes), `0x02027434` (2 boxes), and `0x02024638` (1 box). Save serialization and local save comparisons corroborate the following regions independently of the upstream 2.0 fixture. No upstream adapter code or curated arrays were transplanted.

Verified boundaries, ends exclusive:

| Storage | Save regions |
|---|---|
| Boxes 1–19 | section 5 `[0x004, 0xFF0)`, sections 6–12 `[0, 0xFF0)`, section 13 `[0, 0x1A8)` |
| Boxes 20–22 | physical sector 30 `[0xB0C, 0xFF0)`, physical sector 31 `[0, 0xF80)` |
| Boxes 23–24 | section 2 `[0xF18, 0xFF0)`, section 3 `[0, 0xCC0)` |
| Final box / existing Preset API | section 0 `[0xB0, 0x77C)` |

The first three rows gather exactly 41,760 bytes (720 records); the final region contains 30 records. Records can cross every gather boundary; all footer bytes are excluded.

Preset semantics were resolved against this ROM: the final box name pointer is RAM `0x020315F5` and reads “Preset” after a normal game load. The patched name accessor at ROM `0xA04BA4` indexes the name-pointer row after the 25 box pointers. The routine at `0x1EC5B20` supplies zero-based box index 24 to that accessor and copies the ROM Preset label (`0x1F11D18`). ROM instructions at `0x1F573B2`, referenced at `0x1E80E7C`, describe the five rows as five separate preset teams. Therefore preserve the separate Preset API box 26, hidden box 25 and existing legit-mode rules; an ordinary-box alias would be misleading.

Confirmed defects and repairs:

- Former `+4, length 0xFF0` slices replaced each following sector's initial four bytes with footer bytes. Skip four bytes only in section 5; end each ordinary region at `0xFF0`.
- Include box 19's section-13 continuation and box 20's sector-30/31 boundary. Reconstruct box 23 slot 4 completely rather than tolerate structural garbage. Exact regions replace occupancy-based fallback selection; empty boxes use the same addresses as occupied boxes.
- PC loading now selects one physical 14-sector slot with unique IDs 0–13, supported signatures (`0x01121998` / `0x01121999`), coherent counters and known-domain checksums. Compare counters modulo 32 bits, fall back to an intact older slot if necessary, reject saves with no usable slot or truncated auxiliary storage, and never combine generations. Section 4's checksum remains opaque. Auxiliary sectors and RTC trailers are excluded from footer scanning.
- Touched PC domains use `0xF24` for section 0, `0x450` for section 13 and `0xFF0` for other ordinary sections. Sectors 30/31 have no ordinary checksums. Section 4 is neither written nor reconciled. Save reports use the established lengths and retain section 4's opaque status.
- Backend/browser commits merge edited record bytes into current save bytes instead of replacing section 0 with its load-time snapshot. Trainer/RTC edits after PC load survive. PC no-op commits preserve every byte, and mutations checksum touched ordinary regions after scattering.
- Ordinary feature readers now use the same validated generation: party/trainer, money/BP, bag sector 13, game-progress and Pokédex. Money changes and save-all leave the inactive generation untouched. Party and ordinary bag writes refresh their fixed-domain checksums immediately so a subsequent read cannot fall back because of the editor’s own pending mutation. Backend party CLI uses the same selection and `0xFF0` domain.
- Diagnostic reports select the newest structurally coherent generation without ignoring checksum errors, so corruption remains visible; this diagnostic generation can differ from the intact generation selected for editing. Counter zero is valid and report selection also respects rollover.
- Python is the canonical implementation; browser, Switch and 3DS gather/scatter and ordinary-slot selection follow the same behavior. Both homebrew cores now expose boxes 1–24 through their existing record APIs and menus (the formerly hardcoded limit was 18); no new UI controls or layouts were introduced.

Private fixture evidence (aggregate only):

| Fixture | Counter | Complete legacy main-stream records differing from verified layout |
|---|---|---|
| `Unbound.sav` | 842 | 71, 141, 211, 212 |
| `FewTimesDead.sav` | 1123 | 71, 141, 211, 212, 282, 352 |
| `fill_boxes.sav` | 738 | 71, 141 |
| `empty_boxes.sav` | 737 | 71, 141 |

These local saves' ordinary-section checksums match the ROM's fixed domains. Section 0 `[0xADC, 0xF24)` is zero in these fixtures, so matching shorter checksums were inconclusive. Controlled synthetic changes distinguish included/excluded bytes at `0xADC`/`0xF24`, `0x44C`/`0x450`, and `0xFEC`/`0xFF0`. Save filenames/signatures do not establish each fixture's exact originating version; no such claim is made. The upstream 2.0 fixture was not used to authorize changes.

Verification:

- `python3 backend/tools/pc_storage_audit.py --rom <ignored-ROM-path> <ignored-save-path> ...` reproduces aggregate table references and legacy boundary discrepancies without writing inputs or printing record/owner data.
- `python3 backend/tools/pc_storage_regression.py` / frontend `npm run pc:storage-regression` creates synthetic fixtures and compares whole saves and gathered streams across all four runtimes. Tests cover occupied records crossing every region boundary, release and empty-slot insertion, public readers for all 24 boxes, homebrew release APIs for those boxes, no-op equality, rotations, either slot newer, rollover, corrupt checksums/signatures, duplicate IDs, inconsistent counters, no usable slot, truncated auxiliary storage, opaque section 4, preset merging and disputed checksum domains. Whole-save checks combine ordinary bag changes, money reads/writes and finalization on each selected generation and assert inactive-copy preservation. Both ports use `parity_tmp.sh init/compare/cleanup`; no fixtures are committed.
- Frontend `npm run parity:all` passed, including PC fallback/release, identity, RTC, roster, happiness and save-report checks. The PC fallback test now reads committed bytes through `/download`, allowing the test server to write outputs only under `/tmp`.
- Both homebrew phase 1–4 script sets passed against ignored `Unbound.sav`; save-health parity, Python compile checks, frontend lint and frontend build also passed. Phase-1 checksum references now use the ROM’s fixed domains rather than treating `0xFF0` as a length field; the focused Pokédex fixture now constructs a complete valid slot. PC load/release and sequential party/PC/money endpoint smoke checks cover damaged-slot fallback and invalid/truncated containers.
- Switch standard and lite `.nro` builds and the 3DS `.3dsx` Docker build passed using the installed devkitPro images. The Switch SD bundle was refreshed and generated-file ownership restored. Existing menus automatically consume the corrected 24-box core limit. As required by Switch rules, reviewed `tools/Goldleaf/ui/ui_ExploreMenuLayout.cpp`, Plutonium `docs/files.html` and `docs/dc/d6c/classpu_1_1ui_1_1elm_1_1_menu.html`; existing Menu and back-navigation patterns remain in use. No custom widget was needed.
- Private saves and ROMs were read without alteration. The pre-existing untracked plan was preserved and extended; no other pre-existing tracked changes were present.

Game validation and remaining limits:

- Built the headless library from official mGBA 0.10.5 (`26b7884bc25a5933960f3cdcd98bac1ae14d42e2`) in `/tmp`, using its public core API and PUSE’s own probe. This is optional test tooling, not a new application dependency. `backend/tools/unbound_game_validation.py` verifies the ROM hash, operates on temporary save copies and emits aggregate pass/fail results. No ROM, savedata, RAM dump or savestate is tracked.
- Normal Continue loaded all 720 ordinary records and all 30 preset records exactly as PUSE reconstructed them. Representative occupied edits crossing every stream-region boundary and a preset edit survived a normal game save (counter 842 → 843), serialization of the game’s flash, and a fresh game reboot. The emulator flash clone is 128 KiB; its external RTC trailer is not part of the game’s flash serialization. Editor byte tests independently preserve the original trailer.
- Game RAM also matched PUSE after corrupting the newer slot’s section 6 (game and editor chose 841), setting counters to `0xFFFFFFFF`/0 (both chose 0) and `0xFFFFFFFE`/1 (both chose 1), and using signature `0x01121998`. A stale change at section 0 + `0xADC` caused game fallback, refreshing the `0xF24` checksum kept the newer slot, and changing excluded byte `0xF24` kept the newer slot. These checks distinguish checksum coverage by actual game behavior, not only agreement between editor implementations.
- The optional game test expects the private overworld fixture used here, with Pokedex initially selected in the Start menu. Its fixed button sequence is fixture-specific; it asserts a changed counter to prevent a false save-round-trip pass. Hardware/controller UX was not exercised. Existing 3DS compiler deprecation/linker warnings did not prevent the build.
- Homebrew editing now covers all 24 ordinary boxes. Preset editing has no existing homebrew API/UI and remains unavailable there; its bytes are preserved. Adding that feature is outside this corrective milestone.
- Sectors 30/31 are shared between generations with no independently verified integrity marker or older snapshot. Choosing an older ordinary slot cannot recover an older auxiliary snapshot; the game uses the same shared contents. Auxiliary sectors are explicitly excluded from generic checksum reconciliation too. Section 4 remains opaque and protected from reconciliation as required by repository guidance. Do not infer full-container integrity or historical auxiliary recovery from ordinary-slot validation.
- Milestone 2 and all later milestones remain pending. No profile abstraction, new-game support, generated catalogs or extraction heuristics were introduced.

Reproduce optional game validation after building mGBA as a headless library (`BUILD_QT=OFF`, `BUILD_SDL=OFF`, `M_CORE_GB=OFF`; see the pinned version above):

```bash
cc -I<mgba-source>/include -I<mgba-build>/include -include mgba/flags.h \
  backend/tools/unbound_emulator_probe.c -L<mgba-build> \
  -Wl,-rpath,<mgba-build> -lmgba -o /tmp/puse-unbound-probe
python3 backend/tools/unbound_game_validation.py \
  --rom <ignored-verified-ROM> --save <ignored-overworld-fixture> \
  --probe /tmp/puse-unbound-probe
```

Inputs are read only. Default temporary outputs are deleted; `--keep-tmp` explicitly retains private debugging artifacts under `/tmp`.

## Milestone 2 — introduce the profile contract

**Status:** pending; follows milestone 1.

Represent verified Unbound behavior as a built-in profile, then make runtime operations consume that profile without changing output bytes. Keep the loaded save paired with its profile and remove hardcoded/global lookup assumptions incrementally.

Why: layout and game-rule differences should be parameters or explicit codecs rather than repeated conditionals throughout UI and domain logic.

The contract should include:

| Part | Required information |
|---|---|
| Identity | Stable profile ID, supported versions, ROM hashes and provenance |
| Container | File sizes, signatures, section/slot structure, counters and checksums |
| Storage | Party/trainer offsets, box gather/scatter regions, bag regions and encryption |
| Pokémon codec | Record sizes, bit packing, text encoding and backup/checksum fields |
| Rules | PID constraints, shiny threshold, ability encoding, limits, growth and PP |
| Catalogs | Native IDs/names/stats/forms/items/pockets/moves/abilities; optional national mappings |
| Capabilities | Supported reads/writes, required metadata and unavailable features |
| Evidence | Extraction revision, candidate offsets, confidence, conflicts and completeness |

Keep native IDs as primary identity, scoped by profile. Unknown values must remain distinct from empty slots and retain their original bytes. Optional national mappings help display/interoperability without replacing native IDs. Use the same serialized contract in Python, JavaScript and both portable C++ cores.

Gate completion on Unbound byte equivalence and existing cross-runtime regressions.

## Milestone 3 — add Radical Red as a second explicit profile

**Status:** pending; follows milestone 2.

Begin with Pokémon, trainer and bag operations, using independently validated catalogs and fixtures. Add candidate-based recognition and explicit selection when saves are ambiguous. Expose unsupported operations consistently across runtimes.

Why: a second game tests whether the profile design handles real differences. The upstream adapters share storage but use different species/item mappings and shiny thresholds: Unbound 16, Radical Red 8. Those values still need verification for each supported Radical Red version.

Preserve PUSE's PID-aware editing where verified metadata permits it. Do not equate modern PKHeX legality with a hack's native rules.

## Milestone 4 — add structural ROM discovery

**Status:** pending; read-only prototype work can proceed independently of runtime integration.

Extend `romre` to find candidate save-section tables and box-pointer tables. Follow live-code references, validate surrounding structures, and map RAM regions through save serialization. Add pointer-aware catalog discovery and explicit profile overrides when validation fails.

Why: this reduces dependence on English name anchors and fixed offsets. Exact patterns derived from CFRU source were found in both existing ROMs:

| ROM | Save-section table candidates | Box-pointer table |
|---|---|---|
| Unbound | `0x3FEC94`, `0x825350`, `0xA6CD88` | `0xA6CB2C` |
| SwordShield | `0x14BE0D0` | `0x14BDE10` |

These are source-derived signature matches, not validated live-table selections or a generic detector. The three Unbound copies demonstrate the need to rank and resolve candidates. SwordShield matches are useful because the existing ability-name extraction fails there.

Record confidence per artifact and feature. A successful table-name scan cannot establish binary save layout, flag semantics or exact game version.

## Milestone 5 — complete catalogs and feature coverage

**Status:** pending; follows profile/discovery foundations.

Make item extraction independent of Unbound's `items.txt`, derive form information with explicit validation, and add profile completeness checks. Implement RTC, Pokédex, missions/events and other game-specific operations only with verified profile data.

Why: `romre/run_extract.py` already runs seven tasks, but does not yet build a complete editor profile. Its item task is absent from `TASKS`; item and form tooling still depend on existing reference catalogs. Several metadata extractors assume familiar base stats and record widths.

Expose partial coverage instead of inferring unavailable metadata. Maintain a per-profile/per-runtime support matrix and shared byte-level regressions.

## Source references and reuse boundary

Investigation snapshot: PKHeX.Everywhere `d3d3253a62211145c146dd7ca59a35484e75a7a4`; CFRU `b637a27898b14e25dd24d0f69a3e302f0069deb8`.

- [Shared CFRU save adapter](https://github.com/arleypadua/PKHeX.Everywhere/blob/d3d3253a62211145c146dd7ca59a35484e75a7a4/src/PKHeX.Everywhere.RomHacks/Cfru/CfruSave.cs)
- [CFRU Pokémon codec](https://github.com/arleypadua/PKHeX.Everywhere/blob/d3d3253a62211145c146dd7ca59a35484e75a7a4/src/PKHeX.Everywhere.RomHacks/Cfru/CfruPokemon.cs)
- [Boundary architecture decision](https://github.com/arleypadua/PKHeX.Everywhere/blob/d3d3253a62211145c146dd7ca59a35484e75a7a4/docs/adr/0008-rom-hacks-are-converted-at-the-save-boundary.md)
- [Upstream Unbound tests](https://github.com/arleypadua/PKHeX.Everywhere/blob/d3d3253a62211145c146dd7ca59a35484e75a7a4/src/PKHeX.Everywhere.Engine.Tests/UnboundSaveTests.cs)
- [Original CFRU save layout](https://github.com/Skeli789/Complete-Fire-Red-Upgrade/blob/b637a27898b14e25dd24d0f69a3e302f0069deb8/src/save.c)
- [Original CFRU box pointers](https://github.com/Skeli789/Complete-Fire-Red-Upgrade/blob/b637a27898b14e25dd24d0f69a3e302f0069deb8/src/pokemon_storage_system.c)
- [Original compact Pokémon structure](https://github.com/Skeli789/Complete-Fire-Red-Upgrade/blob/b637a27898b14e25dd24d0f69a3e302f0069deb8/include/new/pokemon_storage_system.h)

Temporary research artifacts, if still available: `/tmp/PKHeX.Everywhere`, `/tmp/CFRU-reference`, `/tmp/OpenHome-reference`, and `/tmp/pkhex-cfru-study/`. This roadmap and the pinned source references remain usable if those directories disappear. The original probes emulated selected upstream algorithms in Python; the upstream .NET suite was not executed.

PUSE is MIT; PKHeX.Everywhere and its credited OpenHome imports are GPL. Use these as research references. Direct transplantation of their code or curated arrays requires a licensing decision; maintain provenance and prefer PUSE's own independently verified implementation and ROM extraction.
