## v0.1.7 (2025-08-10)

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

