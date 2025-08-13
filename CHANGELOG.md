## 0.1.22
- Docs: README adds quick "Play online" link near the top
- Alt Title: add true opaque camera-attached background plane (no UI/game bleed-through)
- Alt Title: floppy insertion target moved into slot; stack now clearly elevates selected disk at top; proper depth for occlusion
- Alt Title: add touch swipe navigation (left/right) and align background to fully hide gameplay/UI
  - Hide HUD, FABs, XP/HP bars, hit counter, and wave label during Alt Title
  - Larger world-space background plane aligned to camera each frame
  - Keep single default layer to avoid hiding essential DOM FABs; hide FABs explicitly during Alt Title
  - Swipe area spans full screen; temporarily sets touch-action to none while swiping on mobile
- Alt Title: hide ground/player/billboards while active to ensure pure focus on the title scene
- Alt Title: fix stack mapping so visually top disk is always the selected one
  - Hide debug isometric grid during Alt Title
  - Touch swipe now advances exactly one disk per gesture (detected on release)
- Alt Title: themed floppy colors (Start black, Daily green, Debug grey), 2x floppy size, subtle float motion; front drive label "DISK SURVIVOR"; FABs visible on Alt Title
  - Birds-eye layout for Alt Title (group rotated overhead), drive tilted ~15° toward camera
  - Floppies laid flat (labels up), stronger float wobble; FABs visible on Alt Title
  - Temporary top-down camera during Alt Title; restore iso view after selection; disks face-up by default and rotate vertical during insert
- Alt Title: clean up background plane and restore hidden UI after selection
- Fix: reduce chance of thin black bar by pinning canvas and covering subpixel seams
- Pause: reliable controller navigation on pause menu (D-pad/left stick selects; A confirms)

## 0.1.21
- Gameplay: Wave 10 “Boo” behavior (advance fast when not watched; creep when in view)
- Gameplay: Post-wave-10 spawn cadence stays high for consistent challenge
- Gameplay: Rare elites (~1/500) pursue more aggressively
- Gameplay: Giants gain brief enrage after rapid hits; drop large XP haul on death
- UX: Small bottom-right fullscreen button
- Debug: Lightweight perf overlay (wave, enemies, scene children, geo, tex, calls, context state)
- Perf: Pooled paint disks and explosion shards; throttled lasso geometry; shared geoms/materials for common projectiles and items; disposal on enemy removal
- Visual: Brief hit flash on all damage sources (low-cost tint ~60ms)
 - Alt Title: 3D floppy/drive scene with larger presentation and opaque background; controller A/Enter debounce and insert animation; scaled to ~75% viewport (tuned)
## 0.1.20
- Fix: Enemy hit tint now correctly resets after ~60ms for SATA Tail and Tape Whirl. Ensured all enemy spawns track `baseColorHex` so temporary tints revert properly.
- Feature: Added new weapon `Paint.exe` (🎨)
  - Leaves bright green (#00FF83) paint swaths under the player while active
  - Enemies standing on paint take damage over time and are permanently painted green
  - Toggled on/off like other uptime-based weapons; much shorter range/duration than Magic Lasso
  - Levels increase uptime (more on than off), DPS, and ground paint lifetime

  - Tweak: Paint swath size tripled; paint is now opaque. Radius increases more with each level and each swath has slight random size variance. Swath color changed to `#2c826e`; enemies painted use `#3c9e87` to differentiate from XP cubes. Stronger level scaling: longer uptime, longer ground lifetime, larger radius, and denser coverage per level.
  - Debug: Add optional floating damage numbers (toggle in debug panel). Now shows for all damage sources; DoT values rounded to avoid "-0" artifacts.
  - Tweak: Paint.exe blobs linger +0.5s longer at base (same emission cadence; trail remains briefly after placement stops).

## v0.1.20 (2025-08-11)

- Fonts: switch entire UI to self-hosted `W95FA` (prefer `W95FA.woff2`, OTF fallback); removed Google Fonts usage
- Docs: README updated with W95FA-only setup and PowerShell '&&' note
 - Assets: add `public/fonts/W95FA.otf` and `public/fonts/W95FA.woff2`
 - Debug: add emoji icons and compact rows in Debug Mode
 - Debug: reduce card min-height, grid gap, and enforce flex row layout for tighter boxes
 - Tape Whirl: adds dusty magnetic hit effect; knockback always away from player
 - SCSI Rocket: update descriptions to emphasize blast radius instead of homing
 - SCSI Rocket: level-ups now increase blast radius, fire rate, and damage
 - Inventory: weapons now show their level in the HUD list
 - Perf: replace repeated alive filters with counters; move rocket homing into main loop (no timers); reduce shockwave geometry churn
 - Perf: throttle far enemy updates every other frame; misc allocations reduced
 - Perf: wave cull now removes only offscreen enemies (farthest first) to avoid visible mass culls
 - UI: title buttons use a 2x2 grid by default (stack on narrow screens); pause actions are smaller and stacked
 - Balance: Tape Whirl now pulses on/off like CRT Beam
 - Perf: add simple spatial hash for projectile→enemy collision checks to cut scans
 - Perf: pool shockwave rings and dust quads to reduce allocations/GC
 - Pause: add Restart and Main Menu buttons with confirmation prompt (OK/Cancel; A/B on controller)

## v0.1.19 (2025-08-10)

- Rocket: targets a random enemy within a radius around the player (with AoE on impact); slower homing and turn

## v0.1.18 (2025-08-10)

- Rocket: AoE restored on impact; homing remains simple with brief hesitate
- Dial-up Burst: emits a single shockwave per cycle; level-ups increase radius/damage

## v0.1.17 (2025-08-10)

- Debug Mode: smooth scroll on controller navigation; more compact rows and slightly smaller font
- Rocket: fully reverted to original simple homing; removed AoE behavior

## v0.1.16 (2025-08-10)

- Debug Mode: clearer element highlighting; controller vertical navigation scrolls the list; A/B access Back/Start buttons
- Start screen: 2x2 grid layout on wide/short displays (e.g., Fold unfolded)
- HUD: digits now use a pixel mono font for a retro look

## v0.1.15 (2025-08-10)

- Debug Mode: controller-friendly navigation (select rows, toggle with A, adjust numbers with up/down, Back with B)
- Rocket: reverted to simpler homing with slight initial hesitate for readability
- Fonts: added Google Fonts (Press Start 2P, VT323) and documented self-hosting option

## v0.1.14 (2025-08-10)

- UX: Controller selection works on Game Over (d-pad/left stick + A)
- Feature: Debug Mode on Start screen to pre-select weapons/upgrades with level caps

## v0.1.13 (2025-08-10)

- Level-ups: XP overflow now queues multiple level-up selections sequentially
- Rocket: significantly slower and more visible flight with larger trail
- Sata Tail: much more pronounced electric zap effect on contact

## v0.1.12 (2025-08-10)

- Rocket: restored visible flight with trail; adjusted pacing to feel readable (boost/pause/chase retained)
- Dial-up Burst: beefier visual ring, thump SFX, and hop effect on surviving enemies
- Controller: B button closes Change Log modal

## v0.1.11 (2025-08-10)

- UX: Game Over screen supports controller selection for Submit/Restart
- Weapon: SCSI Rocket reworked with boost→lock-on→chase behavior and AoE explosion on impact

## v0.1.10 (2025-08-10)

- Balance: Dial-up Burst now scales with multi-pulse blasts, larger radius, faster cycle, and brief slow on hit
- Balance: Tape Whirl adds more saws at higher levels, with increased radius, speed, and DPS

## v0.1.9 (2025-08-10)

- Changelog modal: Close button always visible; no scroll needed to access it

## v0.1.8 (2025-08-10)

- Changelog overlay respects file order and opens at the top
- Docs: README Quick start clarifies Node 18+ (or 20+) supported

## v0.1.6 (2025-08-08)

- Spawn: enemies now spawn strictly offscreen using camera projection to avoid on-screen pop-in
- Cadence: gentle sine-modulated baseline spawns with occasional micro-bursts (staggered) to add variety without lapses
- Enemies: added smooth hesitation cycles (decelerate → brief pause with direction jitter → accelerate) to reduce clumping

## v0.1.1 (2025-08-08)

- Change Log button on title screen opens this file in an overlay
- Treat Magic Lasso and Shield Wall as weapons for level-up slot limits
- Primary bullets now honor Piercing ISA upgrade
- Use unique overlay class and avoid duplicate id usage

## v0.1.3 (2025-08-08)

- Louder SFX and softer default music mix; stronger impact/shoot/level-up
- Pause: Resume button now clickable
- Changelog loads from bundle in prod; newest entries appear first

## v0.1.4 (2025-08-08)

- Touch controls: dual virtual sticks; touch pause button; merged with controller input
- Responsive overlays: title, pause, and game over stack on narrow/tall screens
- Netscape UI: dithered gradients, dark text, sharper corners
- HUD: condensed to Time; level shown on XP bar; removed redundant XP/score from top-left

## v0.1.5 (2025-08-08)

- Controller/touch: prevent right-stick angle from “sticking” on mobile; keep last facing on touch
- XP Vacuum: pulls XP/bundles toward player over 3s; magnet continues 0.5s into level-up with easing
- Time HUD: 4-digit counter; updates every second
- Death polish: maroon flash + synth moan; Game Over UI animates in
- Waves: extended unique enemy waves up to minute 10; shooters strafe in a ring
- Perf: cap active enemies (~140); throttle impact SFX to 50ms min
- Pause: shows a small debug line with entity counts

## v0.1.2 (2025-08-08)

- Scrollable Change Log modal with proper markdown-as-text rendering
- Level-up cards: improved entrance animation, 0.5s click lock, no flicker
- Auto-fire setting added to pause menu; now default on first run
- 90s hit counter above XP bar; increments on kills; cheeky label flip
- Leaderboard submit locked to one submission per game over

## v0.1.0 (2025-08-08)

- Initial docs: README and DEV_NOTES
- Added .gitattributes and configured line endings

