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

### Garage graphics & VFX pass (2026-10-06)
- **Set dressing** (`src/game/bunker/garageDressing.ts`, called from `GarageBuilder`):
  - Building: ribbed roll-up door with guide rails and an inside barrel housing, plinth, roof fascia, gutters and downspouts, a meter box and conduit, a fake CCTV camera with a blinking LED, barred windows, roof AC unit, vents, a hatch and sandbags.
  - Yard: fuel drums (one tipped and leaking), jerry cans, a cable-reel table, pallets and cartons, tyre stacks, the "Executive Restroom" porta-john, sawhorses, a drone-dock pylon with cables, fence signs, and the tarp truck on visible wheels.
  - Workshop: ceiling slab with steel joists and fluorescent fixtures, pegboard tools, bench clutter, a rolling tool chest, two shelving units of supplies, a standing desk with monitors, and a fridge.
  - Vault: steel cladding, shelving with cash and gold, a cash pallet, a hooded founder mannequin behind a velvet rope, an alarm beacon, and a rebuilt vault door (frame, rivets, spoked wheel, hinges, bolts).
  - Bigger props have colliders. Interaction points and gameplay colliders are unchanged.
- **Decal atlas** (`garageAtlas.ts`): one 2048² canvas holds every painted detail (oil, tracks, cracks, hazard stripes, posters, signs, graffiti, light pools, wall washes).
  - All decals merge into one lit mesh and one additive mesh.
  - Light pools and neon washes follow `uPoolNight` and the neon flicker.
- **Draw-call tools:**
  - `GlowPalette` (`materials.ts`) puts every small static glow in ONE material. Each slot is a colour/intensity entry in a uniform array, picked by the geometry's uv.x. Blinkers write `slot.intensity.value`.
  - `GlowSprites` (`effects.ts`) is a single instanced sprite of soft halos. Each halo reads a channel (`CH` in `garageDressing.ts`) that `Garage.updateLights` sets, so halos stay in sync with blinkers, night, tubes, alarm and lasers.
- **VFX:**
  - `Sparks` (GPU streaks with gravity and floor skid) fire on drone brown-outs, crashes and EMP hits, and when the fuse box is cut.
  - The EMP `Shockwave` has a crackling shell, a ground shock ring, a core flash, re-striking arcs and electric sparks. `Game` passes `garage.sparks` and the camera position.
  - Light cones fade near the camera.
  - Lasers have a crisp core, shimmer, dust glints and a red line on the floor.
- **SeedBot:** parts are merged per material (~20 meshes down to ~7). It gains skids, rotor guards, counter-rotating props, nav lights with a strobe, an eye halo that cross-fades by state, motor sparks, and smoke while knocked out.
- **Fixes:**
  - `concrete()` streak stains no longer paint diagonal stripes across floors (they only apply to walls now).
  - The ceiling slab seals the light gap under the tilted roof.
  - The graffiti subtitle no longer overflows its canvas.
- **Draw calls** (headless, `renderer.info.render.drawCalls`, same views): about 25–35 fewer at most Garage views, despite ~2.5× the triangles (e.g. exterior 338 → 311, yard at night 322 → 298, workshop 307 → 296, roofline 367 → 334). Garage + drone objects went from 117 to 103.
- **Next:**
  - concertina wire
  - interior dust motes in the tube light
  - the alarm beacon as a rotating light cone
  - Test the WebGPU path, since `uniformArray` is indexed per vertex in `GlowPalette` and `GlowSprites`. Only WebGL2 was verified headless.

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

### Desktop freeze: the real cause (2026-10-06, overnight)
- The owner's "frozen" reports were never input or game logic. **The window stopped presenting frames** while the page kept rendering, and `?bench` still said 50 fps. Found with a screenshot oracle: `grim` the window every 0.5 s and compare md5s.
- Trigger: **WebKitGTK's own pointer lock** (its X grab from the UI-process connection). Entering gameplay requests pointer lock, so the picture froze at Continue / Enter the Wasteland.
  - A grab held by a *separate* X client (same hidden cursor, same confine-to) leaves presentation live.
  - Rarely, it also stalled without a lock while tiled. It hasn't reproduced since.
- Fix: in the Linux app `Input` uses **native capture**. `mouse_capture(on)` in `rawmouse.rs` grabs the pointer on our window from its own X connection (invisible cursor, confined, no events), and mouse look comes from XI2 raw motion.
  - Escape and window blur release it, since there's no browser Escape handling.
  - Game code listens for `bb-lockchange` / `bb-lockerror`, which fire for either capture kind.
- Also fixed: XWayland exposes the mouse as `xwayland-pointer` (absolute) and `xwayland-relative-pointer`. Summing the absolute device's raw values spun the camera ~19 turns. Only relative slave pointers count now.
- Verified with screenshots at 1512×910: 60 s captured, 120/120 frames changed; walking and looking work; 51–54 fps. Earlier dead ends: native Wayland on NVIDIA (Error 71 / ~25 fps), Intel native Wayland (~18 fps on High).
### Weather and world atmosphere (2026-10-06)
- **Dust storms** (`src/game/world/Weather.ts`): calm (first storm 3.5–6 min into a session, then every 7–12 min) → *front* (a ragged brown wall rises on the upwind horizon, ~50 s) → *storm* (1.5–3 min) → *clearing*. Only scheduled while playing with no modal open.
  - Everything reads two numbers off the Atmosphere (`storm`, `stormFront`), so the storm is uniforms, not meshes. Fog thickens to ~60 m visibility, the sky becomes one brown dome with a pale sun disc, the sun dims (shadows go soft) and the hemi light turns dusty.
  - `SandStreaks` (effects.ts) is one sprite draw call, and only while windy. Ground haze, dust motes, terrain sand ribbons, scrub (stiff stems, faster flutter), tumbleweeds (bigger hops) and a storm audio layer (hiss, whistling howl, buffeting rumble) all scale with it.
  - Stealth: `DroneSense.visibility` (from `atmo.visibility`) shrinks SeedBot's sight range (to ~45 %) and slows detection. Toasts announce the front and the clearing.
  - Dry lightning in thick storms (every 9–31 s): a few rapid flash pulses light the dust from inside (`uFlash`) and thunder follows after a delay that depends on distance (`audio.thunder(k)`). `game.weather.strike()` triggers one.
  - Debug: `game.weather.storm(v, instant?)`, `game.weather.rollIn()` (natural cycle now), `game.weather.auto()`, URL `?storm` / `?storm=0.6`.
- **Sky/light:** exposure now follows sun elevation (`atmo.exposure` → `post.exposure`; 0.78 at noon to 1.55 at night). The day sky is a deeper blue, with darker haze and less ambient, and terrain albedos are mid-tones, so noon no longer bleaches to white. Twilight has an afterglow under the set sun and a pink anti-twilight arch. At night there's a milky way, two star layers, a cratered moon and brighter moonlight.
- **Horizon:** the far city is now a dead megacity of supertall ruins that clears the bounding mountains. At night a few windows glow and roof beacons blink. Still one mesh.
- **Dust devils** (`DustDevils`, effects.ts): up to four slim spinning sand columns wander the flats on bright, calm afternoons (none in storms). One sprite draw call, placed on the GPU and world-anchored. `game.devils.pin(x, z)` parks one for screenshots.
- **Ground:** pebble/grit patches in the terrain shader. Tumbleweeds are hollow twig balls in one InstancedMesh (−18 draw calls when they're in view).
- **Gotchas found:**
  - three skips per-object uniform refreshes for *plain* (non-node) materials whose object and lights didn't change. Object-group fog uniforms went stale on the far city while the sun stood still. All Atmosphere uniforms are now in `renderGroup`.
  - `pow()` of a negative base is NaN in GLSL, and `NaN * 0` is still NaN. One NaN pixel blacks out the whole frame through bloom. Clamp pow bases.
  - `wind × time` in shaders jumps whenever the wind changes. Integrate offsets on the CPU (`uCloudDrift`, `uSandFlow`, Scrub `uGust`).
- Draw calls are unchanged or slightly lower: golden-hour spawn view 282 → 276, camp at night 197 → 185, storm +1. Headless fps is pinned at 60 before and after, including 1440p Ultra.
- Next: dust settling on surfaces after a storm, weather in the save file.

### Desktop mouse look (2026-10-05)
- Symptom (owner): "can't move, nothing works" in the installed app. The `?trace` log from the owner's real session showed:
  - Pointer lock engaged, but real mouse motion arrived as 3–15 px/s (vs ~600 px/s unlocked), so the view never turned.
  - Keys did arrive. W was pressed mostly while the Pause menu was open (after Escape), so nothing moved.
- Cause: WebKitGTK's X11 pointer lock (`PointerLockManagerX11.cpp`, fetched from Arch debuginfod) measures motion from the lock point and recentres with `XWarpPointer`. Under XWayland an X client can't move the real cursor, so it pins at the window edge.
- Fix: `src-tauri/src/rawmouse.rs` reads XInput2 **raw** motion on its own X connection (`x11-dl`, already in the tree). `Input.pollRaw()` polls `raw_mouse_delta` every frame while locked and ignores browser `movementX` once raw motion flows. WebKit's lock still hides and confines the cursor. Two gotchas:
  - Announce XI **≥2.1**. Under 2.0 rules, raw events don't reach root listeners while another client (WebKit) holds the grab.
  - Call `XInitThreads()` before GTK opens its display, because Xlib is now used from two threads.
- Measured with XTest: 1000 px of motion → 2.14 rad of yaw via raw. WebKit's own events delivered ~440 px of it.
- Pointer-lock requests can fail (e.g. the window isn't focused). `pointerlockerror` now shows "Click to resume", and clicking the view retries.
- Ruled out along the way:
  - The `WebKitWebProcess` core dumps are an NVIDIA EGL crash during *teardown* (`GLContext::~GLContext` from `stopRunLoop`) after the window closes. Harmless.
  - Native Wayland on NVIDIA either aborts (dmabuf: Error 71, still with WebKitGTK 2.52.6 / driver 610) or runs ~25 fps (no dmabuf).
- Test tooling: an XTest injector (`xt`) drives the XWayland window. Focus the window via Hyprland first, or WebKit denies pointer lock and keys go nowhere. Run the app via `systemd-run --user … stdbuf -oL` for the launcher environment and an unbuffered log. `?pr=1.25` caps the render pixel ratio.

### Desktop menu performance (2026-10-05)
- The owner reported a few fps in menus in the installed app. Measured in the app at their window size (1512×910 logical, 1.25 scale): title 12–14 fps, menu open ~14 fps.
- Cause: CSS `backdrop-filter: blur` on every `.panel`, big blurred `drop-shadow` filters on the logo, `mix-blend-mode` glitch/scanlines, and animated overlays. WebKitGTK re-rasterises these on the CPU over the live WebGL canvas every frame.
- Fix: `html.lowfx` (set in `src/main.ts` for WebKitGTK; override with `?lowfx=0|1`) swaps them for flat equivalents. Result: title 50–55 fps, menus ~45 fps, in-game ~51 fps on High (~54 on Medium).
- Debug: `?open=controls|settings` opens a menu over the title for benchmarking.
- Benchmarking a real-size window from a script: float and resize it with `hyprctl dispatch 'hl.dsp.window.float({ action = "set", window = "class:Bunker-busters" })'` and `'hl.dsp.window.resize({ x = 1512, y = 910, window = "class:Bunker-busters" })'`. Windows on hidden workspaces aren't rendered, so it must stay visible.

### Desktop click fix (2026-10-05)
- Symptom: in the installed app the title menu looked frozen. Clicking Continue or New Game did nothing; the game itself ran fine with `?autostart`.
- Cause: on the NVIDIA/XWayland path (`GDK_BACKEND=x11`), GTK3's XInput2 handling never delivered mouse button events to WebKit. `?trace` showed key presses arriving but no pointerdown, mousedown or click at all.
- Fix: `GDK_CORE_DEVICE_EVENTS=1` alongside `GDK_BACKEND=x11` (`select_gpu()` and `run-nvidia.sh`). Tested side by side with the owner: XWayland + this flag beat native Wayland on Intel for both speed and looks.
- Uncaught JS errors and unhandled rejections are now logged to the console, so they reach stdout in the desktop app. `?trace` (or `?trace=A`, which shows a label) logs input events.
- The launcher entry uses an absolute icon path. Omarchy's launcher doesn't resolve theme icon names from `~/.local`.
- Driving the desktop window from a script: focus it with `hyprctl dispatch 'hl.dsp.focus({ window = "class:Bunker-busters" })'` (this Hyprland uses the Lua dispatch syntax). `wtype` keys reach the XWayland window as Escape, so for real clicks, ask the owner.

### In-app updates (2026-10-05)
- The desktop app checks GitHub for a newer signed release on the title screen and shows an "Update available" card. It lists the CHANGELOG bullets and offers **Update & restart** with a progress bar.
- Built on `tauri-plugin-updater`, wrapped in our own commands (`src-tauri/src/update.rs`), so no capability files or JS plugin API are needed. The browser build never shows it.
- Install types:
  - The tarball binary (Omarchy) is swapped in place without root.
  - The AppImage is replaced in place.
  - The .deb goes through pkexec.
  - Windows runs the NSIS installer in passive mode.
- The bundler stamps the bundle type ("deb", "appimage"…) into a *copy* of the binary for each package. `target/release/bunker-busters` stays "unknown", so the tarball updates as a plain binary. CI checks this. Don't rewrite markers by string replace: on CI's compiler the other type names are match literals in the binary.
- CI signs everything with `TAURI_SIGNING_PRIVATE_KEY` and publishes `latest.json` (`scripts/update-manifest.mjs`). The release notes come from `CHANGELOG.md` (`scripts/changelog.mjs`), and `release.sh` requires an entry.
- v0.1.0 installs have no updater, so they need one manual download of v0.1.1. Updates are in-app from then on.

### Realism pass (2026-10-05)
Owner feedback: the hands looked like "zombie hook hands", and falling and other physics weren't believable.

**Hands (`Hands.ts`, rebuilt)**
- Anatomy:
  - The palm is a remapped rounded box: tapers to the wrist, arched back, thenar and hypothenar pads.
  - Knuckles sit on an arc, with the middle finger furthest forward and the pinky set back.
  - Joints are full spherical caps, so bent fingers don't open gaps.
  - DIP flexion is about ⅔ of PIP, like real tendons. A single curl value cascades: the index finger stays straightest and the pinky curls most.
  - The thumb sits on the correct side and lies along the index finger.
- Forearms use two-bone IK (`SHOULDER`/`UPPER`/`FORE`, elbow pole down and out), plus an upper-arm sleeve for big reaches. The wrist now bends against a forearm that heads toward a real elbow, instead of the forearm being glued to the hand.
- Presentation:
  - Empty hands hang out of view, like real arms. The `idle` pose is `DOWN`, and lowered rigs skip their ~30 draw calls.
  - Hands rise for actions, the torch, a sprint arm-pump (counter-phase with the stride) and a falling/balance reflex.
- Pose blending is a critically damped spring per channel, so the hands accelerate and settle. The off-hand lags slightly.
- Landing drops the arms through a spring. The flashlight beam follows the torch hand.
- Fresnel rim emissive cut from 0.35 to 0.08. It was the glowing red outline in the owner's night screenshot. Bump strength was retuned for the shrunken viewmodel.
- Interactions fire when the hand arrives (~0.25 s), not on the keypress. A new action fires the interrupted action's pending callback, so an interrupted eat still heals. E/F are ignored while the hands are busy.
- Lab: `&view=side|palm|top&hand=r|l` orbit camera, `&frame={…}` movement state, `&t=` sim time.

**Movement physics (`Player.ts`)**
- Real gravity (9.81, it was 19). Jump apex is ~0.55 m (it was ~0.95 m); the low laser at 0.32 m is still easy to clear.
- Acceleration-limited movement with mass:
  - 10 m/s² from a standstill, 5 m/s² building into a sprint, 16 m/s² braking.
  - 1.2 m/s² of air steering. In the air, momentum carries.
- Quadratic air drag, terminal velocity ~55 m/s.
- Walking off a ledge starts the fall from rest, not from the −2 m/s ground-snap velocity.
- Landing:
  - A recovery beat before the next jump (no bunny-hopping).
  - Horizontal speed bleeds off on hard impacts.
  - A stumble after more than 6 m/s: slowed, no sprint.
- Fall damage above 7.7 m/s impact (~3 m): (v − 7.7) × 11, scaled by toughness. 5 m ≈ 28 HP and 9 m ≈ 80 HP for the Infiltrator.
- Crouching in mid-air tucks the legs: the feet rise and the head stays put (`onTuck` → `cam.shiftEye`).
- Slower backpedal and strafe. Speed follows the terrain grade (uphill slower).
- Stamina: ~14 s of sprinting, recovered in ~5 s standing. Run dry and you're winded until it's back to 40%. No HUD bar: procedural breathing (`audio.breathe`) and a view heave tell you.
- Measured headless: apex 0.52 m; impact 6.7 / 9.5 / 13.0 m/s from 2.5 / 5 / 9 m (ideal 7.0 / 9.9 / 13.3; the gap is drag).

**Camera**
- Footsteps fire at the low point of the first-person stride (`cam.onStep`), so sound and head-bob agree. Before, they ran on the hidden body's own clock.
- Landing dip scales with impact speed (knees absorb up to ~24 cm, plus a nod). Hard landings add shake.

**World physics**
- `physics.world.timestep = dt` every frame. It was a fixed 1/60 per rendered frame, so physics ran 2.4× fast at 144 Hz.
- The EMP canister is a real Rapier rigid body: ~0.5 kg, restitution 0.32, CCD, spin on release. It inherits the player's velocity and makes impact sounds (`bounce`) and dust. The character controller ignores dynamic bodies (`EXCLUDE_DYNAMIC`), so you can walk into it and nudge it.
- SeedBot has a thrust model:
  - Lift ∝ rotor spin² under a PD altitude controller.
  - An EMP drops it like a stone (rotors spin down, ~0.4 s): it crashes, bounces, rests tilted, then spins up, lifts off and rights itself.
  - Brownouts sag and wobble on stuttering thrust.
  - It banks into acceleration, not velocity.

**FX / audio**
- `DustPuffs` (`effects.ts`): one sprite draw call with a GPU-animated ring buffer (drag, wind drift, rise, growth, fade, soft-particle depth fade, haze lighting). Fired on landings, sprint footfalls on sand, canister bounces and the drone crash.
- New sounds: `thud` (painful landing / crash), `bounce` (small steel can), richer `land`, and breathing.

**Next**
- The owner should play-test the feel: acceleration, stamina length, fall-damage curve and hidden idle hands are tuning knobs at the top of `Player.ts` and in `POSES`.
- Not done: dust storms, footstep surface types beyond sand/metal, a ragdoll for the shadow body.

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
