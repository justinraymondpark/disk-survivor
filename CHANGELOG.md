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

