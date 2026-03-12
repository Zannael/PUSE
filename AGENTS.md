# AGENTS.md

Guidance for coding agents working in this repository.
Scope: entire repo (`/home/zappaganini/PycharmProjects/pokemon`).

## 1) Repo Overview

- This repository contains:
- A React + Vite frontend in `frontend/`.
- A Python backend toolkit in `backend/` (FastAPI + modules).
- No monorepo task runner; use npm for frontend and Python commands directly for backend.

## 2) Build / Lint / Test Commands

### Frontend (run from `frontend/`)

- Install deps: `npm install`
- Dev server: `npm run dev`
- Production build: `npm run build`
- Preview built app: `npm run preview`
- Lint all frontend code: `npm run lint`
- Lint a single file: `npx eslint src/App.jsx`

### Backend (run from `backend/`)

- Start API (development): `uvicorn main:app --reload --host 0.0.0.0 --port 8000`
- Run money tool (read): `python -m modules.money <save.sav> --read`
- Run money tool (patch): `python -m modules.money <save.sav> --set 999999 --out out.sav`

### Tests status (important)

- There is currently **no configured project test runner** in `package.json`.
- There are **no repository tests** under `src/` or `pokemon/` (ignore tests inside `node_modules/` or `.venv/`).
- Because of this, "run a single test" is currently **not available** without adding a test framework.

### If/when tests are added (recommended patterns)

- Frontend (Vitest example, single test file):
- `npx vitest run src/components/PokemonCard.test.jsx`
- Frontend (single test name):
- `npx vitest run -t "renders pokemon level"`
- Backend (pytest example, single test file):
- `pytest tests/test_main.py`
- Backend (single test function):
- `pytest tests/test_main.py::test_get_party`

## 3) Environment and Runtime Notes

- Frontend expects `VITE_API_BASE_URL` (used via `import.meta.env.VITE_API_BASE_URL`).
- API CORS currently allows localhost/LAN dev hosts in `pokemon/main.py`.
- Backend writes/modifies `.sav` data; preserve file safety and checksum behavior.

## 4) Code Style and Conventions

### General

- Match existing style in the file you edit; avoid whole-file reformatting.
- Keep changes focused and minimal; do not refactor unrelated code.
- Prefer descriptive names over abbreviations unless already established.
- Avoid introducing new dependencies unless required.

### JavaScript / React (frontend)

- Module format: ESM only (`"type": "module"` in `package.json`).
- Indentation/spacing: follow local file style (current code is mixed; preserve nearby style).
- Semicolons/quotes: preserve existing conventions in touched file (do not normalize globally).
- Components: use functional components and React hooks.
- Export style:
- Use `export default` for primary component files.
- Use named exports only when file already follows that pattern.
- Imports ordering (preferred):
- React/core libs first.
- Third-party packages second.
- Local modules/assets last.
- Group imports with one blank line between groups when practical.
- Naming:
- Components: `PascalCase` (`PartyGrid`, `PokemonEditorModal`).
- Variables/functions: `camelCase`.
- Constants: `UPPER_SNAKE_CASE` for true constants.
- Event handlers: `handleX` naming.
- Hooks:
- Keep `useEffect` dependencies accurate.
- Avoid creating effects that can loop due to unstable dependencies.
- State updates:
- Prefer functional updates when derived from previous value (`setX(prev => ...)`).
- Validate user input before dispatching requests.

### Python (backend/scripts)

- Target Python style close to PEP 8, while preserving existing module patterns.
- Naming:
- Functions/variables: `snake_case`.
- Classes: `PascalCase`.
- Constants: `UPPER_SNAKE_CASE`.
- Keep endpoint models explicit via Pydantic `BaseModel` where request bodies are structured.
- Prefer small helper functions for binary parsing/checksum logic rather than deeply nested blocks.
- Avoid broad `except:`; catch `Exception as e` and surface meaningful HTTP errors.

## 5) Error Handling Guidelines

### Frontend

- Wrap async network calls in `try/catch`.
- Check `res.ok` before assuming JSON/data success.
- Show user-facing feedback for failure states (current UX uses alerts; keep consistent unless refactoring UI messaging intentionally).
- Log actionable debug details to console when useful.

### Backend

- Validate prerequisites early (e.g., uploaded save exists).
- Use `HTTPException` with accurate status codes:
- `400` for bad state/input.
- `404` for missing entities/resources.
- `500` for unexpected processing failures.
- Preserve checksum recalculation/write flows when mutating save data.

## 6) Formatting, Types, and Data Contracts

- Frontend is JavaScript (not TypeScript); keep JSDoc/types lightweight unless project migrates.
- Treat API payload keys as stable contracts (`nature_id`, `item_id`, `ability_index`, etc.).
- Keep numeric parsing explicit (`parseInt(..., 10)` preferred for new code).
- Do not silently change backend field names; update frontend/backend together if contract changes.

## 7) File and Import Hygiene

- Prefer relative imports consistent with surrounding code.
- Do not import from deep internal paths of dependencies.
- Remove unused imports/variables to satisfy ESLint (`no-unused-vars` is enabled).
- Build output (`dist/`) is ignored by lint rules; do not edit generated files.

## 8) Agent Working Rules for This Repo

- Before finalizing changes, run at least:
- `npm run lint`
- `npm run build`
- If backend code changes, also run a quick API smoke check (start uvicorn and hit one endpoint).
- Do not touch `node_modules/` or `.venv/` contents.
- Prefer editing source under `src/` and `pokemon/` only.

## 9) Cursor/Copilot Rules Check

- Checked for `.cursorrules`: **not found**.
- Checked for `.cursor/rules/`: **not found**.
- Checked for `.github/copilot-instructions.md`: **not found**.
- If these files are added later, treat them as higher-priority agent instructions and merge them into this guide.

## 10) Suggested Future Improvements (non-blocking)

- Add a formal test setup (Vitest + Testing Library for frontend, pytest for backend).
- Add unified Python dependency metadata (`requirements.txt` or `pyproject.toml`).
- Add formatter configuration (Prettier and/or Ruff/Black) to reduce mixed style drift.
