# Save compatibility preflight

`build_compatibility_report` in `backend/core/profile.py` is the canonical
read-only contract. `buildCompatibilityReport` in browser core and
`BuildCompatibilityReport` in both native cores produce the same schema v1 JSON.
Inspection never selects a profile, loads catalogs, changes the session, or
writes input bytes.

## Access

- Backend: `POST /profiles/compatibility`, multipart `file`, optional query
  `profile_id`. It returns HTTP 200 even for unknown/incompatible input, with
  `mutations_allowed=false` and blocker codes. Rejected `/upload` requests return
  HTTP 409 and include this report in `detail.compatibility`.
- Browser (Local and Backend): selecting/dropping a save first inspects it.
  The Compatibility disclosure above the editor shows the inspected filename,
  profile, size, structural and intact counters, fallback and blockers. A blocked
  upload stays on the load screen; choose the correct version and reselect the
  file to retry. Successful uploads retain the report as upload-time evidence.
- Switch: Resources > Field Inspector > Save compatibility report, using the
  existing full-screen detail page and B/back stack.
- 3DS: Resources > Field Inspector (L) > Save compatibility report, with B/back.
- Native load failures include compatibility details in the existing diagnostic
  flow. Unknown files are available only for structural preflight; semantic
  fields and editing are not guessed from an unsupported layout.

## Meaning and admission rules

`candidates` contains built-in profiles whose ordinary container signatures,
section IDs and coherent counters match. `profile_id` is the requested built-in
profile, or the sole structural candidate in automatic mode. Neither is exact
ROM recognition: `exact_rom_version_confirmed` is always false. Unbound keeps its
existing automatic default; Radical Red requires the user's explicit 4.1
selection. Permission to edit is conditional on that game/version declaration.
A different ROM version with indistinguishable save bytes cannot be detected.

`structural_generation` is the newest structurally coherent ordinary generation.
`editable_generation` also requires all understood checksum domains to pass.
Counter ordering is modulo 32 bits, first physical slot on a tie or half-range
ambiguity. `uses_older_generation` identifies fallback to the other physical
slot when the newer one fails checksum validation. Zero is a valid counter;
`null` means no usable generation was found.

Editing admission requires the selected profile's container, an intact ordinary
generation and a complete supported flash size (131072 bytes, optionally a
16-byte RTC trailer). Truncated auxiliary storage, arbitrary extra trailers,
unregistered profiles and unknown layouts are blocked before replacing an
existing session. Rejected uploads preserve original bytes, the active profile
and pending PC buffers. Low-level mutation APIs continue to require a loaded
supported session; this does not add an unsafe semantic editor for unknown files.

Blockers are stable codes, in evaluation order:

| Code | Meaning |
|---|---|
| `unsupported_profile` | Requested profile is not registered |
| `unknown_layout` | No unique candidate or selected container does not match |
| `unsupported_size` | File size is not flash size plus a supported RTC trailer |
| `no_coherent_generation` | Selected profile has no intact ordinary generation |
| `explicit_selection_required` | Automatic mode found Radical Red; version declaration required |

`opaque_section_ids` lists checksum domains excluded from verification (Unbound
section 4). A passing report does not verify those domains, the ROM version,
Pokemon legality, or historical consistency of shared auxiliary storage. Reports
are evidence under a profile, not a guarantee that arbitrary save contents are
safe. Existing feature/capability restrictions still apply.

## Verification

`cd frontend && npm run compatibility:regression` generates synthetic fixtures
for both profiles and compares complete reports across all four runtimes. It
covers rotated generations, rollover, ties, half-range ambiguity, checksum and
footer damage, older fallback, wrong/unknown profiles, zero/short files,
truncated auxiliary storage and RTC trailers. It also checks input/profile
immutability, rejected native/browser session preservation (including pending PC
state), and backend route responses. Temporary parity artifacts use each port's
`parity_tmp.sh` lifecycle and are cleaned after execution. The regression is part
of `parity:all`.

Switch UI reference review: Goldleaf `ui/ui_MainApplication.cpp`; Plutonium
`docs/files.html`, `elm_Menu.hpp` and `ui_Dialog.hpp` headers; example `source/Main.cpp`.
The existing MenuItem and detail layout provide the complete navigation; no
custom widget or escalation was needed.

Validation completed for this change: 46 synthetic compatibility cases across
Python/JavaScript/Switch/3DS; backend route smoke and browser Backend/Local
uploads, rejection, same-file retry and fallback; Python compile check;
`parity:all`; frontend lint/build; both native phase 1–4 suites; Switch standard
and lite Docker builds with the SD bundle refreshed and both packaged NRO
hashes matched to their build outputs; 3DS Docker build.
mGBA was unnecessary: this task adds read-only evidence and editing admission,
with unchanged valid-save mutation behavior covered by the existing byte suites.
