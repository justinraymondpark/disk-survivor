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
