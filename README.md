# PUSE - A Pokemon Unbound (offline) Save Editor

Web-based save editor for Pokemon Unbound (v 2.1.1.1.) with a React frontend and a FastAPI backend.

## Features

- Party editing (IV/EV/moves/ability/nature/item)
- PC editing
- Bag editing with pocket discovery (main, balls, berries, TM case)
- Money editing
- Save checksum recalculation and save export

## UI Walkthrough

### 1) Party and PC Overview

Team section with quick access to your current party Pokemon.

![Team section](backend/readme_images/team_section.png)

PC box section for browsing and editing boxed Pokemon.

![PC box section](backend/readme_images/box_section.png)

### 2) Pokemon Editing Flow

Edit IVs and EVs with per-stat controls.

![Pokemon edit stats](backend/readme_images/pokemon_edit_stats.png)

Edit moves and ability slot selection.

![Pokemon edit moves](backend/readme_images/pokemon_edit_moves.png)

Edit nature and held item in the same modal flow.

![Pokemon edit nature and item](backend/readme_images/pokemon_edit_nature_item.png)

### 3) Bag Editing Flow

Start from the bag section with quick pocket detection.

![Bag section with pockets](backend/readme_images/bag_section_with_pockets.png)

Open a detected pocket and inspect full item contents.

![Main item pocket view](backend/readme_images/main_item_pocket_view.png)

Edit a slot to change quantity or item ID, then apply changes.

![Edit item slot](backend/readme_images/edit_item_slot.png)

## Project Structure

- `frontend/` React + Vite UI
- `backend/` FastAPI API and save editing modules
- `backend/data/` static lookup tables (`items.txt`, `pokemon.txt`, `moves.txt`, `tms.txt`)

## Requirements

- Node.js 20+
- Python 3.10+

## Local Run

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --host ${BACKEND_HOST:-0.0.0.0} --port ${BACKEND_PORT:-8000}
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Frontend default URL: `http://localhost:5173`

## Docker

```bash
docker compose up --build
```

## Optional Pokemon Sprites

- Pokemon icon sprites are optional and not required to run the app.
- If missing, the backend logs a warning and returns a tiny fallback image, so UI keeps working.
- Source for icon assets:
  - `https://github.com/Skeli789/Dynamic-Pokemon-Expansion/tree/master/graphics/pokeicon`
- To enable sprites locally, clone/copy that folder into:
  - `backend/icons/pokemon/`

## Optional Item Icons

- Item icons are optional and not required to run the app.
- If missing, backend item-icon lookup simply returns no icon and UI keeps working.
- Item icon pack sources are `https://github.com/PokeAPI/sprites` and Leon's ROM Base.
- To enable item icons locally, place the pack under:
  - `backend/icons/items/`

## Environment Variables

### Backend (`backend/.env`)

- `BACKEND_HOST` default `0.0.0.0`
- `BACKEND_PORT` default `8000`
- `CORS_ORIGINS` comma-separated origins

### Frontend (`frontend/.env`)

- `VITE_API_BASE_URL` backend base URL

## Safety Notes

- Always work on copies of your `.sav` files.
- Keep personal `.sav`/ROM files under `backend/local_artifacts/` (ignored by git).
- Never share personal saves publicly in issue reports.
- This project is community-maintained and evolving.

## Disclaimer

This project is an unofficial fan-made utility. Use it only with legally obtained game files and your own save data.
