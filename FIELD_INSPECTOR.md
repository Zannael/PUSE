# Read-only developer field inspector

The inspector reads the selected coherent generation in the current in-memory save. It does not commit pending editor buffers, normalize values, repair checksums, or write a save. Arbitrary addresses and unknown flags cannot be inspected or edited through this feature.

## Access

- Browser, Local or Backend mode: open **Inspect**, optionally filter the known fields, and export their report as JSON. Refresh reads the current save bytes again.
- API: `GET /developer/fields`; missing saves and layouts without a coherent generation return HTTP 400. There is no inspector write endpoint.
- Switch: **Field Inspector** in the home menu, A for a full-page field detail, B to return through the page stack.
- 3DS: Select from Party to Resources, then L for the inspector. Select a field to see its details; B returns. The global X save shortcut is disabled while the inspector is open on both native ports.

Reports describe the profile chosen by the user. Structural evidence does **not** identify the exact ROM version. `exact_rom_version_confirmed` is always false. `verified-layout` means the location and decoding are established for that profile, not that an arbitrary input has proven its game/version. `layout-only` marks a known byte whose enum meaning is deliberately left unclassified.

## Known fields and evidence

All offsets are relative to logical sections in the selected generation; the report also supplies their physical file offsets. Numeric fields are little-endian. Raw hex contains the entire storage width, including the whole source byte of an individual flag.

| Field | Location | Decoding/evidence |
|---|---|---|
| Trainer name | Section 0 + `0x0`, 7 bytes | Existing trainer text reader; terminator and unknown-character behavior retained |
| Trainer gender byte | Section 0 + `0x8`, 1 byte | Raw enum value; meaning unclassified |
| TID / SID | Section 0 + `0xA` / `0xC`, 2 bytes each | Existing trainer identity reader |
| Stored party count | Profile party section/count offset, 4 bytes | Raw count, without presentation clamping |
| Stored money | Profile trainer section/money offset, 4 bytes | Stored u32 for Unbound; XOR decoded with the key below for Radical Red. This is a fixed-field research view, not the Unbound money editor's heuristic search. |
| Money XOR key | Radical Red section 0 + `0xF20`, 4 bytes | Verified Radical Red profile; not exposed for Unbound |
| Badge 1–8 | Unbound section 1 + `0xFE4`, bits 0–7 | Named `0x820..0x827` flags already read by `game_progress` |
| Champion | Unbound section 1 + `0xFE5`, bit 4 | Named `0x82C` flag already read by `game_progress` |
| DexNav | Unbound section 4 + `0xD9B`, bit 6 | Named expanded `0x91E` flag already read by `game_progress`; this tail remains excluded from checksum repair |

Radical Red progress flags, difficulty, NG+, appearance and unknown event flags have no entries. No meanings are inferred from matching addresses in another game. Pokemon OT fields are distinct from player identity.

## Report contract

Schema version 1 contains `profile_id`, `read_only`, `exact_rom_version_confirmed`, `notice`, `save_index` (the generation counter), and `fields`. Each field has a stable `id`, `label`, `section_id`, `relative_offset`, `file_offset`, `width`, optional `bit` (null for ordinary fields), `raw_hex`, string `decoded`, and `confidence`. Boolean values decode to `"true"` or `"false"`; raw values are never clamped. JSON exports contain trainer identifiers and should be shared deliberately.

## Validation

Run `cd frontend && npm run inspector:regression` or `python3 backend/tools/field_inspector_regression.py` from the root. The test generates synthetic fixtures for both supported profiles and compares Python, JavaScript, Switch and 3DS report objects, while verifying raw locations, named-flag semantics against existing readers, XOR decoding, invalid-layout rejection and unchanged input bytes. It covers rotated generations, first/second generation selection, rollover, fallback from a damaged newer generation, and optional RTC trailers. It also smoke-tests the API handler. `parity:all` includes it.

mGBA is not needed to prove a read-only report's byte immutability; no new offsets or mutations were inferred from emulator behavior for this feature.

Switch UI reference review: Goldleaf `tools/Goldleaf/ui/ui_MainApplication.cpp` (menu and layout stack); Plutonium `docs/files.html`, `docs/d1/dd0/elm___menu_8hpp.html`, `Plutonium/include/pu/ui/elm/elm_Menu.hpp`, and `example/source/MainApplication.cpp` / `Main.cpp`. The inspector reuses existing Menu/MenuItem, TextBlock and full-page layout components; no custom widget was required.
