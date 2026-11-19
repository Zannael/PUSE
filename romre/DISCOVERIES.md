# ROM Reverse-Engineering Discoveries

Living notes for structural discoveries while extracting CFRU ROM data.

## Portable Graphics Extraction (2026-11-19)

- `backend/data/graphics/roms.json` registers the exact local Unbound, Radical Red
  and Sword/Shield hashes, record counts and shared DPE graphics descriptor.
  `romre/extract_graphics.py` emits portable, private PNG packs. See `GRAPHICS.md`.
- All three binaries expose front/back sprite tables, normal/shiny palettes,
  icon pointers, icon palette indices and icon palettes at header offsets
  `0x128` through `0x140`. Native species IDs index these tables directly.
- The live item icon table is referenced at `0x9899C`; verify the surrounding
  accessor instructions before accepting it. Decodable retained vanilla tables
  also exist and must not be selected by image plausibility alone.
- Verified graphics record counts (including placeholders): Unbound 1294,
  Radical Red 1376, Sword/Shield 1268. Item counts examined: 728, 750, 750.
  Every resource key and decoded PNG pixel was compared between Python and JS.
- Castform (native ID 385) has four 2048-byte image banks and four 32-byte
  palettes. Other 128-byte palette blocks in Radical Red contain one effective
  palette followed by repeated grayscale data or zeros. The live battle loader
  copies the first 32 bytes except when indexing Castform's battle form.
- Unbound Iron Plate (item 503) palette at `0x236990` starts with `0x0A`, not
  `0x10`. Its payload decodes using BIOS LZ semantics without changing the ROM.
  Sword/Shield also contains an end reference exceeding the logical resource
  length: bound the output to the declared length rather than rejecting it.
- Resource extraction and appearance selection are separate. Declared female
  mappings and Unown letters are supported; Spinda's procedural spots and exact
  battle-context appearances are not reproduced by a static pack.
- Modern Emerald Expansion is a different adapter, not just different offsets:
  SpeciesInfo/ItemInfo carry graphics pointers, palettes may be raw, and Smol
  compression may be used. This is source-level research, not binary validation.

## Species Name Table Observations

- In both `Unbound.gba` and `SwordShield.gba`, species entries include a gap block after early IDs:
  - `252: Egg`
  - `253: MISSINGNO?`
  - followed by repeated `?` placeholder rows
  - then normal species resumes (for example `277: Treecko`).
- This means species IDs are not guaranteed to be a dense "real mon only" sequence.
- Pipeline policy: keep raw rows as ROM truth; do not renumber IDs.
- Practical consequence: downstream logic should avoid assuming every ID corresponds to a normal species.
- Additional boundary issue seen on `SwordShield.gba`: after `Chimecho`, 11-byte decoding can drift into move text (`Pound`, `Karate`, etc.) if cutoff is too permissive.
- Species cutoff logic now includes:
  - rolling quality windows,
  - gap recovery for placeholder blocks,
  - explicit move-bleed guard (`-`, `Pound`, `Karate*` pattern),
  - suspicious-tail trimming.
- Current extracted endpoints:
  - `Unbound.gba`: ends at `1293: Urshifu`
  - `SwordShield.gba`: ends at `411: Chimecho`

## Anchor Reliability Findings

- Unbound item extraction previously picked the first `Master Ball` / `Ultra Ball`
  pair at `0x3DB054`, a retained vanilla table. The `Costume Box` anchor came from
  the live table, so the output mixed two generations of records. A plausible
  pocket byte alone incorrectly counted stale/blank records as successful reads.
- The CFRU header pointer at `0x1C8` holds `0x08876200`. The live table is continuous:
  `0x876200 + item_id * 44`, including the former base/extended boundary.
  The pocket accessor at `0x9A9D8` loads this same base from `0x9A9F8`, multiplies
  the sanitized item ID by 44, then reads byte `+26` (`ldrb r0, [r0, #26]`).
  Magma Stone's live row is `0x8771D0`: native ID 92, pocket 2 (Key Items).
- Reading this live table corrects 17 pocket codes, not just Magma Stone. It also
  restores pointer-form item names. Some native ID fields are aliases (notably
  TM/HM), so row indexing must use the table position rather than renumbering IDs.
  ID 175 has pocket 0 (unused), despite the legacy names file labelling it Starf
  Berry; the live Starf Berry is 174. The names file remains a separate catalog
  migration concern; pocket generation uses ROM names when distinguishing TM/HM.
- Reproduce item metadata and every runtime pocket/fallback set from the root:

  ```bash
  python3 backend/tools/extract_unbound_item_table.py backend/local_artifacts/Unbound.gba
  python3 backend/tools/sync_item_pocket_data.py --write
  switch-homebrew/scripts/sync_romfs_data.sh --data-only
  3ds-homebrew/scripts/sync_romfs_data.sh
  python3 backend/tools/item_extraction_regression.py --rom backend/local_artifacts/Unbound.gba
  ```

  The private-ROM check compares all 728 records and ROM hash with committed
  output. `cd frontend && npm run items:extraction-regression` needs no ROM and
  checks legacy-table decoys, invalid pointers/records, aliases, indirect names,
  and drift in generated maps and source fallback sets. Discovery fails if the
  header pointer or opening/extended anchors are invalid; it never falls back to
  an arbitrary name match. Item extraction still depends on `items.txt` for the
  requested ID range, so it remains outside the ROM-pure pipeline task list.

- Move table anchor (`Pound`/`Karate Chop`) can false-match on other CFRU hacks.
- Guard added: inferred move count below threshold is treated as anchor failure, not success.
- Ability table anchor (`Stench`/`Drizzle`/`Speed Boost`) can fail on other hacks (name/table divergence).

## Generic String-Run Discovery (Implemented)

- Added generic fixed-width run scanning for move and ability name tables:
  - evaluate each possible alignment modulo entry size
  - find longest contiguous run of valid encoded-string entries
  - select best run as table candidate
- Results so far:
  - `Unbound.gba` moves discovered via generic scan (`923` entries), abilities discovered (`293` entries)
  - `SwordShield.gba` moves discovered via generic scan (`605` entries)
  - `SwordShield.gba` abilities generic scan still fails (`best_run=3`) -> likely different encoding, entry size, or non-contiguous layout

## Structural Ability Discovery (Species-Guided)

- Implemented a structural fallback for ability table detection:
  - infer species table base and species count from ROM
  - collect used ability IDs from species struct ability bytes (`+0x16`, `+0x17`)
  - scan candidate fixed-width string runs across entry sizes
  - score candidates by coverage of used ability IDs and count plausibility
- Key guard: reject candidates with ability-count overshoot far above species-used max ID.
  - This prevents falsely selecting the move-name table as ability table.
- Current result:
  - `Unbound.gba`: structural ability discovery succeeds (`entry_size=17`, count `293`).
  - `SwordShield.gba`: structural method fails closed with
    `Structural scan found only implausible candidates (overshoot too large)`.
    This is preferred over silently accepting wrong data.

## Important Caveat

- Generic string-run discovery is more portable than name anchors, but still assumes:
  - fixed-width entries
  - same text encoding map
  - contiguous table blocks
- For some hacks (current SwordShield abilities case), we need a more structural strategy than text-run detection alone.

## Current ROM-Pure Coverage

- Pure extractors currently active in `romre/run_extract.py`:
  - species table
  - abilities table (when anchor matches)
  - moves table (with false-positive guard)
  - species base stats
  - species growth rates
  - species identity metadata
  - species abilities metadata
- Still pending for full ROM-pure flow:
  - item table extraction without `backend/data/items.txt`
  - form alias extraction without `backend/data/species_id.txt`

## Open RE Tasks

- Replace string-anchor-only detection with pointer/structure-aware discovery where possible.
- Add diagnostics in manifests for detected gap ranges and rejected candidate anchors.
- Build ROM-native item catalog extraction to avoid fixed ID/name reference files.
