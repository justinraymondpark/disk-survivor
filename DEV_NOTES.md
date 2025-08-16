## Development Notes

Lightweight doc for active work, backlog, and changelog.

### Conventions for new pickups (and similar gameplay objects)

- Code locations
  - `dropPickup(...)` and `applyPickup(...)` in `src/game.ts` handle spawn and effect application
  - Add any new pickup kind to the `Pickup` type
  - Create the pickup mesh alongside other shared geom/mats if reused
- Spawn odds
  - Keep odds centralized in `dropPickup(...)`; document any special cases
  - Rare/negative pickups should be clearly marked and easy to toggle via debug
- Debug access
  - Add a button in Debug Mode to spawn one instance near the player (for QA)
- HUD/UX
  - If a pickup applies a timed effect, consider a small HUD indicator and an audio cue
- Disposal
  - Ensure pickups are removed from scene and arrays when collected; use `disposeObjectDeep` on custom meshs/materials

Recent example: "Fuzzy Logic" bad pickup
- Kind: `fuzzy` (added to `Pickup` type)
- Visual: black spiky ball (icosahedron ~0.32)
- Effect: inverts camera-relative movement for ~7s (`fuzzyUntil` timestamp)
- Spawn: very rare (see `dropPickup` odds)
- Debug: Debug Mode includes a button to spawn one near the player

### Current state (summary)

- Core loop, UI overlays, controller support, and progression are implemented.
- Leaderboard wired via Netlify Functions and Blobs (silent no-op locally if not running functions).
- Music per theme expected; SFX via Web Audio API.

### Known issues / TODO

- Weapons classification: `isWeapon(name)` omits `Magic Lasso` and `Shield Wall`. This may mis-enforce max weapons vs. upgrades in level-up choices. Fix by including all weapon names.
- Projectile pierce: Primary bullets set `pierce: 0` in `shoot()`. Apply `projectilePierce` so the Piercing upgrade affects primary fire as intended.
- Duplicate overlay ids: Title, pause, and level-up overlays all use id `overlay`. While code holds element refs, duplicate ids are invalid and can confuse CSS/queries. Give unique ids and update styles to use classes.
- Shooter enemy does not actually shoot; it just keeps distance. Decide if it should fire projectiles and implement if desired.
- Asset expectations: Ensure `public/music/{default,geocities,yahoo,dialup}.{mp3,ogg}` exist. Add `public/title.png` or adjust art path.
- Options card is a placeholder. Add a proper options screen (e.g., remap controls, toggle VFX, sensitivity).
- Performance polish: consider simple pooling for projectiles/enemies; dispose materials/geometries proactively; reduce overdraw on additive effects.
- Mobile: investigate touch controls (virtual stick) and UI scaling for small viewports.

### Nice to have

- Meta-progression or run modifiers (curses/boons)
- Daily/weekly seeds
- More enemy archetypes (splitters, bombers, actual ranged projectiles)
- Boss telegraphs and patterns
- Visual juice: hit flashes, spritesheets/billboards, screen shake

### Changelog

- 2025-08-08: Added `README.md` and `DEV_NOTES.md` with architecture overview and backlog.

### Release checklist

- All overlays have unique ids/classes; keyboard/gamepad navigation verified
- Music files present; volumes persisted; pause resume works
- Leaderboard verified on Netlify (submit + top)
- Performance acceptable on mid hardware (60 FPS target)
- README updated with run/deploy steps, controls, and credits


