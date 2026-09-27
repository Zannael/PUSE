# Focused roster export v1

The browser's **All Pokémon** view downloads `puse-roster-v1.json` or `puse-roster-v1.md`. Both represent every occupied Party slot plus only the PC slots explicitly selected in that view. **Select filtered PC** adds every matching PC row, including rows beyond the current 100-row page; **Clear PC** removes all PC selections. Changing filters does not discard selections. Empty and locked slots are never exported. Export reads the current in-memory save and does not write save bytes.

The JSON object has `format: "puse.roster"`, `version: 1`, `game: "Pokemon Unbound 2.1.1.1"`, and an ordered `pokemon` array. Each Pokémon has:

- `location`: `{source: "party", index}` with a zero-based index, or `{source: "pc", box, slot}` with one-based box and slot numbers (Preset uses box 26).
- `species: {id, name}`, `nickname`, `level`, `nature: {id, name}`, `shiny`, and `gender`.
- `ability: {id, name, slot}` where slot 0/1 is a standard ability and 2 is hidden, and `held_item: {id, name}`.
- `ivs` and `evs` keyed by `HP`, `Atk`, `Def`, `SpA`, `SpD`, and `Spe`.
- `moves`: occupied move slots in game order, each with `id`, `name`, `pp`, `pp_ups`, and `pp_max`.

Names use the loaded catalogs when available and fall back to numeric IDs. Markdown is a readable projection of this same JSON model. This is a roster report, not a lossless Pokémon interchange format: it omits ownership, PID, raw bytes, and other save fields. Importing it is unsupported. The planned portable Pokémon format is a separate task.

The Python reference is `backend/modules/roster_export.py`; the browser projection is `frontend/src/services/rosterExport.js`. The browser invokes the same projection for backend and local modes after their existing roster readers return. Switch and 3DS do not have an aggregate roster selector or report download, and their PC readers currently cover stream boxes 1–18. Native roster export remains a documented coverage gap; no native save parser or mutation behavior changed in this task.
