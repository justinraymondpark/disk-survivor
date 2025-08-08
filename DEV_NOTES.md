## Development Notes

Lightweight doc for active work, backlog, and changelog.

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


