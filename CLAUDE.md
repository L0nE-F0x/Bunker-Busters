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

| `BunkerBusters-linux-x86_64-update.bin` | in-app updater only: the tarball's raw binary, swapped in place |
| `latest.json` | in-app updater manifest (signatures + per-install-type URLs), built by `scripts/update-manifest.mjs` |

- **Don't rename the assets.** The website links to `releases/latest/download/<fixed name>` and asks the GitHub API which assets exist (`src/site/site.ts`).
- The version shown in the game title and the site footer comes from `package.json` (`__APP_VERSION__`, injected in `vite.config.ts`).

Release notes: add a `## vX.Y.Z` section to `CHANGELOG.md` **before** running the script (it refuses otherwise). It becomes the GitHub release notes and the "what's new" bullets in the in-app update card.

**In-app updates** (desktop, from v0.1.1). On the title screen the app checks `releases/latest/download/latest.json` and offers "Update & restart":
- **Code:** `src-tauri/src/update.rs` (commands `update_check` / `update_install` / `update_progress`) and `src/ui/Updater.ts` (the card).
- **How each install type updates:**
  - tarball binary: swapped in place, no root
  - AppImage: replaced in place
  - .deb: `dpkg` through a pkexec password prompt
  - Windows: NSIS installer in passive mode
- **Signing:**
  - Every download is verified against the public key in `tauri.conf.json`.
  - The private key is at `~/.tauri/bunker-busters.key` on the owner's machine (empty password) and in the repo secret `TAURI_SIGNING_PRIVATE_KEY`.
  - **If that key is lost, installed copies can never update again.** It must stay backed up.
- **Local builds:** `npm run desktop:build` now needs the key: `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/bunker-busters.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" npm run desktop:build`. `desktop:release`/`desktop:install` (`--no-bundle`) don't.
- **End-to-end test:** run an older binary with `BB_SELF_UPDATE=1 BB_EXIT_AFTER=30`. It checks, installs and restarts with no UI, printing `[update] …` to stdout.

After a release:
```bash
gh run watch $(gh run list --workflow Release --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status
gh release view vX.Y.Z --json assets --jq '.assets[].name'   # expect the 6 assets above
npm run desktop:install          # update the owner's installed copy (~/.local/bin + app launcher entry)
```

Rebuild a tag's release without retagging: Actions → Release → *Run workflow* with the tag. To fix a broken release, delete the release and tag (`gh release delete vX --cleanup-tag`) and run `scripts/release.sh` again.

## Code map

```
src/main.ts                 boot → createRenderer → Game.build()
src/engine/                 renderer (backend chain, canvas sizing), postfx (TSL post stack), audio (procedural
                            Web Audio: ambience, sfx) + ambient (positional loop voices) + foley/surface (footsteps by
                            surface, room reverb) + music (generative score), physics (Rapier), input, noise + noiseTex
src/game/Game.ts            orchestrator: modes title → charselect → playing, frame loop, items, saves, HUD feed
src/game/Story.ts           quest runtime (steps from flags, rewards, banter); data in content/quests.ts + story.ts
src/game/world/             Atmosphere (sky, fog, sun, day/night), Heightfield + Terrain, Props, Landmarks,
                            Scrub, effects (dust, haze, fire, light cones, shockwave), materials (factories), kit (geometry,
                            MeshBatch + buildFar, DistanceLod, shadowProxy, Frame), lights (VirtualLight pool), npc (people)
src/game/town/              Dry Creek, The Cut and the wash (Settlement.ts: build half + NPC dialogue/quests half)
src/game/sites/             points of interest, one class each: jet, drivein, datacenter, tube (Site.ts: flag contract)
src/game/bunker/            GarageBuilder (Tier 1 geometry), Garage (locks, hazards, loot, taunts), Drone (SeedBot AI)
src/game/player/            Player (Rapier controller), FirstPersonCamera, Hands (procedural viewmodel + poses),
                            CharacterModel (third-person body, now a shadow-only caster), ThirdPersonCamera (unused)
src/content/                data: items, skills, archetypes, world layout, bunkers/garage.ts (data-driven)
src/ui/                     DOM HUD/menus (UI.ts), Lockpick/Circuit/Keypad minigames, Minimap, TouchControls (phones), styles.css
src/site/ + index.html      marketing page.   play/index.html: game page.   public/media + og.jpg: site art
src-tauri/                  desktop shell. main.rs: auto NVIDIA selection on hybrid Linux laptops, dev hooks. update.rs: in-app updater
scripts/                    release.sh, changelog.mjs, update-manifest.mjs, install-linux.sh, run-nvidia.sh, dev/* (test harness, below)
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
node scripts/dev/mobile-shot.mjs "http://localhost:5173/play/?webgl" out.png --tap 230,207 --twin "150,250,150,150;600,200,700,200"   # phone emulation + touch gestures
node scripts/dev/walk-probe.mjs 150 [--sprint]   # movement regression: logs every stall + contacts (FPS=144 env)
node scripts/dev/audio-capture.mjs "http://localhost:5173/play/?webgl&autostart" out.wav 60 --eval "game.atmo.hour = 22"   # record the mix + per-bus dB; then ffmpeg showspectrumpic
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
- `?touch=1|0`: force the phone/touch build on or off (on-screen controls, compact layout, mobile quality caps)
- `?webgl`, `?gpu=high|low|reset`: backend override
- `?skip=ui,post,env,dust,haze,props,landmarks,scrub,garage,terrain,sky,shadows,fog`: subsystem bisecting

Desktop dev hooks (env vars):
- `BB_START_URL`: open another URL
- `BB_EXIT_AFTER=N`: auto-quit
- `BB_GPU=integrated`: skip NVIDIA selection
- `BB_SELF_UPDATE=1`: check for and install an update with no UI (updater test)
- Page flag `?trace` (or `?trace=A`, which shows a label): log clicks and keys reaching the page. Uncaught JS errors always go to the console, which is stdout in the app.

The webview's `console.log` goes to stdout.

## Hard-won rules (read before touching these areas)

- **GPU safety:** never launch a *headed* Chrome with its GPU process forced onto NVIDIA (render-node override + PRIME env). It froze the owner's session once. Headless tests are safe. New desktop GPU experiments: a short self-closing window first (`debug/canary.html`, `BB_EXIT_AFTER`), and warn the owner to save work.
- **WebGPU in Chrome on this machine:**
  - On NVIDIA the device is lost on first present (`vkAllocateMemory … OUT_OF_DEVICE_MEMORY`). That's a Chrome/Dawn/driver bug, not ours.
  - The backend chain in `src/engine/renderer.ts` falls back to Intel WebGPU, then WebGL2, and remembers the choice.
  - Detect device loss with `device.lost`, not just `uncapturederror`.
  - WebGPU canvas sizes are padded to 64 px × 128 rows (`fitCanvas`) for cross-GPU swapchain import.
- **Desktop GPU path (Linux hybrid):** PRIME offload + **XWayland + `WEBKIT_DISABLE_DMABUF_RENDERER=1` + `GDK_CORE_DEVICE_EVENTS=1`** is the only path that runs at full refresh. Without the last one, GTK under XWayland never delivers mouse clicks to the page, so the menu looks frozen. Native-Wayland dmabuf crashes with Error 71. `select_gpu()` in `src-tauri/src/main.rs` applies this automatically. WebKitGTK has **no WebGPU**, so the desktop app uses WebGL2.
- **Never use WebKit's pointer lock in the Linux app.** Its X grab freezes the window's presentation under XWayland/PRIME (the page keeps rendering, the screen doesn't). `Input` uses native capture (`mouse_capture` in `rawmouse.rs`); game code listens for `bb-lockchange`/`bb-lockerror`. **Verify desktop changes with screenshots** (grim + md5 every 0.5 s), never `?bench` alone.
- **Mouse look in the Linux app (XWayland):** WebKitGTK's pointer lock barely reports motion there. Mouse look comes from XInput2 raw motion (`src-tauri/src/rawmouse.rs` → `raw_mouse_delta` → `Input.pollRaw()`). It must announce XI ≥2.1, call `XInitThreads()` before GTK starts, and only accept *relative* slave pointers (XWayland's `xwayland-pointer` is absolute).
- **Performance in WebKit:**
  - The bottlenecks are draw-call submission and HTML/CSS compositing over the canvas, not the GPU.
  - Keep meshes merged: `MeshBatch` per material, and material factories are **memoized**, so equal calls return one instance.
  - **Never mutate a factory material.** Use `rustyMetalUnique`/`fabricUnique`.
  - No GTAO pass on WebGL.
  - **No CSS `filter`, `backdrop-filter` or `mix-blend-mode` in WebKitGTK**: they're redrawn on the CPU over the canvas every frame and took menus to ~13 fps. `html.lowfx` (auto in the Linux app, `?lowfx=1` to test) must neutralise any new ones. Throttle per-frame canvas/DOM updates.
- **Lights and distance:** never `new THREE.PointLight` in world code. Use `VirtualLight` (world/lights.ts): a fixed pool of real lights is lent to the nearest, so the light count (and every shader) never changes. New places get a `buildFar()` stand-in under a `DistanceLod` and a `shadowProxy()` for their static batch (skip anything that moves or hides).
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
