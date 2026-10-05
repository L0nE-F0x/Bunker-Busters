# Bunker Busters: agent hand-off

First-person post-apocalyptic heist game (Three.js r186 WebGPU/WebGL2 + TSL shaders, Rapier physics, fully procedural, no art assets). It ships as:
- a **website**: https://bunker-busters.netlify.app/ (marketing/download page at `/`, browser build at `/play/`)
- a **desktop app**: Tauri 2. WebKitGTK on Linux, WebView2 on Windows. Downloads come from GitHub Releases.

Repo: https://github.com/L0nE-F0x/Bunker-Busters (public, branch `main`). Read `BUNKER_BUSTERS_SPEC.md` for the design and `NOTES.md` for the dev log and findings.

**Current phase:** v0.1.0 is released, the site is live and the owner has the desktop app installed. We are now **refining and iterating**. The owner cares most about visual quality ("make it look incredible"), then game feel. Each meaningful round of improvements ends with a release (below).

## Daily loop

```bash
npm run dev                  # http://localhost:5173  (site at /, game at /play/)
npm run typecheck && npm run build
npm run desktop              # desktop shell (dev) against the dev server
```

- Pushing to `main` redeploys the website on Netlify (about a minute). That covers the site and the `/play/` browser build.
- Desktop users only get changes through a **release**.
- After a milestone, add a short dated section to `NOTES.md` (what works, what's stubbed, next steps). The spec asks for this.
- The spec says: **ask the owner before adding heavy dependencies.**
- Commits end with the attribution line given in the session's system reminder.

## Releasing (how to ship a new version)

One command does the version bump, checks, commit, tag and push:

```bash
scripts/release.sh patch            # 0.1.0 → 0.1.1  (also: minor | major | 0.3.0)
scripts/release.sh patch --dry-run  # bump + verify, then restore files: nothing committed
```

What it does:
1. Requires a clean `main` that's in sync with `origin`.
2. Bumps the version in **all three places**: `package.json` (+lock), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (+`Cargo.lock`).
3. Runs `npm run build` and `cargo check`.
4. Commits `Release vX.Y.Z`, tags `vX.Y.Z`, and pushes both.

The tag triggers `.github/workflows/release.yml`:
1. Creates a draft release.
2. Builds **Linux** on ubuntu-22.04 and **Windows** in parallel.
3. Uploads assets with **fixed names**, then publishes once every platform has succeeded.

| Asset | Who it's for |
|---|---|
| `BunkerBusters-linux-x86_64.tar.gz` | Omarchy/Arch (recommended). Plain binary against the system WebKitGTK, plus `install.sh` |
| `BunkerBusters-linux-x86_64.AppImage` | any distro. Bundles an older WebKitGTK and is slower (~23 vs 35–50 fps) |
| `BunkerBusters-linux-amd64.deb` | Debian/Ubuntu |
| `BunkerBusters-windows-x64-setup.exe` | Windows 10/11, NSIS. **Unsigned**: SmartScreen shows "More info → Run anyway" |

- **Don't rename the assets.** The website links to `releases/latest/download/<fixed name>` and asks the GitHub API which assets exist (`src/site/site.ts`).
- The version shown in the game title and the site footer comes from `package.json` (`__APP_VERSION__`, injected in `vite.config.ts`).

After a release:
```bash
gh run watch $(gh run list --workflow Release --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status
gh release view vX.Y.Z --json assets --jq '.assets[].name'   # expect the 4 assets above
npm run desktop:install          # update the owner's installed copy (~/.local/bin + app launcher entry)
```

Rebuild a tag's release without retagging: Actions → Release → *Run workflow* with the tag. To fix a broken release, delete the release and tag (`gh release delete vX --cleanup-tag`) and run `scripts/release.sh` again.

## Code map

```
src/main.ts                 boot → createRenderer → Game.build()
src/engine/                 renderer (backend chain, canvas sizing), postfx (TSL post stack), audio (procedural
                            Web Audio), physics (Rapier), input, noise + noiseTex (baked noise atlas)
src/game/Game.ts            orchestrator: modes title → charselect → playing, frame loop, items, saves, HUD feed
src/game/world/             Atmosphere (sky, fog, sun, day/night), Heightfield + Terrain, Props, Landmarks,
                            Scrub, effects (dust, haze, fire, light cones, shockwave), materials (factories), kit (geometry)
src/game/bunker/            GarageBuilder (Tier 1 geometry), Garage (locks, hazards, loot, taunts), Drone (SeedBot AI)
src/game/player/            Player (Rapier controller), FirstPersonCamera, Hands (procedural viewmodel + poses),
                            CharacterModel (third-person body, now a shadow-only caster), ThirdPersonCamera (unused)
src/content/                data: items, skills, archetypes, world layout, bunkers/garage.ts (data-driven)
src/ui/                     DOM HUD/menus (UI.ts), Lockpick/Circuit/Keypad minigames, Minimap, styles.css
src/site/ + index.html      marketing page.   play/index.html: game page.   public/media + og.jpg: site art
src-tauri/                  desktop shell. main.rs: auto NVIDIA selection on hybrid Linux laptops, dev hooks
scripts/                    release.sh, install-linux.sh, run-nvidia.sh, dev/* (test harness, below)
debug/                      dev-only pages (served by `npm run dev`, never deployed): hands lab, GPU canary, OG card
```

## Verifying changes (do this, don't guess)

The owner's machine: Omarchy (Arch + Hyprland/Wayland), Intel iGPU drives the screen, RTX 4050 dGPU, 144 Hz. Chrome is deliberately pinned to the Intel GPU by `~/.config/chrome-flags.conf`. Don't change that file.

Headless harness. It needs `npm run dev` running, and nothing appears on screen:
```bash
node scripts/dev/shot.mjs "http://localhost:5173/play/?webgl&autostart" out.png \
  --wait 3000 --eval "game.atmo.hour = 21.5" --wait 2000 --fps --shot night.png
node scripts/dev/hands-lab.mjs sheet.png "pose=reach" "pose=lockpick&look=engineer" "pose=idle&torch" "pose=flat&view=palm"
node scripts/dev/marketing-shots.mjs [hero night interior camp lockpick]   # regenerate site screenshots
node scripts/dev/og-card.mjs                                               # regenerate public/og.jpg
scripts/dev/bench-desktop.sh [high|medium]   # real desktop-app perf: opens a window ~40 s, self-closes
```

- The harness renders WebGL on the RTX 4050 headlessly (`GPU_MODE=nvidia|intel|soft`).
- Always pass `?webgl` in headless game URLs.
- `window.game` exposes everything: `game.player.teleport(v)`, `game.cam.snap(yaw,pitch)`, `game.atmo.hour`, `game.hands.setBase('lockpick')`, `game.garage.drone`, `game.state`, `game.ui`.
- **Look at the screenshots.** Visual quality is the product.

Game URL flags:
- `?autostart`: skip menus into a fresh run
- `?bench`: log fps and update/physics/render ms every 2 s
- `?q=low|medium|high|ultra`
- `?webgl`, `?gpu=high|low|reset`: backend override
- `?skip=ui,post,env,dust,haze,props,landmarks,scrub,garage,terrain,sky,shadows,fog`: subsystem bisecting

Desktop dev hooks (env vars):
- `BB_START_URL`: open another URL
- `BB_EXIT_AFTER=N`: auto-quit
- `BB_GPU=integrated`: skip NVIDIA selection

The webview's `console.log` goes to stdout.

## Hard-won rules (read before touching these areas)

- **GPU safety:** never launch a *headed* Chrome with its GPU process forced onto NVIDIA (render-node override + PRIME env). It froze the owner's session once. Headless tests are safe. New desktop GPU experiments: a short self-closing window first (`debug/canary.html`, `BB_EXIT_AFTER`), and warn the owner to save work.
- **WebGPU in Chrome on this machine:**
  - On NVIDIA the device is lost on first present (`vkAllocateMemory … OUT_OF_DEVICE_MEMORY`). That's a Chrome/Dawn/driver bug, not ours.
  - The backend chain in `src/engine/renderer.ts` falls back to Intel WebGPU, then WebGL2, and remembers the choice.
  - Detect device loss with `device.lost`, not just `uncapturederror`.
  - WebGPU canvas sizes are padded to 64 px × 128 rows (`fitCanvas`) for cross-GPU swapchain import.
- **Desktop GPU path (Linux hybrid):** PRIME offload + **XWayland + `WEBKIT_DISABLE_DMABUF_RENDERER=1`** is the only path that runs at full refresh. Native-Wayland dmabuf crashes with Error 71. `select_gpu()` in `src-tauri/src/main.rs` applies this automatically. WebKitGTK has **no WebGPU**, so the desktop app uses WebGL2.
- **Performance in WebKit:**
  - The bottlenecks are draw-call submission and HTML/CSS compositing over the canvas, not the GPU.
  - Keep meshes merged: `MeshBatch` per material, and material factories are **memoized**, so equal calls return one instance.
  - **Never mutate a factory material.** Use `rustyMetalUnique`/`fabricUnique`.
  - No GTAO pass on WebGL.
  - Avoid always-on CSS filters/backdrop-blur in the HUD, and throttle per-frame canvas/DOM updates.
- **TSL shaders:**
  - Put tweakable values in `uniform()`, not literals, so instances share one program. Unique literals mean one compile per material, which made loading take 73 s once.
  - Sample the baked noise atlas (`noise()`/`fbm2()` in `src/engine/noiseTex.ts`) instead of per-pixel `mx_*` noise.
  - In `positionNode` on InstancedMesh, instancing is already applied. Use `positionGeometry` for local values.
- **Hands** (`src/game/player/Hands.ts`):
  - Authored at real scale, scaled 1.3 (FP convention), then shrunk by `VIEW_SCALE` toward the eye so they never clip walls.
  - For a right hand palm-down, the thumb is on −x: `a = -side` for anatomy, `side` for screen mirroring.
  - Empty hands rest **off-screen** (`idle` = `DOWN`), like real arms, at the owner's request ("zombie hook hands"). They rise for actions, the torch, sprinting and falling.
  - Forearms come from two-bone IK, and poses blend through a critically damped spring. Keep the rim emissive tiny: near the lens it reads as a glowing outline.
  - Iterate with the hands lab (`&view=palm|side` to check anatomy), never blind.
- **Physics:**
  - The world steps by the frame `dt`.
  - The player is a kinematic controller with real gravity and acceleration limits (constants at the top of `Player.ts`).
  - Dynamic bodies (the EMP canister) are excluded from the controller's query (`EXCLUDE_DYNAMIC`).
  - Footsteps come from `FirstPersonCamera.onStep`, not the shadow body.
- Fonts are self-hosted via `@fontsource` (`src/fonts.ts`). Import paths have **no `.css` suffix** (the packages' export maps add it).
- In bash with `set -o pipefail`, don't use `grep -q` on a producer's output (SIGPIPE → false failure).
- Node scripts: use `fileURLToPath(new URL(…))`, not `.pathname`. The repo path contains a space.

## Backlog (owner priorities first)

1. **Visual polish pass:**
   - richer Garage exterior and interior detail
   - better hero/landing art
   - drone and laser VFX
   - weather (dust storms)
   - character-select presentation
2. **Desktop performance:** the target is the 4050 hitting 60+ fps on High in the desktop app. Today it's about 35–50 fps (`scripts/dev/bench-desktop.sh`). Next: merge hand/body meshes, fewer per-frame DOM writes, instancing for repeated props, LOD for far terrain.
3. **Content per spec v0.2:**
   - Tier 2 "Apex Vault" and Tier 3 "The Panopticon"
   - a hacking minigame
   - a stealth/light model
   - crafting
   - Extract a generic bunker runtime from `Garage.ts` first.
4. **Distribution:**
   - Windows installer not yet tested on real hardware
   - code signing
   - a GitHub Actions cache for faster CI
   - optionally an AUR package
