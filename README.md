# Bunker Busters

Post-apocalyptic open-world heist game. Scavenge the wasteland, scout the doomsday bunkers of the tech elite, and break in. First-person, stealth and lockpicking, fully procedural graphics (Three.js WebGPU + TSL).

## Play in the browser

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production bundle → dist/
```

The web build deploys to Netlify as-is (`netlify.toml`: `npm run build` → `dist/`). The renderer uses WebGPU where it works and falls back to WebGL2 automatically. The title screen shows which backend is active.

## Website

`index.html` is the marketing/download page (site root). `play/index.html` is the browser build of the game. Netlify deploys both from `main` (`netlify.toml`). The download buttons link to fixed asset names on the latest GitHub Release.

## Desktop app (Tauri)

The same game in a native window (WebKitGTK on Linux, WebView2 on Windows). On hybrid-GPU Linux laptops the app automatically renders on the NVIDIA dGPU (PRIME offload via XWayland). Set `BB_GPU=integrated` to opt out.

```bash
npm run desktop           # dev window
npm run desktop:install   # optimised build + install to ~/.local (app launcher entry)
scripts/install-linux.sh --uninstall
```

Needs Rust and, on Linux, `webkit2gtk-4.1`.

## Releasing

```bash
# bump "version" in package.json and src-tauri/tauri.conf.json, then:
git tag v0.1.1 && git push origin v0.1.1
```

`.github/workflows/release.yml` builds Linux (tar.gz for Omarchy/Arch, AppImage, .deb) and Windows (NSIS installer) and publishes the release once every platform has built.

## Controls

WASD move · mouse look · Shift sprint · C crouch · Space jump · E/F interact · L flashlight · 1–3 items · Tab inventory · M map · Esc pause

## Docs

- `BUNKER_BUSTERS_SPEC.md`: game design spec
- `NOTES.md`: dev log: what works, what's stubbed, GPU/backend findings, next steps
