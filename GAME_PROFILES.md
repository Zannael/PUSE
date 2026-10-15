# PUSE game profile contract (schema 1)

PUSE currently registers one built-in profile: `unbound-2.1.1.1`, for the verified English Unbound 2.1.1.1 ROM. A profile describes existing editor behavior; it does not establish compatibility merely because a save has a familiar signature. Uploads keep the existing validation and error behavior. Automatic game/version recognition and selection of a second game belong to milestone 3.

## Canonical source and runtime bindings

`backend/data/profiles/unbound-2.1.1.1.json` is canonical. Python loads and recursively freezes this contract. Browser local mode imports the generated `frontend/src/core/gameProfile.json` and freezes it. Each native core uses generated `include/puse/core/GameProfile.hpp` bindings: constexpr traits for binary operations and the exact canonical JSON for inspection. Native ROMFS mirrors also contain the profile JSON. No JSON parser or new application dependency is required by the portable cores.

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

Existing low-level entry points retain their signatures and use the one registered immutable profile. This preserves API payloads and legacy standalone tools. Slot selection, checksums, PC regions, party/PC record offsets, resource offsets, bag anchors, Pokédex offsets, key limits and catalog bindings now consume profile data. Some field packing, text tables, growth formulas, progression flags and fallback metadata loaders remain inside the explicitly named Unbound codecs. They must not silently be reused for a second game: milestone 3 must dispatch verified codecs/catalogs and respect capabilities. The extraction/catalog-completeness work remains milestone 4/5.

## Native identity and lossless preservation

A native identifier is `(profile_id, native_id)`. National Dex mappings are optional metadata and do not replace native species IDs. Profile inspection distinguishes `empty`, `known` and `unknown` species while preserving the raw record. Existing public Pokémon readers keep their established presentation filters.

Insertion now reserves any PC/Preset record whose native species ID is nonzero, even if legacy validity filters omit it. Such records cannot be silently overwritten as empty slots. The existing occupied-slot error is returned, automatic slot selection skips them, and neighboring edits preserve their bytes. This narrow guard is the deliberate validation change required by milestone 2's unknown-value preservation rule; verified valid-record mutations retain their pre-refactor bytes.

## Completion evidence and limits

Nine SHA-256 fingerprints captured from synthetic pre-refactor outputs cover no-ops, PC mutations and combined preset/resources/bag/party/Pokédex mutations under normal, rotated and wrapped generation layouts. The regression compares current outputs to those fixed fingerprints. The four-runtime storage regression independently checks the complete gather/scatter serialization. Contract serialization, immutable selection, unsupported-profile rejection, session lifecycle, unknown-record reservation/preservation and backend upload payload compatibility have focused tests.

Private saves and ROMs are never profile assets. Shared auxiliary sectors still have no verified historical snapshot; section 4 remains opaque to generic checksum reconciliation. Homebrew Preset editing and save-review UI remain unavailable. Native builds and host parity do not substitute for physical-console controller/save validation.
