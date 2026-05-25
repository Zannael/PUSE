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
