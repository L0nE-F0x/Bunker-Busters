# Bunker Busters — Dev Notes

## Milestone: v0.1 MVP vertical slice

### Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle in dist/ (Netlify-ready, see netlify.toml)
```

URL flags: `?webgl` forces WebGL2. `?gpu=high` / `?gpu=low` force WebGPU on the discrete / integrated GPU. `?gpu=reset` forgets the stored backend choice. `?q=low|medium|high|ultra` overrides quality. `?skip=props,landmarks,scrub,dust,haze,env,post,garage,terrain,sky,shadows,fog` disables subsystems (for GPU debugging).

**Renderer backend chain.** The game tries WebGPU on the discrete GPU first, then WebGPU on the integrated GPU, then WebGL2. It catches early device loss or repeated device errors, remembers the result per browser and reloads one step down the chain.

**This machine (Chrome 153, hybrid Intel + RTX 4050, Hyprland/Wayland):**
- Chrome's GPU process is deliberately pinned to the Intel iGPU by `~/.config/chrome-flags.conf`. That's the right call for desktop use: the panel is wired to Intel. So WebGL2 always runs on Intel.
- Chrome still lets WebGPU pick the NVIDIA card through Vulkan (Dawn). That device is lost on its first present with `vkAllocateMemory failed with VK_ERROR_OUT_OF_DEVICE_MEMORY`. It happens even for a bare clear-screen test, so it's a Chrome/Dawn/NVIDIA-driver interop problem, not this game. Unaligned canvas sizes additionally fail the cross-GPU swapchain import (`Requested allocation size … smaller than the image requires`). The drawing buffer is now padded to 64 px × 128 rows on WebGPU and cropped, which fixes that part.
- WebGPU on the Intel iGPU works. Headless at 1280×720: High runs at WebGPU 30 fps vs WebGL2 27 fps, Medium at 45 vs 42.
- Pinning all of Chrome to NVIDIA (render-node override + PRIME offload) froze the desktop session during testing. Don't do that on a live session.

### First-person update (v0.1.1)
- The player is now first-person. `FirstPersonCamera` handles eye-height crouch easing, gait head-bob, strafe roll, landing spring, sprint FOV and trauma shake.
- `Hands` is a procedural viewmodel: gloved hands with articulated fingers and thumb, knuckle armour, wrist straps, sleeves, and a wrist gadget in the archetype accent colour.
  - Looks per archetype: black tactical gloves (Infiltrator) and tan work gloves (Engineer).
  - Poses blend: idle, crouch, run, lockpick, keypad, reach/grab, EMP hold → wind-up → throw, eat, and a torch grip.
  - Look-sway inertia, bob and landing dip are layered on top.
  - The hands are authored at real scale and shrunk toward the eye (`VIEW_SCALE`), so they never clip through walls.
- Held items: lockpick and tension wrench, EMP canister, ration bar, flashlight. Flashlight is on **L**. It's a camera-mounted spotlight, and SeedBot spots you 1.6× faster while it's on.
- The old third-person body still walks around but renders only into the sun's shadow map (layer 1), so you see your own long evening shadow.
- Character select is now a kneeling-at-the-campfire close-up of your character's hands and gear.
- Interaction targeting follows your gaze. Banners are queued. The hotbar moved bottom-right so it doesn't sit on the hands.
- Dev tool: `http://localhost:5173/debug/hands.html?pose=lockpick&look=engineer&torch` renders the hands alone in a studio (dev server only, not part of the build).

### Hand-off & tooling (2026-10-05)
- `CLAUDE.md` is the agent hand-off: daily loop, release procedure, code map, verification harness, hard-won rules, backlog.
- `scripts/release.sh patch|minor|major|X.Y.Z [--dry-run]` bumps all three version files, verifies, commits, tags and pushes.
- `scripts/dev/` is the headless test harness (`shot.mjs`, `hands-lab.mjs`, `marketing-shots.mjs`, `og-card.mjs`) plus `bench-desktop.sh`. Dev dependency: `playwright-core` (uses an installed Chrome).
- The version shown in-game and on the site comes from `package.json` via `__APP_VERSION__`.

### Distribution (2026-10-05)
- **Site:** `index.html` (root) is the marketing/download page, built from `src/site/*`, with screenshots in `public/media/`. `/play/` is the browser build. Netlify deploys `main`.
- **Download buttons** point at `releases/latest/download/<fixed asset name>`. The page asks the GitHub API which assets exist and falls back to "play in browser" before the first release.
- **Releases:** push a `v*` tag and `.github/workflows/release.yml` builds:
  - `BunkerBusters-linux-x86_64.tar.gz`: plain binary against the system WebKitGTK, plus `install.sh` (recommended for Omarchy/Arch)
  - `BunkerBusters-linux-x86_64.AppImage`
  - `BunkerBusters-linux-amd64.deb`
  - `BunkerBusters-windows-x64-setup.exe`: NSIS, unsigned, so SmartScreen warns
- **GPU:** the Linux desktop app picks the NVIDIA GPU by itself on hybrid laptops (`select_gpu()` in `src-tauri/src/main.rs`).
- **Local install:** `npm run desktop:install` builds the release binary and runs `scripts/install-linux.sh` (~/.local/bin + app-launcher entry). `--uninstall` removes it.
- **Verified on this machine (v0.1.0 CI builds):** the tarball binary and the AppImage both launch and auto-select NVIDIA. The AppImage is slower (~23 fps vs 35–50 for the tarball on the system's newer WebKitGTK 2.52), so the tarball stays the recommended Omarchy download.
- **Not yet verified:** the Windows installer on real hardware.
- The repo is public (2026-10-05). All four `releases/latest/download/…` links work anonymously, and the live site shows v0.1.0 with OS-matched buttons.

### Desktop shell (Tauri) — GPU findings (2026-10-05)
- `src-tauri/` hosts the same web game in WebKitGTK on Linux. `npm run desktop`, `npm run desktop:nvidia` (via `scripts/run-nvidia.sh`), `npm run desktop:build`.
- WebKitGTK has **no WebGPU**, so the game uses the WebGL2 backend there.
- Presentation paths on Intel + RTX 4050 under Hyprland (10 s WebGL canary, `debug/canary.html`):

  | path | result |
  |---|---|
  | native Wayland + dmabuf | Wayland "Error 71", WebKit aborts (the compositor rejects NVIDIA buffers) |
  | native Wayland, no dmabuf | works on NVIDIA, frames copied through RAM, ~45 fps cap |
  | XWayland + dmabuf | GBM allocation fails, no frames |
  | **XWayland, no dmabuf** | **works on NVIDIA at full 144 Hz**: the default in `run-nvidia.sh` |

- Full game on NVIDIA in the desktop shell, window 936×1138: High 27.5 fps with the HUD (39.5 without), Medium 47 fps. Intel in the same shell: ~13.5 fps on the title screen.
- The bottleneck is WebKit overhead, not the GPU. GPU utilisation sits around 50%. Per-frame costs:
  - **draw-call submission:** render call 13–25 ms, from ~5k calls/frame on High.
  - **HTML/CSS compositing over the canvas:** worst on the title screen, where hiding the UI doubled fps.
- Next optimisation targets:
  - share materials across instances so meshes merge
  - drop the GTAO pre-pass on WebGL
  - merge the character/hand meshes
  - throttle the minimap canvas
  - remove CSS filters/backdrop-blur from always-on HUD layers
- Debug URL flags: `?bench` logs fps and update/physics/render ms every 2 s to the console (the desktop shell prints console output to stdout). `?autostart` skips the menus. `?skip=…,ui` hides the HTML overlay.

### What works

**Engine (`src/engine`)**
- Three.js r186 `WebGPURenderer` with automatic WebGL2 fallback (backend shown on the title screen).
- Post stack (`postfx.ts`, all TSL): ambient-only GTAO pre-pass → raymarched shadow-map godrays (bilateral-blurred, additive) → bloom → orange/teal split-tone grade → ACES → SMAA → radial chromatic aberration, warm vignette, film grain. Gameplay overlays: damage flash, detection pulse, EMP static/tearing, fade.
- Quality presets low/medium/high/ultra (pixel ratio, shadow map size, AO, godrays, dust count, grass density), switchable live in Settings.
- Rapier (WASM) physics: heightfield terrain, static colliders, kinematic character controller (autostep, snap-to-ground, slope limits).
- Fully procedural Web Audio: wind bed with gusts, ambient synth pad that opens up with tension, HRTF-spatialised loops (drone hum, campfire crackle, neon buzz, generator), ~30 synthesised one-shots, an alarm siren, and optional speech-synthesis megaphone taunts.
- Input with pointer lock, a typed event bus, and seeded noise utilities.

**World (`src/game/world`)**
- Single shared `Heightfield`: dunes, terraced mesas, a dry wash, bounding mountains, and flattened pads for the roads, landmarks and bunker. A far-terrain ring and a ruined city skyline fill out the horizon.
- Terrain shader: sand with wind ripples, cracked salt flats, layered rock strata on slopes, scrub patches, a crumbling highway (cracks, faded dashes, sand drifts) and dirt tracks. Detail comes from surface-gradient bump mapping.
- Time of day: a full 26-minute day/night cycle keyed on sun elevation. It drives the procedural sky (sun disk, cirrus, stars, moon), analytic height fog that shares the sky's haze colour, sun or moon shadows, hemisphere fill, a cube-camera environment map and the rim light.
- Props: instanced rocks and dead trees, wrecked sedans, leaning telephone poles with sagging wires, three satirical billboards, rolling tumbleweeds, and wind-swaying scrub streamed around the player.
- FX: GPU dust motes lit by forward scattering, drifting ground haze (soft particles), a campfire with embers and a flickering light, volumetric light cones, and an EMP shockwave.
- Landmarks: **Last Chance Gas**, a camp with a flickering neon sign and string lights (spawn point, rest/save). **The Spire**, a collapsed lattice tower with a blinking aviation light.

**Bunker: Tier 1 "The Garage" (`src/game/bunker`, data in `src/content/bunkers/garage.ts`)**
- Perimeter: razor-wire fence with a padlocked gate (3-pin lockpick) or a secret NE gap that is only usable once you have the blueprint intel. Three tin-can tripwires: crouch to step over them, or disarm them with Electronics 1.
- SeedBot, the guard drone: patrol → suspicious → alert → search state machine, a vision cone with line of sight, and a detection meter that accounts for distance, stance, night and archetype. It browns out every ~25s (12% battery), is knocked out by EMP, and catching you means a taser zap and waking up outside the fence.
- Entry: side door with a 4-pin padlock, or short the keypad (Electronics 1, oscilloscope minigame).
- Interior: two laser tripwires (jump the low beam, crouch under the high one) or cut them at the fuse box. Without Electronics this costs you health.
- Vault: 5-pin lock, or the keypad (code hinted on the whiteboard and in the blueprint; 3 wrong guesses trigger the alarm). Three loot containers roll the data-driven loot table, then the "BUNKER BUSTED" finale plays.
- Megaphone taunts from Tanner Pivotson with subtitles. Floodlights at night, alarm lighting, and the roof is cut away while you're inside.

**Gameplay / UI**
- Character select (Infiltrator / Engineer) with a live 3D preview at the campfire. Each archetype has its own model look, stats, starting kit and signature perk.
- Procedural character: primitive-built scavenger with a walk/run/crouch/jump/interact procedural animation, plus coat, scarf and antenna secondary motion.
- Third-person camera: collision, shoulder offset, sprint FOV kick, trauma shake, tighter framing indoors.
- HUD: objective tracker, toasts, segmented health, XP and level, hotbar, rotating minimap with compass and fog of war, clock and day phase, detection eye, stance pills, interaction prompts, subtitles, banners, level-up burst.
- Inventory and skills panel (grid, item details, use, carry weight, skill point spending), world map with intel log, intel reader, pause, settings, controls.
- Minigames: pin-tumbler lockpicking (find the binding pin by feel, sweet spot, overset strain, picks break), signal-match circuit bypass, keypad.
- Progression: XP from locks, intel, discovery and loot; level-ups grant skill points; 2 skills (Lockpicking, Electronics) with per-level effects.
- Save/load: localStorage autosave every 60s, saving on rest, manual save from the pause menu, and Continue on the title screen. Fog of war is RLE-encoded into the save.

### Stubbed / simplified
- Only 2 skills and 2 archetypes (per the MVP spec). Hacker and Brute are not in yet.
- The survival layer (hunger, thirst, radiation) is not implemented. Rations and shakes only heal.
- Grenade bounce uses a ray-reflect approximation, not a real rigid body.
- Drone pathing is a waypoint loop with wall-sliding avoidance, not navmesh pathfinding.
- No NPCs or traders yet; intel is delivered as world notes.
- No gamepad support.

### Next steps (v0.2 per spec)
- Tier 2 "Apex Vault" and Tier 3 "The Panopticon" as new `Bunker` data files plus builders.
- Hacking minigame v2, a proper stealth model (light and shadow sampling, noise propagation), crafting from scrap.
- Extract the generic bunker runtime (layers, obstacles and solutions) from `Garage.ts` so new bunkers are mostly data.
- Performance: chunk the terrain into LODs, impostor far props, GPU-instanced scrub via compute.
