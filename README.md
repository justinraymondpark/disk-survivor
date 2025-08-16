## Disk Survivor

Arcade “survivor”-style browser game built with Three.js and Vite. Move a heroic floppy disk, pick a web-1.0 theme, collect weapons/upgrades, and survive ever-growing waves.

Play online: [garfieldslament.com](https://garfieldslament.com/)

### Quick start

- **Prereqs**: Node 18+ (or 20+) and npm
- **Install**:
  ```bash
  npm install
  ```
- **Dev** (Vite):
  ```bash
  npm run dev
  ```
- **Build**:
  ```bash
  npm run build
  ```
- **Preview build**:
  ```bash
  npm run preview
  ```

### Controls

- **Move**: WASD or Arrow keys; Gamepad left stick
- **Aim/Shoot**: Mouse aim + button, or Gamepad right stick (auto-fires while aiming)
- **Pause**: P / Esc / Gamepad Start (adjust master/music/SFX volumes)
- **Menus**: D-pad/left stick to navigate; Enter/A to confirm
- **Mobile**: Dual virtual sticks (left move, right aim). A small “Pause” button appears bottom-left when touch was used recently. Touch, keyboard/mouse, and controller can be used interchangeably.

### Gameplay loop

- Walk onto a billboard tile to choose a theme (Geocities, Yahoo, Dial-up). The choice sets the ground art, spawns obstacles, and starts theme music.
- Auto-spawns escalate over time; periodic “giant” elites appear.
- Defeat enemies to drop XP and occasional pickups (Heal, XP bundle, Vacuum).
- Level up to pick 1 of 3 randomized choices: new weapons, weapon level-ups, or upgrades.

### Game reference: systems and content (overview)

#### Weapons (roster + key behavior)

- CRT Beam: piercing forward sweep that pulses on/off
- Dot Matrix: fires weaker side bullets while shooting
- Dial-up Burst: periodic shockwave ring around the player
- SCSI Rocket: homing rocket with AoE on impact
- Tape Whirl: orbiting saws that knock back on contact
- Magic Lasso: draw a loop; enemies inside take damage
- Shield Wall: short blocking wall with uptime cycles
- Paint.exe: leaves damaging paint swaths; enemies turn green when painted
- Defrag Spiral: emits spiral bursts of colorful blocks; movement-gated with ~1s grace; occasional surge bursts scale with level
- Zip Bomb: sticky charge that explodes into fragments; on enemy hit spawns 3 shards at impact; shorter travel before exploding
- Pop-up Storm: rising pop-up windows spawn 7–15 units out; deal touch damage; white hit flash; +2 count per level and faster cadence

Removed: Cursor Beam, Antivirus Sweep

#### Upgrades

- Turbo CPU (fire rate), SCSI Splitter (multishot), Overclocked Bus (move speed), Copper Heatsink (projectile damage), ECC Memory (max HP + heal), DMA Burst (burst fire), Magnet Coil (XP magnet radius), Piercing ISA (projectile pierce), XP Amplifier (XP gain)

#### Enemies (high level)

- Core: slime, runner, zigzag, tank, shooter, giant
- Advanced waves: spinner, splitter (splits into two runners on low HP), bomber (proximity explode), sniper, weaver, charger (windup dash), orbiter, teleport, brute
- Special behaviors: wave 10 “Boo” slows when watched; rare elites pursue aggressively; giants can briefly enrage after rapid hits

#### XP and pickups

- XP orbs and bundles drop with wave-scaled replacement odds (higher tiers later)
- Pickups: Vacuum (global XP pull ~3s), Heal (“chicken”), extra XP bundles
- Drop rates: heal ≈ 2× vacuum rate; XP otherwise

#### Spawning and culling

- Spawns are forced offscreen via camera projection checks; cadence ramps with subtle sine modulation and rare micro-bursts
- Enemies older than one wave and offscreen are culled after a grace window

#### Debugging and perf

- Pause overlay shows live counts; damage toasts can be enabled in Debug Mode
- Pooled/pooled-like resources for transient meshes; explicit disposal on removal

### Tech stack

- **Rendering**: Three.js with an orthographic, isometric camera
- **Build**: Vite + TypeScript
- **Audio**: Web Audio API for SFX, HTMLAudioElement for looping music
- **Backend**: Netlify Functions + Netlify Blobs for leaderboard

### Project structure

- `index.html`: App entry
- `src/main.ts`: Boots the game (`runGame`)
- `src/game.ts`: Core game loop, systems, UI overlays
- `src/audio.ts`: SFX/music manager with saved volume preferences
- `src/style.css`: Minimal UI/overlay styles
- `netlify/functions/leaderboard-submit.ts`: POST submit score/time
- `netlify/functions/leaderboard-top.ts`: GET top entries
- `public/` (recommended): static assets (e.g., `public/music/*`, `public/title.png`)

### Assets

- Music files expected at `music/<theme>.mp3|ogg`. With Vite, put them in `public/music/` so they are served at `/music/...`.
- Title image referenced as `title.png` (optional; a styled text fallback is shown if missing). With Vite, place at `public/title.png`.

### Leaderboard (Netlify)

- The game posts to `/.netlify/functions/leaderboard-submit` and fetches from `/.netlify/functions/leaderboard-top`.
- On Netlify, functions use a Blobs bucket `leaderboard/entries.json` and sort by time survived, then score.
- Local dev options:
  - Easiest: ignore errors (calls are try/catch’d) and play without a leaderboard.
  - Full: install the Netlify CLI and run `netlify dev` so `/.netlify/functions/*` are available during Vite dev. Configure `NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN` if you want to target a specific site/bucket.

### Scripts

- `npm run dev`: Start Vite dev server
- `npm run build`: Type-check and build for production
- `npm run preview`: Preview the production build

### Notes

- The game uses an orthographic, isometric camera mounted on an `isoPivot`, with the player rotated to face the aim vector.
- Gamepad is supported for movement, aiming, pause, and overlay navigation.
- SFX volumes and music preferences persist in `localStorage`.
- Mobile touch controls are enabled only during gameplay, not on overlays; touch and controller inputs are merged so either can drive movement/aim at any time.

### Maintainer tips (for future sessions)

- Keep `README.md`, `DEV_NOTES.md`, and `CHANGELOG.md` updated with each change; commits should be frequent and descriptive.
- When adding UI overlays, avoid duplicate ids; prefer classes (e.g., `.overlay`) and hold element references in code.
- For production: prefer bundling static text (like `CHANGELOG.md`) via Vite `?raw` imports to avoid platform routing/404s.
- Input system: `InputManager` merges gamepad and touch/mouse per-axis; don’t hard-disable one when another is present.
- Styling: we’re iterating toward a Netscape-era UI. Favor chunky gradients, subtle dithering, and smaller corner radii (4px). Keep text dark on light cards.
- Mobile: responsive CSS stacks overlay cards on narrow/tall screens; title button row uses `.title-buttons` and stacks in portrait.

### Debug mode

- Available from the 3D Title menu as a button: Debug Mode (the 3D menu is now the default; formerly called Alt Title).
- Lets you toggle any weapon or upgrade and set desired levels before starting a run.
- Enforces the same caps as gameplay: max 5 weapons and 5 upgrades.
- Use B on a controller or the Back button to return to the 3D Title menu.

### Fonts

- All UI fonts use self-hosted `W95FA` via `@font-face` (see `src/style.css`). Place `W95FA.woff2` (preferred) and optionally `W95FA.otf` in `public/fonts/`.

### Shell notes

- PowerShell here doesn’t support the `&&` separator. Run commands separately instead of chaining.

### Controller notes

- On debug and pause overlays, A activates the focused control; use d-pad/left stick to navigate.
- If focus seems lost, press d-pad once to re-sync selection.

### Maintainer quick-brief (what a future chat should know)

- Core files: `src/game.ts` (loop, systems, UI), `src/audio.ts` (SFX/music), `src/style.css` (UI), Netlify Functions in `netlify/functions/*`.
- Spawning/offscreen:
  - Enemies spawn strictly offscreen using `pickOffscreenSpawn(minMargin,maxMargin)` which projects candidate points against the camera and rejects anything visible.
  - Spawn cadence is a mostly steady stream with subtle variation: baseline interval ramps with time, gently modulated by a sine, plus rare micro-bursts that add a few staggered spawns.
- Anti-clump behavior:
  - Each enemy occasionally runs a hesitation cycle: decelerate (ease-out) → brief pause (with slight direction jitter) → accelerate (ease-in). State is stored on `Enemy` as `hesitateState/Timer/Dur/nextHesitateAt/speedScale`.
- Input:
  - `InputManager` merges keyboard, mouse, gamepad, and touch per-axis; touch/gamepad can be used simultaneously. Touch controls are enabled only during gameplay; a small `Pause` button appears when touch was used recently.
- HUD/UI:
  - Time HUD updates each second (4 digits). Hit counter flips its label periodically. Level is shown at the XP bar. Overlays use the `.overlay` class; cards are styled with a Netscape-inspired look.
- XP/vacuum:
  - XP magnet upgrade increases pull radius. Vacuum pickup pulls XP/bundles for ~3s. Magnet continues ~0.5s into level-up with easing.
- Weapons/enemies:
  - Weapons: CRT Beam, Dot Matrix, Dial-up Burst, SCSI Rocket, Tape Whirl, Magic Lasso, Shield Wall. New enemy types include spinner, splitter, bomber, sniper, weaver; shooters strafe at a preferred distance.
- Audio:
  - Louder SFX, softer music by default; impact SFX is throttled. Player death plays a synth "death moan" and triggers a maroon flash before the Game Over UI fades in.
- Debugging/perf:
  - Pause overlay shows live counts: enemies, projectiles, XP orbs, pickups. Consider adding a “near” enemies metric (within N units) to compare total vs. on-screen density.
- Changelog:
  - `CHANGELOG.md` is bundled via Vite `?raw` and shown in a modal. Keep newest entries at the top; mirror commit summaries.

### Historical notes (archived)

- Paint.exe weapon
  - Emits opaque green swaths on the ground (`#2c826e`) that damage enemies on them; painted enemies turn a slightly different green `#3c9e87` permanently.
  - Toggled on/off; as it levels: more uptime, longer linger (`paintDuration`), larger radius, denser coverage, higher DPS. Circles have slight size variance.
  - Swaths are pooled meshes to reduce churn. See `paint*` fields and logic in `src/game.ts`.

- Universal hit-tint
  - Any enemy damaged gets a brief (~60ms) 10% desaturated tint and a matching “ouch” on the face canvas. State lives on `Enemy` (`baseColorHex`, `hitTintUntil`, etc.). Handled via `onEnemyDamaged(...)` and the enemy update branch that restores `baseColorHex` afterward.

- Enemies and waves
  - Wave 10 “Boo” behavior: enemies move fast when not looked at; very slow when looked at.
  - Post-wave-10 maintains high spawn counts by mixing prior waves.
  - Rare elites: ~1 in 500 are extra aggressive.
  - Giants: briefly enrage after successive hits; calm down after a short time without hits; drop a large XP reward.
  - Note: spawned enemies keep their original attributes; waves do not overwrite existing enemies’ stats.

- Daily Disk mode
  - Daily wave plan randomized per day using a simple xorshift PRNG seeded from New York date (rollover 3 AM America/New_York).
  - Separate leaderboard namespace using `mode` and `dailyId` in Netlify Functions.
  - UI shows current date on the button. Pending: “Previous Days” browser on Game Over; optional weapon/upgrade limits per day and theme variations.

- Performance
  - Pooled transient objects: paint disks and explosion shards (safe). Projectile pooling was tried and reverted due to gameplay regressions; keep projectiles non-pooled.
  - Throttled lasso geometry rebuilds and reduced CanvasTexture churn, especially for enemy faces on mobile.
  - Explicit disposal on enemy removal; shared geometries/materials for common meshes.
  - WebGL context loss handled; when lost, render loop idles until restored and textures mark `needsUpdate`.
  - Lightweight perf overlay toggled from the debug panel; shows enemies, scene children, `renderer.info.memory.*` and `render.calls`.

- Fullscreen + FABs
  - Small fullscreen FAB lives bottom-right; Options and Changelog are matching small FABs that show on the title screen only.

- Controller navigation
  - Title and pause overlays support d-pad/left stick for horizontal and vertical movement and A/Enter to activate; Start button is ignored on the title so it doesn’t immediately pause.

- 3D Title menu (formerly “Alt Title”)
  - Implemented by `showAltTitle3DOverlay()` in `src/game.ts`. Uses a separate Three.js overlay scene: floppy drive slot plus a stack of textured floppies (Start, Daily, Daily 2.0, Debug, Leaderboards, Bug Report).
  - Tuned for multiple aspect ratios; includes a Shift+F panel to tweak slot/title positions and selected/others offsets.
  - An opaque background plane covers gameplay/UI while the menu is active.
  - Navigation: Left/right (or A/D) cycles; d-pad or left stick also cycles; tap/click on the selected floppy to insert; controller A confirms. Drag swipes move one disk per gesture.

### House rules for future edits

- Preserve existing indentation style and width (tabs vs. spaces) in all files.
- After changes, update `CHANGELOG.md` (newest at top) with concise notes; commit and push if the change doesn’t introduce known issues.
- Favor readability: explicit property sets over giant object literals that can trip TS/transpilers.

### Pending / next ideas

- Add a “near” enemy count to the pause debug line to reflect on-screen pressure.
- Guard against floor texture flicker; consider WebGL context loss handling.
- Optionally tune spawn margins by DPI/zoom for ultra-dense displays.
- Continue mobile UI refinements; evaluate controller navigation consistency on all overlays.

## Ideas for later

- Enemy that enrages when hit and becomes much more aggressive (think Mario World caterpillar).
- Yellow splitters that pop into 2 could have a more interesting pattern after splitting.
- Red enemies are too slow/uninteresting; give them a unique hook/mechanic.
- If there's an "end": recreate the SkiFree yeti vibe – a monster that eventually chases you down and gobbles you.
- Secret level hidden off the main menu.
- Include kill count on the leaderboard along with time/score.
- 1 of every 100 enemies should spawn with red eyes and be very aggressive.
- Prize for killing BIG (giant) enemies: drop a huge XP cube or similar jackpot.

### License

No license specified yet. Add one if you plan to distribute.

# Disk Survivor
## Development notes

- Performance matters: when adding new gameplay features (weapons, enemies, FX, UI), consider their impact on allocations and GPU load.
  - Prefer pooling meshes and reusing shared geometries/materials.
  - Throttle dynamic geometry rebuilds and CanvasTexture updates.
  - Avoid per-frame allocations in hot loops; dispose of resources on removal.
  - Test on mobile/low-end GPUs and watch the in-game perf overlay (Geo/Tex/Calls) for trends.


Isometric 3D survivor-like built with Vite + TypeScript + Three.js.

- Play: [garfieldslament.com](https://garfieldslament.com/)
- Leaderboard: Netlify Functions + Blobs
- Build: `npm run build` → outputs to `dist/`
- Dev: `npm run dev`

Deployment
- Netlify build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`

Environment (for Blobs in Functions)
- `NETLIFY_SITE_ID` = your site API/Project ID
- `NETLIFY_AUTH_TOKEN` = your personal access token

### Test deployment

- This line exists to verify CI/CD deploy triggers on README edits.
- Safe to remove later.
- Additional README touch to test push workflow (2025-08-10).

