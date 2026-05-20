# PUSE - A Pokemon Unbound (online) Save Editor

> Live app: **[https://zannael.github.io/PUSE/](https://zannael.github.io/PUSE/)**

Web-based save editor for Pokemon Unbound (v 2.1.1.1) built with a frontend-first architecture.
The project **now also includes a Nintendo Switch Homebrew version!**
The app supports local in-browser save editing (recommended) and backend mode (FastAPI) with parity-focused behavior.

## Features

- Party editing (species, nickname, IV/EV, moves, PP/PP Ups, nature, item, ability, level)
- PC editing (including insert workflows for writable empty slots)
- Bag editing with quick pocket discovery + search fallback (main, balls, berries, TM case, key items)
- Money editing (safe clamping)
- Identity controls (shiny/gender) with PID-aware safety checks
- RTC metadata recovery tools (pair repair and quick fix)
- Checksum recalculation and save export

## Runtime Modes

- **Local mode (`VITE_RUNTIME_MODE=local`)**: parsing/editing/checksum/export run completely in the browser.
- **Backend mode (`VITE_RUNTIME_MODE=backend`)**: uses FastAPI local endpoints.

## End-User UX (Website)

The live app home page now contains the UX onboarding flow and static workflow previews.
If you want to use PUSE as an end user, start directly from the website:

- **[https://zannael.github.io/PUSE/](https://zannael.github.io/PUSE/)**

Website flow (recommended):

1. Load a `.sav` or `.srm` file.
2. Edit Party / PC / Bag / Money.
3. Download updated save (checksum-safe).

For advanced recovery scenarios, use the RTC metadata tools section from the home page.

## Technical Notes

- Frontend local mode and backend mode are designed to remain behaviorally aligned.
- API contracts are intentionally stable (`nature_id`, `item_id`, `ability_index`, etc.).
- Catalog data is ROM-truth synchronized across backend and frontend local runtime.
- Optional icon systems degrade safely with placeholders when mappings/assets are unavailable.

## Project Structure

- `frontend/` React + Vite UI
- `backend/` FastAPI API and save editing modules
- `backend/data/` static lookup tables (`items.txt`, `pokemon.txt`, `moves.txt`, `tms.txt`)

## Requirements

- Node.js 20+
- Python 3.10+

## Local Run

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Frontend default URL: `http://localhost:5173`

- For **frontend-only mode** (recommended), set in `frontend/.env`:
  - `VITE_RUNTIME_MODE=local`
- For **backend mode**, set in `frontend/.env`:
  - `VITE_RUNTIME_MODE=backend`
  - `VITE_API_BASE_URL=http://localhost:8000`

### Backend (only if using backend mode)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --host ${BACKEND_HOST:-0.0.0.0} --port ${BACKEND_PORT:-8000}
```

## Docker

```bash
docker compose up --build
```

## Switch Homebrew (NRO)

A Nintendo Switch `.nro` port of PUSE is available under `switch-homebrew/`. Build requires Docker and devkitPro — no host C++ toolchain needed.

### Prerequisites

- Docker Desktop (or Docker Engine on Linux)
- The `switch-homebrew/tools/Dockerfile` provides the full devkitPro + Plutonium build environment automatically

### Build

```bash
# Full build: Docker image + compile + SD card bundle
switch-homebrew/scripts/build_docker.sh

# If backend/data changed, sync static data into ROMFS first
switch-homebrew/scripts/sync_romfs_data.sh
```

Output: `switch-homebrew/artifacts/sdmc/switch/puse/` ready to copy to an SD card.

### SD Card Setup

1. Copy `switch-homebrew/artifacts/sdmc/switch/puse/` to the root of your Switch SD card.
2. Place your save file at `sdmc:/switch/puse/Unbound.sav`.
3. Launch `hbmenu`, then open PUSE.

### Controls

| Button | Action |
|--------|--------|
| A | Select / confirm edit |
| B | Back / cancel |
| X | Save changes to SD card |
| + | Exit to hbmenu |

### Capabilities

- Browse and edit all 6 party Pokémon (species, nickname, level, nature, item, ability, IVs, EVs, moves + PP/PP-Up, shiny/gender)
- Browse all 18 PC boxes; edit any stored Pokémon (same fields as party, PP-Up editable)
- Read and write trainer money (up to 999,999,999)
- Save written in-place to `Unbound.sav` on SD card; toast confirmation on success

## Optional Pokemon Sprites

- Pokemon icon sprites are optional and not required to run the app.
- If missing, the backend logs a warning and returns a tiny fallback image, so UI keeps working.
- Source for icon assets:
  - Upstream (original): `https://github.com/Skeli789/Dynamic-Pokemon-Expansion/tree/master/graphics/frontspr`
  - Extended Gen 9 fork: `https://github.com/Shiny-Miner/Dynamic-Pokemon-Expansion-Gen-9/tree/master/graphics/frontspr`
- To enable sprites locally, clone/copy that folder into:
  - `backend/icons/pokemon/`

### Frontend icon delivery (GitHub Pages / local mode)

- In frontend local mode, icons are resolved without backend endpoints:
  - Pokemon icons: pinned commit from `Shiny-Miner/Dynamic-Pokemon-Expansion-Gen-9` (fork of `Skeli789/Dynamic-Pokemon-Expansion`)
  - Item icons: `PokeAPI/sprites`
- Manifests are generated and committed under:
  - `frontend/src/data/pokemon-icon-manifest.json`
  - `frontend/src/data/item-icon-manifest.json`
- To refresh mappings after changing pinned commits or source lists:
  - Run `npm run icons:manifest` inside `frontend/`
  - (Optional CI/local guard) run `npm run icons:check`
- Unmapped IDs gracefully fall back to local placeholders in `frontend/public/icons/`.

## Optional Item Icons

- Item icons are optional and not required to run the app.
- If missing, backend item-icon lookup simply returns no icon and UI keeps working.
- Item icon sources are:
  - `https://github.com/PokeAPI/sprites` (item icons)
  - Leon's ROM Base item icon pack
- Place them like this:
  - Copy the PokeAPI item icon folder contents into `backend/icons/items/Base Items/`
  - Copy Leon's ROM Base item icon folders/files into `backend/icons/items/`
- The backend resolver checks `Base Items/` first (including subfolders), then falls back to the other folders in `backend/icons/items/`.

## Environment Variables

### Backend (`backend/.env`)

- `BACKEND_HOST` default `0.0.0.0`
- `BACKEND_PORT` default `8000`
- `CORS_ORIGINS` comma-separated origins

### Frontend (`frontend/.env`)

- `VITE_API_BASE_URL` backend base URL
- `VITE_RUNTIME_MODE` runtime mode (`backend` or `local`)
- `VITE_BASE_PATH` Vite base path (`/` for local dev, `/<repo>/` for project Pages)

## Deployment (Maintainers)

- Frontend deploy is handled by `.github/workflows/deploy-pages.yml`.
- One-time setup: in GitHub, go to `Settings -> Pages -> Source` and choose **GitHub Actions**.
- On push to `main` (or manual run), the workflow builds `frontend/dist` in local mode, sets `VITE_BASE_PATH=/<repo>/`, and copies `index.html` to `404.html` for SPA fallback.
- Icons in local mode are served from pinned CDN commits via generated manifests, so no backend icon folders are required on GitHub Pages.

## Safety Notes

- Always work on copies of your `.sav` files (even if the code SHOULD never touch you original one).
- Keep personal `.sav`/ROM files under `backend/local_artifacts/` (ignored by git).
- Never share personal saves publicly in issue reports.
- This project is community-maintained and evolving.

## Disclaimer

This project is an unofficial fan-made utility. Use it only with legally obtained game files and your own save data.
