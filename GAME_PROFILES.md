# PUSE game profile contract (schema 1)

PUSE registers two verified English profiles: `unbound-2.1.1.1` and `radical-red-4.1`. Recognition returns structural family candidates; it cannot identify an exact ROM version. Radical Red and ambiguous candidates require explicit game/version selection. Unbound remains the default for legacy standalone tools. See `romre/CFRU_IMPLEMENTATION_PLAN.md` for ROM hashes and independent game validation.

## Canonical source and runtime bindings

`backend/data/profiles/*.json` are canonical. Python loads and recursively freezes this contract. Browser local mode imports the generated `frontend/src/core/gameProfile.json` and freezes it. Each native core uses generated `include/puse/core/GameProfile.hpp` bindings: constexpr traits for binary operations and the exact canonical JSON for inspection. Native ROMFS mirrors also contain the profile JSON. No JSON parser or new application dependency is required by the portable cores.

Run from the repository root:

```bash
python3 backend/tools/sync_game_profiles.py
switch-homebrew/scripts/sync_romfs_data.sh --data-only
3ds-homebrew/scripts/sync_romfs_data.sh
python3 backend/tools/sync_game_profiles.py --check
python3 backend/tools/profile_regression.py
```

Do not hand-edit generated bindings or mirrored JSON. The synchronization check and focused regression start frontend `parity:all`. Existing byte-level, feature and homebrew parity checks remain required.

## Contract fields

| Field | Meaning |
|---|---|
| `schema_version`, `id` | Serialized contract version and stable game/version namespace. |
| `identity` | Supported version/language, ROM hashes, provenance boundaries and selection policy. |
| `container` | Sector and slot sizes, footer fields, signatures, counter ordering, checksum domains, opaque sectors, auxiliary storage and known trailer sizes. Length metadata does not introduce a new upload-size restriction. |
| `storage` | PC gather/scatter regions and addressing, separate preset semantics, party/trainer offsets, resources, bag anchors and Pokédex flags. Region ends are exclusive. |
| `codecs` | Implemented codec identifiers, record sizes/fields, text widths, packing/checksum policies and legacy validity bounds. |
| `rules` | Identity/shiny/ability policies, level/IV/EV/happiness/resource/PP limits and named growth/PP algorithms. |
| `catalogs` | Logical catalog keys, canonical filenames, profile-scoped native ID spaces, required metadata and optional national mappings. |
| `requirements` | Catalog prerequisites per feature. These describe metadata needs; existing fallback/error behavior is preserved. |
| `capabilities` | Per-feature, per-runtime coverage. `preserve-only`, `core-only` and `unavailable` are explicit, rather than implied support. |
| `evidence` | Audit/extraction revision, table candidates, resolved live tables, confidence, completeness and unresolved integrity limits. |

`core/profile_schema.py` validates the registered contract and generator invariants, including supported codec/schema IDs, widths, capacities, checksum domains, catalog namespaces/paths and the runtime capability matrix. This is an internal built-in contract, not an untrusted profile/plugin loading format. Merely adding a JSON file cannot enable another game. New codecs and dispatch must be implemented and validated before registering it.

## Session and operation binding

Backend uploads retain `current_save["profile_id"]`; local browser sessions retain `profileId` through mutations and buffer replacement, accessible through `getSessionProfile()`. Both native `SaveSession` implementations retain a built-in profile pointer, expose `Profile()`, and reset it on `Clear()`. Failed native loads preserve the existing session and profile.

Existing low-level entry points retain their signatures and use the selected immutable profile through a read-only view. This preserves API payloads and legacy standalone tools. Slot selection, checksums, PC regions, party/PC record offsets, resource offsets, bag anchors, Pokédex offsets, key limits and catalog bindings now consume profile data. Some field packing, text tables, growth formulas, progression flags and fallback metadata loaders remain inside the explicitly named Unbound codecs. Radical Red uses independently verified shared record layouts, its own catalog namespace, 25-box addressing, fixed fragmented bag pockets, XOR money and shiny threshold 8. Unbound-specific flags, presets and item/name mappings are never substituted for missing Radical Red metadata. The extraction/catalog-completeness work remains milestone 4/5.

## Native identity and lossless preservation

A native identifier is `(profile_id, native_id)`. National Dex mappings are optional metadata and do not replace native species IDs. Profile inspection distinguishes `empty`, `known` and `unknown` species while preserving the raw record. Existing public Pokémon readers keep their established presentation filters.

Insertion now reserves any PC/Preset record whose native species ID is nonzero, even if legacy validity filters omit it. Such records cannot be silently overwritten as empty slots. The existing occupied-slot error is returned, automatic slot selection skips them, and neighboring edits preserve their bytes. This narrow guard is the deliberate validation change required by milestone 2's unknown-value preservation rule; verified valid-record mutations retain their pre-refactor bytes.

## Completion evidence and limits

Nine SHA-256 fingerprints captured from synthetic pre-refactor outputs cover no-ops, PC mutations and combined preset/resources/bag/party/Pokédex mutations under normal, rotated and wrapped generation layouts. The regression compares current outputs to those fixed fingerprints. The four-runtime storage regression independently checks the complete gather/scatter serialization. Contract serialization, immutable selection, unsupported-profile rejection, session lifecycle, unknown-record reservation/preservation and backend upload payload compatibility have focused tests.

Private saves and ROMs are never profile assets. Shared auxiliary sectors still have no verified historical snapshot; Unbound section 4 remains opaque; Radical Red section 4 has a verified `0xD98` checksum domain. Homebrew Preset editing and save-review UI remain unavailable. Native builds and host parity do not substitute for physical-console controller/save validation.

## Radical Red 4.1 coverage and selection

| Operation | Backend / browser / Switch / 3DS |
|---|---|
| Existing Party / PC records, PID-aware identity, names, items, moves/PP, levels, stats, happiness | Supported |
| PC boxes 1–25 and release | Supported; Box 25 is ordinary storage |
| Player name / gender / combined TID/SID | Read-only |
| Money | Read/write, u32 XOR with trainer key; max 999,999,999 |
| Five fixed bag pockets | Read/write; main pocket compaction crosses its two physical regions |
| New Pokémon construction, caught-ball editing, Preset, BP, RTC, Pokédex / progress flags, aggregate roster | Unavailable; preserved / guarded |
| Effective ability and special-mode battle-rule prediction | Unavailable; native ability slots and base-ROM stats remain explicit |

The web loader exposes explicit version selection. Backend upload accepts `profile_id` as an optional query parameter; `/profiles/recognize` returns candidates without activating them. Browser local and backend clients expose matching profile and read-only trainer methods. Switch uses the existing file browser and a built-in version-confirmation dialog; 3DS chooses the supported game before looking for `radicalred.sav` or `Unbound.sav`. Selection loads profile-scoped catalogs and suppresses Unbound-only controls/icons.

Canonical Radical Red assets are generated by `backend/tools/extract_radical_red_41.py --rom <verified-ROM> --out backend/data/games/radical-red-4.1`, then the profile generator and both ROMFS sync scripts above. The extractor rejects other ROM hashes. Runtime assets contain extracted metadata, never ROM/save bytes. Missing required native Radical Red pocket catalogs fail closed instead of invoking Unbound fallback sets.

Focused tests: `python3 backend/tools/radical_red_regression.py <private-save>` compares full bytes in four runtimes; `radical_red_api_regression.py` exercises actual ASGI routes without external dependencies; `radical_red_game_validation.py --rom <ROM> --save <save> --probe <mGBA-adapter>` optionally checks real-game load/save/reboot. Private fixtures are read-only and temporary outputs are cleaned. Unsupported versions, difficulty/randomizer overrides and physical-console validation remain explicit limits, not inferred compatibility.
