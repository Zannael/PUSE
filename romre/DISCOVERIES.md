# ROM Reverse-Engineering Discoveries

Living notes for structural discoveries while extracting CFRU ROM data.

## Species Name Table Observations

- In both `Unbound.gba` and `SwordShield.gba`, species entries include a gap block after early IDs:
  - `252: Egg`
  - `253: MISSINGNO?`
  - followed by repeated `?` placeholder rows
  - then normal species resumes (for example `277: Treecko`).
- This means species IDs are not guaranteed to be a dense "real mon only" sequence.
- Pipeline policy: keep raw rows as ROM truth; do not renumber IDs.
- Practical consequence: downstream logic should avoid assuming every ID corresponds to a normal species.

## Anchor Reliability Findings

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
