# PUSE 3DS

Save editor for **Pokemon Unbound v2.1.1.1** on Nintendo 3DS.  
Mirrors the Switch homebrew port. Built with libstarlight + citro3d.

---

## Requirements

- Nintendo 3DS (any model) with **Luma3DS** custom firmware
- **Homebrew Launcher** (for `.3dsx`) or **FBI** (for `.cia`)
- Your Pokemon Unbound save file (`Unbound.sav`)

---

## Install

### Option A — `.3dsx` via Homebrew Launcher

1. Copy `puse-3ds.3dsx` to `sdmc:/3ds/puse-3ds/puse-3ds.3dsx`
2. Copy your save to `sdmc:/3ds/puse/Unbound.sav`
3. Launch via Homebrew Launcher

### Option B — `.cia` via FBI

1. Copy `puse-3ds.cia` to your SD card
2. Open FBI → SD → install the `.cia`
3. Copy your save to `sdmc:/3ds/puse/Unbound.sav`
4. Launch from the Home Menu

---

## Save file location

```
sdmc:/3ds/puse/Unbound.sav
```

The editor reads from and writes to this path. A `.bak` backup is created before every save.

---

## Controls

| Button | Action |
|--------|--------|
| A | Select / confirm |
| B | Back |
| L | PC boxes |
| R | Bag |
| Select | Money & BP |
| Y | Toggle legit mode (510 EV cap) |
| X | Save (with backup) |
| Start | Exit |

---

## Optional: Pokemon icons

Place 48×48 PNG icons at `sdmc:/3ds/puse/icons/pokemon/{id:04d}.png`.  
Missing icons are silently skipped — the editor works without them.

---

## Build from source

Requires Docker.

```bash
# Build .3dsx
3ds-homebrew/scripts/build_docker.sh

# Build .cia (requires Docker image with makerom/bannertool)
docker build -t puse-3ds-dev -f 3ds-homebrew/tools/Dockerfile 3ds-homebrew/tools/
3ds-homebrew/scripts/build_cia.sh
```

---

## Notes

- **Legit mode** persisted at `sdmc:/3ds/puse/legit_mode` (file presence = enabled)
- Auto-saves on suspend (lid close / Home button) when unsaved changes exist
- Low battery indicator shown in header when charge ≤ 20%
