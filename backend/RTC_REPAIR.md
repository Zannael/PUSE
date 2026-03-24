# RTC Tampering Repair (Unbound profile)

This workflow repairs RTC tampering by comparing a tampered save with an NPC-fixed counterpart and generating deterministic candidates.

## Files

- Generator: `backend/tools/rtc_repair_from_pair.py`
- Diff manifest: `backend/local_artifacts/rtc_manifest_unbound2.json`

## Usage

```bash
python3 backend/tools/rtc_repair_from_pair.py \
  --broken backend/local_artifacts/Unbound_2.sav \
  --fixed backend/local_artifacts/Unbound_2_fixed.sav \
  --manifest backend/local_artifacts/rtc_manifest_unbound2.json \
  --out-dir backend/local_artifacts
```

## Candidate order

Test in this order and stop at first that is valid and fixes tampering:

1. `Unbound_2_candidate_layout2_id0_id4_full.sav` (default)
2. `Unbound_2_candidate_layout2_id0_id4_id13_full.sav`
3. `Unbound_2_candidate_layout2_id0_id4_id13_full_plus_aux12.sav`

## Pair vs Quick

Use these modes based on what files you have and how confident you are about the root cause.

### Pair Repair (recommended)

- Input: tampered save + one NPC-fixed counterpart.
- Goal: derive a save-specific manifest from real before/after bytes.
- Output: manifest + ordered fallback candidates in a zip pack.
- Use when: you still have both files, especially if the save has unusual section behavior.

Backend endpoint:

```bash
curl -X POST \
  -F "broken=@tampered.sav" \
  -F "fixed=@npc_fixed.sav" \
  http://127.0.0.1:8000/rtc/repair-candidates \
  -o rtc_pair_repair_pack.zip
```

### Quick Fix (single file)

- Input: one tampered save.
- Goal: apply known manifest deltas from `backend/data/rtc_manifest_unbound_v1.json`.
- Output: quick fallback candidates in a zip pack.
- Use when: you are sure the issue is RTC tampering and no NPC-fixed pair is available.

Backend endpoint:

```bash
curl -X POST \
  -F "file=@tampered.sav" \
  http://127.0.0.1:8000/rtc/quick-fix \
  -o rtc_quick_fix_pack.zip
```

Warning: quick fix is profile-based. If symptoms are not RTC-related, prefer pair repair.

## Notes

- Section ids `0`, `4`, and `13` are treated as opaque: do not recompute with standard checksum logic.
- The script aligns output generation/layout to the NPC-fixed save geometry.
- Always keep original save backups.
