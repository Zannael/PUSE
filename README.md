# PUSE - Pokémon Unbound Save Editor

**[Open the web editor](https://zannael.github.io/PUSE/)** · **[Releases](https://github.com/Zannael/PUSE/releases)** · **[Changelog](CHANGELOG.md)**

PUSE edits Pokémon Unbound saves in your browser, through a local FastAPI backend, or on Nintendo Switch and Nintendo 3DS. It also includes experimental support for the verified English Radical Red 4.1 version.

The browser's **Local mode** runs save parsing, editing, checksum updates and export on your device. No local server is required. Optional icons may load from external sources.

> **Nintendo 3DS beta:** the port includes the shared save-logic improvements and passes host parity checks and target builds, but it still needs thorough testing on real hardware. Controller/touch navigation, SD-card writes, backups and suspend/resume behavior need independent device validation before the port can be considered stable.

## Start here

1. Keep a backup of your original in-game `.sav` or `.srm` file. Emulator save states are different files and are not supported.
2. [Open PUSE](https://zannael.github.io/PUSE/) and select **Local mode**.
3. Select the game/version and load a copy of your save. Radical Red requires explicit **4.1** selection.
4. Edit the supported Party, PC, Bag or resource fields, then review and download the updated save.
5. Load the edited copy in your game and verify the result before replacing your backup.

For homebrew, use the [Switch](#nintendo-switch-homebrew) or [3DS](#nintendo-3ds-homebrew-beta) instructions below. The native apps write to the selected save on the SD card, so keep a separate original copy.

## Supported games and features

| Game | Supported version | PC storage | Coverage |
|---|---|---|---|
| Pokémon Unbound | English 2.1.1.1 | 24 ordinary boxes; separate Preset region | Main supported game. Preset editing is available in the web editor; native ports preserve it. |
| Pokémon Radical Red | English 4.1, verified ROM revision | 25 ordinary boxes | Experimental coverage for existing Pokémon edits, PC release, five bag pockets, trainer identity reading and money. |

Shared Pokémon editing includes species, nickname, Original Trainer name, level/EXP, IVs/EVs, nature, held item, moves, PP/PP Ups where stored, happiness, shiny/gender identity and native ability-slot selection. Supported operations update the relevant checksums; PID-aware identity edits preserve the applicable nature and ability-slot constraints.

Unbound also provides PC insertion, Money + Battle Points editing and native-assisted RTC recovery. The web editor includes caught-ball editing, Pokédex Seen/Caught controls, an All Pokémon view, focused roster export and save-health/change review. Some native features are core-only or have no corresponding UI; the detailed matrix is in [GAME_PROFILES.md](GAME_PROFILES.md).

**Radical Red limits:** new Pokémon construction, caught-ball editing, BP, RTC recovery, Pokédex/progress flags and aggregate roster export are unavailable. Effective ability overrides and difficulty/randomizer-specific battle rules are not fully modeled; ability controls identify native slots rather than predicting every in-game override. Unbound-only icons are not reused for Radical Red IDs.

A familiar save signature does not prove the ROM version or establish support for another CFRU hack. See the [profile documentation](GAME_PROFILES.md) and [CFRU implementation plan](romre/CFRU_IMPLEMENTATION_PLAN.md) for verified ROM hashes, evidence and coverage limits.

## Nintendo Switch homebrew

The Switch port uses Plutonium + libnx and supports Party, PC, bag and supported resource edits, PC release and Unbound RTC recovery. PC navigation covers all **24 Unbound ordinary boxes** or **25 Radical Red boxes**. Homebrew Preset editing remains unavailable.

### Install and use

1. Use a packaged SD bundle from the relevant [release](https://github.com/Zannael/PUSE/releases), or build one below.
2. Copy the bundle's `switch/puse/` folder to `/switch/puse/` on your SD card.
3. Put a copy of your save on the SD card, for example `sdmc:/switch/puse/Unbound.sav` or `radicalred.sav`.
4. Launch PUSE through hbmenu and select the save using its file browser. Confirm the exact version when loading Radical Red.

| Button | Action |
|---|---|
| A | Select / confirm edit |
| B | Back / cancel |
| X | Save changes to the selected SD-card save |
| + | Exit to hbmenu |

### Build

Docker provides the devkitPro + Plutonium environment; no host C++ toolchain is needed for the NRO build.

```bash
# From the repository root: synchronize canonical data before building.
switch-homebrew/scripts/sync_romfs_data.sh
switch-homebrew/scripts/build_docker.sh

# Optional smaller variant with data-only ROMFS and no embedded icons.
switch-homebrew/scripts/build_docker_lite.sh

# Refresh the bundle after building the lite variant.
switch-homebrew/scripts/prepare_sd_bundle.sh
```

Outputs: `switch-homebrew/puse-switch.nro`, optional `puse-switch-lite.nro`, and the SD bundle under `switch-homebrew/artifacts/sdmc/`.

## Nintendo 3DS homebrew (beta)

**The 3DS port is still a beta and needs thorough real-hardware testing.** Its current core includes the same storage/checksum repairs, profile selection, ordinary PC coverage and applicable editing improvements as the other runtimes. Successful portable-core tests and `.3dsx` builds do not establish on-device reliability.

### Install and use

1. Build the `.3dsx` below or use an available beta binary from the relevant release.
2. Copy it to `sdmc:/3ds/puse-3ds/puse-3ds.3dsx` and launch through Homebrew Launcher.
3. Put a copy of your save at `sdmc:/3ds/puse/Unbound.sav` or `sdmc:/3ds/puse/radicalred.sav`.
4. Choose **Unbound 2.1.1.1** or **Radical Red 4.1** at startup. The app also searches selected common save directories.

| Button | Action |
|---|---|
| A | Select / confirm |
| B | Back |
| L | PC boxes |
| R | Bag |
| Select | Money / supported resources |
| Y | Toggle Legit Mode (510 total EV cap) |
| X | Save; a `.bak` copy is created |
| Start | Exit |

### Build

Docker builds the devkitARM + libstarlight environment when needed.

```bash
# From the repository root.
3ds-homebrew/scripts/sync_romfs_data.sh
3ds-homebrew/scripts/build_docker.sh
```

Output: `3ds-homebrew/puse-3ds.3dsx`.

Optional CIA packaging, after the Docker image/tooling and 3DS build are available:

```bash
3ds-homebrew/scripts/build_cia.sh
```

Output: `3ds-homebrew/puse-3ds.cia`, installable through FBI. CIA packaging is a separate step from `.3dsx` build validation.

More port-specific development notes are in [3ds-homebrew/README.md](3ds-homebrew/README.md).

## Unbound RTC recovery

The recommended recovery action re-enables Unbound's one-use **Frozen Heights Time Fixer** after validating the save. Correct the device/emulator clock first, run the recovery on a copy, visit the in-game NPC, save in-game and restart. The broad manifest-based repair options remain advanced fallbacks.

In the web editor, RTC tools are on the load screen. Switch has an RTC Recovery menu; on 3DS, open **Select → Money → RTC Recovery**. These operations are unavailable for Radical Red.

The native-assisted recovery method was discovered, reproduced and documented by [@caesarium25](https://github.com/caesarium25) in [Pokémon Unbound NPC Time Fixer Reset](https://github.com/caesarium25/pokemon-unbound-npc-time-fixer-reset), then contributed through [issue #22](https://github.com/Zannael/PUSE/issues/22). His finding identified the section-4 Time Fixer-used flag that made this recovery path possible.

## Run locally

The web editor has two runtime modes: **Local** executes the save logic in the browser; **Backend** uses local FastAPI endpoints. Both use the same client contract and are checked for equivalent save mutations.

Requirements: Node.js 20+ for the frontend; Python 3.10+ only for backend mode. Docker Compose is an alternative for running the full stack.

### Frontend

```bash
cd frontend
npm ci
cp .env.example .env
```

Set `VITE_RUNTIME_MODE=local` in `frontend/.env` for browser-only editing, then run:

```bash
npm run dev
```

Open `http://localhost:5173`.

For backend mode, set `VITE_RUNTIME_MODE=backend` and `VITE_API_BASE_URL=http://localhost:8000`, and start the backend separately:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Docker Compose

From the repository root:

```bash
docker compose up --build
```

The frontend is available at `http://localhost:5173` and the backend at `http://localhost:8000`. Select Backend mode to use FastAPI.

### Environment variables

| File | Key | Purpose |
|---|---|---|
| `frontend/.env` | `VITE_RUNTIME_MODE` | `local` or `backend`; persisted browser selection takes precedence |
| `frontend/.env` | `VITE_API_BASE_URL` | Backend URL |
| `frontend/.env` | `VITE_BASE_PATH` | `/` for local development; `/<repo>/` for project Pages |
| `backend/.env` | `BACKEND_HOST`, `BACKEND_PORT` | Server settings; pass corresponding arguments when launching uvicorn directly |
| `backend/.env` | `CORS_ORIGINS` | Comma-separated allowed origins |

## Optional icons

Icons are optional; missing assets use placeholders or are omitted. Radical Red currently avoids Unbound-only icon mappings.

- **Browser Local mode:** generated manifests resolve Unbound Pokémon and item icons from pinned external sources. No backend icon folders are needed. Manifests live in `frontend/src/data/`; run `npm run icons:check` in `frontend/` to verify them, or `npm run icons:manifest` when intentionally regenerating mappings.
- **Backend:** Pokémon assets belong in `backend/icons/pokemon/`. PokeAPI item files belong in `backend/icons/items/Base Items/`; additional item packs may use `backend/icons/items/`. The resolver checks `Base Items/` first.
- **Switch:** standard builds can include ROMFS icons. Optional SD assets use `sdmc:/switch/puse/icons/pokemon/` and `sdmc:/switch/puse/icons/items/`; the lite build omits embedded icons.
- **3DS:** optional 48×48 Pokémon PNGs use `sdmc:/3ds/puse/icons/pokemon/{id:04d}.png`.

Asset references: [original DPE front sprites](https://github.com/Skeli789/Dynamic-Pokemon-Expansion/tree/master/graphics/frontspr), [extended Gen 9 DPE front sprites](https://github.com/Shiny-Miner/Dynamic-Pokemon-Expansion-Gen-9/tree/master/graphics/frontspr), [PokeAPI sprites](https://github.com/PokeAPI/sprites), and Leon's ROM Base item icon pack. Native-ID/form mappings must match the selected game.

## Development and project layout

| Path | Purpose |
|---|---|
| `frontend/` | React/Vite UI and independent browser save core |
| `backend/` | FastAPI API and canonical Python save behavior |
| `backend/data/` | Canonical profiles and ROM-derived catalogs |
| `switch-homebrew/` | Switch application, portable C++ core and ROMFS assets |
| `3ds-homebrew/` | 3DS application, portable C++ core and ROMFS assets |
| `romre/` | ROM research/extraction workspace and CFRU implementation plan |

Read [CONTRIBUTING.md](CONTRIBUTING.md), [RULES.md](RULES.md) and [GAME_PROFILES.md](GAME_PROFILES.md) before changing shared save behavior. Python is the canonical reference; applicable readers, writers, validation and checksum rules must be ported to all four runtimes.

Common checks:

```bash
python3 -m py_compile backend/main.py backend/core/*.py backend/modules/*.py
cd frontend && npm run lint && npm run build && npm run parity:all
```

Run native phase 1–4 parity checks from each homebrew directory. Version-specific Radical Red and optional real-ROM validation commands are documented in the [CFRU plan](romre/CFRU_IMPLEMENTATION_PLAN.md).

Personal saves, ROMs and research dumps belong in ignored `backend/local_artifacts/` or native `artifacts/` directories. Do not commit them. Bug reports should include the game/version, platform, reproduction steps and the operation attempted; share personal saves privately if needed.

### GitHub Pages deployment

The [deployment workflow](.github/workflows/deploy-pages.yml) runs on pushes to **`master`** or manual dispatch. It builds the frontend in Local mode with `VITE_BASE_PATH=/${repo}/` and copies `index.html` to `404.html` for SPA fallback. In GitHub Pages settings, choose **GitHub Actions** as the source.

## Disclaimer

PUSE is an unofficial fan-made utility. Use your own save data and legally obtained game files. Keep an original backup, especially when testing experimental game support or the 3DS beta.
