# Starfall Command — Desktop Edition

An original single-player sci-fi RTS with an Electron desktop shell, persistent named operations, and procedurally generated 2.5D battlefield art. This release upgrades the existing skirmish, not StarCraft's campaigns, factions, or complete feature set.

## Play

```sh
npm install
npm start
```

The game opens **fullscreen by default**. macOS uses borderless/simple fullscreen; other desktops use Electron's native fullscreen. **F11** or the fullscreen button switches back to a window. A mouse and keyboard are recommended.

Create a named operation, choose Cadet / Commander / Veteran, and deploy. **Continue** restores the latest unfinished game; **Game library** lists all operations. Loads start paused so you can inspect the battlefield before resuming.

### Local macOS app

```sh
npm run assets       # Regenerate original component PNGs and app icon
npm run package:mac
open "dist/Starfall Command.app"
```

The `.app` contains Electron and all game resources and needs no Node installation to run. It is built for the current Mac's architecture and ad-hoc signed for local use. It is **not notarized for public distribution**. The packager verifies its signature and only replaces an existing known Starfall build, not unrelated applications. Windows/Linux installers are not included or tested.

`index.html` remains a browser fallback: keep it with `src/` and `assets/`. Deployment requests browser fullscreen where permitted; use the fullscreen button if the browser denies it. Add `?windowed=1` to suppress the browser request. Browser saves and desktop saves are separate; use export/import to transfer them.

## Complete game-state saving

- **Named games:** create multiple independent operations, rename them, and continue any of them.
- **F5 / Save:** commit the current operation. **F9 / Game library:** browse operations.
- **Autosave:** every 30 seconds of wall-clock time while a match is running.
- **Save and quit:** the native window stays open until the save finishes. A failed save offers “Keep playing” or explicit “Quit without saving.” Abrupt force-quit/power loss can only recover the latest successfully committed autosave; this is not cloud sync.
- **Save as new game:** create a separately named checkpoint without overwriting the active operation. Delete requires confirmation, and the active operation cannot be deleted until you switch games.
- **Portable saves:** export/import `.starfall.json` files. Import always assigns a new ID and cannot overwrite an existing game. Export reads committed state; save first to include your latest progress.
- **Recovery:** atomic replacement, file/directory sync where supported, SHA-256 integrity checks, strict schema validation, serialized writes, and a last-known-good `.bak` file per operation. Damaged saves stay visible rather than silently disappearing. A valid backup can be loaded and saved to repair the primary.

Saved simulation state includes units, buildings, construction, health, cooldowns, worker cargo and mining progress, production/research queues, upgrades, resources and depletion, orders, paths, rally points, siege modes, RNG state, AI plans/timers, visible and explored fog, vision timing, combat effects, events, match results, and statistics. The view snapshot includes camera/zoom, selected units, control groups, speed, sound preference, build tab, pending command, and fractional simulation time. Pointer position, open dialogs, and OS window mode are not part of a battlefield snapshot. Loading deliberately pauses the match.

On macOS, desktop saves are located at:

```text
~/Library/Application Support/Starfall Command/operations/
  <operation-uuid>.json
  <operation-uuid>.json.bak
```

The app's data directory is stable across local upgrades. Browser fallback uses separate per-operation localStorage records with backup copies; browser quotas/private browsing can prevent saves, in which case the game reports failure.

### Bring a v1 browser save into Electron

Open the updated `index.html` at the same file location/in the same browser where you played v1. An existing `starfall-save-v1` slot is migrated into the browser game library without deleting the original. Export it, then import that JSON through the desktop library. V1 JSON exports are also accepted directly. The app cannot automatically read a different browser's private storage. The v2 regression tests verify exact timing/path continuation; v1 migration necessarily supplies defaults for fields v1 did not save.

## Battlefield features

The existing gameplay remains: mineral/gas harvesting; worker-built structures and repair; prerequisites; reserved supply; production/rally points; global research; terrain-aware navigation; formation movement; attack-move/hold; healing, splash and siege; persistent fog; a minimap; and a resource-constrained computer opponent with three difficulties. Destroy all rival structures to win; losing all your structures ends the match.

Six units: **Drone, Ranger, Lancer, Mender, Bastion, Wraith**.

Eight structures: **Command Spire, Supply Relay, Extractor, Infantry Bay, Foundry, Flight Deck, Research Lab, Sentry**.

The mission seed changes terrain surface detail and the AI's random sequence. The battlefield layout remains Kestrel Basin.

## Visual overhaul

All fourteen unit/structure models now use projected geometry with directional lighting, beveled armor, material gradients, panel seams, bolts, vents, glass, team-colored lights, and soft ground shadows. Units have pose/direction variants, moving drone legs and infantry, tank stabilizers, and aircraft thrusters. Terrain, cliffs, mineral facets, gas vapor, damaged-building smoke, explosions and tracers are generated locally.

See `assets/generated/roster.png` for the full component library and individual transparent PNGs alongside it. `src/art.js` is the model source and uses a bounded sprite cache. This is original, stylized **2.5D**, not photorealism or a full real-time 3D engine. No StarCraft assets or external generation service are used. Visual superiority to StarCraft is an aspiration, not a verified claim.

## Controls

| Input | Action |
|---|---|
| Click / drag | Select / box-select |
| Shift + select / double-click | Add units / select visible units of a class |
| Right-click | Move, attack, gather, repair, or structure rally |
| A → click / M → click | Attack-move / move only |
| B | Selected drone's build palette |
| S / H / X | Stop / hold / toggle Bastion siege |
| Ctrl/Cmd + 1–5 / 1–5 | Store / recall group; double-tap to center |
| F2 / I | Select army / next idle drone |
| Arrows / middle-drag / wheel | Pan / pan / zoom |
| Space | Center selection |
| P / Escape / ? | Pause / cancel command or menu / field manual |
| F5 / F9 / F11 | Save / game library / fullscreen |

## Verify

Requires Node.js 22+ for development. Electron is the only third-party dependency.

```sh
npm run check
npm test
npm run test:browser
npm run test:electron
```

- **29 simulation/persistence tests:** original gameplay coverage plus exact serialized-state equality, identical subsequent simulation, legacy migration, named-game isolation, concurrent writes, backup recovery, disk failure, portable import/export, and path validation.
- **Chrome smoke test:** real mouse/keyboard interactions, generated rendering, named saves, exact restoration, live production, error handling, light/dark theme, and a true 390px viewport.
- **Native Electron smoke test:** actual display-filling window, UTF-8, renderer isolation, restricted protocol/IPC, single-instance save ownership, real save-on-quit/process exit/relaunch, exact state restore, multiple games, 30-second autosave, rename escaping, checkpoint creation/deletion, and corrupt-primary recovery.

Tests use temporary profiles and never access your real operation directory. They clean up their profiles and screenshots unless `SCREENSHOT_DIR` is supplied. Set `CHROME_PATH` for a nonstandard Chrome install. To run the native test against the packaged app:

```sh
STARFALL_EXECUTABLE="$PWD/dist/Starfall Command.app/Contents/MacOS/Electron" npm run test:electron
```

Native file-picker interaction and audio quality are not automated; portable save contents are tested at the storage layer. Only macOS and installed Chrome were exercised here.

## Structure

- `index.html`, `src/styles.css`, `src/desktop.css` — shell and responsive interface.
- `src/simulation.js` — DOM-independent deterministic simulation, shared with native validation/tests.
- `src/art.js` — original models, terrain, effects, bounded rendering cache.
- `src/app.js` — game controls and presentation.
- `src/operations.js`, `src/save-client.js`, `src/save-format.js` — library UI, browser/native adapter, portable schema and integrity checks.
- `electron/main.cjs`, `electron/preload.cjs`, `electron/save-store.cjs` — sandboxed desktop shell, narrow IPC bridge, atomic filesystem storage.
- `scripts/` — source checks, reproducible component generation and local macOS packaging.
- `tests/` — game, persistence, browser and native-process verification.

The desktop renderer has Node integration disabled, context isolation and sandboxing enabled, a strict local-script CSP, no arbitrary IPC bridge, blocked external navigation/new windows, and access only to the local game asset protocol. Save filenames are validated UUIDs, not renderer-controlled paths. A single-instance lock prevents two desktop processes from competing for the same save files.
