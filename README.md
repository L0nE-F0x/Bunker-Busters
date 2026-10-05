# Bunker Busters

Post-apocalyptic open-world heist game. Scavenge the wasteland, scout the doomsday bunkers of the tech elite, and break in. First-person, stealth and lockpicking, fully procedural graphics (Three.js WebGPU + TSL).

## Play in the browser

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production bundle → dist/
```

The web build deploys to Netlify as-is (`netlify.toml`: `npm run build` → `dist/`). The renderer uses WebGPU where it works and falls back to WebGL2 automatically. The title screen shows which backend is active.

## Desktop app (Tauri)

The same game in a native window (WebKitGTK on Linux, WebView2 on Windows, WKWebView on macOS). On hybrid-GPU Linux laptops this lets the game run on the discrete GPU without touching your everyday browser:

```bash
npm run desktop          # dev window, default GPU
npm run desktop:nvidia   # dev window on the NVIDIA dGPU (PRIME offload, see scripts/run-nvidia.sh)
npm run desktop:build    # release bundles (AppImage / .deb) in src-tauri/target/release/bundle
```

Needs Rust and, on Linux, `webkit2gtk-4.1`.

## Controls

WASD move · mouse look · Shift sprint · C crouch · Space jump · E/F interact · L flashlight · 1–3 items · Tab inventory · M map · Esc pause

## Docs

- `BUNKER_BUSTERS_SPEC.md`: game design spec
- `NOTES.md`: dev log: what works, what's stubbed, GPU/backend findings, next steps
