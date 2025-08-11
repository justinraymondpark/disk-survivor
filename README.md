## Disk Survivor

Arcade “survivor”-style browser game built with Three.js and Vite. Move a heroic floppy disk, pick a web-1.0 theme, collect weapons/upgrades, and survive ever-growing waves.

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

### Weapons and upgrades (high level)

- **Weapons**: CRT Beam (piercing laser), Dot Matrix (side bullets), Dial-up Burst (shockwave), SCSI Rocket (homing), Tape Whirl (orbiting saws), Magic Lasso (loop damage), Shield Wall (blocking wall). Each can level up.
- **Upgrades**: Fire rate, multishot, move speed, projectile damage, HP+heal, burst fire, XP magnet, projectile pierce, XP gain.

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

- Available from the Start screen as a fourth button: Debug Mode.
- Lets you toggle any weapon or upgrade and set desired levels before starting a run.
- Enforces the same caps as gameplay: max 5 weapons and 5 upgrades.
- Use B on a controller or the Back button to return to the Start screen.

### Fonts

- Monospace-style digits and counters now use self-hosted `W95FA` via `@font-face` (see `src/style.css`). Add the font file to `public/fonts/W95FA.otf`.
- UI cards still reference `Press Start 2P`; if you prefer to self-host, add assets under `public/fonts/` and update `src/style.css` accordingly.

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

### Pending / next ideas

- Add a “near” enemy count to the pause debug line to reflect on-screen pressure.
- Guard against floor texture flicker; consider WebGL context loss handling.
- Optionally tune spawn margins by DPI/zoom for ultra-dense displays.
- Continue mobile UI refinements; evaluate controller navigation consistency on all overlays.

### License

No license specified yet. Add one if you plan to distribute.

# Disk Survivor

Isometric 3D survivor-like built with Vite + TypeScript + Three.js.

- Play: https://garfieldslament.com/
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

